# Codex Auto Review — Smart Router Skill

**Date**: 2026-03-12
**Status**: Approved Design
**Author**: Claude + hiep

---

## Summary

A new meta-skill `/codex-auto-review` that analyzes the codebase/changes using rule-based detection, automatically selects the most relevant review skills, and runs them in parallel (default) or sequentially.

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

### New Runner Command

```bash
node codex-runner.js detect --working-dir <dir> --scope <working-tree|branch|full> [--threshold <0-100>] [--base-branch <branch>]
```

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
    },
    "codex-parallel-review": {
      "score": 0,
      "reasons": []
    },
    "codex-think-about": {
      "score": 0,
      "reasons": []
    }
  },
  "scope": "working-tree",
  "files_analyzed": 12,
  "threshold": 50
}
```

### Detection Rules

Each rule produces a score contribution for one or more skills. Scores are capped at 100.

#### Scope-Based Rules (Primary)

| Condition | Skill | Score | How to detect |
|-----------|-------|-------|---------------|
| Has uncommitted changes | `codex-impl-review` | +100 | `git diff --name-only` has output |
| Has staged files | `codex-commit-review` | +100 | `git diff --cached --name-only` has output |
| On non-main branch with remote | `codex-pr-review` | +80 | Branch != main/master AND has upstream |
| Plan file exists | `codex-plan-review` | +100 | `plan.md`, `*.plan.md`, `PLAN.md`, `docs/*plan*` exist |
| scope=full AND >50 source files | `codex-codebase-review` | +100 | File count from `find` |
| scope=full AND <=50 source files | `codex-impl-review` | +80 | Fallback for smaller projects |

#### Content-Based Rules (Security Signals)

These scan changed files (working-tree/branch) or all source files (full scope).

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

### Score Threshold

- Default threshold: **50**
- Skills with score >= threshold are selected
- User can override: `--threshold 30` (more skills) or `--threshold 80` (fewer, more targeted)
- `codex-think-about` is never auto-selected (requires explicit topic from user)
- `codex-parallel-review` is never auto-selected (it's itself a meta-skill)

### Implementation Details

- `cmdDetect()` function added to codex-runner.js (~150-200 lines)
- Uses only Node.js stdlib: `fs`, `path`, `child_process` (for git commands)
- File content scanning limited to first 100KB per file for performance
- Only scans files matching common source extensions: `.js`, `.ts`, `.py`, `.go`, `.rs`, `.java`, `.cs`, `.rb`, `.php`, `.jsx`, `.tsx`, `.vue`, `.svelte`
- Exit code 0 on success, 1 on error
- Output is always JSON to stdout

---

## Part 2: SKILL.md Workflow

### File Structure

```
skill-packs/codex-review/skills/codex-auto-review/
├── SKILL.md
└── references/
    ├── workflow.md        — detailed execution + merge logic
    ├── prompts.md         — prompt templates for merge phase
    └── output-format.md   — unified report format spec
```

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
**Parallel mode (default):**
- Start all selected skills simultaneously using `node "$RUNNER" start --working-dir "$PWD" --effort "$EFFORT" --format "$FORMAT"` with each skill's prompt
- Poll all running skills in round-robin
- Each skill runs its own debate loop independently
- Wait for all to complete

**Sequential mode (`--sequential`):**
- Run skills one at a time in priority order (highest score first)
- Pass previous skill's key findings as context to next skill's prompt
- Better for deep, connected analysis

#### Step 5: Merge & Report
Claude Code merges all skill results into a unified report:

1. **Collect** all findings from all skills
2. **Deduplicate**: findings about the same file+line+issue are merged (keep the more detailed one)
3. **Sort** by severity: critical > high > medium > low
4. **Tag** each finding with source skill: `[security]`, `[impl]`, etc.
5. **Unified verdict**:
   - Any skill says REVISE → overall REVISE
   - All skills APPROVE → overall APPROVE
   - Mixed with stalemate → note stalemate items
6. **Write** unified report in requested format

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
- Add `cmdDetect(argv)` function (~150-200 lines)
- Add `"detect"` case in `main()` switch
- Add detection pattern constants
- Update usage help text
- **No changes** to existing commands (start/poll/stop/version)

### bin/codex-skill.js
- Add `'codex-auto-review'` to SKILLS array (1 line)

### manifest.json
- Add `"codex-auto-review"` to skills array (1 line)

### New files
- `skill-packs/codex-review/skills/codex-auto-review/SKILL.md`
- `skill-packs/codex-review/skills/codex-auto-review/references/workflow.md`
- `skill-packs/codex-review/skills/codex-auto-review/references/prompts.md`
- `skill-packs/codex-review/skills/codex-auto-review/references/output-format.md`

### CLAUDE.md
- Update skill count (8 → 9)
- Add `codex-auto-review` to skill list and architecture docs

### README.md
- Add `/codex-auto-review` to skill list

---

## Part 4: Edge Cases

1. **No skills detected**: If all scores < threshold, suggest user run `/codex-impl-review` directly or lower threshold
2. **Only 1 skill detected**: Skip merge step, run that skill directly (same as invoking it manually)
3. **Git not available**: Skip git-based rules, fall back to file-scanning rules only
4. **Empty working directory**: Return error with helpful message
5. **Huge codebase (>1000 files)**: Cap file scanning to first 500 files for performance, warn user
6. **Parallel failures**: If one skill fails, report partial results from others + error note

---

## Part 5: Future Enhancements (Out of Scope)

- AI-based detection as fallback when rule-based is uncertain
- User-defined custom rules in `.codex-review.config.json`
- Learning from past reviews (skill X was useful for this type of code)
- CI/CD integration: `npx codex-auto-review --ci --scope branch --format sarif`
