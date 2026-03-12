# Codex Auto Review Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/codex-auto-review` meta-skill that detects what review skills to run, executes them in parallel, and merges results into a unified report.

**Architecture:** A new `detect` subcommand in `codex-runner.js` performs rule-based analysis (git state + file content regex) and outputs scored skill recommendations as JSON. A new SKILL.md + references/ drives Claude Code through detect → confirm → execute → merge workflow.

**Tech Stack:** Node.js stdlib only (fs, path, child_process), Markdown templates

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `skill-packs/codex-review/scripts/codex-runner.js` | Add `cmdDetect()`, `EXIT_GIT_NOT_FOUND`, version bump |
| Modify | `bin/codex-skill.js` | Add `codex-auto-review` to SKILLS array |
| Modify | `skill-packs/codex-review/manifest.json` | Add skill, bump version |
| Modify | `README.md` | Add `/codex-auto-review` entry |
| Modify | `CLAUDE.md` | Update skill count, add auto-review docs |
| Create | `skill-packs/codex-review/skills/codex-auto-review/SKILL.md` | Skill template with `{{RUNNER_PATH}}` |
| Create | `skill-packs/codex-review/skills/codex-auto-review/references/workflow.md` | Execution + merge logic |
| Create | `skill-packs/codex-review/skills/codex-auto-review/references/prompts.md` | Delegation instructions + merge prompt |
| Create | `skill-packs/codex-review/skills/codex-auto-review/references/output-format.md` | Unified report format spec |

---

## Chunk 1: Detection Engine (`cmdDetect` in codex-runner.js)

### Task 1: Add constants and exit code

**Files:**
- Modify: `skill-packs/codex-review/scripts/codex-runner.js:19-26`

- [ ] **Step 1: Add `EXIT_GIT_NOT_FOUND` constant and bump version**

After line 26 (`const EXIT_CODEX_NOT_FOUND = 5;`), add:

```javascript
const EXIT_GIT_NOT_FOUND = 6;
```

Change line 19 from:
```javascript
const CODEX_RUNNER_VERSION = 9;
```
to:
```javascript
const CODEX_RUNNER_VERSION = 10;
```

- [ ] **Step 2: Verify version command still works**

Run: `node skill-packs/codex-review/scripts/codex-runner.js version`
Expected: `10`

- [ ] **Step 3: Commit**

```bash
git add skill-packs/codex-review/scripts/codex-runner.js
git commit -m "feat(runner): add EXIT_GIT_NOT_FOUND=6, bump version to 10"
```

---

### Task 2: Add detection pattern constants

**Files:**
- Modify: `skill-packs/codex-review/scripts/codex-runner.js` (after exit code constants, ~line 28)

- [ ] **Step 1: Add source extension list and security regex patterns**

Insert after the `IS_WIN` constant (line 28):

```javascript
// --- Detection Engine Constants ---
const SOURCE_EXTENSIONS = new Set([
  ".js", ".ts", ".jsx", ".tsx", ".py", ".go", ".rs",
  ".java", ".cs", ".rb", ".php", ".vue", ".svelte",
]);

const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "vendor",
  "__pycache__", ".next", ".nuxt", "coverage",
]);

const SECURITY_PATTERNS = [
  { regex: /SELECT\s.+FROM|INSERT\s+INTO|UPDATE\s.+SET|DELETE\s+FROM/i, score: 30, reason: "SQL query strings" },
  { regex: /(?:password|secret|api[_-]?key|token|credential|auth)\s*[:=]/i, score: 25, reason: "auth/password patterns" },
  { regex: /\beval\s*\(|\bexec\s*\(|\bnew\s+Function\s*\(/i, score: 25, reason: "eval()/exec()/Function() usage" },
  { regex: /\b(?:crypto|createHash|createCipher|encrypt|decrypt)\b/i, score: 15, reason: "crypto/hash/encrypt usage" },
  { regex: /req\.body|req\.params|req\.query|request\.form|request\.args/i, score: 20, reason: "user input handling" },
  { regex: /innerHTML|dangerouslySetInnerHTML|v-html|\{\{\{/i, score: 20, reason: "HTML/template injection risk" },
];

const SECURITY_FILE_EXTENSIONS = new Set([".sql", ".prisma", ".graphql"]);
const SECURITY_CONFIG_FILES = new Set(["docker-compose.yml", "docker-compose.yaml", "nginx.conf", "Dockerfile"]);

const PLAN_FILE_PATTERNS = ["plan.md", "PLAN.md"];
const PLAN_GLOB_PATTERN = /(?:^|\/)docs\/.*plan/i;
const PLAN_SUFFIX = ".plan.md";
```

- [ ] **Step 2: Verify runner still loads without errors**

Run: `node skill-packs/codex-review/scripts/codex-runner.js version`
Expected: `10`

- [ ] **Step 3: Commit**

```bash
git add skill-packs/codex-review/scripts/codex-runner.js
git commit -m "feat(runner): add detection pattern constants for auto-review"
```

---

### Task 3: Implement `cmdDetect()` — argument parsing and git helpers

**Files:**
- Modify: `skill-packs/codex-review/scripts/codex-runner.js` (before `main()` function, ~line 1667)

- [ ] **Step 1: Add git helper functions**

Insert before the `// CLI` section:

```javascript
// ============================================================
// Detection Engine
// ============================================================

function gitAvailable() {
  const cmd = IS_WIN ? "where" : "which";
  const r = spawnSync(cmd, ["git"], { encoding: "utf8", timeout: 5000 });
  return r.status === 0;
}

function gitExec(args, cwd) {
  const r = spawnSync("git", args, { encoding: "utf8", cwd, timeout: 15000 });
  if (r.status !== 0) return null;
  return (r.stdout || "").trim();
}

function resolveBaseBranch(cwd, explicit) {
  if (explicit) return explicit;
  // Try main, then master
  for (const branch of ["main", "master"]) {
    const r = spawnSync("git", ["rev-parse", "--verify", branch], {
      encoding: "utf8", cwd, timeout: 5000,
    });
    if (r.status === 0) return branch;
  }
  return null;
}

function collectSourceFiles(dir, maxFiles) {
  const results = [];
  function walk(current, relPath) {
    if (results.length >= maxFiles) return;
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    // Sort for determinism
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          walk(path.join(current, entry.name), childRel);
        }
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        results.push(childRel);
      }
    }
  }
  walk(dir, "");
  return results;
}
```

- [ ] **Step 2: Verify runner still loads**

Run: `node skill-packs/codex-review/scripts/codex-runner.js version`
Expected: `10`

- [ ] **Step 3: Commit**

```bash
git add skill-packs/codex-review/scripts/codex-runner.js
git commit -m "feat(runner): add git helpers and file walker for detect command"
```

---

### Task 4: Implement `cmdDetect()` — core scoring logic

**Files:**
- Modify: `skill-packs/codex-review/scripts/codex-runner.js` (after helpers from Task 3)

- [ ] **Step 1: Add `cmdDetect()` function**

```javascript
function cmdDetect(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "working-dir": { type: "string" },
      scope: { type: "string", default: "working-tree" },
      threshold: { type: "string", default: "50" },
      "base-branch": { type: "string", default: "" },
      "max-files": { type: "string", default: "500" },
    },
    strict: true,
  });

  const workingDir = values["working-dir"];
  const scope = values.scope;
  const threshold = parseInt(values.threshold, 10);
  const baseBranchFlag = values["base-branch"] || "";
  const maxFiles = parseInt(values["max-files"], 10);

  if (!workingDir) {
    process.stderr.write("Error: --working-dir is required\n");
    return EXIT_ERROR;
  }

  const validScopes = ["working-tree", "branch", "full"];
  if (!validScopes.includes(scope)) {
    process.stderr.write(`Error: invalid scope '${scope}'. Valid: ${validScopes.join(", ")}\n`);
    return EXIT_ERROR;
  }

  let resolvedDir;
  try {
    resolvedDir = fs.realpathSync(workingDir);
  } catch {
    process.stderr.write(`Error: working directory does not exist: ${workingDir}\n`);
    return EXIT_ERROR;
  }

  // Check if directory has any files
  try {
    const entries = fs.readdirSync(resolvedDir);
    if (entries.length === 0) {
      process.stderr.write("Error: working directory is empty\n");
      return EXIT_ERROR;
    }
  } catch {
    process.stderr.write(`Error: cannot read working directory: ${workingDir}\n`);
    return EXIT_ERROR;
  }

  const hasGit = gitAvailable();
  let exitCode = EXIT_SUCCESS;

  // Initialize scores
  const scores = {
    "codex-impl-review": { score: 0, reasons: [] },
    "codex-security-review": { score: 0, reasons: [] },
    "codex-plan-review": { score: 0, reasons: [] },
    "codex-commit-review": { score: 0, reasons: [] },
    "codex-pr-review": { score: 0, reasons: [] },
    "codex-codebase-review": { score: 0, reasons: [] },
  };

  function addScore(skill, points, reason) {
    const s = scores[skill];
    s.score = Math.min(100, s.score + points);
    s.reasons.push(reason);
  }

  // --- Scope-based rules (require git) ---
  if (hasGit) {
    if (scope === "working-tree" || scope === "branch") {
      // Uncommitted changes
      const unstaged = gitExec(["diff", "--name-only"], resolvedDir);
      const staged = gitExec(["diff", "--cached", "--name-only"], resolvedDir);
      if (unstaged && unstaged.length > 0) {
        addScore("codex-impl-review", 100, "has uncommitted code changes");
      }
      if (staged && staged.length > 0) {
        addScore("codex-commit-review", 100, "has staged files ready for commit");
      }

      // Branch detection for pr-review
      const currentBranch = gitExec(["rev-parse", "--abbrev-ref", "HEAD"], resolvedDir);
      if (currentBranch && currentBranch !== "main" && currentBranch !== "master" && currentBranch !== "HEAD") {
        const upstream = gitExec(["rev-parse", "--abbrev-ref", "@{upstream}"], resolvedDir);
        if (upstream) {
          addScore("codex-pr-review", 80, `on branch '${currentBranch}' with upstream`);
        }
      }
    }

    if (scope === "branch") {
      const baseBranch = resolveBaseBranch(resolvedDir, baseBranchFlag);
      if (!baseBranch) {
        process.stderr.write("Warning: cannot determine base branch — use --base-branch\n");
      } else {
        const branchDiff = gitExec(["diff", "--name-only", `${baseBranch}...HEAD`], resolvedDir);
        if (branchDiff && branchDiff.length > 0) {
          addScore("codex-impl-review", 100, `branch has changes vs ${baseBranch}`);
        }
      }
    }
  } else {
    exitCode = EXIT_GIT_NOT_FOUND;
    process.stderr.write("Warning: git not available — detection limited to file patterns\n");
  }

  // --- File-based detection ---
  // Determine which files to scan
  let filesToScan = [];

  if (scope === "full" || !hasGit) {
    filesToScan = collectSourceFiles(resolvedDir, maxFiles);
  } else {
    // For working-tree and branch, scan changed files only
    if (hasGit) {
      const unstaged = gitExec(["diff", "--name-only"], resolvedDir) || "";
      const staged = gitExec(["diff", "--cached", "--name-only"], resolvedDir) || "";
      const branchFiles = scope === "branch"
        ? (gitExec(["diff", "--name-only", `${resolveBaseBranch(resolvedDir, baseBranchFlag) || "main"}...HEAD`], resolvedDir) || "")
        : "";
      const allChanged = new Set([
        ...unstaged.split("\n").filter(Boolean),
        ...staged.split("\n").filter(Boolean),
        ...branchFiles.split("\n").filter(Boolean),
      ]);
      filesToScan = [...allChanged].filter(f =>
        SOURCE_EXTENSIONS.has(path.extname(f).toLowerCase())
      ).sort().slice(0, maxFiles);
    }
  }

  // Full scope: check file count for codebase-review
  if (scope === "full") {
    const allSourceFiles = collectSourceFiles(resolvedDir, maxFiles + 1);
    if (allSourceFiles.length > 50) {
      addScore("codex-codebase-review", 100, `${allSourceFiles.length} source files (recommend /codex-codebase-review directly)`);
    } else {
      addScore("codex-impl-review", 80, `${allSourceFiles.length} source files (small project, full scope)`);
    }
  }

  // Plan file detection
  let planFound = false;
  for (const pf of PLAN_FILE_PATTERNS) {
    if (fs.existsSync(path.join(resolvedDir, pf))) {
      addScore("codex-plan-review", 100, `${pf} exists`);
      planFound = true;
      break;
    }
  }
  if (!planFound) {
    // Check for *.plan.md in root
    try {
      const rootFiles = fs.readdirSync(resolvedDir);
      for (const f of rootFiles) {
        if (f.endsWith(PLAN_SUFFIX)) {
          addScore("codex-plan-review", 100, `${f} exists`);
          planFound = true;
          break;
        }
      }
    } catch { /* ignore */ }
  }
  if (!planFound) {
    // Check docs/**/*plan*
    try {
      const docsDir = path.join(resolvedDir, "docs");
      if (fs.existsSync(docsDir)) {
        function findPlanFiles(dir, rel) {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            const childRel = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) {
              findPlanFiles(path.join(dir, e.name), childRel);
            } else if (PLAN_GLOB_PATTERN.test(`docs/${childRel}`)) {
              addScore("codex-plan-review", 100, `docs/${childRel} matches plan pattern`);
              planFound = true;
              return;
            }
            if (planFound) return;
          }
        }
        findPlanFiles(docsDir, "");
      }
    } catch { /* ignore */ }
  }

  // .env file check
  if (fs.existsSync(path.join(resolvedDir, ".env"))) {
    addScore("codex-security-review", 15, ".env file present");
  }

  // Security file extensions check
  let secExtFound = false;
  let secConfigFound = false;
  try {
    const rootFiles = fs.readdirSync(resolvedDir);
    for (const f of rootFiles) {
      if (SECURITY_FILE_EXTENSIONS.has(path.extname(f).toLowerCase())) {
        addScore("codex-security-review", 20, `security-related file extension: ${path.extname(f)}`);
        secExtFound = true;
        break;
      }
      if (SECURITY_CONFIG_FILES.has(f)) {
        addScore("codex-security-review", 15, `config file: ${f}`);
        secConfigFound = true;
      }
    }
  } catch { /* ignore */ }

  // Content-based security scanning
  const MAX_FILE_SIZE = 100 * 1024; // 100KB
  const securityHits = new Map(); // reason -> count
  for (const relFile of filesToScan) {
    const absFile = path.join(resolvedDir, relFile);
    let content;
    try {
      const stat = fs.statSync(absFile);
      if (stat.size > MAX_FILE_SIZE) continue;
      content = fs.readFileSync(absFile, "utf8");
    } catch { continue; }

    for (const { regex, reason } of SECURITY_PATTERNS) {
      if (regex.test(content)) {
        securityHits.set(reason, (securityHits.get(reason) || 0) + 1);
      }
    }
  }
  // Apply security scores
  for (const { regex, score, reason } of SECURITY_PATTERNS) {
    const count = securityHits.get(reason) || 0;
    if (count > 0) {
      addScore("codex-security-review", score, `${reason} in ${count} file${count > 1 ? "s" : ""}`);
    }
  }

  // Build output
  const selectedSkills = Object.entries(scores)
    .filter(([_, v]) => v.score >= threshold)
    .sort((a, b) => b[1].score - a[1].score)
    .map(([k]) => k);

  const output = {
    skills: selectedSkills,
    scores,
    scope,
    files_analyzed: filesToScan.length,
    files_capped: filesToScan.length >= maxFiles,
    threshold,
    git_available: hasGit,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  return exitCode;
}
```

- [ ] **Step 2: Verify function compiles (runner loads)**

Run: `node skill-packs/codex-review/scripts/codex-runner.js version`
Expected: `10`

- [ ] **Step 3: Commit**

```bash
git add skill-packs/codex-review/scripts/codex-runner.js
git commit -m "feat(runner): implement cmdDetect() core scoring logic"
```

---

### Task 5: Wire `detect` into CLI main() and update help text

**Files:**
- Modify: `skill-packs/codex-review/scripts/codex-runner.js:1671-1706` (main function)

- [ ] **Step 1: Add detect case to switch and update help**

In the `main()` switch block, add before `default:`:

```javascript
    case "detect":
      exitCode = cmdDetect(rest);
      break;
```

Update the help text in the `default` case to:

```javascript
      process.stderr.write(
        "codex-runner.js — Cross-platform toolkit for Codex CLI review skills\n\n" +
        "Usage:\n" +
        "  node codex-runner.js version\n" +
        "  node codex-runner.js start --working-dir <dir> [--effort <level>] [--thread-id <id>] [--timeout <s>] [--format <markdown|json|sarif|both>]\n" +
        "  node codex-runner.js poll <state_dir>\n" +
        "  node codex-runner.js stop <state_dir>\n" +
        "  node codex-runner.js detect --working-dir <dir> [--scope <working-tree|branch|full>] [--threshold <0-100>] [--base-branch <branch>] [--max-files <N>]\n",
      );
```

Also update the file header comment (lines 3-7) to:

```javascript
/**
 * codex-runner.js — Cross-platform toolkit for Codex CLI review skills.
 *
 * Subcommands: version, start, poll, stop, detect, _watchdog
 */
```

- [ ] **Step 2: Test detect command on current project**

Run: `node skill-packs/codex-review/scripts/codex-runner.js detect --working-dir .`
Expected: JSON output with skill scores. Should detect things like plan files in docs/.

- [ ] **Step 3: Test detect with --scope full**

Run: `node skill-packs/codex-review/scripts/codex-runner.js detect --working-dir . --scope full`
Expected: JSON with `codex-codebase-review` or `codex-impl-review` depending on file count.

- [ ] **Step 4: Test detect with --threshold 0 (show all)**

Run: `node skill-packs/codex-review/scripts/codex-runner.js detect --working-dir . --scope working-tree --threshold 0`
Expected: JSON with all skills in `skills` array.

- [ ] **Step 5: Commit**

```bash
git add skill-packs/codex-review/scripts/codex-runner.js
git commit -m "feat(runner): wire detect command into CLI, update help text"
```

---

## Chunk 2: SKILL.md and References

### Task 6: Create SKILL.md template

**Files:**
- Create: `skill-packs/codex-review/skills/codex-auto-review/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

```markdown
---
name: codex-auto-review
description: Smart router that detects which review skills to run, executes them in parallel, and merges results into a unified report. Zero-friction comprehensive review with one command.
---

# Codex Auto Review

## Purpose
Use this skill for zero-friction comprehensive review. It automatically detects what kind of review your code needs, runs the appropriate skills in parallel, and produces a unified report.

## Prerequisites
- Working directory with source code
- `codex` CLI is installed and authenticated
- `codex-review` skill pack is installed (`npx github:lploc94/codex_skill`)

## Runner

```bash
RUNNER="{{RUNNER_PATH}}"
```

## Workflow
1. **Collect inputs**: Ask user for scope (`working-tree` default, `branch`, `full`), effort level (`low`/`medium`/`high` default/`xhigh`), output format (`markdown` default, `json`, `sarif`, `both`), execution mode (parallel default, `--sequential`). Set `SCOPE`, `EFFORT`, `FORMAT`.
2. **Detect**: Run `node "$RUNNER" detect --working-dir "$PWD" --scope "$SCOPE"`. Parse JSON. Display table of detected skills with scores and reasons. Handle exit code 6 (git unavailable) gracefully. See `references/workflow.md` for details.
3. **Confirm**: Show selected skills to user. Allow add/remove. User confirms to proceed. If codex-codebase-review detected, suggest running it directly instead.
4. **Execute**: For each selected skill, read its prompt from `~/.claude/skills/<skill>/references/prompts.md`, fill template variables, start single-round Codex pass via runner. Max 3 parallel (configurable). See `references/workflow.md` for execution details and `references/prompts.md` for delegation instructions.
5. **Merge & Report**: Read all review.txt files, deduplicate findings, sort by severity, tag with source skill, compute unified verdict, write to `.codex-review/auto-runs/` directory. See `references/output-format.md` for report format.

### Delegatable Skills
| Skill | Prompt Source |
|-------|-------------|
| `codex-impl-review` | Working Tree / Branch Review Prompt (Round 1) |
| `codex-security-review` | Security Review Prompt (Round 1) |
| `codex-commit-review` | Commit Review Prompt (Round 1) |
| `codex-pr-review` | PR Review Prompt (Round 1) |
| `codex-plan-review` | Plan Review Prompt (Round 1) |

### Non-Delegatable (suggest direct invocation)
- `codex-codebase-review` — chunk-based workflow
- `codex-think-about` — not a review skill
- `codex-parallel-review` — meta-skill

## Required References
- Detailed execution: `references/workflow.md`
- Delegation instructions: `references/prompts.md`
- Report format: `references/output-format.md`

## Rules
- Single-round only (no debate loops). For deep review, user should invoke skills directly.
- Max 3 parallel Codex processes by default.
- Never auto-run if no skills detected above threshold.
- Always show detection results before execution.
- Preserve individual skill outputs in sub-reviews/ for traceability.
```

- [ ] **Step 2: Verify template has `{{RUNNER_PATH}}`**

Run: `grep "{{RUNNER_PATH}}" skill-packs/codex-review/skills/codex-auto-review/SKILL.md`
Expected: Match found.

- [ ] **Step 3: Commit**

```bash
git add skill-packs/codex-review/skills/codex-auto-review/SKILL.md
git commit -m "feat(auto-review): create SKILL.md template"
```

---

### Task 7: Create references/workflow.md

**Files:**
- Create: `skill-packs/codex-review/skills/codex-auto-review/references/workflow.md`

- [ ] **Step 1: Write workflow.md**

```markdown
# Auto Review Workflow

## 1) Collect Inputs

### Scope
Ask user: `working-tree` (default) | `branch` | `full`.

### Effort Level
Ask user: `low` | `medium` | `high` (default) | `xhigh`.

### Output Format
Ask user: `markdown` (default) | `json` | `sarif` | `both`.

### Execution Mode
Ask user: `parallel` (default) | `sequential`.

## 2) Detect

```bash
DETECT_OUTPUT=$(node "$RUNNER" detect --working-dir "$PWD" --scope "$SCOPE")
DETECT_EXIT=$?
```

### Handle exit codes:
- **0**: Success. Parse JSON from stdout.
- **1**: Error. Report message to user, abort.
- **6**: Git not available. Parse JSON (partial results). Warn user: "Git not available — detection limited to file patterns only."

### Display detection results:
```
Detected skills for auto-review:
  Skill                    Score   Reasons
  codex-impl-review        [100]   has uncommitted code changes
  codex-security-review    [ 85]   SQL queries in 3 files, auth patterns
  codex-commit-review      [  0]   (below threshold, skipped)
```

### codex-codebase-review special handling:
If `codex-codebase-review` is in the selected skills list, remove it and display:
"Large codebase detected (N files). Run `/codex-codebase-review` directly for full chunked analysis."

## 3) Confirm

Show final list of skills that will run. User can:
- Add a skill manually (e.g., "also run security-review")
- Remove a skill (e.g., "skip pr-review")
- Proceed

If no skills selected (all below threshold):
"No skills matched the threshold (50). Try `--threshold 30` for broader detection, or run a specific skill directly."
**Do not auto-run anything.** Stop here.

## 4) Execute

### Prompt delegation
For each selected skill:
1. Read `~/.claude/skills/<skill-name>/references/prompts.md`
2. Find the **Round 1 prompt** (first code block after "Round 1" heading)
3. Fill template variables:
   - `{USER_REQUEST}` → "Auto-review: comprehensive code review"
   - `{SESSION_CONTEXT}` → scope, effort level, list of all skills being run
   - `{OUTPUT_FORMAT}` → the standard ISSUE-{N} + VERDICT format from `~/.claude/skills/<skill-name>/references/output-format.md`
   - Skill-specific variables (see Prompts Reference)
4. Pipe prompt to: `node "$RUNNER" start --working-dir "$PWD" --effort "$EFFORT"`
5. Save the returned STATE_DIR

### Parallel mode (default)
- Start up to 3 Codex processes simultaneously
- If more than 3 skills: queue remaining, start as each completes
- Poll all running processes in round-robin (15s intervals)
- After each poll, report progress: "Codex [Ns] <skill>: <activity>"
- Continue until all complete or fail

### Sequential mode
- Run one skill at a time, highest score first
- After each completes, append its key findings summary to the next skill's prompt context
- Better for connected analysis

### Failure handling
- If a skill's Codex process returns `failed`/`timeout`/`stalled`: note error, continue with others
- If >50% of skills fail: abort remaining, suggest `--sequential` mode
- Always report which skills succeeded and which failed

## 5) Merge & Report

### Create session directory
```bash
SESSION_DIR=".codex-review/auto-runs/<timestamp>-<pid>"
mkdir -p "$SESSION_DIR/sub-reviews"
```

### Copy sub-reviews
For each completed skill, copy its `review.txt` to:
`$SESSION_DIR/sub-reviews/<skill-name>/review.txt`

### Merge process (Claude Code performs this)
1. Read all review.txt files from sub-reviews/
2. Parse ISSUE-{N} blocks from each
3. Deduplicate: same file + similar problem → keep more detailed version
4. Sort by severity: critical > high > medium > low
5. Tag each finding with source skill: `[security]`, `[impl]`, etc.
6. Compute unified verdict:
   - Any REVISE → overall REVISE
   - All APPROVE → overall APPROVE

### Write outputs
- Always write `$SESSION_DIR/review.txt` (merged markdown)
- Write `$SESSION_DIR/meta.json` with session metadata
- If format=json or both: write `$SESSION_DIR/review.json`
- If format=sarif or both: write `$SESSION_DIR/review.sarif.json`
- If format=both: also write `$SESSION_DIR/review.md`

### meta.json schema
```json
{
  "timestamp": 1234567890,
  "scope": "working-tree",
  "effort": "high",
  "format": "markdown",
  "mode": "parallel",
  "skills_selected": ["codex-impl-review", "codex-security-review"],
  "skills_completed": ["codex-impl-review", "codex-security-review"],
  "skills_failed": [],
  "detection_scores": { ... },
  "total_issues": 8,
  "deduplicated_issues": 6,
  "overall_verdict": "REVISE",
  "duration_seconds": 180
}
```

## 6) Cleanup

```bash
node "$RUNNER" stop "$STATE_DIR_1"
node "$RUNNER" stop "$STATE_DIR_2"
# ... for each sub-skill state dir
```

Always run cleanup for all sub-skill state directories, even on failure.

## Error Handling

- Runner `start` exit 1: report error, skip that skill
- Runner `start` exit 5: Codex not found. Abort all, tell user to install Codex.
- Runner `poll` returns `POLL:failed`: retry once. If still fails, skip skill.
- Runner `poll` returns `POLL:timeout`: use partial results if review.txt exists.
- Runner `poll` returns `POLL:stalled`: use partial results if review.txt exists.
- All skills fail: report error, no merged report.
```

- [ ] **Step 2: Commit**

```bash
git add skill-packs/codex-review/skills/codex-auto-review/references/workflow.md
git commit -m "feat(auto-review): create references/workflow.md"
```

---

### Task 8: Create references/prompts.md

**Files:**
- Create: `skill-packs/codex-review/skills/codex-auto-review/references/prompts.md`

- [ ] **Step 1: Write prompts.md**

```markdown
# Auto Review — Prompt Delegation Guide

## Strategy

Auto-review delegates to existing skills by reading their actual prompt templates at runtime.
This file contains instructions for Claude Code, NOT duplicated prompts.

## How to Build a Delegated Prompt

For each selected skill:

### 1. Read the skill's prompt template
```bash
cat ~/.claude/skills/<skill-name>/references/prompts.md
```

### 2. Extract the Round 1 prompt
Find the first code block after a heading containing "Round 1". This is the prompt to use.
Ignore any "Rebuttal" or "Round 2+" sections — auto-review is single-round only.

### 3. Fill template variables

#### codex-impl-review (Working Tree mode)
- `{USER_REQUEST}` → "Auto-review: comprehensive code review"
- `{SESSION_CONTEXT}` → "Running as part of auto-review. Scope: {SCOPE}. Other skills running: {SKILL_LIST}."
- `{OUTPUT_FORMAT}` → Read from `~/.claude/skills/codex-impl-review/references/output-format.md`

#### codex-impl-review (Branch mode)
- Same as above, plus:
- `{BASE_BRANCH}` → resolved base branch name

#### codex-security-review
- `{WORKING_DIR}` → current working directory
- `{SCOPE}` → scope from user input
- `{EFFORT}` → effort level
- `{BASE_BRANCH}` → base branch (if branch mode, else "N/A")

#### codex-commit-review
- `{COMMIT_MESSAGES}` → output of `git log --format="%H %s" -5`
- `{PROJECT_CONVENTIONS}` → "Follow conventional commits. Check scope accuracy."
- `{OUTPUT_FORMAT}` → Read from `~/.claude/skills/codex-commit-review/references/output-format.md`

#### codex-pr-review
- `{PR_TITLE}` → "Auto-review: branch diff"
- `{PR_DESCRIPTION}` → "Automated review via codex-auto-review"
- `{BASE_BRANCH}` → resolved base branch
- `{COMMIT_COUNT}` → output of `git rev-list --count <base>..HEAD`
- `{USER_REQUEST}` → "Auto-review: comprehensive code review"
- `{SESSION_CONTEXT}` → scope and skill list context
- `{OUTPUT_FORMAT}` → Read from `~/.claude/skills/codex-pr-review/references/output-format.md`

#### codex-plan-review
- `{PLAN_PATH}` → path to detected plan file
- `{USER_REQUEST}` → "Auto-review: plan quality check"
- `{SESSION_CONTEXT}` → scope and skill list context
- `{OUTPUT_FORMAT}` → Read from `~/.claude/skills/codex-plan-review/references/output-format.md`

### 4. Pipe to runner
```bash
printf '%s' "$FILLED_PROMPT" | node "$RUNNER" start --working-dir "$PWD" --effort "$EFFORT"
```

## Fallback Prompt

If a skill's references/prompts.md cannot be read (skill not installed), use this generic fallback:

```
## Your Role
You are Codex acting as a strict code reviewer for {SKILL_NAME}.

## Instructions
1. Read the code changes in this repository.
2. Focus on correctness, security, and maintainability.
3. Use the required output format exactly.

## Required Output Format
### ISSUE-{N}: {Short title}
- Category: bug | security | performance | maintainability
- Severity: low | medium | high | critical
- Problem: {clear statement}
- Evidence: {where/how observed}
- Suggested fix: {concrete fix}

### VERDICT
- Status: APPROVE | REVISE
- Reason: {short reason}
```
```

- [ ] **Step 2: Commit**

```bash
git add skill-packs/codex-review/skills/codex-auto-review/references/prompts.md
git commit -m "feat(auto-review): create references/prompts.md delegation guide"
```

---

### Task 9: Create references/output-format.md

**Files:**
- Create: `skill-packs/codex-review/skills/codex-auto-review/references/output-format.md`

- [ ] **Step 1: Write output-format.md**

```markdown
# Unified Auto Review Report Format

## Report Structure

```markdown
# Auto Review Report

**Skills Run**: {comma-separated skill list}
**Scope**: {working-tree|branch|full}
**Effort**: {low|medium|high|xhigh}
**Overall Verdict**: {APPROVE|REVISE}

## Critical ({count})
### [{source}] ISSUE-{N}: {title}
- Category: {category}
- Severity: critical
- Problem: {description}
- Evidence: {evidence}
- Suggested fix: {fix}

## High ({count})
### [{source}] ISSUE-{N}: {title}
...

## Medium ({count})
...

## Low ({count})
...

## Summary
| Skill | Findings | Verdict |
|-------|----------|---------|
| {skill} | {count} issues | {APPROVE|REVISE} |
| **Total** | **{total} issues ({dedup} duplicates removed)** | **{overall}** |
```

## Source Tags

Tag each finding with its source skill (abbreviated):
- `[impl]` — codex-impl-review
- `[security]` — codex-security-review
- `[commit]` — codex-commit-review
- `[pr]` — codex-pr-review
- `[plan]` — codex-plan-review

## Deduplication Rules

Claude Code identifies duplicates when:
- Two findings reference the same file AND same general problem area
- The descriptions address the same root cause from different angles

When deduplicating:
- Keep the finding with more detail/evidence
- Note the source of both in the tag: `[impl+security]`

## Verdict Logic

- Any sub-skill REVISE → overall **REVISE**
- All sub-skills APPROVE → overall **APPROVE**
- Sub-skill failed to complete → note in summary, exclude from verdict

## meta.json

Written alongside report. Schema in workflow.md.
```

- [ ] **Step 2: Commit**

```bash
git add skill-packs/codex-review/skills/codex-auto-review/references/output-format.md
git commit -m "feat(auto-review): create references/output-format.md"
```

---

## Chunk 3: Installer and Metadata Updates

### Task 10: Update installer, manifest, and docs

**Files:**
- Modify: `bin/codex-skill.js:29,31,169,179`
- Modify: `skill-packs/codex-review/manifest.json`
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update bin/codex-skill.js**

Line 29 — add `'codex-auto-review'` to SKILLS array:
```javascript
const SKILLS = ['codex-plan-review', 'codex-impl-review', 'codex-think-about', 'codex-commit-review', 'codex-pr-review', 'codex-parallel-review', 'codex-codebase-review', 'codex-security-review', 'codex-auto-review'];
```

Line 31 — update comment:
```javascript
// All directories managed by this installer (runner + 9 skills)
```

After line 179 (security-review message), add:
```javascript
  console.log('  /codex-auto-review     — smart auto-detection + parallel review');
```

Line 169 — update Skills path:
```javascript
  console.log(`  Skills:  ${skillsRoot}/codex-{plan-review,impl-review,think-about,commit-review,pr-review,parallel-review,codebase-review,security-review,auto-review}`);
```

- [ ] **Step 2: Update manifest.json**

```json
{
  "name": "codex-review",
  "version": "7.0.0",
  "runner": "scripts/codex-runner.js",
  "skills": [
    "codex-plan-review",
    "codex-impl-review",
    "codex-think-about",
    "codex-commit-review",
    "codex-pr-review",
    "codex-parallel-review",
    "codex-codebase-review",
    "codex-security-review",
    "codex-auto-review"
  ]
}
```

- [ ] **Step 3: Update README.md**

Change "Eight skills" to "Nine skills" on line 5. Add after line 13:
```markdown
- `/codex-auto-review` — smart auto-detection + parallel review (one command, comprehensive results)
```

Update "Installs 8 skills" to "Installs 9 skills" on line 29.

Add to Usage section after line 55:
```markdown
- `/codex-auto-review` for smart auto-detection and parallel review.
```

- [ ] **Step 4: Update CLAUDE.md**

In Project Overview section: change "seven skills" to "eight skills" (auto-review is the 9th including security-review). Add to the skill list:
```markdown
- `/codex-auto-review` — smart auto-detection + parallel review
```

In Skill Pack Layout: add `codex-auto-review/` entry.
In Installed Output: add `codex-auto-review/` entry.
In Core Execution Flow: add item 8 for auto-review flow.
In Verification: add `/codex-auto-review` to the list.
Update runner version reference from 8/9 to 10.

- [ ] **Step 5: Test installer locally**

Run: `node bin/codex-skill.js`
Expected: Installs successfully, shows `/codex-auto-review` in output.

- [ ] **Step 6: Verify runner version after install**

Run: `node ~/.claude/skills/codex-review/scripts/codex-runner.js version`
Expected: `10`

- [ ] **Step 7: Verify detect command works from installed path**

Run: `node ~/.claude/skills/codex-review/scripts/codex-runner.js detect --working-dir .`
Expected: JSON output with scores.

- [ ] **Step 8: Commit**

```bash
git add bin/codex-skill.js skill-packs/codex-review/manifest.json README.md CLAUDE.md
git commit -m "feat: add codex-auto-review to installer, manifest, and docs"
```

---

## Chunk 4: End-to-End Verification

### Task 11: Full integration test

- [ ] **Step 1: Run installer fresh**

```bash
node bin/codex-skill.js
```

- [ ] **Step 2: Verify all 9 skills installed**

```bash
ls ~/.claude/skills/ | grep codex
```
Expected: 10 directories (codex-review + 9 skills).

- [ ] **Step 3: Verify SKILL.md has runner path injected**

```bash
grep "RUNNER=" ~/.claude/skills/codex-auto-review/SKILL.md
```
Expected: Absolute path, no `{{RUNNER_PATH}}`.

- [ ] **Step 4: Verify detect command**

```bash
node ~/.claude/skills/codex-review/scripts/codex-runner.js detect --working-dir "$(pwd)" --scope working-tree
```
Expected: Valid JSON output.

- [ ] **Step 5: Verify references/ copied**

```bash
ls ~/.claude/skills/codex-auto-review/references/
```
Expected: `workflow.md`, `prompts.md`, `output-format.md`

- [ ] **Step 6: Final commit with all changes**

```bash
git add -A
git status  # verify no unexpected files
git commit -m "feat: codex-auto-review skill — smart router with detect command

Adds /codex-auto-review meta-skill:
- detect command in codex-runner.js (rule-based scoring)
- SKILL.md + references/ (workflow, prompts, output-format)
- Installer, manifest, README, CLAUDE.md updated
- Runner version bumped to 10, manifest to 7.0.0"
```
