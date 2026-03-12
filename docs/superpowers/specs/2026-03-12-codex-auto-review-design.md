# Codex Auto Review — Smart Router Skill

**Date**: 2026-03-12
**Status**: Revised (v2)
**Author**: Claude + hiep

---

## Summary

A new meta-skill `/codex-auto-review` that analyzes the codebase/changes using rule-based detection, automatically selects the most relevant review skills, and runs them in parallel (default) or sequentially, then merges results into a unified report.

## Goals

1. Zero-friction review: user runs one command, gets comprehensive review
2. Deterministic skill selection via rule-based detection (no AI token cost for detection)
3. Parallel execution by default for speed, sequential option for depth
4. Unified merged report with deduplication across skills

## Non-Goals

- AI-based detection (out of scope, may add later as enhancement)
- New review skills (this skill routes to existing skills only)
- Changes to existing skills' behavior

---

## Part 1: Detection Engine

### Architecture Note

The `detect` command is added to `codex-runner.js`, evolving it from "Codex CLI process runner" to "codex-review toolkit CLI." This is intentional: having a single entry point simplifies the installer and SKILL.md references. The file header and CLAUDE.md will be updated to reflect this expanded scope:

```
codex-runner.js — Cross-platform toolkit for Codex CLI review skills.
Subcommands: version, start, poll, stop, detect, _watchdog
```

### New Runner Command

```bash
node codex-runner.js detect --working-dir <dir> --scope <working-tree|branch|full> [--threshold <0-100>] [--base-branch <branch>] [--max-files <N>]
```

### Parameters

| Param | Default | Description |
|-------|---------|-------------|
| `--working-dir` | (required) | Project root directory |
| `--scope` | `working-tree` | What to analyze: `working-tree`, `branch`, `full` |
| `--threshold` | `50` | Minimum score to select a skill (0-100) |
| `--base-branch` | auto-detect | Base branch for `branch` scope. Resolution: `--base-branch` flag > `main` > `master` > error |
| `--max-files` | `500` | Maximum files to scan for content patterns |

### Exit Codes

| Code | Constant | Meaning |
|------|----------|---------|
| 0 | `EXIT_SUCCESS` | Success — JSON output written to stdout |
| 1 | `EXIT_ERROR` | Error — invalid arguments, working directory not found |
| 6 | `EXIT_GIT_NOT_FOUND` (new) | Git not available — partial results (file-scan only), JSON still output with `"git_available": false` |

Note: Exit code 5 (`EXIT_CODEX_NOT_FOUND`) is reserved for "Codex CLI not found" in other runner commands. `detect` uses a new exit code 6 to avoid semantic overload.

### Output Format

```json
{
  "skills": ["codex-impl-review", "codex-security-review"],
  "scores": {
    "codex-impl-review": {
      "score": 100,
      "reasons": ["has uncommitted code changes"]
    },
    "codex-security-review": {
      "score": 85,
      "reasons": ["SQL queries found in 3 files", "auth patterns detected", ".env file present"]
    },
    "codex-plan-review": {
      "score": 0,
      "reasons": []
    },
    "codex-commit-review": {
      "score": 0,
      "reasons": []
    },
    "codex-pr-review": {
      "score": 30,
      "reasons": ["on non-main branch"]
    },
    "codex-codebase-review": {
      "score": 0,
      "reasons": []
    }
  },
  "scope": "working-tree",
  "files_analyzed": 12,
  "threshold": 50,
  "git_available": true
}
```

Note: `codex-think-about` and `codex-parallel-review` are excluded from output (never auto-selected).

### Detection Rules

Each rule produces a score contribution for one or more skills. Scores are capped at 100.

#### Scope-Based Rules (Primary)

| Condition | Skill | Score | How to detect |
|-----------|-------|-------|---------------|
| Has uncommitted changes | `codex-impl-review` | +100 | `git diff --name-only` has output |
| Has staged files | `codex-commit-review` | +100 | `git diff --cached --name-only` has output |
| On non-main branch with remote | `codex-pr-review` | +80 | Branch != main/master AND has upstream |
| Plan file exists | `codex-plan-review` | +100 | `plan.md`, `*.plan.md`, `PLAN.md`, `docs/*plan*` exist |
| scope=full AND >50 source files | `codex-codebase-review` | +100 | File count from globbing |
| scope=full AND <=50 source files | `codex-impl-review` | +80 | Fallback for smaller projects |

#### Content-Based Rules (Security Signals)

These scan changed files (working-tree/branch) or all source files (full scope), limited to `--max-files` and first 100KB per file.

| Pattern | Skill | Score | Regex/Detection |
|---------|-------|-------|-----------------|
| SQL query strings | `codex-security-review` | +30 | `SELECT\s.*FROM\|INSERT\s+INTO\|UPDATE\s.*SET\|DELETE\s+FROM` |
| Auth/password patterns | `codex-security-review` | +25 | `password\|secret\|api[_-]?key\|token\|credential\|auth` in assignments |
| `eval()`/`exec()`/`Function()` | `codex-security-review` | +25 | `eval\(\|exec\(\|new\s+Function\(` |
| `.env` file present | `codex-security-review` | +15 | `.env` file exists in working dir |
| `crypto`/`hash`/`encrypt` | `codex-security-review` | +15 | Import/require of crypto modules |
| User input handling | `codex-security-review` | +20 | `req.body\|req.params\|req.query\|request.form\|request.args` |
| HTML/template injection risk | `codex-security-review` | +20 | `innerHTML\|dangerouslySetInnerHTML\|v-html\|{{{` |

#### File-Extension Rules

| Extensions present | Skill bonus | Score |
|--------------------|-------------|-------|
| `.sql`, `.prisma`, `.graphql` | `codex-security-review` | +20 |
| Config files: `docker-compose.yml`, `nginx.conf`, `Dockerfile` | `codex-security-review` | +15 |

### Score Threshold & Exclusions

- Default threshold: **50**
- Skills with score >= threshold are selected
- User can override: `--threshold 30` (more skills) or `--threshold 80` (fewer, more targeted)
- **Always excluded from auto-selection:**
  - `codex-think-about` — requires explicit topic from user, not a code review skill
  - `codex-parallel-review` — is itself a meta-skill (would cause recursion)
  - `codex-auto-review` — self-reference prevention

### Cross-Platform (Windows)

All git commands use `spawnSync` with `encoding: "utf8"`. On Windows, git is typically in PATH if Git for Windows is installed. If git is not available, `detect` falls back to file-only scanning (exit code 5, `"git_available": false` in output). All file path operations use `path.join()` for cross-platform compatibility.

### Implementation Details

- `cmdDetect(argv)` function added to codex-runner.js (~200-250 lines)
- Uses only Node.js stdlib: `fs`, `path`, `child_process` (for git commands)
- File content scanning limited to first 100KB per file for performance
- Only scans files matching common source extensions: `.js`, `.ts`, `.py`, `.go`, `.rs`, `.java`, `.cs`, `.rb`, `.php`, `.jsx`, `.tsx`, `.vue`, `.svelte`
- Output is always JSON to stdout

---

## Part 2: SKILL.md Workflow

### File Structure

```
skill-packs/codex-review/skills/codex-auto-review/
├── SKILL.md
└── references/
    ├── workflow.md        — detailed execution + merge logic
    ├── prompts.md         — prompt templates for each delegated skill
    └── output-format.md   — unified report format spec
```

### Prompt Construction Strategy

The auto-review skill needs to build Codex prompts for each selected skill. Strategy:

**`references/prompts.md` contains simplified prompt templates for each delegatable skill.** These are not copies of the original skills' prompts — they are streamlined single-round prompts optimized for auto-review (no debate loop). Each template includes:
- The skill's review focus (what to look for)
- Output format requirements (always ISSUE-{N} + VERDICT)
- File list / diff to review

This decouples auto-review from changes to individual skills' prompt files.

### SKILL.md Workflow (5 Steps)

#### Step 1: Collect Inputs
- Ask user for scope: `working-tree` (default), `branch`, `full`
- Ask user for effort level: `low`, `medium`, `high` (default), `xhigh`
- Ask user for output format: `markdown` (default), `json`, `sarif`, `both`
- Optional: `--sequential` flag for sequential execution
- Set `SCOPE`, `EFFORT`, `FORMAT`

#### Step 2: Detect
```bash
DETECT_OUTPUT=$(node "$RUNNER" detect --working-dir "$PWD" --scope "$SCOPE")
```
- Parse JSON output
- Display table to user showing detected skills, scores, and reasons
- Example display:
```
Detected skills for review:
  codex-impl-review      [100] — has uncommitted code changes
  codex-security-review  [ 85] — SQL queries found, auth patterns detected
  codex-commit-review    [  0] — (skipped, below threshold)
```

#### Step 3: Confirm
- Show final list of skills to run
- User can add/remove skills before execution
- User confirms to proceed

#### Step 4: Execute

**Key design decision: Auto-review runs single-round reviews only (no debate loops).** Each selected skill gets one Codex pass. This is because:
- Claude Code is a single sequential agent — it cannot orchestrate multiple parallel debate loops
- Single-round catches most issues; the debate loop is for deep refinement which users can do via individual skills
- Keeps auto-review fast (minutes, not hours)

**Parallel mode (default):**
1. For each selected skill, build prompt from `references/prompts.md` (skill-specific template)
2. Start all Codex processes simultaneously: `node "$RUNNER" start --working-dir "$PWD" --effort "$EFFORT"` (always markdown format internally)
3. Poll all running processes in round-robin until all complete
4. Read `review.txt` from each state directory

**Sequential mode (`--sequential`):**
1. Run skills one at a time in priority order (highest detection score first)
2. Build each prompt, start runner, poll until complete
3. Append previous skill's key findings summary to next skill's prompt as context
4. Better for deep, connected analysis

**Note on internal format:** Sub-skills always output markdown internally (review.txt). Only the final merged report (Step 5) is converted to the user's requested format (json/sarif/both). This simplifies parsing and merge logic.

#### Step 5: Merge & Report

**Merge is LLM-based (Claude Code).** Claude Code reads all review.txt files and uses its judgment to:

1. **Collect** all findings from all skill outputs (parse ISSUE-{N} blocks)
2. **Deduplicate**: Claude identifies findings about the same issue (same file + similar problem description) and keeps the more detailed version. This is fuzzy matching by the LLM, not exact file+line match, because different skills may describe the same issue from different angles.
3. **Sort** by severity: critical > high > medium > low
4. **Tag** each finding with source skill: `[security]`, `[impl]`, etc.
5. **Unified verdict**:
   - Any skill says REVISE → overall REVISE
   - All skills APPROVE → overall APPROVE
   - Mixed with stalemate → note stalemate items
6. **Write** unified report:
   - Always write `review.txt` (markdown)
   - If format=json: also write `review.json` via `parseToCanonicalJSON()` + file write
   - If format=sarif: also write `review.sarif.json` via `convertToSARIF()`
   - If format=both: write all above + `review.md`

### Unified Report Format

```markdown
# Auto Review Report

**Skills Run**: codex-impl-review, codex-security-review
**Scope**: working-tree
**Overall Verdict**: REVISE

## Critical (1)
### [security] ISSUE-1: SQL Injection in user query
...

## High (3)
### [impl] ISSUE-2: Null dereference in auth handler
### [security] ISSUE-3: Hardcoded API key
### [impl] ISSUE-4: Race condition in cache update
...

## Summary
| Skill | Findings | Verdict |
|-------|----------|---------|
| codex-impl-review | 5 issues | REVISE |
| codex-security-review | 3 issues | REVISE |
| **Total** | **8 issues (2 duplicates removed)** | **REVISE** |
```

---

## Part 3: Changes Required

### codex-runner.js
- Update file header comment to reflect expanded scope ("toolkit CLI")
- Bump `CODEX_RUNNER_VERSION` from 9 to 10
- Add `cmdDetect(argv)` function (~200-250 lines)
- Add `"detect"` case in `main()` switch
- Add detection pattern constants (regex patterns for security signals)
- Update usage help text to include `detect` command
- **No changes** to existing commands (start/poll/stop/version)

### bin/codex-skill.js
- Add `'codex-auto-review'` to SKILLS array (line 29)
- Update comment `// All directories managed by this installer (runner + 8 skills)` → 9 skills
- Add `codex-auto-review` to success message output (after line 179)

### manifest.json
- Add `"codex-auto-review"` to skills array
- Bump version to `7.0.0`

### New files
- `skill-packs/codex-review/skills/codex-auto-review/SKILL.md`
- `skill-packs/codex-review/skills/codex-auto-review/references/workflow.md`
- `skill-packs/codex-review/skills/codex-auto-review/references/prompts.md`
- `skill-packs/codex-review/skills/codex-auto-review/references/output-format.md`

### CLAUDE.md
- Update skill count (8 → 9) in Project Overview
- Add `codex-auto-review` to skill list, architecture docs, installed output, verification steps
- Update runner version reference (9 → 10)

### README.md
- Add `/codex-auto-review` to skill list and description

---

## Part 4: Edge Cases

1. **No skills detected**: If all scores < threshold, display message: "No skills matched the threshold (50). Try `--threshold 30` for broader detection, or run a specific skill directly." Do not auto-run anything.
2. **Only 1 skill detected**: Run that skill through the auto-review workflow (single prompt, no debate), producing the unified report format. This gives consistent output format regardless of how many skills were selected.
3. **Git not available**: `detect` returns exit code 5 with `"git_available": false`. Skip all git-based rules, use file-scanning rules only. SKILL.md warns user that detection is limited.
4. **Empty working directory**: `detect` returns exit code 1 with error message.
5. **Huge codebase (>max-files)**: Scan first `--max-files` (default 500) files, output `"files_analyzed"` count and `"files_capped": true` in JSON. Warn user in SKILL.md display.
6. **Parallel failures**: If one Codex process fails (poll returns `failed`/`timeout`/`stalled`), report partial results from completed skills + error note for failed skill. Never fail silently.
7. **plan-review + impl-review overlap**: Both can be selected simultaneously. This is intentional — plan-review checks the plan document, impl-review checks the code. They review different artifacts.

---

## Part 5: Future Enhancements (Out of Scope)

- AI-based detection as fallback when rule-based is uncertain
- User-defined custom rules in `.codex-review.config.json`
- Learning from past reviews (skill X was useful for this type of code)
- CI/CD integration: `npx codex-auto-review --ci --scope branch --format sarif`
- `--dry-run` flag on detect (output results without executing)
- Debate loop support in auto-review (currently single-round only)
