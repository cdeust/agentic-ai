/**
 * Constants for the seed_project discovery stages.
 *
 * Heat values, config file names, doc globs, entry points, CI/CD files,
 * ignored directories, and language extension mappings.
 *
 * Port of: mcp_server/handlers/seed_project_constants.py
 * source: cortex@ed33435 mcp_server/handlers/seed_project_constants.py
 */

// source: cortex@ed33435 mcp_server/handlers/seed_project_constants.py:9
export const HEAT_BY_TYPE: Record<string, number> = {
  structural_summary: 0.9,
  documentation: 0.85,
  entry_point: 0.80,
  config: 0.70,
  ci_cd: 0.60,
};

// source: cortex@ed33435 mcp_server/handlers/seed_project_constants.py:17
export const CONFIG_FILES: string[] = [
  "package.json",
  "package-lock.json",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "requirements.txt",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  "pom.xml",
  "build.gradle",
  "composer.json",
  ".ruby-version",
  "Gemfile",
  "mix.exs",
];

// source: cortex@ed33435 mcp_server/handlers/seed_project_constants.py:36
export const DOC_GLOBS: string[] = [
  "README*",
  "CLAUDE*",
  "CONTRIBUTING*",
  "CHANGELOG*",
  "ARCHITECTURE*",
];

// source: cortex@ed33435 mcp_server/handlers/seed_project_constants.py:37
export const DOC_DIRS: string[] = [
  "docs",
  "doc",
  "documentation",
  "adr",
  "docs/adr",
];

// source: cortex@ed33435 mcp_server/handlers/seed_project_constants.py:39
export const ENTRY_POINT_NAMES: Set<string> = new Set([
  "__main__.py",
  "main.py",
  "app.py",
  "server.py",
  "cli.py",
  "index.js",
  "index.ts",
  "main.js",
  "main.ts",
  "server.js",
  "main.go",
  "cmd/main.go",
  "main.rs",
  "src/main.rs",
  "Main.java",
]);

// source: cortex@ed33435 mcp_server/handlers/seed_project_constants.py:57
export const CI_FILES: string[] = [
  ".github/workflows",
  "Makefile",
  "makefile",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "tox.ini",
  ".travis.yml",
  "circle.yml",
  ".circleci",
  "Jenkinsfile",
  ".gitlab-ci.yml",
  "bitbucket-pipelines.yml",
];

// source: cortex@ed33435 mcp_server/handlers/seed_project_constants.py:73
export const IGNORE_DIRS: Set<string> = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".venv",
  "venv",
  "env",
  ".env",
  "dist",
  "build",
  "target",
  "out",
  ".next",
  ".nuxt",
  "coverage",
  ".coverage",
  "htmlcov",
  "site-packages",
  ".tox",
  ".nox",
]);

// source: cortex@ed33435 mcp_server/handlers/seed_project_constants.py:100
export const EXT_MAP: Record<string, string> = {
  ".py": "Python",
  ".js": "JavaScript",
  ".ts": "TypeScript",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".rb": "Ruby",
  ".php": "PHP",
  ".cs": "C#",
  ".cpp": "C++",
  ".c": "C",
  ".swift": "Swift",
  ".ex": "Elixir",
  ".exs": "Elixir",
  ".scala": "Scala",
  ".clj": "Clojure",
  ".hs": "Haskell",
};
