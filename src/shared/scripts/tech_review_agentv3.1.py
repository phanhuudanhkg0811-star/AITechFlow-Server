"""
Tech Review Agent v3 — Project-Aware Smart Filtering
Tự động phát hiện loại dự án (React, Django, Flutter, ML, ...)
rồi áp rule filter riêng cho từng loại để tối ưu file gửi lên LLM.

Yêu cầu:
    pip install google-generativeai

Cần để cùng thư mục:
    project_detector.py
    smart_filter.py

Cách dùng:
    python tech_review_agent.py --github https://github.com/owner/repo --key YOUR_KEY
    python tech_review_agent.py --zip repo.zip --key YOUR_KEY
    python tech_review_agent.py --folder ./my_project --key YOUR_KEY
    python tech_review_agent.py --demo --key YOUR_KEY
"""

import os
import re
import sys
import json
import zipfile
import argparse
import textwrap
import tempfile
import urllib.request
import builtins
from pathlib import Path



try:
    import google.generativeai as genai
except ImportError:
    print("❌  Thiếu thư viện. Chạy: pip install google-generativeai")
    sys.exit(1)

try:
    from project_detector import detect_project_types, ProjectType
    from smart_filter import smart_filter, FilterResult
except ImportError as e:
    print(f"❌  Không tìm thấy module: {e}")
    print("    Đảm bảo project_detector.py và smart_filter.py nằm cùng thư mục.")
    sys.exit(1)


# ─────────────────────────────────────────────
# 1. CONFIG
# ─────────────────────────────────────────────

# LƯU Ý QUAN TRỌNG CHO NESTJS:
# Ép TẤT CẢ lệnh print() trong file này tự động in ra luồng stderr (luồng log/lỗi).
# Điều này giúp luồng stdout hoàn toàn sạch sẽ, không chứa các dòng text trang trí.
original_print = builtins.print
def stderr_print(*args, **kwargs):
    if 'file' not in kwargs:
        kwargs['file'] = sys.stderr
    original_print(*args, **kwargs)
builtins.print = stderr_print

def send_result_to_nestjs(data: dict):
    """Hàm duy nhất được phép in ra stdout để NestJS hứng và parse JSON"""
    original_print(json.dumps(data, ensure_ascii=False))

# Extension được load khi đọc ZIP / folder
# (smart_filter sẽ lọc thêm theo loại dự án)
LOAD_EXTENSIONS = {
    ".py", ".js", ".ts", ".java", ".go",
    ".cs", ".cpp", ".c", ".rb", ".php",
    ".jsx", ".tsx", ".kt", ".swift", ".dart",
    ".vue", ".svelte",
    ".sql", ".tf", ".yaml", ".yml",
    ".json", ".toml", ".gradle", ".mod",
    ".rb", ".erb",
}

# Thư mục bỏ qua ngay khi load (rác chắc chắn)
LOAD_SKIP = {
    "node_modules", "__pycache__", ".git", "venv", ".venv",
    "dist", "build", "vendor", "third_party",
    ".gradle", ".dart_tool", ".pub-cache",
    "Pods", "DerivedData", ".build",
}

MAX_FILES = 50
MAX_CHARS = 600_000


# ─────────────────────────────────────────────
# 2. ĐỌC FILE
# ─────────────────────────────────────────────

def load_from_zip(zip_path: str) -> dict[str, str]:
    files = {}
    with zipfile.ZipFile(zip_path) as z:
        names = z.namelist()
        
        # Detect if there's a single root folder (typical for GitHub zips)
        root_dir = None
        if names:
            first_parts = names[0].replace("\\", "/").split("/")
            if len(first_parts) >= 1:
                potential_root = first_parts[0]
                if all(n.replace("\\", "/").startswith(potential_root + "/") or n.replace("\\", "/") == potential_root + "/" for n in names):
                    root_dir = potential_root + "/"

        for name in names:
            if any(skip in name for skip in LOAD_SKIP):
                continue
            if Path(name).suffix.lower() not in LOAD_EXTENSIONS:
                continue
            try:
                content = z.read(name).decode("utf-8", errors="ignore")
                if content.strip():
                    normalized_name = name.replace("\\", "/")
                    if root_dir and normalized_name.startswith(root_dir):
                        normalized_name = normalized_name[len(root_dir):]
                    if normalized_name:
                        files[normalized_name] = content
            except Exception:
                pass
    return files


def load_from_folder(folder_path: str) -> dict[str, str]:
    files = {}
    for path in Path(folder_path).rglob("*"):
        if any(skip in str(path) for skip in LOAD_SKIP):
            continue
        if path.suffix.lower() not in LOAD_EXTENSIONS:
            continue
        try:
            content = path.read_text(encoding="utf-8", errors="ignore")
            if content.strip():
                files[str(path.relative_to(folder_path)).replace("\\", "/")] = content
        except Exception:
            pass
    return files


# ─────────────────────────────────────────────
# 3. TẢI TỪ GITHUB
# ─────────────────────────────────────────────

def parse_github_url(url: str) -> tuple[str, str, str | None]:
    url = url.strip().rstrip("/")
    if url.endswith(".git"):
        url = url[:-4]

    # Cảnh báo nếu user copy URL template chưa thay branch
    PLACEHOLDER_BRANCHES = {"BRANCH_NAME", "branch_name", "<branch>", "BRANCH", "YOUR_BRANCH"}
    pattern = r"github\.com/([^/]+)/([^/]+)(?:/tree/([^/]+))?"
    match = re.search(pattern, url)
    if not match:
        raise ValueError(
            f"URL GitHub không hợp lệ: {url}\n"
            f"  Định dạng đúng:\n"
            f"    https://github.com/owner/repo\n"
            f"    https://github.com/owner/repo/tree/branch-name"
        )

    owner, repo, branch = match.group(1), match.group(2), match.group(3) or None

    # Nếu branch là placeholder → bỏ qua, để auto-detect
    if branch and branch in PLACEHOLDER_BRANCHES:
        print(f"⚠️  Phát hiện branch placeholder '{branch}' trong URL — sẽ tự động detect branch mặc định.")
        branch = None

    return owner, repo, branch



def _try_download_zip(url: str, zip_path: str) -> int:
    """
    Thử tải một URL về zip_path.
    Trả về số byte tải được, hoặc raise HTTPError nếu thất bại.
    """
    req = urllib.request.Request(url, headers={"User-Agent": "TechReviewAgent/3.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        total      = resp.headers.get("Content-Length")
        downloaded = 0
        with open(zip_path, "wb") as f:
            while chunk := resp.read(65536):
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded / int(total) * 100
                    print(f"\r    Tiến độ: {pct:.0f}% ({downloaded//1024}KB)", end="", flush=True)
                else:
                    print(f"\r    Đã tải: {downloaded//1024}KB", end="", flush=True)
    return downloaded


def _fetch_repo_info(owner: str, repo: str) -> tuple[str, str, list[str]]:
    """
    Gọi GitHub API để lấy:
      - default_branch : branch mặc định của repo
      - repo_full_name : tên đầy đủ (owner/repo)
      - all_branches   : danh sách TẤT CẢ branch (tối đa 100)

    Raise RuntimeError nếu repo không tồn tại / private.
    Trả về (default_branch="main", repo, []) nếu API bị rate-limit.
    """
    headers = {"User-Agent": "TechReviewAgent/3.0"}

    # ── 1. Thông tin repo ──
    try:
        req = urllib.request.Request(
            f"https://api.github.com/repos/{owner}/{repo}", headers=headers
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            info = json.loads(resp.read())
            default_branch = info.get("default_branch", "main")
            repo_full_name = info.get("full_name", f"{owner}/{repo}")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise RuntimeError(
                f"Repo không tồn tại hoặc là private: {owner}/{repo}\n"
                f"  Kiểm tra lại URL hoặc đảm bảo repo là public."
            ) from e
        print(f"⚠️  GitHub API lỗi {e.code} — tiếp tục với thông tin hạn chế.")
        return "main", f"{owner}/{repo}", []
    except Exception as e:
        print(f"⚠️  Không kết nối được GitHub API: {e}")
        return "main", f"{owner}/{repo}", []

    # ── 2. Danh sách tất cả branch (per_page=100, chỉ lấy trang đầu) ──
    all_branches: list[str] = []
    try:
        req2 = urllib.request.Request(
            f"https://api.github.com/repos/{owner}/{repo}/branches?per_page=100",
            headers=headers,
        )
        with urllib.request.urlopen(req2, timeout=10) as resp2:
            all_branches = [b["name"] for b in json.loads(resp2.read())]
    except Exception:
        pass  # Không lấy được branches thì thôi, vẫn dùng được default

    return default_branch, repo_full_name, all_branches


def download_from_github(github_url: str) -> str:
    owner, repo, branch_hint = parse_github_url(github_url)

    print(f"🔍  Kiểm tra repo {owner}/{repo} qua GitHub API...")
    default_branch, repo_full_name, all_branches = _fetch_repo_info(owner, repo)

    if all_branches:
        print(f"    Repo có {len(all_branches)} branch, mặc định: '{default_branch}'")
    else:
        print(f"    Branch mặc định: '{default_branch}'")

    # ── Xây danh sách candidates ──────────────────────────────────────────
    # Thứ tự ưu tiên:
    #   1. Branch user chỉ định trong URL (nếu có và tồn tại thật)
    #   2. Default branch của repo
    #   3. Fallback common names (chỉ thêm nếu tồn tại thật, hoặc API không trả branch list)
    candidates: list[str] = []

    def branch_exists(name: str) -> bool:
        """True nếu branch tồn tại trong danh sách API, hoặc API không có list (uncertain)."""
        if not all_branches:
            return True   # không có danh sách → cứ thử
        return name in all_branches

    if branch_hint:
        if branch_exists(branch_hint):
            candidates.append(branch_hint)
        else:
            # Branch user gõ không tồn tại → cảnh báo ngay, không thử
            branch_list_str = "\n    ".join(all_branches[:20])
            suffix = f"\n    ... và {len(all_branches) - 20} branch khác" if len(all_branches) > 20 else ""
            raise RuntimeError(
                f"Branch '{branch_hint}' không tồn tại trong repo {owner}/{repo}.\n"
                f"  Danh sách branch hiện có:\n"
                f"    {branch_list_str}{suffix}\n\n"
                f"  Dùng đúng tên branch, ví dụ:\n"
                f"    --github https://github.com/{owner}/{repo}/tree/{default_branch}"
            )

    if default_branch not in candidates:
        candidates.append(default_branch)

    # Thêm fallback phổ biến — chỉ nếu chúng thực sự tồn tại
    for fb in ["main", "master", "develop", "dev"]:
        if fb not in candidates and branch_exists(fb):
            candidates.append(fb)

    # ── Thử tải từng candidate ────────────────────────────────────────────
    tmp_dir  = tempfile.mkdtemp()
    zip_path = os.path.join(tmp_dir, f"{repo}.zip")

    for branch in candidates:
        zip_url = f"https://github.com/{owner}/{repo}/archive/refs/heads/{branch}.zip"
        print(f"📥  Tải {repo_full_name} (branch: '{branch}')")
        print(f"    URL: {zip_url}")
        try:
            downloaded = _try_download_zip(zip_url, zip_path)
            print(f"\n✅  Tải xong! ({downloaded//1024}KB, branch: '{branch}')")
            return zip_path
        except urllib.error.HTTPError as e:
            if e.code == 404:
                # Hiếm xảy ra vì đã filter qua all_branches, nhưng vẫn handle
                print(f"\n    ✗ Branch '{branch}' tải thất bại (404), thử tiếp...")
                continue
            raise RuntimeError(
                f"Lỗi HTTP {e.code} khi tải repo {owner}/{repo}.\n"
                f"  URL đã thử: {zip_url}"
            ) from e

    # Không có candidate nào thành công → chỉ cho biết branch có sẵn
    branch_list_str = "\n    ".join(all_branches[:20]) if all_branches else "(không lấy được danh sách)"
    suffix = f"\n    ... và {len(all_branches) - 20} branch khác" if len(all_branches) > 20 else ""
    raise RuntimeError(
        f"Không tải được repo {owner}/{repo} từ bất kỳ branch nào.\n"
        f"  Đã thử: {', '.join(candidates)}\n"
        f"  Danh sách branch thật của repo:\n"
        f"    {branch_list_str}{suffix}\n\n"
        f"  Chỉ định branch thủ công:\n"
        f"    --github https://github.com/{owner}/{repo}/tree/<tên-branch>"
    )


# ─────────────────────────────────────────────
# 4. BUILD CONTEXT
# ─────────────────────────────────────────────

def build_context(filter_result: FilterResult) -> str:
    """
    Gộp file thành context gửi lên Gemini.
    Thêm metadata về project type và file quan trọng nhất.
    """
    parts = []

    # ── Header tổng quan ──
    parts.append("=== TỔNG QUAN CODEBASE ===")
    parts.append(f"Loại dự án      : {filter_result.primary_type.value}")
    if len(filter_result.project_types) > 1:
        others = [t.value for t in filter_result.project_types[1:]]
        parts.append(f"Loại phụ        : {', '.join(others)}")
    parts.append(f"Số file phân tích: {len(filter_result.selected)}")
    parts.append(f"Tổng ký tự       : {filter_result.total_chars:,}")
    parts.append("")

    # Top file theo import count
    top_by_import = sorted(
        filter_result.import_counts.items(),
        key=lambda x: x[1], reverse=True
    )[:5]
    if top_by_import and any(c > 0 for _, c in top_by_import):
        parts.append("File trung tâm (được import nhiều nhất):")
        for fname, count in top_by_import:
            if count > 0:
                parts.append(f"  - {fname} (được import {count} lần)")
        parts.append("")

    # Top file theo score tổng
    top_by_score = sorted(
        filter_result.scores.items(),
        key=lambda x: x[1], reverse=True
    )[:5]
    parts.append("File ưu tiên cao nhất (theo rule loại dự án):")
    for fname, score in top_by_score:
        parts.append(f"  - {fname} (score: {score:.1f})")
    parts.append("")

    # ── Nội dung từng file (sắp xếp theo score giảm dần) ──
    sorted_files = sorted(
        filter_result.selected.items(),
        key=lambda kv: filter_result.scores.get(kv[0], 0),
        reverse=True,
    )

    for filename, content in sorted_files:
        ic    = filter_result.import_counts.get(filename, 0)
        score = filter_result.scores.get(filename, 0)

        # Label để Gemini biết mức độ quan trọng
        if ic >= 5:
            label = f"[CORE — import {ic}× | score {score:.0f}]"
        elif ic >= 2:
            label = f"[import {ic}× | score {score:.0f}]"
        elif score >= 60:
            label = f"[PRIORITY | score {score:.0f}]"
        else:
            label = f"[score {score:.0f}]"

        header = f"\n{'='*60}\nFILE: {filename} {label}\n{'='*60}\n"
        parts.append(header + content)

    return "\n".join(parts)


# ─────────────────────────────────────────────
# 5. PROMPT
# ─────────────────────────────────────────────

SYSTEM_PROMPT = """
Bạn là senior software architect với 10+ năm kinh nghiệm.
Nhiệm vụ: review codebase của một ứng viên và trả về báo cáo JSON.

Lưu ý quan trọng về context:
- Codebase đã được lọc thông minh theo LOẠI DỰ ÁN cụ thể
- File có label [CORE] hoặc [PRIORITY] là file quan trọng nhất — phân tích kỹ
- File score cao = chứa business logic cốt lõi của dự án
- Hãy điều chỉnh tiêu chí đánh giá phù hợp với loại dự án được ghi ở đầu context

QUAN TRỌNG: Chỉ trả về JSON thuần túy, không có markdown, không có backtick,
trả lời bằng tiếng Việt, tuân thủ đúng schema sau:

{
  "verdict": "PASS" | "FAIL" | "BORDERLINE",
  "overall_score": <số 0-10>,
  "seniority_estimate": "Junior" | "Mid-level" | "Senior" | "Staff",
  "job_fit": {
    "is_fit": <true hoặc false>,
    "reason": "<nhận xét về việc kỹ năng thể hiện trong code có đáp ứng Job Description hay không (nếu có JD)>"
  },
  "architecture": {
    "pattern": "<MVC | Layered | Clean Architecture | Hexagonal | Monolith | Microservice | ...>",
    "summary": "<nhận xét tổng thể về kiến trúc, 2-3 câu>",
    "scalability": "<nhận xét về khả năng mở rộng>"
  },
  "solid_scores": {
    "S": {"score": <0-10>, "comment": "<nhận xét ngắn, chỉ ra file cụ thể>"},
    "O": {"score": <0-10>, "comment": "<nhận xét ngắn>"},
    "L": {"score": <0-10>, "comment": "<nhận xét ngắn>"},
    "I": {"score": <0-10>, "comment": "<nhận xét ngắn>"},
    "D": {"score": <0-10>, "comment": "<nhận xét ngắn>"}
  },
  "issues": [
    {
      "severity": "HIGH" | "MEDIUM" | "LOW",
      "file": "<tên file cụ thể>",
      "line_hint": "<dòng code hoặc function name liên quan>",
      "description": "<mô tả vấn đề>",
      "suggestion": "<gợi ý sửa cụ thể>"
    }
  ],
  "strengths": ["<điểm mạnh 1>", "<điểm mạnh 2>", "<điểm mạnh 3>"],
  "red_flags": ["<dấu hiệu đáng lo ngại nếu có>"],
  "interview_questions": [
    "<câu hỏi kỹ thuật sâu phù hợp với level ứng viên>",
    "<câu hỏi về quyết định thiết kế họ đã đưa ra>",
    "<câu hỏi về trade-off trong kiến trúc>"
  ]
}
"""


def build_user_prompt(context: str, filter_result: FilterResult,
                      total_files: int, job_desc: str = None) -> str:
    selected = len(filter_result.selected)
    skipped  = len(filter_result.skipped)
    note = (
        f"(repo gốc có {total_files} file, "
        f"đã lọc theo rule '{filter_result.rule_used}' "
        f"còn {selected} file quan trọng nhất, bỏ qua {skipped} file)"
    ) if total_files > selected else ""

    jd_section = f"\n\nYÊU CẦU CÔNG VIỆC (JOB DESCRIPTION):\n{job_desc}\nHãy đánh giá xem kỹ năng ứng viên thể hiện trong codebase có phù hợp với vị trí này không." if job_desc else ""

    return f"""
Đây là codebase của ứng viên. {selected} file được phân tích {note}.
{jd_section}

{context}

Hãy review theo schema đã yêu cầu và trả về JSON.
"""


# ─────────────────────────────────────────────
# 6. GỌI GEMINI
# ─────────────────────────────────────────────

def call_gemini(api_key: str, context: str, filter_result: FilterResult,
                total_files: int, job_desc: str = None) -> dict:
    genai.configure(api_key=api_key)

    model = genai.GenerativeModel(
        model_name="gemini-2.5-flash",
        system_instruction=SYSTEM_PROMPT,
        
    )

    user_prompt = build_user_prompt(context, filter_result, total_files, job_desc)
    char_count  = len(context)
    print(f"\n⏳  Đang gửi {char_count:,} ký tự vào Gemini 2.5 Flash...")
    print("    (có thể mất 20-40 giây)\n")

    response = model.generate_content(
        user_prompt,
        generation_config={"response_mime_type": "application/json"}
    )
    raw = response.text.strip()

    # Bóc markdown fence nếu model trả về dù đã dặn không
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(lines[1:-1])

    return json.loads(raw)


# ─────────────────────────────────────────────
# 7. IN KẾT QUẢ
# ─────────────────────────────────────────────

def print_detection_banner(filter_result: FilterResult):
    """In banner loại dự án + rule đã áp dụng."""
    CYAN   = "\033[96m"
    BOLD   = "\033[1m"
    RESET  = "\033[0m"
    GREEN  = "\033[92m"

    print(f"\n{BOLD}{'─'*65}{RESET}")
    print(f"  {BOLD}🔬 Phát hiện loại dự án{RESET}")
    print(f"{'─'*65}")
    print(f"  Primary type : {BOLD}{CYAN}{filter_result.primary_type.value}{RESET}")
    if len(filter_result.project_types) > 1:
        others = [t.value for t in filter_result.project_types[1:3]]
        print(f"  Phụ          : {', '.join(others)}")
    print(f"  Rule áp dụng : {GREEN}{filter_result.rule_used}{RESET}")
    print(f"  File chọn    : {len(filter_result.selected)} / "
          f"{len(filter_result.selected) + len(filter_result.skipped)}")
    print(f"  Tổng ký tự   : {filter_result.total_chars:,}")
    print(f"{'─'*65}\n")


def print_filter_table(filter_result: FilterResult):
    """In bảng file được chọn kèm score và import count."""
    BOLD  = "\033[1m"
    RESET = "\033[0m"
    GREEN = "\033[92m"
    CYAN  = "\033[96m"

    print(f"\n{BOLD}📊  Bảng file được chọn:{RESET}")
    print(f"{'─'*70}")
    print(f"  {'FILE':<44} {'SCORE':>6}  {'IMPORT':>6}")
    print(f"{'─'*70}")

    sorted_files = sorted(
        filter_result.scores.items(),
        key=lambda x: x[1], reverse=True
    )

    for fname, score in sorted_files:
        ic    = filter_result.import_counts.get(fname, 0)
        short = fname if len(fname) <= 44 else "…" + fname[-43:]
        color = GREEN if score >= 60 else (CYAN if score >= 30 else RESET)
        print(f"  {color}{short:<44}{RESET} {score:>6.1f}  {ic:>6}")

    if filter_result.skipped:
        print(f"\n  ⚠️  Bỏ qua {len(filter_result.skipped)} file "
              f"(ví dụ: {', '.join(filter_result.skipped[:3])})")
    print(f"{'─'*70}")


def print_report(result: dict):
    BOLD    = "\033[1m"
    GREEN   = "\033[92m"
    RED     = "\033[91m"
    YELLOW  = "\033[93m"
    CYAN    = "\033[96m"
    MAGENTA = "\033[95m"
    RESET   = "\033[0m"

    verdict_color = {
        "PASS": GREEN, "FAIL": RED, "BORDERLINE": YELLOW
    }.get(result.get("verdict", ""), RESET)

    seniority_color = {
        "Junior": YELLOW, "Mid-level": CYAN,
        "Senior": GREEN,  "Staff": MAGENTA,
    }

    print("\n" + "="*65)
    print(f"{BOLD}          TECH REVIEW AGENT v3 — KẾT QUẢ{RESET}")
    print("="*65)

    verdict   = result.get("verdict", "N/A")
    score     = result.get("overall_score", "N/A")
    seniority = result.get("seniority_estimate", "N/A")
    sc        = seniority_color.get(seniority, RESET)

    print(f"\n{BOLD}Kết luận      :{RESET} {verdict_color}{BOLD}{verdict}{RESET}   "
          f"{BOLD}Điểm tổng:{RESET} {score}/10")
    print(f"{BOLD}Level ước tính:{RESET} {sc}{BOLD}{seniority}{RESET}")

    job_fit = result.get("job_fit")
    if job_fit and "is_fit" in job_fit:
        fit_color = GREEN if job_fit.get("is_fit") else RED
        fit_str = "PHÙ HỢP" if job_fit.get("is_fit") else "CHƯA PHÙ HỢP"
        print(f"{BOLD}Mức độ Job Fit:{RESET} {fit_color}{BOLD}{fit_str}{RESET}")
        
        reason = job_fit.get("reason", "")
        if reason:
            wrapped_reason = textwrap.fill(
                reason, width=70,
                initial_indent="  → ",
                subsequent_indent="    "
            )
            print(wrapped_reason)

    arch = result.get("architecture", {})
    print(f"\n{BOLD}{CYAN}Kiến trúc:{RESET} {arch.get('pattern', 'N/A')}")
    print(f"  {arch.get('summary', '')}")
    if arch.get("scalability"):
        print(f"  Scalability: {arch['scalability']}")

    # SOLID
    print(f"\n{BOLD}SOLID Scores:{RESET}")
    solid  = result.get("solid_scores", {})
    labels = {
        "S": "Single Responsibility",
        "O": "Open/Closed",
        "L": "Liskov Substitution",
        "I": "Interface Segregation",
        "D": "Dependency Inversion",
    }
    for key, label in labels.items():
        info  = solid.get(key, {})
        s     = info.get("score", "?")
        bar   = "█" * int(s) + "░" * (10 - int(s)) if isinstance(s, (int, float)) else ""
        color = GREEN if s >= 7 else (YELLOW if s >= 4 else RED)
        print(f"  {key} {label:<26} {color}{bar} {s}/10{RESET}")
        comment = info.get("comment", "")
        if comment:
            wrapped = textwrap.fill(
                comment, width=58,
                initial_indent="    → ",
                subsequent_indent="      ",
            )
            print(wrapped)

    # Issues
    issues = result.get("issues", [])
    if issues:
        print(f"\n{BOLD}Vấn đề phát hiện ({len(issues)}):{RESET}")
        sev_color = {"HIGH": RED, "MEDIUM": YELLOW, "LOW": CYAN}
        for i, issue in enumerate(issues, 1):
            sev   = issue.get("severity", "?")
            color = sev_color.get(sev, RESET)
            line  = issue.get("line_hint", "")
            loc   = f" → {line}" if line else ""
            print(f"\n  {i}. [{color}{sev}{RESET}] {issue.get('file', '')}{loc}")
            print(f"     Vấn đề : {issue.get('description', '')}")
            print(f"     Gợi ý  : {issue.get('suggestion', '')}")

    # Red flags
    red_flags = result.get("red_flags", [])
    if red_flags:
        print(f"\n{BOLD}{RED}Red Flags:{RESET}")
        for rf in red_flags:
            print(f"  ⚠️  {rf}")

    # Strengths
    strengths = result.get("strengths", [])
    if strengths:
        print(f"\n{BOLD}Điểm mạnh:{RESET}")
        for s in strengths:
            print(f"  ✓ {s}")

    # Interview questions
    questions = result.get("interview_questions", [])
    if questions:
        print(f"\n{BOLD}Câu hỏi phỏng vấn gợi ý:{RESET}")
        for q in questions:
            print(f"  • {q}")

    print("\n" + "="*65 + "\n")


# ─────────────────────────────────────────────
# 8. MAIN
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Tech Review Agent v3 — Project-Aware Smart Filtering",
        formatter_class=argparse.RawTextHelpFormatter,
        epilog="""
Ví dụ:
  python tech_review_agent.py --github https://github.com/owner/repo --key YOUR_KEY
  python tech_review_agent.py --zip repo.zip --key YOUR_KEY
  python tech_review_agent.py --folder ./my_project --key YOUR_KEY
  python tech_review_agent.py --demo --key YOUR_KEY
        """,
    )
    parser.add_argument("--key",       required=True, help="Gemini API key")
    parser.add_argument("--github",    help="GitHub repo URL (tự động tải)")
    parser.add_argument("--zip",       help="File .zip của repo")
    parser.add_argument("--folder",    help="Thư mục repo local")
    parser.add_argument("--demo",      action="store_true",
                        help="Dùng sample_project/ để demo")
    parser.add_argument("--job",       help="Mô tả công việc (chuỗi hoặc đường dẫn file .txt) để đánh giá mức độ phù hợp")
    parser.add_argument("--output",    help="Lưu kết quả JSON (mặc định: review_<repo>.json)")
    parser.add_argument("--max-files", type=int, default=MAX_FILES,
                        help=f"Số file tối đa gửi đi (default: {MAX_FILES})")
    parser.add_argument("--show-files", action="store_true",
                        help="In bảng file được chọn kèm score")
    args = parser.parse_args()

    repo_name = "review"

    # ── 1. Load file ──
    if args.github:
        zip_path  = download_from_github(args.github)
        all_files = load_from_zip(zip_path)
        try:
            _, repo_name, _ = parse_github_url(args.github)
        except Exception:
            pass

    elif args.demo:
        folder = Path(__file__).parent / "sample_project"
        print(f"📂  Demo mode: {folder}")
        all_files = load_from_folder(str(folder))
        repo_name = "demo"

    elif args.zip:
        print(f"📦  Đọc zip: {args.zip}")
        all_files = load_from_zip(args.zip)
        repo_name = Path(args.zip).stem

    elif args.folder:
        print(f"📂  Đọc folder: {args.folder}")
        all_files = load_from_folder(args.folder)
        repo_name = Path(args.folder).name

    else:
        parser.print_help()
        sys.exit(1)

    if not all_files:
        print("❌  Không tìm thấy file code nào.")
        sys.exit(1)

    total_files = len(all_files)
    print(f"✅  Đọc được {total_files} file")

    # ── 2. Detect project type ──
    print("\n🔍  Đang phân tích loại dự án...")
    detection = detect_project_types(all_files)

    # ── 3. Smart filter theo loại dự án ──
    print(f"⚙️   Áp rule filter cho: {detection.primary.value}")
    filter_result = smart_filter(
        all_files,
        detection=detection,
        max_files=args.max_files,
        max_chars=MAX_CHARS,
    )

    # ── 4. In kết quả filter ──
    print_detection_banner(filter_result)
    if args.show_files:
        print_filter_table(filter_result)

    # ── 5. Build context & gọi Gemini ──
    context = build_context(filter_result)

    job_desc = args.job
    if job_desc and os.path.isfile(job_desc):
        try:
            with open(job_desc, "r", encoding="utf-8") as f:
                job_desc = f.read()
        except Exception as e:
            print(f"⚠️  Không thể đọc file JD: {e}")

    result = call_gemini(
        api_key=args.key,
        context=context,
        filter_result=filter_result,
        total_files=total_files,
        job_desc=job_desc,
    )

    # ── 6. In và lưu kết quả ──
    # ── 6. In và lưu kết quả ──
    print_report(result) # Report này giờ sẽ an toàn vì đã bị ép qua stderr

    output_path = args.output or f"review_{repo_name}.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"💾  Kết quả JSON lưu tại: {output_path}") # Cái này cũng qua stderr
    
    # THÊM DÒNG NÀY ĐỂ TRẢ JSON VỀ CHO NESTJS:
    send_result_to_nestjs(result)


if __name__ == "__main__":
    main()
