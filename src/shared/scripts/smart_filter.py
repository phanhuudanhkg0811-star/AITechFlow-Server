"""
smart_filter.py — Lọc file thông minh theo loại dự án

Thay vì filter chung chung, module này áp rule riêng cho từng ProjectType
để tối ưu số file gửi lên LLM — giữ đúng file quan trọng, bỏ đúng file rác.

Cách dùng:
    from smart_filter import smart_filter
    from project_detector import detect_project_types

    detection = detect_project_types(all_files)
    result = smart_filter(all_files, detection)

    print(result.summary())
    # result.selected  → dict[str, str] để gửi lên LLM
"""

import re
from pathlib import Path
from dataclasses import dataclass, field
from collections import defaultdict

from project_detector import ProjectType, DetectionResult, detect_project_types


# ─────────────────────────────────────────────
# 1. CẤU HÌNH GIỚI HẠN
# ─────────────────────────────────────────────

MAX_FILES = 50
MAX_CHARS = 600_000   # ~150K tokens


# ─────────────────────────────────────────────
# 2. FILTER RULE — định nghĩa rule cho từng type
# ─────────────────────────────────────────────

@dataclass
class FilterRule:
    """
    Bộ rule lọc file cho một ProjectType cụ thể.

    priority_dirs   : thư mục ưu tiên cao nhất — file ở đây lên đầu
    priority_files  : tên file cụ thể luôn được giữ (entry points, config quan trọng)
    skip_dirs       : thư mục bỏ qua hoàn toàn
    skip_patterns   : regex khớp path → bỏ qua
    deprioritize    : regex khớp path → cho vào cuối (đọc nếu còn slot)
    allowed_exts    : nếu set, chỉ giữ các extension này (None = giữ tất cả)
    max_file_lines  : file dài hơn ngưỡng này → deprioritize (thường là generated)
    scoring_hints   : {regex_pattern: bonus_score} — điều chỉnh điểm thêm
    """
    priority_dirs:   list[str]         = field(default_factory=list)
    priority_files:  list[str]         = field(default_factory=list)
    skip_dirs:       list[str]         = field(default_factory=list)
    skip_patterns:   list[str]         = field(default_factory=list)
    deprioritize:    list[str]         = field(default_factory=list)
    allowed_exts:    set[str] | None   = None
    max_file_lines:  int               = 800
    scoring_hints:   dict[str, float]  = field(default_factory=dict)


# ── Global skip — áp cho mọi project type ──
GLOBAL_SKIP_DIRS = {
    "node_modules", "__pycache__", ".git", "venv", ".venv",
    "dist", "build", "vendor", "third_party", ".idea", ".vscode",
    ".gradle", ".dart_tool", ".pub-cache",
}

GLOBAL_SKIP_PATTERNS = [
    r"package-lock\.json$",
    r"yarn\.lock$",
    r"poetry\.lock$",
    r"Pipfile\.lock$",
    r"go\.sum$",
    r"\.min\.(js|css)$",
    r"\.map$",
    r"\.lock$",
    r"\.log$",
    r"\.DS_Store$",
    r"Thumbs\.db$",
]

# ── Global test patterns — deprioritize ──
GLOBAL_TEST_PATTERNS = [
    r"test_.*\.py$",
    r".*_test\.(py|go|kt|swift)$",
    r".*\.(spec|test)\.(ts|tsx|js|jsx)$",
    r"/(tests?|specs?|__tests__)/.+",
    r"/fixtures?/.+",
    r"/mocks?/.+",
    r"/stubs?/.+",
]


# ─────────────────────────────────────────────
# 3. RULE MAP — rule cụ thể cho từng ProjectType
# ─────────────────────────────────────────────

RULE_MAP: dict[ProjectType, FilterRule] = {

    # ── FRONTEND REACT ───────────────────────
    ProjectType.FRONTEND_REACT: FilterRule(
        priority_dirs=[
            "src/components", "src/hooks", "src/pages",
            "src/store", "src/context", "src/features",
            "src/layouts", "src/services", "app/",   # Next.js App Router
        ],
        priority_files=[
            "src/App.tsx", "src/App.jsx",
            "src/main.tsx", "src/main.jsx",
            "src/index.tsx", "src/index.jsx",
            "next.config.ts", "next.config.js",
            "vite.config.ts", "package.json",
        ],
        skip_dirs=[
            "public", "static", ".next", "out",
            "storybook-static", ".storybook",
        ],
        skip_patterns=[
            r"\.(css|scss|sass|less|svg|png|jpg|ico|woff|ttf)$",
            r"\.stories\.(tsx|jsx|ts|js)$",
            r"\.d\.ts$",
        ],
        deprioritize=[
            r"src/assets/",
            r"src/styles/",
            r"src/i18n/",
            r"src/locales/",
            r"src/types/",     # type-only files ít logic
        ],
        allowed_exts={".tsx", ".ts", ".jsx", ".js", ".json"},
        scoring_hints={
            r"use[A-Z]\w+\.(ts|tsx)$":         +20,   # custom hooks
            r"(context|provider)\.(ts|tsx)$":   +15,
            r"(store|slice|reducer)\.(ts|tsx)$": +15,
            r"(service|api)\.(ts|tsx)$":         +10,
            r"page\.(tsx|jsx)$":                +10,   # Next.js page
        },
    ),

    # ── FRONTEND VUE ─────────────────────────
    ProjectType.FRONTEND_VUE: FilterRule(
        priority_dirs=[
            "src/components", "src/views", "src/composables",
            "src/stores", "src/router", "src/services",
            "src/plugins", "src/layouts",
        ],
        priority_files=[
            "src/main.ts", "src/main.js",
            "src/App.vue", "nuxt.config.ts",
            "vite.config.ts", "package.json",
        ],
        skip_dirs=["public", "dist", ".nuxt", ".output"],
        skip_patterns=[
            r"\.(css|scss|svg|png|jpg)$",
            r"\.d\.ts$",
        ],
        deprioritize=[r"src/assets/", r"src/styles/", r"src/i18n/"],
        allowed_exts={".vue", ".ts", ".js", ".json"},
        scoring_hints={
            r"composables?/use\w+\.ts$":       +20,
            r"stores?/\w+\.(ts|js)$":          +15,
            r"views?/\w+\.vue$":               +10,
        },
    ),

    # ── FRONTEND ANGULAR ─────────────────────
    ProjectType.FRONTEND_ANGULAR: FilterRule(
        priority_dirs=[
            "src/app/components", "src/app/services",
            "src/app/modules", "src/app/guards",
            "src/app/interceptors", "src/app/store",
        ],
        priority_files=[
            "src/main.ts", "src/app/app.module.ts",
            "src/app/app-routing.module.ts",
            "angular.json", "package.json",
        ],
        skip_dirs=["dist", ".angular"],
        skip_patterns=[
            r"\.(css|scss|html)$",  # template & style tách riêng
            r"\.spec\.ts$",
            r"\.d\.ts$",
        ],
        deprioritize=[r"environments/", r"assets/"],
        allowed_exts={".ts", ".json"},
        scoring_hints={
            r"\.service\.ts$":    +20,
            r"\.module\.ts$":     +15,
            r"\.component\.ts$":  +10,
            r"\.guard\.ts$":      +10,
            r"\.interceptor\.ts$": +10,
        },
    ),

    # ── FRONTEND SVELTE ──────────────────────
    ProjectType.FRONTEND_SVELTE: FilterRule(
        priority_dirs=["src/lib", "src/routes", "src/components"],
        priority_files=["src/app.html", "svelte.config.js", "package.json"],
        skip_dirs=["static", ".svelte-kit", "build"],
        skip_patterns=[r"\.(css|png|svg)$"],
        allowed_exts={".svelte", ".ts", ".js", ".json"},
        scoring_hints={r"src/routes/.+\+page\.svelte$": +15},
    ),

    # ── FRONTEND VANILLA ─────────────────────
    ProjectType.FRONTEND_VANILLA: FilterRule(
        priority_dirs=["src", "js", "scripts"],
        priority_files=["index.html", "main.js", "app.js", "package.json"],
        skip_dirs=["dist", "build", "node_modules"],
        skip_patterns=[r"\.(css|scss|png|svg|ico)$"],
        allowed_exts={".js", ".ts", ".html", ".json"},
    ),

    # ── BACKEND PYTHON ───────────────────────
    ProjectType.BACKEND_PYTHON: FilterRule(
        priority_dirs=[
            "app/api", "app/routers", "app/services",
            "app/repositories", "app/domain", "app/core",
            "api/", "services/", "repositories/",
            "domain/", "usecase/", "usecases/",
            "models/", "schemas/",
        ],
        priority_files=[
            "main.py", "app.py", "manage.py",
            "wsgi.py", "asgi.py",
            "app/main.py", "app/app.py",
            "config.py", "settings.py",
            "app/core/config.py",
        ],
        skip_dirs=[
            "migrations", "alembic/versions",
            "staticfiles", "mediafiles",
            "locale", "templates",      # Django templates ít logic
        ],
        skip_patterns=[
            r"migrations/\d{4}.*\.py$",   # alembic / django migration
            r"__init__\.py$",              # thường rỗng
            r"conftest\.py$",
            r"setup\.py$",
            r"manage\.py$",               # Django boilerplate
        ],
        deprioritize=[
            r"tests?/",
            r"schemas?/",               # đọc sau — quan trọng nhưng thụ động
            r"utils\.py$",
            r"helpers?\.py$",
            r"constants?\.py$",
        ],
        allowed_exts={".py"},
        max_file_lines=600,
        scoring_hints={
            r"services?/\w+\.py$":        +25,
            r"repositor(?:y|ies)/\w+\.py$":    +20,
            r"domain/\w+\.py$":           +20,
            r"usecases?/\w+\.py$":        +20,
            r"(router|view|handler)s?/\w+\.py$": +15,
            r"models?/\w+\.py$":          +10,
            r"core/\w+\.py$":             +10,
        },
    ),

    # ── BACKEND NODE ─────────────────────────
    ProjectType.BACKEND_NODE: FilterRule(
        priority_dirs=[
            "src/controllers", "src/services", "src/repositories",
            "src/modules", "src/middleware", "src/routes",
            "src/domain", "src/usecases",
        ],
        priority_files=[
            "src/main.ts", "src/app.ts",
            "server.ts", "server.js",
            "app.ts", "app.js",
            "package.json", "tsconfig.json",
        ],
        skip_dirs=["dist", "coverage", "logs"],
        skip_patterns=[
            r"\.d\.ts$",
            r"\.js\.map$",
            r"migrations?/\d+.*\.(ts|js)$",
        ],
        deprioritize=[
            r"dto/",
            r"interfaces?/",
            r"constants?/",
            r"decorators?/",
        ],
        allowed_exts={".ts", ".js", ".json"},
        scoring_hints={
            r"\.service\.(ts|js)$":        +25,
            r"\.controller\.(ts|js)$":     +20,
            r"\.repository\.(ts|js)$":     +20,
            r"\.module\.(ts|js)$":         +15,
            r"\.middleware\.(ts|js)$":     +10,
            r"\.guard\.(ts|js)$":          +10,
        },
    ),

    # ── BACKEND JAVA ─────────────────────────
    ProjectType.BACKEND_JAVA: FilterRule(
        priority_dirs=[
            "src/main/java",
            "service", "services",
            "controller", "controllers",
            "repository", "repositories",
            "domain", "usecase",
            "security", "config",
        ],
        priority_files=["pom.xml", "build.gradle"],
        skip_dirs=[
            "src/test",
            "src/main/resources/static",
            "src/main/resources/templates",
            "generated",
            "target",
        ],
        skip_patterns=[
            r"resources/.*\.(xml|yml|yaml|properties)$",
            r"Test\.java$",
            r"IT\.java$",
        ],
        deprioritize=[r"dto/", r"mapper/", r"constant/", r"exception/"],
        allowed_exts={".java", ".kt", ".xml", ".gradle"},
        max_file_lines=700,
        scoring_hints={
            r"Service\.java$":       +25,
            r"ServiceImpl\.java$":   +25,
            r"Repository\.java$":    +20,
            r"Controller\.java$":    +20,
            r"Entity\.java$":        +15,
            r"UseCase\.java$":       +20,
            r"Config\.java$":        +10,
        },
    ),

    # ── BACKEND GO ───────────────────────────
    ProjectType.BACKEND_GO: FilterRule(
        priority_dirs=[
            "internal/", "pkg/",
            "cmd/", "handler/", "handlers/",
            "service/", "services/",
            "repository/", "repositories/",
            "domain/", "usecase/", "usecases/",
        ],
        priority_files=["main.go", "cmd/main.go", "go.mod"],
        skip_dirs=["vendor", "mocks", "testdata"],
        skip_patterns=[
            r"_test\.go$",
            r"mock_\w+\.go$",
            r"\.pb\.go$",    # protobuf generated
        ],
        deprioritize=[r"wire_gen\.go$", r"docs/"],
        allowed_exts={".go", ".mod"},
        scoring_hints={
            r"internal/\w+/service\.go$":    +25,
            r"internal/\w+/handler\.go$":    +20,
            r"internal/\w+/repository\.go$": +20,
            r"internal/\w+/usecase\.go$":    +20,
            r"cmd/.+/main\.go$":             +15,
        },
    ),

    # ── BACKEND .NET ─────────────────────────
    ProjectType.BACKEND_DOTNET: FilterRule(
        priority_dirs=[
            "Controllers", "Services", "Repositories",
            "Domain", "Application", "Infrastructure",
            "Handlers", "UseCases",
        ],
        priority_files=["Program.cs", "Startup.cs", "appsettings.json"],
        skip_dirs=["obj", "bin", "Migrations"],
        skip_patterns=[
            r"Migrations/\d+.*\.cs$",
            r"\.Designer\.cs$",
            r"\.g\.cs$",
        ],
        deprioritize=[r"DTOs?/", r"Models?/", r"Constants?/"],
        allowed_exts={".cs", ".json", ".csproj"},
        scoring_hints={
            r"Services?/\w+Service\.cs$":         +25,
            r"Controllers?/\w+Controller\.cs$":    +20,
            r"Repositories?/\w+Repository\.cs$":   +20,
            r"Handlers?/\w+Handler\.cs$":          +20,
            r"Domain/\w+\.cs$":                    +15,
        },
    ),

    # ── BACKEND RUBY ─────────────────────────
    ProjectType.BACKEND_RUBY: FilterRule(
        priority_dirs=[
            "app/controllers", "app/models",
            "app/services", "app/jobs",
            "app/serializers", "lib/",
        ],
        priority_files=[
            "config/routes.rb", "config/application.rb",
            "Gemfile",
        ],
        skip_dirs=["db/migrate", "log", "tmp", "public"],
        skip_patterns=[r"_spec\.rb$", r"schema\.rb$"],
        deprioritize=[r"app/helpers/", r"app/mailers/", r"app/views/"],
        allowed_exts={".rb"},
        scoring_hints={
            r"app/services/\w+\.rb$":    +25,
            r"app/models/\w+\.rb$":      +20,
            r"app/controllers/\w+\.rb$": +20,
            r"app/jobs/\w+\.rb$":        +10,
        },
    ),

    # ── BACKEND PHP ──────────────────────────
    ProjectType.BACKEND_PHP: FilterRule(
        priority_dirs=[
            "app/Http/Controllers", "app/Services",
            "app/Repositories", "app/Models",
            "app/Http/Middleware",
        ],
        priority_files=[
            "routes/web.php", "routes/api.php",
            "app/Http/Kernel.php",
            "config/app.php", "composer.json",
        ],
        skip_dirs=["vendor", "storage", "bootstrap/cache", "public"],
        skip_patterns=[r"database/migrations/\d+.*\.php$"],
        deprioritize=[r"app/Http/Requests/", r"app/Providers/"],
        allowed_exts={".php", ".json"},
        scoring_hints={
            r"Services?/\w+Service\.php$":    +25,
            r"Controllers?/\w+Controller\.php$": +20,
            r"Repositories?/\w+\.php$":        +20,
            r"Models?/\w+\.php$":              +15,
        },
    ),

    # ── MOBILE FLUTTER ───────────────────────
    ProjectType.MOBILE_FLUTTER: FilterRule(
        priority_dirs=[
            "lib/features", "lib/core", "lib/data",
            "lib/domain", "lib/presentation",
            "lib/screens", "lib/widgets",
            "lib/bloc", "lib/cubit",
            "lib/providers", "lib/services",
        ],
        priority_files=["lib/main.dart", "pubspec.yaml"],
        skip_dirs=[
            "android", "ios", "web", "windows", "linux", "macos",  # platform code
            "build", ".dart_tool",
        ],
        skip_patterns=[
            r"\.freezed\.dart$",   # generated
            r"\.g\.dart$",         # generated
            r"\.gr\.dart$",        # auto_route generated
        ],
        deprioritize=[
            r"lib/l10n/",
            r"lib/gen/",
            r"lib/generated/",
        ],
        allowed_exts={".dart", ".yaml"},
        scoring_hints={
            r"lib/domain/\w+\.dart$":            +25,
            r"lib/features/\w+/bloc/\w+\.dart$": +25,
            r"lib/data/repositor(?:y|ies)/\w+\.dart$": +20,
            r"lib/core/\w+\.dart$":              +15,
            r"lib/presentation/\w+\.dart$":      +10,
        },
    ),

    # ── MOBILE ANDROID ───────────────────────
    ProjectType.MOBILE_ANDROID: FilterRule(
        priority_dirs=[
            "app/src/main/java",
            "app/src/main/kotlin",
        ],
        priority_files=[
            "app/src/main/AndroidManifest.xml",
            "build.gradle", "settings.gradle",
            "app/build.gradle",
        ],
        skip_dirs=[
            "app/src/test", "app/src/androidTest",
            "app/src/main/res",    # XML resources ít logic
            "gradle/wrapper",
            "build",
        ],
        skip_patterns=[
            r"R\.java$",           # generated
            r"BuildConfig\.java$", # generated
            r"databinding/",       # generated binding classes
        ],
        deprioritize=[
            r"di/\w+Module\.(kt|java)$",    # DI modules — boilerplate
            r"\.xml$",
        ],
        allowed_exts={".kt", ".java", ".gradle", ".xml"},
        max_file_lines=600,
        scoring_hints={
            r"ViewModel\.(kt|java)$":      +25,
            r"Repository\.(kt|java)$":     +25,
            r"UseCase\.(kt|java)$":        +20,
            r"Interactor\.(kt|java)$":     +20,
            r"Service\.(kt|java)$":        +15,
            r"Activity\.(kt|java)$":       +10,
            r"Fragment\.(kt|java)$":       +10,
        },
    ),

    # ── MOBILE IOS ───────────────────────────
    ProjectType.MOBILE_IOS: FilterRule(
        priority_dirs=[
            "Sources", "Source",
            "ViewModels", "Views",
            "Models", "Services",
            "Repositories", "Domain",
        ],
        priority_files=["Package.swift", "Podfile"],
        skip_dirs=[
            "Pods", ".build", "DerivedData",
            "Resources",
        ],
        skip_patterns=[
            r"\.storyboard$",
            r"\.xib$",
            r"Assets\.xcassets/",
        ],
        deprioritize=[r"Extensions?/", r"Utilities/", r"Helpers?/"],
        allowed_exts={".swift", ".m", ".h"},
        scoring_hints={
            r"ViewModel\.swift$":   +25,
            r"Service\.swift$":     +20,
            r"Repository\.swift$":  +20,
            r"UseCase\.swift$":     +20,
            r"Manager\.swift$":     +15,
        },
    ),

    # ── MOBILE REACT NATIVE ──────────────────
    ProjectType.MOBILE_RN: FilterRule(
        priority_dirs=[
            "src/screens", "src/components",
            "src/navigation", "src/store",
            "src/services", "src/hooks",
            "src/context",
        ],
        priority_files=[
            "App.tsx", "App.js",
            "index.js", "package.json",
            "metro.config.js",
        ],
        skip_dirs=["android", "ios", "__tests__"],
        skip_patterns=[r"\.(png|jpg|svg)$"],
        allowed_exts={".tsx", ".ts", ".jsx", ".js", ".json"},
        scoring_hints={
            r"src/store/\w+\.(ts|js)$":    +20,
            r"src/services/\w+\.(ts|js)$": +20,
            r"src/screens/\w+\.(tsx|jsx)$": +15,
            r"src/hooks/use\w+\.(ts|js)$": +15,
        },
    ),

    # ── DATA SCIENCE ─────────────────────────
    ProjectType.DATA_SCIENCE: FilterRule(
        priority_dirs=[
            "src", "notebooks", "analysis",
            "features", "preprocessing",
            "visualization", "reporting",
        ],
        priority_files=["requirements.txt", "environment.yml"],
        skip_dirs=["data", "raw_data", "output", "figures"],
        skip_patterns=[
            r"\.ipynb_checkpoints/",
            r"__pycache__/",
        ],
        deprioritize=[
            # Notebook thường rất dài, ít reusable
            r"\.ipynb$",
            r"scratch/",
            r"archive/",
        ],
        allowed_exts={".py", ".ipynb", ".sql", ".yaml"},
        max_file_lines=500,
        # Data Science ít dùng import count để đánh giá —
        # ưu tiên theo tên file gợi ý pipeline step
        scoring_hints={
            r"(feature|feat)_\w+\.py$":          +25,
            r"(preprocess|clean|transform).*\.py$": +20,
            r"(train|model|evaluate|predict).*\.py$": +20,
            r"pipeline\.py$":                    +15,
            r"(config|cfg)\.py$":                +10,
        },
    ),

    # ── ML TRAINING ──────────────────────────
    ProjectType.ML_TRAINING: FilterRule(
        priority_dirs=[
            "src", "models", "trainers",
            "datasets", "losses", "metrics",
            "configs", "scripts",
        ],
        priority_files=[
            "train.py", "trainer.py",
            "finetune.py", "pretrain.py",
            "run_training.py",
        ],
        skip_dirs=["checkpoints", "runs", "wandb", "logs", "outputs"],
        skip_patterns=[
            r"\.ckpt$", r"\.pth$", r"\.bin$",
            r"\.onnx$", r"\.safetensors$",
        ],
        deprioritize=[
            r"scripts/eval_",
            r"scripts/infer_",
        ],
        allowed_exts={".py", ".yaml", ".json", ".toml"},
        max_file_lines=600,
        scoring_hints={
            r"models?/\w+\.py$":           +25,
            r"trainers?/\w+\.py$":         +25,
            r"datasets?/\w+\.py$":         +20,
            r"losses?/\w+\.py$":           +20,
            r"(train|finetune).*\.py$":    +20,
            r"configs?/.*\.(yaml|json)$":  +15,
            r"metrics?/\w+\.py$":          +10,
        },
    ),

    # ── ML INFERENCE ─────────────────────────
    ProjectType.ML_INFERENCE: FilterRule(
        priority_dirs=["src", "app", "serving", "inference"],
        priority_files=[
            "serve.py", "inference.py",
            "predictor.py", "main.py",
        ],
        skip_dirs=["models_cache", "triton_model_repo"],
        skip_patterns=[r"\.(onnx|pth|bin|pt)$"],
        allowed_exts={".py", ".json", ".yaml"},
        scoring_hints={
            r"(predict|infer).*\.py$":   +25,
            r"(preprocess|postprocess).*\.py$": +20,
            r"(pipeline|serving).*\.py$": +20,
        },
    ),

    # ── DATA PIPELINE ────────────────────────
    ProjectType.DATA_PIPELINE: FilterRule(
        priority_dirs=[
            "dags", "flows", "pipelines",
            "jobs", "tasks", "operators",
            "models",   # dbt models
        ],
        priority_files=[
            "dbt_project.yml",
            "airflow.cfg",
            "prefect.yaml",
            "Makefile",
        ],
        skip_dirs=[
            "logs", "data", "target",    # dbt target
            "dbt_packages",
        ],
        skip_patterns=[
            r"compiled/.*\.sql$",        # dbt compiled output
            r"run/.*\.sql$",
        ],
        deprioritize=[r"snapshots/", r"seeds/", r"macros/"],
        allowed_exts={".py", ".sql", ".yaml", ".yml"},
        scoring_hints={
            r"dags?/\w+\.py$":           +25,
            r"flows?/\w+\.py$":          +25,
            r"pipelines?/\w+\.py$":      +25,
            r"models?/\w+\.sql$":        +20,
            r"operators?/\w+\.py$":      +15,
            r"tasks?/\w+\.py$":          +15,
        },
    ),

    # ── INFRA TERRAFORM ──────────────────────
    ProjectType.INFRA_TERRAFORM: FilterRule(
        priority_dirs=["modules", "environments", "stacks"],
        priority_files=["main.tf", "variables.tf", "outputs.tf"],
        skip_dirs=[".terraform"],
        skip_patterns=[r"\.tfstate$", r"\.tfstate\.backup$"],
        deprioritize=[r"\.terraform\.lock\.hcl$"],
        allowed_exts={".tf", ".tfvars"},
        scoring_hints={
            r"modules?/\w+/main\.tf$":      +20,
            r"environments?/\w+/main\.tf$": +20,
        },
    ),

    # ── INFRA K8S ────────────────────────────
    ProjectType.INFRA_K8S: FilterRule(
        priority_dirs=["charts", "templates", "manifests", "k8s"],
        priority_files=["Chart.yaml", "values.yaml", "kustomization.yaml"],
        skip_dirs=["charts/crds"],
        skip_patterns=[r"\.lock$"],
        deprioritize=[r"tests?/"],
        allowed_exts={".yaml", ".yml", ".json"},
        scoring_hints={
            r"templates?/deployment\.ya?ml$": +20,
            r"templates?/service\.ya?ml$":    +15,
            r"values.*\.ya?ml$":              +15,
        },
    ),
}

# Fallback cho UNKNOWN hoặc type chưa có rule
FALLBACK_RULE = FilterRule(
    priority_dirs=["src", "lib", "core", "app"],
    priority_files=["main.py", "app.py", "index.ts", "main.go"],
    skip_dirs=list(GLOBAL_SKIP_DIRS),
    max_file_lines=800,
)


# ─────────────────────────────────────────────
# 4. IMPORT GRAPH (giữ lại từ v2, dùng làm tín hiệu bổ sung)
# ─────────────────────────────────────────────

def _extract_imports(filename: str, content: str) -> list[str]:
    imports = []
    ext = Path(filename).suffix.lower()
    if ext == ".py":
        patterns = [r"^import\s+([\w.]+)", r"^from\s+([\w.]+)\s+import"]
    elif ext in {".js", ".ts", ".jsx", ".tsx"}:
        patterns = [r'from\s+[\'"]([^\'"\s]+)[\'"]',
                    r'require\s*\(\s*[\'"]([^\'"\s]+)[\'"]\s*\)']
    elif ext == ".java":
        patterns = [r"^import\s+([\w.]+);"]
    elif ext in {".kt"}:
        patterns = [r"^import\s+([\w.]+)"]
    elif ext == ".go":
        patterns = [r'"([\w./\-]+)"']
    elif ext == ".dart":
        patterns = [r"import\s+'([^']+)'"]
    elif ext == ".swift":
        patterns = [r"^import\s+(\w+)"]
    else:
        patterns = []
    for p in patterns:
        for m in re.finditer(p, content, re.MULTILINE):
            imports.append(m.group(1))
    return imports


def _build_import_count(files: dict[str, str]) -> dict[str, int]:
    module_to_file: dict[str, str] = {}
    for filename in files:
        path = Path(filename)
        stem = path.stem
        without_ext = str(path.with_suffix(""))
        dotted = without_ext.replace("/", ".").replace("\\", ".")
        for key in [stem, without_ext, dotted,
                    f"./{stem}", f"./{without_ext}"]:
            module_to_file.setdefault(key, filename)

    count: dict[str, int] = defaultdict(int)
    for filename, content in files.items():
        for mod in _extract_imports(filename, content):
            mod_clean = mod.lstrip("./")
            for key in [mod, mod_clean, Path(mod).stem]:
                if key in module_to_file and module_to_file[key] != filename:
                    count[module_to_file[key]] += 1
                    break
    return dict(count)


# ─────────────────────────────────────────────
# 5. SCORER — tính điểm cho từng file
# ─────────────────────────────────────────────

def _is_test_file(filename: str) -> bool:
    for p in GLOBAL_TEST_PATTERNS:
        if re.search(p, filename, re.IGNORECASE):
            return True
    return False


def _score_file(
    filename: str,
    content:  str,
    rule:     FilterRule,
    import_count: int,
) -> float:
    """
    Tính điểm ưu tiên cho file theo rule của project type.
    Điểm càng cao → được giữ lại và đọc trước.
    """
    score = 0.0
    low = filename.lower()

    # ── Điểm nền từ import count ──
    score += import_count * 8

    # ── Priority files — cộng thẳng ──
    for pf in rule.priority_files:
        if pf.lower() in low or Path(filename).name.lower() == pf.lower():
            score += 60
            break

    # ── Priority dirs ──
    for pd in rule.priority_dirs:
        if pd.lower().rstrip("/") in low:
            score += 30
            break

    # ── Deprioritize ──
    for dp in rule.deprioritize:
        if re.search(dp, filename, re.IGNORECASE):
            score -= 20
            break

    # ── Test file ──
    if _is_test_file(filename):
        score -= 35

    # ── File quá dài → thường generated ──
    line_count = content.count("\n")
    if line_count > rule.max_file_lines:
        score -= (line_count - rule.max_file_lines) * 0.02

    # ── Scoring hints của rule ──
    for pattern, bonus in rule.scoring_hints.items():
        if re.search(pattern, filename, re.IGNORECASE):
            score += bonus
            break   # chỉ áp bonus đầu tiên khớp

    return score


# ─────────────────────────────────────────────
# 6. RESULT
# ─────────────────────────────────────────────

@dataclass
class FilterResult:
    selected:      dict[str, str]
    skipped:       list[str]
    project_types: list[ProjectType]
    primary_type:  ProjectType
    scores:        dict[str, float]
    import_counts: dict[str, int]
    total_chars:   int
    rule_used:     str   # tên rule đã áp dụng

    def summary(self) -> str:
        lines = [
            f"{'─'*65}",
            f"  Project type  : {self.primary_type.value}",
            f"  Rule áp dụng  : {self.rule_used}",
            f"  File được chọn: {len(self.selected)} / "
            f"{len(self.selected) + len(self.skipped)}",
            f"  Tổng ký tự    : {self.total_chars:,}",
            f"{'─'*65}",
            f"  {'FILE':<42} {'SCORE':>6}  {'IMPORT':>6}",
            f"{'─'*65}",
        ]
        for fname, score in sorted(
            self.scores.items(), key=lambda x: x[1], reverse=True
        ):
            ic = self.import_counts.get(fname, 0)
            short = fname if len(fname) <= 42 else "…" + fname[-41:]
            lines.append(f"  {short:<42} {score:>6.1f}  {ic:>6}")
        if self.skipped:
            lines.append(f"\n  ⚠️  Bỏ qua {len(self.skipped)} file "
                         f"(ví dụ: {', '.join(self.skipped[:3])})")
        lines.append(f"{'─'*65}")
        return "\n".join(lines)


# ─────────────────────────────────────────────
# 7. PUBLIC API
# ─────────────────────────────────────────────

def smart_filter(
    files: dict[str, str],
    detection: DetectionResult | None = None,
    max_files: int = MAX_FILES,
    max_chars:  int = MAX_CHARS,
) -> FilterResult:
    """
    Lọc và xếp hạng files theo loại dự án.

    Args:
        files     : dict {path: content} — toàn bộ file đọc được
        detection : kết quả từ detect_project_types(); nếu None sẽ tự detect
        max_files : số file tối đa gửi lên LLM
        max_chars : tổng ký tự tối đa

    Returns:
        FilterResult với .selected (dict sẵn sàng dùng)
    """
    if detection is None:
        detection = detect_project_types(files)

    primary = detection.primary

    # ── Chọn rule ──
    rule = RULE_MAP.get(primary, FALLBACK_RULE)
    rule_name = primary.value if primary in RULE_MAP else "fallback"

    # ── Bước 1: Hard filter — bỏ file rác ──
    candidates: dict[str, str] = {}

    for filename, content in files.items():
        # Global skip dirs
        if any(skip in filename for skip in GLOBAL_SKIP_DIRS):
            continue
        # Global skip patterns
        if any(re.search(p, filename, re.IGNORECASE)
               for p in GLOBAL_SKIP_PATTERNS):
            continue
        # Rule skip dirs
        if any(sd.rstrip("/") in filename for sd in rule.skip_dirs):
            continue
        # Rule skip patterns
        if any(re.search(p, filename, re.IGNORECASE)
               for p in rule.skip_patterns):
            continue
        # Extension filter (nếu rule có giới hạn ext)
        if rule.allowed_exts:
            if Path(filename).suffix.lower() not in rule.allowed_exts:
                continue

        candidates[filename] = content

    # ── Bước 2: Build import graph trên candidates ──
    import_count = _build_import_count(candidates)

    # ── Bước 3: Score từng file ──
    scored: list[tuple[float, str, str]] = []
    for filename, content in candidates.items():
        ic = import_count.get(filename, 0)
        s  = _score_file(filename, content, rule, ic)
        scored.append((s, filename, content))

    scored.sort(key=lambda x: x[0], reverse=True)

    # ── Bước 4: Chọn top files trong giới hạn ──
    selected:     dict[str, str]   = {}
    selected_scores: dict[str, float] = {}
    skipped:      list[str]        = []
    total_chars   = 0

    for score, filename, content in scored:
        chunk = len(content) + len(filename) + 130
        if len(selected) >= max_files or total_chars + chunk > max_chars:
            skipped.append(filename)
            continue
        selected[filename]        = content
        selected_scores[filename] = score
        total_chars += chunk

    return FilterResult(
        selected      = selected,
        skipped       = skipped,
        project_types = detection.types,
        primary_type  = primary,
        scores        = selected_scores,
        import_counts = {f: import_count.get(f, 0) for f in selected},
        total_chars   = total_chars,
        rule_used     = rule_name,
    )


# ─────────────────────────────────────────────
# 8. CLI TEST NHANH
# ─────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    import zipfile

    if len(sys.argv) < 2:
        print("Dùng: python smart_filter.py <path_to_zip_or_folder>")
        sys.exit(1)

    target = sys.argv[1]
    all_files: dict[str, str] = {}

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
                    c = z.read(name).decode("utf-8", errors="ignore")
                    if c.strip():
                        normalized_name = name.replace("\\", "/")
                        if root_dir and normalized_name.startswith(root_dir):
                            normalized_name = normalized_name[len(root_dir):]
                        if normalized_name:
                            all_files[normalized_name] = c
                except Exception:
                    pass
    else:
        for path in Path(target).rglob("*"):
            if path.is_file():
                try:
                    all_files[str(path.relative_to(target)).replace("\\", "/")] = \
                        path.read_text(encoding="utf-8", errors="ignore")
                except Exception:
                    pass

    print(f"Đọc {len(all_files)} file từ {target}\n")

    from project_detector import detect_project_types
    detection = detect_project_types(all_files)
    print(detection.summary())
    print()

    result = smart_filter(all_files, detection)
    print(result.summary())
