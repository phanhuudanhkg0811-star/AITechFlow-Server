"""
project_detector.py — Phát hiện loại dự án từ cấu trúc repo

Cách dùng:
    from project_detector import detect_project_types, ProjectType

    all_files = {"package.json": "...", "src/App.tsx": "..."}
    types = detect_project_types(all_files)
    # → [ProjectType.FRONTEND_REACT, ProjectType.FRONTEND_TS]
"""

import re
import json
from enum import Enum
from pathlib import Path
from dataclasses import dataclass, field


# ─────────────────────────────────────────────
# 1. ĐỊNH NGHĨA CÁC LOẠI DỰ ÁN
# ─────────────────────────────────────────────

class ProjectType(str, Enum):
    # Frontend
    FRONTEND_REACT      = "frontend_react"
    FRONTEND_VUE        = "frontend_vue"
    FRONTEND_ANGULAR    = "frontend_angular"
    FRONTEND_SVELTE     = "frontend_svelte"
    FRONTEND_VANILLA    = "frontend_vanilla"

    # Backend
    BACKEND_PYTHON      = "backend_python"      # Django / FastAPI / Flask
    BACKEND_NODE        = "backend_node"         # Express / NestJS / Fastify
    BACKEND_JAVA        = "backend_java"         # Spring Boot
    BACKEND_GO          = "backend_go"
    BACKEND_DOTNET      = "backend_dotnet"       # ASP.NET
    BACKEND_RUBY        = "backend_ruby"         # Rails / Sinatra
    BACKEND_PHP         = "backend_php"          # Laravel / Symfony

    # Mobile
    MOBILE_FLUTTER      = "mobile_flutter"
    MOBILE_ANDROID      = "mobile_android"       # Kotlin / Java
    MOBILE_IOS          = "mobile_ios"           # Swift / ObjC
    MOBILE_RN           = "mobile_react_native"

    # Data / AI / ML
    DATA_SCIENCE        = "data_science"         # pandas, jupyter
    ML_TRAINING         = "ml_training"          # torch, tensorflow
    ML_INFERENCE        = "ml_inference"         # serving/triton
    DATA_PIPELINE       = "data_pipeline"        # airflow, prefect, dbt

    # Infra / DevOps
    INFRA_TERRAFORM     = "infra_terraform"
    INFRA_K8S           = "infra_k8s"

    # Không xác định
    UNKNOWN             = "unknown"


@dataclass
class DetectionResult:
    types: list[ProjectType]
    confidence: dict[ProjectType, float]   # 0.0 – 1.0
    signals: dict[ProjectType, list[str]]  # lý do detect
    primary: ProjectType = ProjectType.UNKNOWN

    def __post_init__(self):
        if self.types:
            self.primary = self.types[0]

    def summary(self) -> str:
        if not self.types:
            return "Không xác định được loại dự án"
        lines = [f"Loại dự án phát hiện được ({len(self.types)}):"]
        for pt in self.types:
            conf = self.confidence.get(pt, 0)
            sigs = self.signals.get(pt, [])
            lines.append(
                f"  • {pt.value:<28} confidence={conf:.0%}  "
                f"[{', '.join(sigs[:3])}]"
            )
        return "\n".join(lines)


# ─────────────────────────────────────────────
# 2. SIGNAL DEFINITIONS
#    Mỗi ProjectType có bộ signal riêng:
#    - marker_files  : file/thư mục đặc trưng
#    - dep_keywords  : từ khoá trong package.json / requirements.txt / build.gradle
#    - path_patterns : regex khớp với đường dẫn file trong repo
#    - content_regex : regex khớp với nội dung file bất kỳ
# ─────────────────────────────────────────────

@dataclass
class SignalSet:
    marker_files:   list[str]       = field(default_factory=list)
    dep_keywords:   list[str]       = field(default_factory=list)
    path_patterns:  list[str]       = field(default_factory=list)
    content_regex:  list[str]       = field(default_factory=list)
    # Trọng số: marker > dep > path > content
    weights: dict[str, float] = field(default_factory=lambda: {
        "marker": 0.5,
        "dep":    0.3,
        "path":   0.15,
        "content": 0.05,
    })


SIGNAL_MAP: dict[ProjectType, SignalSet] = {

    # ── FRONTEND ──────────────────────────────
    ProjectType.FRONTEND_REACT: SignalSet(
        marker_files=["public/index.html", "src/App.jsx", "src/App.tsx",
                      "src/index.jsx", "src/index.tsx", "next.config.js",
                      "next.config.ts", "vite.config.ts", "craco.config.js"],
        dep_keywords=["react", "react-dom", "next", "gatsby",
                      "@remix-run", "react-router"],
        path_patterns=[r"src/components/.*\.(jsx|tsx)$",
                       r"src/pages/.*\.(jsx|tsx)$",
                       r"src/hooks/use[A-Z].*\.(ts|js)$",
                       r"\.(jsx|tsx)$"],
        content_regex=[r"from ['\"]react['\"]",
                       r"import React",
                       r"useState|useEffect|useCallback"],
    ),

    ProjectType.FRONTEND_VUE: SignalSet(
        marker_files=["vue.config.js", "vite.config.ts", "nuxt.config.ts",
                      "nuxt.config.js"],
        dep_keywords=["vue", "@vue/core", "nuxt", "pinia", "vuex",
                      "vue-router"],
        path_patterns=[r"\.vue$", r"src/views/.*\.vue$",
                       r"src/components/.*\.vue$"],
        content_regex=[r"<template>", r"defineComponent", r"setup\(\)"],
    ),

    ProjectType.FRONTEND_ANGULAR: SignalSet(
        marker_files=["angular.json", ".angular-cli.json",
                      "src/main.ts", "src/app/app.module.ts"],
        dep_keywords=["@angular/core", "@angular/common",
                      "@angular/router", "@ngrx"],
        path_patterns=[r"\.component\.ts$", r"\.module\.ts$",
                       r"\.service\.ts$", r"\.directive\.ts$"],
        content_regex=[r"@Component\(", r"@NgModule\(",
                       r"@Injectable\("],
    ),

    ProjectType.FRONTEND_SVELTE: SignalSet(
        marker_files=["svelte.config.js", "svelte.config.ts"],
        dep_keywords=["svelte", "@sveltejs/kit"],
        path_patterns=[r"\.svelte$", r"src/routes/.*\.svelte$"],
        content_regex=[r"<script>", r"\$:", r"on:click"],
    ),

    ProjectType.FRONTEND_VANILLA: SignalSet(
        marker_files=["index.html"],
        dep_keywords=["parcel", "webpack", "rollup"],
        path_patterns=[r"\.html$", r"public/.*\.js$"],
        content_regex=[r"document\.getElementById",
                       r"querySelector", r"addEventListener"],
    ),

    # ── BACKEND ───────────────────────────────
    ProjectType.BACKEND_PYTHON: SignalSet(
        marker_files=["manage.py", "wsgi.py", "asgi.py",
                      "requirements.txt", "pyproject.toml",
                      "Pipfile", "app.py", "main.py",
                      "alembic.ini"],
        dep_keywords=["django", "fastapi", "flask", "starlette",
                      "tornado", "sanic", "aiohttp", "uvicorn",
                      "sqlalchemy", "alembic"],
        path_patterns=[r"api/.*\.py$", r"app/.*\.py$",
                       r"services/.*\.py$", r"models/.*\.py$",
                       r"views\.py$", r"serializers\.py$",
                       r"routers?/.*\.py$"],
        content_regex=[r"@app\.route", r"@router\.",
                       r"class.*View\(", r"APIRouter\(",
                       r"def get\(|def post\(|def put\("],
    ),

    ProjectType.BACKEND_NODE: SignalSet(
        marker_files=["server.js", "server.ts", "app.js", "app.ts",
                      "src/main.ts", "src/app.ts"],
        dep_keywords=["express", "fastify", "koa", "hapi",
                      "@nestjs/core", "nestjs", "restify",
                      "body-parser", "cors", "helmet",
                      "typeorm", "prisma", "sequelize"],
        path_patterns=[r"src/controllers?/.*\.(ts|js)$",
                       r"src/routes?/.*\.(ts|js)$",
                       r"src/middleware/.*\.(ts|js)$",
                       r"src/modules?/.*\.(ts|js)$"],
        content_regex=[r"express\(\)", r"Router\(\)",
                       r"@Controller\(", r"@Get\(|@Post\(",
                       r"app\.listen\("],
    ),

    ProjectType.BACKEND_JAVA: SignalSet(
        marker_files=["pom.xml", "build.gradle", "build.gradle.kts",
                      "settings.gradle", "gradlew"],
        dep_keywords=["spring-boot", "spring-web", "spring-data",
                      "spring-security", "quarkus", "micronaut",
                      "jakarta", "javax.servlet"],
        path_patterns=[r"src/main/java/.*\.java$",
                       r"Controller\.java$", r"Service\.java$",
                       r"Repository\.java$", r"Entity\.java$"],
        content_regex=[r"@SpringBootApplication",
                       r"@RestController", r"@Service",
                       r"@Repository", r"@GetMapping|@PostMapping"],
    ),

    ProjectType.BACKEND_GO: SignalSet(
        marker_files=["go.mod", "go.sum", "main.go", "cmd/main.go"],
        dep_keywords=["gin-gonic/gin", "labstack/echo",
                      "gorilla/mux", "chi", "fiber",
                      "gorm", "sqlx"],
        path_patterns=[r"\.go$", r"internal/.*\.go$",
                       r"pkg/.*\.go$", r"handler/.*\.go$"],
        content_regex=[r"func main\(\)", r"gin\.Default\(\)",
                       r"http\.ListenAndServe", r"echo\.New\(\)"],
    ),

    ProjectType.BACKEND_DOTNET: SignalSet(
        marker_files=["*.csproj", "*.sln", "Program.cs",
                      "Startup.cs", "appsettings.json"],
        dep_keywords=["Microsoft.AspNetCore", "Microsoft.EntityFrameworkCore",
                      "Newtonsoft.Json"],
        path_patterns=[r"Controllers/.*\.cs$", r"Services/.*\.cs$",
                       r"Models/.*\.cs$", r"\.cs$"],
        content_regex=[r"\[ApiController\]", r"\[HttpGet\]",
                       r"WebApplication\.Create",
                       r"IServiceCollection"],
    ),

    ProjectType.BACKEND_RUBY: SignalSet(
        marker_files=["Gemfile", "config.ru", "Rakefile",
                      "config/routes.rb", "config/application.rb"],
        dep_keywords=["rails", "sinatra", "grape", "hanami",
                      "activerecord", "rspec"],
        path_patterns=[r"app/controllers/.*\.rb$",
                       r"app/models/.*\.rb$",
                       r"app/services/.*\.rb$"],
        content_regex=[r"class.*ApplicationController",
                       r"def index|def show|def create",
                       r"belongs_to|has_many"],
    ),

    ProjectType.BACKEND_PHP: SignalSet(
        marker_files=["composer.json", "artisan", "index.php",
                      "config/app.php"],
        dep_keywords=["laravel/framework", "symfony/symfony",
                      "slim/slim", "codeigniter", "yii"],
        path_patterns=[r"app/Http/Controllers/.*\.php$",
                       r"app/Models/.*\.php$",
                       r"routes/.*\.php$"],
        content_regex=[r"namespace App\\Http",
                       r"extends Controller",
                       r"\$this->middleware"],
    ),

    # ── MOBILE ────────────────────────────────
    ProjectType.MOBILE_FLUTTER: SignalSet(
        marker_files=["pubspec.yaml", "pubspec.lock",
                      "lib/main.dart", "android/", "ios/"],
        dep_keywords=["flutter", "dart", "bloc", "provider",
                      "riverpod", "get_it", "go_router"],
        path_patterns=[r"lib/.*\.dart$", r"lib/screens?/.*\.dart$",
                       r"lib/widgets?/.*\.dart$",
                       r"lib/bloc/.*\.dart$"],
        content_regex=[r"StatelessWidget|StatefulWidget",
                       r"BuildContext", r"Widget build\(",
                       r"MaterialApp\("],
    ),

    ProjectType.MOBILE_ANDROID: SignalSet(
        marker_files=["AndroidManifest.xml", "build.gradle",
                      "app/src/main/AndroidManifest.xml",
                      "gradle/wrapper/gradle-wrapper.properties"],
        dep_keywords=["androidx", "com.android", "kotlin-android",
                      "hilt-android", "retrofit", "okhttp",
                      "room", "lifecycle"],
        path_patterns=[r"app/src/main/java/.*\.(kt|java)$",
                       r".*ViewModel\.(kt|java)$",
                       r".*Repository\.(kt|java)$",
                       r".*Activity\.(kt|java)$",
                       r".*Fragment\.(kt|java)$"],
        content_regex=[r"@HiltAndroidApp|@AndroidEntryPoint",
                       r"ViewModel\(\)|AndroidViewModel",
                       r"onCreate\(savedInstanceState"],
    ),

    ProjectType.MOBILE_IOS: SignalSet(
        marker_files=["*.xcodeproj", "*.xcworkspace",
                      "Podfile", "Package.swift",
                      "Info.plist"],
        dep_keywords=["SwiftUI", "UIKit", "Combine",
                      "CoreData", "Alamofire", "Kingfisher"],
        path_patterns=[r"\.swift$", r"Sources/.*\.swift$",
                       r".*ViewController\.swift$",
                       r".*ViewModel\.swift$"],
        content_regex=[r"import SwiftUI|import UIKit",
                       r"struct.*: View",
                       r"@State|@Binding|@ObservedObject",
                       r"func viewDidLoad"],
    ),

    ProjectType.MOBILE_RN: SignalSet(
        marker_files=["metro.config.js", "metro.config.ts",
                      "app.json", "react-native.config.js",
                      "index.js", "App.js", "App.tsx"],
        dep_keywords=["react-native", "@react-navigation",
                      "expo", "react-native-vector-icons",
                      "@react-native-community"],
        path_patterns=[r"src/screens?/.*\.(tsx|jsx)$",
                       r"src/components?/.*\.(tsx|jsx)$",
                       r"src/navigation/.*\.(ts|js)$"],
        content_regex=[r"from ['\"]react-native['\"]",
                       r"StyleSheet\.create",
                       r"<View>|<Text>|<TouchableOpacity>"],
    ),

    # ── DATA / ML ─────────────────────────────
    ProjectType.DATA_SCIENCE: SignalSet(
        marker_files=["*.ipynb", "notebooks/", "requirements.txt",
                      "environment.yml", "Pipfile"],
        dep_keywords=["pandas", "numpy", "matplotlib", "seaborn",
                      "plotly", "scipy", "statsmodels",
                      "jupyter", "ipykernel"],
        path_patterns=[r"\.ipynb$", r"notebooks?/.*\.py$",
                       r"eda/.*\.py$", r"analysis/.*\.py$"],
        content_regex=[r"import pandas as pd",
                       r"import numpy as np",
                       r"\.read_csv\(|\.read_parquet\(",
                       r"df\.|pd\.DataFrame"],
    ),

    ProjectType.ML_TRAINING: SignalSet(
        marker_files=["train.py", "trainer.py", "finetune.py",
                      "pretrain.py", "run_training.py",
                      "configs/", "checkpoints/"],
        dep_keywords=["torch", "tensorflow", "keras",
                      "transformers", "lightning", "jax",
                      "flax", "accelerate", "deepspeed",
                      "wandb", "mlflow", "optuna"],
        path_patterns=[r"(train|finetune|pretrain).*\.py$",
                       r"models?/.*\.py$", r"datasets?/.*\.py$",
                       r"losses?/.*\.py$", r"trainers?/.*\.py$"],
        content_regex=[r"model\.fit\(|trainer\.train\(",
                       r"torch\.nn\.Module",
                       r"class.*Dataset.*:",
                       r"DataLoader\(|DataCollator"],
    ),

    ProjectType.ML_INFERENCE: SignalSet(
        marker_files=["serve.py", "inference.py", "predictor.py",
                      "triton/", "bentofile.yaml", "bentoml/"],
        dep_keywords=["bentoml", "triton", "ray[serve]",
                      "torchserve", "onnxruntime", "tensorrt",
                      "tritonclient", "seldon"],
        path_patterns=[r"(serve|inference|predict).*\.py$",
                       r"api/.*model.*\.py$"],
        content_regex=[r"InferenceSession\(",
                       r"ort\.InferenceSession",
                       r"@bentoml\.service",
                       r"torch\.jit\.load|torch\.load"],
    ),

    ProjectType.DATA_PIPELINE: SignalSet(
        marker_files=["dags/", "airflow.cfg", "prefect.yaml",
                      "dbt_project.yml", "profiles.yml",
                      "Makefile", "dagster_workspace.yaml"],
        dep_keywords=["apache-airflow", "prefect", "dagster",
                      "dbt-core", "luigi", "kedro",
                      "great-expectations", "pyspark",
                      "apache-spark"],
        path_patterns=[r"dags?/.*\.py$", r"flows?/.*\.py$",
                       r"pipelines?/.*\.py$",
                       r"models?/.*\.sql$",   # dbt
                       r"jobs?/.*\.py$"],
        content_regex=[r"@dag|@task|DAG\(",
                       r"@flow|@task",
                       r"SparkSession\.builder",
                       r"SELECT.*FROM.*{{\s*ref\("],   # dbt jinja
    ),

    # ── INFRA ─────────────────────────────────
    ProjectType.INFRA_TERRAFORM: SignalSet(
        marker_files=["main.tf", "variables.tf", "outputs.tf",
                      "terraform.tfvars", ".terraform/"],
        dep_keywords=[],
        path_patterns=[r"\.tf$", r"modules?/.*\.tf$"],
        content_regex=[r"resource ['\"]", r"provider ['\"]",
                       r"variable ['\"]", r"terraform {"],
    ),

    ProjectType.INFRA_K8S: SignalSet(
        marker_files=["Chart.yaml", "values.yaml", "kustomization.yaml",
                      "k8s/", "kubernetes/", "deploy/"],
        dep_keywords=[],
        path_patterns=[r"\.ya?ml$"],
        content_regex=[r"apiVersion: apps/v",
                       r"kind: Deployment|kind: Service",
                       r"kind: Ingress|kind: ConfigMap"],
    ),
}


# ─────────────────────────────────────────────
# 3. HELPER: ĐỌC DEPENDENCY FILE
# ─────────────────────────────────────────────

def _parse_package_json(files: dict[str, str]) -> set[str]:
    """Lấy toàn bộ dependencies từ package.json."""
    deps: set[str] = set()
    for filename, content in files.items():
        if Path(filename).name != "package.json":
            continue
        try:
            data = json.loads(content)
            for section in ("dependencies", "devDependencies",
                            "peerDependencies"):
                deps.update(data.get(section, {}).keys())
        except Exception:
            pass
    return deps


def _parse_requirements_txt(files: dict[str, str]) -> set[str]:
    """Lấy package names từ requirements.txt / Pipfile / pyproject.toml."""
    deps: set[str] = set()
    for filename, content in files.items():
        name = Path(filename).name.lower()
        if name not in ("requirements.txt", "pipfile",
                        "pyproject.toml", "setup.cfg"):
            continue
        for line in content.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            # Lấy tên package (bỏ version specifier)
            pkg = re.split(r"[>=<!;[\s]", line)[0].lower()
            if pkg:
                deps.add(pkg)
    return deps


def _parse_gradle(files: dict[str, str]) -> set[str]:
    """Lấy dependencies từ build.gradle."""
    deps: set[str] = set()
    for filename, content in files.items():
        if "build.gradle" not in filename:
            continue
        for match in re.finditer(
            r"(?:implementation|api|compile)['\"\s(]+([^'\")\s]+)", content
        ):
            deps.add(match.group(1).lower())
    return deps


def _parse_go_mod(files: dict[str, str]) -> set[str]:
    deps: set[str] = set()
    for filename, content in files.items():
        if Path(filename).name != "go.mod":
            continue
        for line in content.splitlines():
            line = line.strip()
            if line.startswith("require") or (line and not line.startswith("//")):
                parts = line.split()
                if parts:
                    deps.add(parts[0].lower())
    return deps


def _collect_all_deps(files: dict[str, str]) -> set[str]:
    deps: set[str] = set()
    deps.update(_parse_package_json(files))
    deps.update(_parse_requirements_txt(files))
    deps.update(_parse_gradle(files))
    deps.update(_parse_go_mod(files))
    return deps


# ─────────────────────────────────────────────
# 4. SCORER — tính confidence cho từng type
# ─────────────────────────────────────────────

def _score_type(
    project_type: ProjectType,
    signals: SignalSet,
    all_filenames: list[str],
    all_deps: set[str],
    files: dict[str, str],
) -> tuple[float, list[str]]:
    """
    Trả về (confidence_score, [matched_signals]).
    confidence trong [0.0, 1.0].
    """
    score = 0.0
    matched: list[str] = []
    w = signals.weights

    # ── Marker files ──
    marker_hits = 0
    for marker in signals.marker_files:
        # Cho phép glob-like match (e.g. "*.csproj")
        if "*" in marker:
            ext = marker.lstrip("*")
            if any(f.endswith(ext) for f in all_filenames):
                marker_hits += 1
                matched.append(f"file:{marker}")
        else:
            if any(marker in f for f in all_filenames):
                marker_hits += 1
                matched.append(f"file:{marker}")

    if signals.marker_files and marker_hits > 0:
        score += w["marker"] * min(marker_hits / 2.0, 1.0)

    # ── Dep keywords ──
    dep_hits = 0
    for kw in signals.dep_keywords:
        kw_lower = kw.lower()
        # Khớp nếu dependency bắt đầu bằng keyword (xử lý scoped packages)
        if any(dep == kw_lower or dep.startswith(kw_lower.split("/")[0])
               for dep in all_deps):
            dep_hits += 1
            matched.append(f"dep:{kw}")

    if signals.dep_keywords and dep_hits > 0:
        score += w["dep"] * min(dep_hits / 2.0, 1.0)

    # ── Path patterns ──
    path_hits = 0
    for pattern in signals.path_patterns:
        if any(re.search(pattern, f, re.IGNORECASE) for f in all_filenames):
            path_hits += 1
            matched.append(f"path:{pattern}")

    if signals.path_patterns and path_hits > 0:
        score += w["path"] * min(path_hits / 2.0, 1.0)

    # ── Content regex (sample 30 files để không quá chậm) ──
    content_hits = 0
    sampled = list(files.items())[:30]
    for pattern in signals.content_regex:
        compiled = re.compile(pattern, re.IGNORECASE | re.MULTILINE)
        if any(compiled.search(content) for _, content in sampled):
            content_hits += 1
            matched.append(f"content:{pattern[:30]}")

    if signals.content_regex and content_hits > 0:
        score += w["content"] * min(content_hits / 3.0, 1.0)

    return round(score, 3), matched


# ─────────────────────────────────────────────
# 5. PUBLIC API
# ─────────────────────────────────────────────

# Ngưỡng confidence tối thiểu để xếp loại vào kết quả
CONFIDENCE_THRESHOLD = 0.15


def detect_project_types(
    files: dict[str, str],
    threshold: float = CONFIDENCE_THRESHOLD,
) -> DetectionResult:
    """
    Phân tích cấu trúc repo và trả về DetectionResult.

    Args:
        files: dict {relative_path: content} — output của load_from_zip/folder
        threshold: ngưỡng confidence tối thiểu (0-1)

    Returns:
        DetectionResult với .types (sorted by confidence), .primary, .signals
    """
    all_filenames = list(files.keys())
    all_deps      = _collect_all_deps(files)

    confidence: dict[ProjectType, float]    = {}
    signals:    dict[ProjectType, list[str]] = {}

    for project_type, signal_set in SIGNAL_MAP.items():
        score, matched = _score_type(
            project_type, signal_set, all_filenames, all_deps, files
        )
        if score >= threshold:
            confidence[project_type] = score
            signals[project_type]    = matched

    # Sắp xếp theo confidence giảm dần
    sorted_types = sorted(confidence.keys(),
                          key=lambda t: confidence[t],
                          reverse=True)

    return DetectionResult(
        types=sorted_types,
        confidence=confidence,
        signals=signals,
    )


def detect_primary_type(files: dict[str, str]) -> ProjectType:
    """Shortcut — chỉ lấy type có confidence cao nhất."""
    result = detect_project_types(files)
    return result.primary


# ─────────────────────────────────────────────
# 6. CLI ĐỂ TEST NHANH
# ─────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    import zipfile

    if len(sys.argv) < 2:
        print("Dùng: python project_detector.py <path_to_zip_or_folder>")
        sys.exit(1)

    target = sys.argv[1]
    test_files: dict[str, str] = {}

    if target.endswith(".zip"):
        with zipfile.ZipFile(target) as z:
            names = z.namelist()
            root_dir = None
            if names:
                first_parts = names[0].replace("\\", "/").split("/")
                if len(first_parts) >= 1:
                    potential_root = first_parts[0]
                    if all(n.replace("\\", "/").startswith(potential_root + "/") or n.replace("\\", "/") == potential_root + "/" for n in names):
                        root_dir = potential_root + "/"

            for name in names:
                try:
                    content = z.read(name).decode("utf-8", errors="ignore")
                    if content.strip():
                        normalized_name = name.replace("\\", "/")
                        if root_dir and normalized_name.startswith(root_dir):
                            normalized_name = normalized_name[len(root_dir):]
                        if normalized_name:
                            test_files[normalized_name] = content
                except Exception:
                    pass
    else:
        for path in Path(target).rglob("*"):
            if path.is_file():
                try:
                    test_files[str(path.relative_to(target)).replace("\\", "/")] = \
                        path.read_text(encoding="utf-8", errors="ignore")
                except Exception:
                    pass

    print(f"Đọc {len(test_files)} file từ {target}\n")
    result = detect_project_types(test_files)
    print(result.summary())