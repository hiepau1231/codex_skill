# UX Consistency Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize all 9 `codex-review` SKILL.md files to a common template, add persistent session output to 5 review skills, and add smart context auto-detection to reduce setup friction.

**Architecture:** Three sequential phases — (1) template alignment across SKILL.md files, (2) unified `.codex-review/sessions/` output in workflow.md reference files, (3) smart defaults replacing manual setup questions in SKILL.md workflow steps and workflow.md. All changes are in `skill-packs/codex-review/skills/` (source of truth; installer copies to `~/.claude/skills/`).

**Tech Stack:** Markdown, Node.js (installer only — no code changes to `codex-runner.js`)

---

## File Map

```
skill-packs/codex-review/skills/
├── codex-parallel-review/
│   └── SKILL.md                      ← Phase 1 (When to Use, Typical time), Phase 3 (step 1 + effort smart default)
│                                        [No Phase 2: excluded from session output (multi-output workflow)]
├── codex-think-about/
│   └── SKILL.md                      ← Phase 1 (When to Use, Typical time), Phase 3 (step 1)
│                                        [No Phase 2: not a review skill, no structured output]
│                                        [No Phase 3 workflow.md: no setup inputs to detect]
├── codex-codebase-review/
│   └── SKILL.md                      ← Phase 1 (When to Use, Typical time col), Phase 3 (step 1 + effort smart default)
│                                        [No Phase 2: excluded from session output (chunked workflow)]
├── codex-pr-review/
│   ├── SKILL.md                      ← Phase 1 (When to Use, Typical time, step 1), Phase 3 (base-branch+effort)
│   └── references/workflow.md        ← Phase 2 (session output), Phase 3 (detection docs)
├── codex-security-review/
│   ├── SKILL.md                      ← Phase 1 (When to Use, Typical time, remove inline sections, step 1), Phase 3 (scope+effort)
│   ├── references/output-format.md   ← Phase 1 (absorb 3 inline sections from SKILL.md)
│   └── references/workflow.md        ← Phase 2 (session output), Phase 3 (detection docs)
├── codex-auto-review/
│   ├── SKILL.md                      ← Phase 1 (When to Use, Typical time, step 1)
│   └── references/workflow.md        ← Phase 2 (path migration + fix review.json ref)
├── codex-impl-review/
│   ├── SKILL.md                      ← Phase 1 (When to Use), Phase 3 (step 1 + scope+effort smart defaults)
│   └── references/workflow.md        ← Phase 2 (session output), Phase 3 (detection docs)
├── codex-commit-review/
│   ├── SKILL.md                      ← Phase 1 (When to Use), Phase 3 (step 1 + mode smart default)
│   └── references/workflow.md        ← Phase 2 (session output), Phase 3 (detection docs)
└── codex-plan-review/
    ├── SKILL.md                      ← Phase 3 only (step 1 + plan-path+effort smart defaults; When to Use already present)
    └── references/workflow.md        ← Phase 2 (session output), Phase 3 (detection docs)
```

---

## Standard Blocks (referenced by tasks below)

### Standard Effort Table (4 columns — insert under `### Effort Level Guide`)
```markdown
| Level    | Depth             | Best for                        | Typical time |
|----------|-------------------|---------------------------------|--------------|
| `low`    | Surface check     | Quick sanity check              | ~2-3 min     |
| `medium` | Standard review   | Most day-to-day work            | ~5-8 min     |
| `high`   | Deep analysis     | Important features              | ~10-15 min   |
| `xhigh`  | Exhaustive        | Critical/security-sensitive     | ~20-30 min   |
```

### Session Output Block (insert at end of each skill's workflow.md, before the Cleanup section)
```markdown
## Session Output

After the final round completes (or after Round 1 for single-round skills), create a persistent session directory:

```bash
SESSION_DIR=".codex-review/sessions/{SKILL_NAME}-$(date +%s)-$$"
mkdir -p "$SESSION_DIR"
cp "$STATE_DIR/review.md" "$SESSION_DIR/review.md"
cat > "$SESSION_DIR/meta.json" << 'METAEOF'
{
  "skill": "{SKILL_NAME}",
  "version": 14,
  "effort": "$EFFORT",
  "scope": "$SCOPE",
  "rounds": $ROUND_COUNT,
  "verdict": "$FINAL_VERDICT",
  "timing": { "total_seconds": $ELAPSED_SECONDS },
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
METAEOF
echo "Session saved to: $SESSION_DIR"
```

Replace `{SKILL_NAME}` with the skill name (e.g., `codex-impl-review`). For skills without a `$SCOPE` variable, omit that field from meta.json.

Report `$SESSION_DIR` path to the user in the final summary.
```

### Smart Defaults — Scope+Effort Pattern (for impl-review, security-review)
```markdown
1. **Collect inputs**: Auto-detect context and announce defaults before asking anything.
   - **effort**: Run `git diff --name-only | wc -l` — result <10 → `medium`, 10–50 → `high`, >50 → `xhigh`; default `high` if undetectable.
   - **scope**: Run `git status --short` — non-empty output → `working-tree`. Else run `git rev-list @{u}..HEAD` — non-empty → `branch`. If both conditions true, use `working-tree`. If neither, ask user.
   - Announce: "Detected: scope=`$SCOPE`, effort=`$EFFORT` (N files changed). Proceeding — reply to override scope, effort, or both."
   - Set `SCOPE` and `EFFORT`. Only block for inputs that remain undetectable.
```

### Smart Defaults — Base-Branch+Effort Pattern (for pr-review)
```markdown
1. **Collect inputs**: Auto-detect context and announce defaults before asking anything.
   - **effort**: Run `git diff --name-only <base>...HEAD | wc -l` — result <10 → `medium`, 10–50 → `high`, >50 → `xhigh`; default `high` if undetectable.
   - **base-branch**: Check `git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null` (strip `refs/remotes/origin/` prefix); fallback to checking existence of `main` then `master`. If found, announce as detected default.
   - Announce: "Detected: base=`$BASE`, effort=`$EFFORT` (N files changed). Proceeding — reply to override. PR title/description optional."
   - Set `BASE` and `EFFORT`. Only block if base branch cannot be resolved.
```

### Smart Defaults — Mode Pattern (for commit-review)
```markdown
1. **Collect inputs**: Auto-detect context and announce defaults before asking anything.
   - **mode**: Run `git diff --cached --quiet`; if exits 1 (has staged changes) → `draft`; else → `last`.
   - **effort**: Default `medium` for commit-review (commits are typically small scope).
   - Announce: "Detected: mode=`$MODE`, effort=`medium`. Proceeding — reply to override."
   - Set `MODE` and `EFFORT`. For `draft` mode, ask for commit message text. For `last` mode, N=1 default.
```

### Smart Defaults — Plan-Path+Effort Pattern (for plan-review)
```markdown
1. **Collect inputs**: Auto-detect context and announce defaults before asking anything.
   - **plan-path**: Scan CWD for `plan.md`, `PLAN.md`, `docs/plan.md`. If single match found, use it. If multiple matches, list them and ask user to choose. If none, ask user for path.
   - **effort**: Default `high` for plan review (plans typically cover significant scope).
   - Announce detected plan path and effort. Proceeding — reply to override.
   - Set `PLAN_PATH` and `EFFORT`. Block only if plan file cannot be found or resolved.
```

### Smart Defaults — Effort-Only Pattern (for parallel-review, codebase-review)
```markdown
1. **Collect inputs**: Auto-detect effort and announce default before asking anything.
   - **effort**: Run `git diff --name-only | wc -l` — result <10 → `medium`, 10–50 → `high`, >50 → `xhigh`; default `high` if undetectable.
   - Announce: "Detected: effort=`$EFFORT` (N files changed). Proceeding — reply to override."
   - Set `EFFORT`.
```

---

## Phase 1: SKILL.md Template Standardization

> **Prerequisite:** Ensure no other changes to `skill-packs/codex-review/skills/*/SKILL.md` are in flight on this branch. If merge conflicts arise during commits, resolve manually and proceed to the next task.

> **Scope note on step 1 labels:** Phase 1 does NOT change Workflow step 1 content — that is Phase 3's job. Phase 1 only adds sections (`When to Use`, `Typical time` column). The only exception: codex-plan-review already has `When to Use` and does not require a Phase 1 task — it is handled entirely in Phase 3 (Task 14).

> **Why step 1 label is Phase 3, not Phase 1:** The spec lists "Standardize Workflow step 1 to `**Collect inputs**: <list>`" under Section A, but this label change is inseparably coupled to the smart defaults content in Phase 3 — changing the label without replacing the content would leave a misleading heading. Phase 3 tasks naturally perform both the label change and the content replacement in one atomic edit per skill. This is a deliberate sequencing decision.

### Task 1: codex-parallel-review SKILL.md

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-parallel-review/SKILL.md`

- [ ] **Step 1: Verify current state**

  Read the file and confirm: no `## When to Use` section, Effort table has 4 rows but only 3 columns (missing `Typical time`), step 1 starts with `**Collect inputs**` already (good).

  Run: `grep -n "When to Use\|Typical time\|Collect inputs" "skill-packs/codex-review/skills/codex-parallel-review/SKILL.md"`
  Expected: no `When to Use` match, no `Typical time` match.

- [ ] **Step 2: Add `## When to Use` section after `## Purpose`**

  Insert this block after the `## Purpose` section (before `## Prerequisites`):
  ```markdown
  ## When to Use
  When you want independent dual-reviewer analysis. Produces higher-confidence findings than single-reviewer skills because findings are cross-validated between Claude agents and Codex before being reported.
  ```

- [ ] **Step 3: Add `Typical time` column to Effort table**

  Replace the current 3-column effort table:
  ```markdown
  ### Effort Level Guide
  | Level    | Depth             | Best for                        |
  |----------|-------------------|---------------------------------|
  | `low`    | Surface check     | Quick sanity check              |
  | `medium` | Standard review   | Most day-to-day work            |
  | `high`   | Deep analysis     | Important features              |
  | `xhigh`  | Exhaustive        | Critical/security-sensitive     |
  ```
  With the standard 4-column table (use Standard Effort Table block above, but adjust times: low ~5-10 min, medium ~10-20 min, high ~20-30 min, xhigh ~30-45 min — parallel overhead is higher than single skills).

- [ ] **Step 4: Verify result**

  Run: `grep -n "When to Use\|Typical time" "skill-packs/codex-review/skills/codex-parallel-review/SKILL.md"`
  Expected: both match, section order is Purpose → When to Use → Prerequisites → Runner → Workflow → Required References → Rules.

  Also verify the current step 1 label (establishes baseline for Task 15):
  Run: `grep -n "^\(1\.\|1 \)" "skill-packs/codex-review/skills/codex-parallel-review/SKILL.md" | head -3`
  Note whether step 1 currently reads "**Collect inputs**" or "**Ask user**" — Task 15 will update it.

- [ ] **Step 5: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-parallel-review/SKILL.md
  git commit -m "feat(phase1): add When to Use and Typical time to codex-parallel-review"
  ```

---

### Task 2: codex-think-about SKILL.md

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-think-about/SKILL.md`

- [ ] **Step 1: Verify current state**

  Run: `grep -n "When to Use\|Typical time" "skill-packs/codex-review/skills/codex-think-about/SKILL.md"`
  Expected: no matches.

- [ ] **Step 2: Add `## When to Use` section after `## Purpose`**

  Insert this block after the `## Purpose` section (before `## Prerequisites`):
  ```markdown
  ## When to Use
  When you want to debate a technical decision or design question before implementing. Use this for architecture choices, technology comparisons, and reasoning through tradeoffs — not for code review.
  ```

- [ ] **Step 3: Add `Typical time` column to Effort table**

  Replace the current 3-column table under `### Effort Level Guide` with the Standard Effort Table block.

- [ ] **Step 4: Verify result**

  Run: `grep -n "When to Use\|Typical time" "skill-packs/codex-review/skills/codex-think-about/SKILL.md"`
  Expected: both match.

- [ ] **Step 5: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-think-about/SKILL.md
  git commit -m "feat(phase1): add When to Use and Typical time to codex-think-about"
  ```

---

### Task 3: codex-codebase-review SKILL.md

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-codebase-review/SKILL.md`

- [ ] **Step 1: Verify current state**

  Run: `grep -n "When to Use\|Typical time" "skill-packs/codex-review/skills/codex-codebase-review/SKILL.md"`
  Expected: no matches. Note the custom effort table has columns: Level, Discovery, Cross-cutting, Validation.

  Confirm absence of Typical time:
  ```bash
  grep -A 5 "Effort Level Guide" "skill-packs/codex-review/skills/codex-codebase-review/SKILL.md" | grep "Typical time"
  ```
  Expected: no output (confirms column not yet present).

- [ ] **Step 2: Add `## When to Use` section after `## Purpose`**

  Insert this block after the `## Purpose` section (before `## Prerequisites`):
  ```markdown
  ## When to Use
  For full codebase audit (50–500+ files). Not for incremental change review — use `/codex-impl-review` for that. Run periodically for architecture/quality sweeps or before major releases.
  ```

- [ ] **Step 3: Add `Typical time` column to custom Effort table**

  Replace current table:
  ```markdown
  | Level    | Discovery        | Cross-cutting    | Validation   |
  |----------|------------------|------------------|--------------|
  | `low`    | Auto-detect only | Basic (2 cats)   | Skip         |
  | `medium` | Auto + confirm   | Standard (3 cats)| Skip         |
  | `high`   | Full + confirm   | Full (5 cats)    | 1 round      |
  | `xhigh`  | Full + suggest   | Full + arch      | 2 rounds     |
  ```
  With:
  ```markdown
  | Level    | Discovery        | Cross-cutting    | Validation   | Typical time        |
  |----------|------------------|------------------|--------------|---------------------|
  | `low`    | Auto-detect only | Basic (2 cats)   | Skip         | ~10-20 min/chunk    |
  | `medium` | Auto + confirm   | Standard (3 cats)| Skip         | ~15-30 min/chunk    |
  | `high`   | Full + confirm   | Full (5 cats)    | 1 round      | ~20-40 min/chunk    |
  | `xhigh`  | Full + suggest   | Full + arch      | 2 rounds     | ~30-60 min/chunk    |
  ```

- [ ] **Step 4: Verify result**

  Run: `grep -n "When to Use\|Typical time" "skill-packs/codex-review/skills/codex-codebase-review/SKILL.md"`
  Expected: both match.

- [ ] **Step 5: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-codebase-review/SKILL.md
  git commit -m "feat(phase1): add When to Use and Typical time to codex-codebase-review"
  ```

---

### Task 4: codex-pr-review SKILL.md

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-pr-review/SKILL.md`

- [ ] **Step 1: Verify current state**

  Run: `grep -n "When to Use\|Typical time" "skill-packs/codex-review/skills/codex-pr-review/SKILL.md"`
  Expected: no matches. Confirm step 1 starts with `**Ask user**`.

- [ ] **Step 2: Add `## When to Use` section after `## Purpose`**

  Insert after `## Purpose` (before `## Prerequisites`):
  ```markdown
  ## When to Use
  Before opening or merging a pull request. Covers branch diff, commit history, and PR description together in one pass — more thorough than `/codex-impl-review` for pre-merge scenarios.
  ```

- [ ] **Step 3: Add `Typical time` column to Effort table**

  Replace current 3-column table:
  ```markdown
  | Level    | Depth             | Best for                        |
  |----------|-------------------|---------------------------------|
  | `low`    | Surface check     | Quick sanity check              |
  | `medium` | Standard review   | Most day-to-day work            |
  | `high`   | Deep analysis     | Important features              |
  | `xhigh`  | Exhaustive        | Critical/security-sensitive     |
  ```
  With (PR review is slightly slower — more context to process):
  ```markdown
  | Level    | Depth             | Best for                        | Typical time |
  |----------|-------------------|---------------------------------|--------------|
  | `low`    | Surface check     | Quick sanity check              | ~3-5 min     |
  | `medium` | Standard review   | Most day-to-day work            | ~8-12 min    |
  | `high`   | Deep analysis     | Important features              | ~15-20 min   |
  | `xhigh`  | Exhaustive        | Critical/security-sensitive     | ~25-40 min   |
  ```

- [ ] **Step 4: Verify result**

  Run: `grep -n "When to Use\|Typical time" "skill-packs/codex-review/skills/codex-pr-review/SKILL.md"`
  Expected: both match.

- [ ] **Step 5: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-pr-review/SKILL.md
  git commit -m "feat(phase1): add When to Use and Typical time to codex-pr-review"
  ```

---

### Task 5: codex-security-review SKILL.md + output-format.md

This is the most complex Phase 1 task. `codex-security-review/SKILL.md` currently has three inline sections (`### Scope Guide`, `## Security Categories Covered`, `## Output Format`, `## Important Limitations`) that belong in references. These must be removed from SKILL.md and absorbed into `references/output-format.md`.

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-security-review/SKILL.md`
- Modify: `skill-packs/codex-review/skills/codex-security-review/references/output-format.md`

- [ ] **Step 1: Verify current state of SKILL.md**

  Run: `grep -n "^## \|^### " "skill-packs/codex-review/skills/codex-security-review/SKILL.md"`
  Expected output shows: Purpose, Prerequisites, Runner, Workflow, Effort Level Guide, Scope Guide, Security Categories Covered (inline), Output Format (inline), Important Limitations (inline), Required References, Rules.

- [ ] **Step 2: Add `## When to Use` section after `## Purpose`**

  Insert after `## Purpose` (before `## Prerequisites`):
  ```markdown
  ## When to Use
  When changes touch auth, crypto, SQL queries, user input processing, file uploads, or external API calls. Use for security-focused pre-commit or pre-merge review. Complements `/codex-impl-review` — run both for sensitive code.
  ```

- [ ] **Step 3: Add `Typical time` column to Effort table**

  The current effort table has only 3 columns (no `Typical time`):
  ```markdown
  | Level    | Depth             | Best for                        |
  |----------|-------------------|---------------------------------|
  | `low`    | Common patterns   | Quick security sanity check     |
  | `medium` | OWASP Top 10      | Standard security review        |
  | `high`   | Deep analysis     | Pre-production security audit   |
  | `xhigh`  | Exhaustive        | Critical/regulated systems      |
  ```
  Replace with:
  ```markdown
  | Level    | Depth             | Best for                        | Typical time |
  |----------|-------------------|---------------------------------|--------------|
  | `low`    | Common patterns   | Quick security sanity check     | ~3-5 min     |
  | `medium` | OWASP Top 10      | Standard security review        | ~8-12 min    |
  | `high`   | Deep analysis     | Pre-production security audit   | ~15-20 min   |
  | `xhigh`  | Exhaustive        | Critical/regulated systems      | ~25-40 min   |
  ```

- [ ] **Step 4: Remove inline sections from SKILL.md**

  Delete the following sections entirely from SKILL.md (content moves to output-format.md):
  - `## Security Categories Covered` (the full section with OWASP Top 10 list and "Additional Security Checks")
  - `## Output Format` (the section listing CWE ID, OWASP Category, Severity, Confidence, Attack Vector, Suggested Fix)
  - `## Important Limitations` (the section with ✅/❌/⚠️ static analysis limits)

  Also update `## Required References` to link the moved content:
  ```markdown
  ## Required References
  - Detailed execution: `references/workflow.md`
  - Prompt templates: `references/prompts.md`
  - Output contract (incl. Security Categories, Output Format, OWASP coverage): `references/output-format.md`
  ```

- [ ] **Step 5: Verify SKILL.md section order**

  Run: `grep -n "^## \|^### " "skill-packs/codex-review/skills/codex-security-review/SKILL.md"`
  Expected: Purpose, When to Use, Prerequisites, Runner, Workflow, Effort Level Guide, Scope Guide, Required References, Rules — in that order. No Security Categories, Output Format, or Important Limitations sections.

  Verify Scope Guide is preserved within Workflow section:
  Run: `grep -n "Scope Guide" "skill-packs/codex-review/skills/codex-security-review/SKILL.md"`
  Expected: one match inside `## Workflow` (codex-security-review has a scope parameter, so Scope Guide is kept).

- [ ] **Step 6: Add removed content to references/output-format.md**

  Prepend the following block at the top of `references/output-format.md` (before the existing "Overview" section):
  ```markdown
  ## Security Categories Covered

  ### OWASP Top 10 2021
  - **A01:2021** - Broken Access Control
  - **A02:2021** - Cryptographic Failures
  - **A03:2021** - Injection (SQL, Command, XSS, etc.)
  - **A04:2021** - Insecure Design
  - **A05:2021** - Security Misconfiguration
  - **A06:2021** - Vulnerable and Outdated Components
  - **A07:2021** - Identification and Authentication Failures
  - **A08:2021** - Software and Data Integrity Failures
  - **A09:2021** - Security Logging and Monitoring Failures
  - **A10:2021** - Server-Side Request Forgery (SSRF)

  ### Additional Security Checks
  - Secrets/credentials in code
  - Hardcoded passwords and API keys
  - Insecure random number generation
  - Path traversal vulnerabilities
  - XML External Entity (XXE) attacks
  - Insecure deserialization
  - Missing security headers
  - CORS misconfigurations

  ## Output Format

  Each security finding includes:
  - **CWE ID**: Common Weakness Enumeration identifier
  - **OWASP Category**: OWASP Top 10 2021 mapping
  - **Severity**: `critical`, `high`, `medium`, `low`
  - **Confidence**: `high`, `medium`, `low` (static analysis confidence)
  - **Attack Vector**: How the vulnerability could be exploited
  - **Suggested Fix**: Secure code example

  ## Important Limitations

  **This is static analysis only:**
  - ✅ Can detect: Code patterns, hardcoded secrets, common vulnerabilities
  - ❌ Cannot detect: Runtime behavior, memory leaks (need profiling), zero-days
  - ⚠️ Heuristic: Findings are AI-generated suggestions, not guaranteed vulnerabilities

  **Always:**
  - Verify findings manually before treating as confirmed vulnerabilities
  - Run dynamic security testing (DAST) for runtime issues
  - Use dedicated tools for dependency scanning (Snyk, Dependabot)
  - Consult security experts for critical systems

  ---

  ```

- [ ] **Step 7: Verify output-format.md**

  Run: `grep -n "^## \|^### " "skill-packs/codex-review/skills/codex-security-review/references/output-format.md"`
  Expected: Security Categories Covered, Output Format, Important Limitations, (then existing) Overview, Finding Structure, Security Categories, Severity Levels, etc.

- [ ] **Step 8: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-security-review/SKILL.md \
          skill-packs/codex-review/skills/codex-security-review/references/output-format.md
  git commit -m "feat(phase1): standardize codex-security-review - add When to Use, Typical time, move inline sections to references"
  ```

---

### Task 6: codex-auto-review SKILL.md

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-auto-review/SKILL.md`

- [ ] **Step 1: Verify current state**

  Run: `grep -n "When to Use\|Typical time" "skill-packs/codex-review/skills/codex-auto-review/SKILL.md"`
  Expected: no matches.

- [ ] **Step 2: Add `## When to Use` section after `## Purpose`**

  Insert after `## Purpose` (before `## Prerequisites`):
  ```markdown
  ## When to Use
  When you want zero-friction comprehensive review without deciding which skills to run. Auto-detects relevant review types from your changes and runs them in parallel. Best used at natural milestones (feature completion, before PR).
  ```

- [ ] **Step 3: Add `Typical time` column to Effort table**

  Replace the current 3-column effort table:
  ```markdown
  | Level    | Depth             | Best for                        |
  |----------|-------------------|---------------------------------|
  | `low`    | Surface check     | Quick sanity check              |
  | `medium` | Standard review   | Most day-to-day work            |
  | `high`   | Deep analysis     | Important features              |
  | `xhigh`  | Exhaustive        | Critical/security-sensitive     |
  ```
  With (auto-review runs multiple skills, times are higher):
  ```markdown
  | Level    | Depth             | Best for                        | Typical time        |
  |----------|-------------------|---------------------------------|---------------------|
  | `low`    | Surface check     | Quick sanity check              | ~5-10 min           |
  | `medium` | Standard review   | Most day-to-day work            | ~10-20 min          |
  | `high`   | Deep analysis     | Important features              | ~20-40 min          |
  | `xhigh`  | Exhaustive        | Critical/security-sensitive     | ~40-60+ min         |
  ```

- [ ] **Step 4: Verify result**

  Run: `grep -n "When to Use\|Typical time" "skill-packs/codex-review/skills/codex-auto-review/SKILL.md"`
  Expected: both match.

- [ ] **Step 5: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-auto-review/SKILL.md
  git commit -m "feat(phase1): add When to Use and Typical time to codex-auto-review"
  ```

---

### Task 7: codex-impl-review, codex-commit-review, codex-plan-review SKILL.md

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-impl-review/SKILL.md`
- Modify: `skill-packs/codex-review/skills/codex-commit-review/SKILL.md`
- Modify: `skill-packs/codex-review/skills/codex-plan-review/SKILL.md`

- [ ] **Step 1: Verify current state for all three**

  Run:
  ```bash
  grep -n "When to Use" skill-packs/codex-review/skills/codex-impl-review/SKILL.md
  grep -n "When to Use" skill-packs/codex-review/skills/codex-commit-review/SKILL.md
  grep -n "When to Use" skill-packs/codex-review/skills/codex-plan-review/SKILL.md
  ```
  Expected: impl and commit have no match; plan-review has a match (already present, skip adding).

- [ ] **Step 2: Add `## When to Use` to codex-impl-review SKILL.md**

  Insert after `## Purpose` (before `## Prerequisites`):
  ```markdown
  ## When to Use
  After writing code, before committing. Use for uncommitted working-tree changes (default) or comparing a branch against base before merge. Run before `/codex-commit-review` or `/codex-pr-review`.
  ```

- [ ] **Step 3: Add `## When to Use` to codex-commit-review SKILL.md**

  Insert after `## Purpose` (before `## Prerequisites`):
  ```markdown
  ## When to Use
  After staging changes (draft mode) to review a commit message before committing, or after committing (last mode) to verify message quality before pushing. Checks message quality only — not code.
  ```

- [ ] **Step 4: Verify all three files**

  Run: `grep -c "When to Use" skill-packs/codex-review/skills/codex-impl-review/SKILL.md skill-packs/codex-review/skills/codex-commit-review/SKILL.md skill-packs/codex-review/skills/codex-plan-review/SKILL.md`
  Expected: each file shows count ≥ 1.

- [ ] **Step 5: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-impl-review/SKILL.md \
          skill-packs/codex-review/skills/codex-commit-review/SKILL.md
  git commit -m "feat(phase1): add When to Use to codex-impl-review and codex-commit-review"
  ```

---

## Phase 2: Unified Output Location

### Task 8: Compatibility Audit

Before migrating paths, confirm no stale references remain outside of `codex-auto-review/references/workflow.md`.

**Files:**
- No files modified in this task — audit only

- [ ] **Step 1: Search for stale `auto-runs` path references**

  Run: `grep -rn "auto-runs" skill-packs/`
  Note every file and line that matches.

- [ ] **Step 2: Search for stale `review.json` references**

  Run: `grep -rn "review\.json" skill-packs/`
  Note every file and line that matches.

- [ ] **Step 3: Evaluate each match**

  - Any match in `codex-runner.js` → **STOP, escalate**: `codex-runner.js` is out of scope for this plan. Do not proceed with Phase 2 until this is resolved.
  - Any match in a `references/workflow.md` file other than `codex-auto-review/references/workflow.md` → fix it in this task before proceeding.
  - Match in `codex-auto-review/references/workflow.md` → expected, will be fixed in Task 10.

- [ ] **Step 4: Fix any unexpected stale references found**

  For each match outside the expected location, update the reference to use the new path `.codex-review/sessions/<skill-name>-<timestamp>-<pid>/` and remove `review.json` references.

- [ ] **Step 5: Record audit result**

  No commit needed if no unexpected references found. If fixes were made:
  ```bash
  git add -p   # stage only the fixed files
  git commit -m "fix(phase2): remove stale auto-runs and review.json references (compatibility audit)"
  ```

---

### Task 9: Add Session Output to 5 Review Skill workflow.md Files

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-impl-review/references/workflow.md`
- Modify: `skill-packs/codex-review/skills/codex-pr-review/references/workflow.md`
- Modify: `skill-packs/codex-review/skills/codex-plan-review/references/workflow.md`
- Modify: `skill-packs/codex-review/skills/codex-commit-review/references/workflow.md`
- Modify: `skill-packs/codex-review/skills/codex-security-review/references/workflow.md`

- [ ] **Step 1: Verify none have a Session Output section yet**

  Run: `grep -rn "Session Output\|sessions/" skill-packs/codex-review/skills/codex-impl-review/references/ skill-packs/codex-review/skills/codex-pr-review/references/ skill-packs/codex-review/skills/codex-plan-review/references/ skill-packs/codex-review/skills/codex-commit-review/references/ skill-packs/codex-review/skills/codex-security-review/references/`
  Expected: no matches.

- [ ] **Step 2: Add Session Output block to each workflow.md**

  For each of the 5 workflow.md files, append the Session Output block (from Standard Blocks above) before the Cleanup/Error Handling section. Use the correct `{SKILL_NAME}` for each:
  - `codex-impl-review` — includes `$SCOPE`
  - `codex-pr-review` — includes `$SCOPE` (use base branch as scope or omit)
  - `codex-plan-review` — omit `$SCOPE` field (not applicable)
  - `codex-commit-review` — omit `$SCOPE` field; use `$MODE` instead
  - `codex-security-review` — includes `$SCOPE`

  For `codex-plan-review` meta.json, use this schema (no scope):
  ```json
  {
    "skill": "codex-plan-review",
    "version": 14,
    "effort": "$EFFORT",
    "rounds": $ROUND_COUNT,
    "verdict": "$FINAL_VERDICT",
    "timing": { "total_seconds": $ELAPSED_SECONDS },
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  }
  ```

  For `codex-commit-review` meta.json, use this schema (mode instead of scope):
  ```json
  {
    "skill": "codex-commit-review",
    "version": 14,
    "effort": "$EFFORT",
    "mode": "$MODE",
    "rounds": $ROUND_COUNT,
    "verdict": "$FINAL_VERDICT",
    "timing": { "total_seconds": $ELAPSED_SECONDS },
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  }
  ```

  > **Note on commit-review schema:** `"mode"` replaces `"scope"` because commit-review's input is `draft` or `last` mode, not a git scope. This is not an error — the field captures the same intent (what context the review operates in) using the correct vocabulary for this skill.

- [ ] **Step 3: Verify all 5 files now have the section**

  Run: `grep -rln "Session Output" skill-packs/codex-review/skills/codex-impl-review/references/ skill-packs/codex-review/skills/codex-pr-review/references/ skill-packs/codex-review/skills/codex-plan-review/references/ skill-packs/codex-review/skills/codex-commit-review/references/ skill-packs/codex-review/skills/codex-security-review/references/`
  Expected: 5 file paths returned.

- [ ] **Step 4: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-impl-review/references/workflow.md \
          skill-packs/codex-review/skills/codex-pr-review/references/workflow.md \
          skill-packs/codex-review/skills/codex-plan-review/references/workflow.md \
          skill-packs/codex-review/skills/codex-commit-review/references/workflow.md \
          skill-packs/codex-review/skills/codex-security-review/references/workflow.md
  git commit -m "feat(phase2): add session output (.codex-review/sessions/) to 5 review skills"
  ```

---

### Task 10: Migrate codex-auto-review/references/workflow.md

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-auto-review/references/workflow.md`

- [ ] **Step 1: Verify current stale references**

  Run: `grep -n "auto-runs\|review\.json" "skill-packs/codex-review/skills/codex-auto-review/references/workflow.md"`
  Expected: matches at the `SESSION_DIR` definition and the merge input `review.json` example.

- [ ] **Step 2: Update `SESSION_DIR` path from `auto-runs` to `sessions`**

  Find and replace all occurrences of `.codex-review/auto-runs/` with `.codex-review/sessions/` in this file.

  Before:
  ```bash
  SESSION_DIR=".codex-review/auto-runs/<session>"
  ```
  After:
  ```bash
  SESSION_DIR=".codex-review/sessions/codex-auto-review-$(date +%s)-$$"
  ```

  Also update the directory tree example if present:
  ```
  # Before
  .codex-review/auto-runs/<unix-timestamp>-<pid>/

  # After
  .codex-review/sessions/codex-auto-review-<unix-timestamp>-<pid>/
  ```

- [ ] **Step 3: Fix stale `review.json` reference in merge input**

  Find the merge input JSON example that references `review.json`:
  ```json
  "codex-impl-review": [...findings from review.json...],
  "codex-security-review": [...findings from review.json...]
  ```
  Replace with:
  ```json
  "codex-impl-review": [...findings parsed from review.md...],
  "codex-security-review": [...findings parsed from review.md...]
  ```

  Also update the comment above this block to explain that Claude Code reads `review.md` files from each skill's session dir and parses `ISSUE-{N}` blocks to build the merge input.

- [ ] **Step 4: Add `"skill"` and `"version"` fields to the meta.json example**

  Find the existing `meta.json` example and add the two new fields at the top:
  ```json
  {
    "skill": "codex-auto-review",
    "version": 14,
    "skills_run": ["codex-impl-review", "codex-security-review"],
    ...existing fields...
  }
  ```

- [ ] **Step 5: Verify no stale references remain**

  Run: `grep -n "auto-runs\|review\.json" "skill-packs/codex-review/skills/codex-auto-review/references/workflow.md"`
  Expected: no matches.

  > **Backward compatibility note:** Existing run directories in `.codex-review/auto-runs/` from prior sessions are not retroactively migrated. Users can safely delete the old directory after verifying new runs appear in `.codex-review/sessions/`. The installer does not clean up this directory.

- [ ] **Step 6: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-auto-review/references/workflow.md
  git commit -m "feat(phase2): migrate codex-auto-review to sessions/ path, fix stale review.json reference"
  ```

---

## Phase 3: Smart Defaults

### Task 11: Smart Defaults — codex-impl-review and codex-security-review

Both skills auto-detect `scope` and `effort`.

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-impl-review/SKILL.md`
- Modify: `skill-packs/codex-review/skills/codex-security-review/SKILL.md`
- Modify: `skill-packs/codex-review/skills/codex-impl-review/references/workflow.md`
- Modify: `skill-packs/codex-review/skills/codex-security-review/references/workflow.md`

- [ ] **Step 1: Update codex-impl-review Workflow step 1**

  Replace:
  ```markdown
  1. **Ask user** to choose review effort level: `low`, `medium`, `high`, or `xhigh` (default: `high`). Ask review mode: `working-tree` (default) or `branch`. If branch mode, ask for base branch name and validate (see workflow.md for base branch discovery). Set `EFFORT` and `MODE`.
  ```
  With the **Smart Defaults — Scope+Effort Pattern** block from Standard Blocks above.

- [ ] **Step 2: Update codex-security-review Workflow step 1**

  Replace:
  ```markdown
  1. **Ask user** to choose review effort level: `low`, `medium`, `high`, or `xhigh` (default: `high`). Ask review scope: `working-tree` (uncommitted changes), `branch` (branch diff), or `full` (entire codebase). Set `EFFORT` and `SCOPE`.
  ```
  With the **Smart Defaults — Scope+Effort Pattern** block.

- [ ] **Step 3: Add detection docs to codex-impl-review/references/workflow.md**

  At the top of the file (before `## 1) Collect Inputs`), insert:
  ```markdown
  ## Smart Default Detection

  > **Context:** These detection commands run inside Claude Code where `git` is available. They assume a git repository. All `git` commands are wrapped in `2>/dev/null` to fail silently for non-git directories or edge cases (detached HEAD, no upstream tracking branch set). Detection is best-effort — if a command fails, the fallback default is used.

  Before asking the user anything, auto-detect and announce:

  **effort detection:**
  ```bash
  FILES_CHANGED=$(git diff --name-only 2>/dev/null | wc -l)
  if [ "$FILES_CHANGED" -lt 10 ]; then EFFORT="medium"
  elif [ "$FILES_CHANGED" -lt 50 ]; then EFFORT="high"
  else EFFORT="xhigh"
  fi
  # Fallback: default high
  EFFORT=${EFFORT:-high}
  ```

  **scope detection:**
  ```bash
  HAS_WORKING_CHANGES=$(git status --short 2>/dev/null | wc -l)
  HAS_BRANCH_COMMITS=$(git rev-list @{u}..HEAD 2>/dev/null | wc -l)
  if [ "$HAS_WORKING_CHANGES" -gt 0 ]; then SCOPE="working-tree"
  elif [ "$HAS_BRANCH_COMMITS" -gt 0 ]; then SCOPE="branch"
  else SCOPE=""  # ask user
  fi
  ```

  Announce: `"Detected: scope=working-tree, effort=high (23 files changed). Proceeding — reply to override."`

  Only block execution for `$SCOPE` when both detection methods return 0 (no changes anywhere).

  ---

  ```

- [ ] **Step 4: Add detection docs to codex-security-review/references/workflow.md**

  Add the same `## Smart Default Detection` section at the top of the file. Content is identical to step 3.

- [ ] **Step 5: Verify changes**

  Run:
  ```bash
  grep -n "Collect inputs\|Smart Default" skill-packs/codex-review/skills/codex-impl-review/SKILL.md
  grep -n "Collect inputs\|Smart Default" skill-packs/codex-review/skills/codex-security-review/SKILL.md
  ```
  Expected: `Collect inputs` in SKILL.md step 1; `Smart Default` in both files.

- [ ] **Step 6: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-impl-review/SKILL.md \
          skill-packs/codex-review/skills/codex-security-review/SKILL.md \
          skill-packs/codex-review/skills/codex-impl-review/references/workflow.md \
          skill-packs/codex-review/skills/codex-security-review/references/workflow.md
  git commit -m "feat(phase3): add smart defaults (scope+effort auto-detect) to impl-review and security-review"
  ```

---

### Task 12: Smart Defaults — codex-pr-review

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-pr-review/SKILL.md`
- Modify: `skill-packs/codex-review/skills/codex-pr-review/references/workflow.md`

- [ ] **Step 1: Update Workflow step 1 in SKILL.md**

  Replace:
  ```markdown
  1. **Ask user** to choose review effort level: `low`, `medium`, `high`, or `xhigh` (default: `high`). Ask for base branch (discover and validate — see workflow.md). Ask for PR title and description (optional). Set `EFFORT`.
  ```
  With the **Smart Defaults — Base-Branch+Effort Pattern** block from Standard Blocks above.

- [ ] **Step 2: Add detection docs to workflow.md**

  At the top of the file (before `## 1) Collect Inputs`), insert:
  ```markdown
  ## Smart Default Detection

  **base-branch detection:**
  ```bash
  BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||')
  if [ -z "$BASE" ]; then
    git show-ref --verify --quiet refs/heads/main && BASE="main"
    git show-ref --verify --quiet refs/heads/master && BASE="master"
  fi
  ```

  **effort detection** (after base is resolved):
  ```bash
  FILES_CHANGED=$(git diff --name-only "$BASE"...HEAD 2>/dev/null | wc -l)
  if [ "$FILES_CHANGED" -lt 10 ]; then EFFORT="medium"
  elif [ "$FILES_CHANGED" -lt 50 ]; then EFFORT="high"
  else EFFORT="xhigh"
  fi
  EFFORT=${EFFORT:-high}
  ```

  Announce: `"Detected: base=main, effort=high (15 files changed). Proceeding — reply to override. PR title/description are optional."`

  Block only if `$BASE` cannot be resolved (both auto-detection and fallback fail).

  ---

  ```

- [ ] **Step 3: Verify**

  Run: `grep -n "Collect inputs\|Smart Default" "skill-packs/codex-review/skills/codex-pr-review/SKILL.md" "skill-packs/codex-review/skills/codex-pr-review/references/workflow.md"`
  Expected: matches in both files.

- [ ] **Step 4: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-pr-review/SKILL.md \
          skill-packs/codex-review/skills/codex-pr-review/references/workflow.md
  git commit -m "feat(phase3): add smart defaults (base-branch+effort auto-detect) to codex-pr-review"
  ```

---

### Task 13: Smart Defaults — codex-commit-review

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-commit-review/SKILL.md`
- Modify: `skill-packs/codex-review/skills/codex-commit-review/references/workflow.md`

- [ ] **Step 1: Update Workflow step 1 in SKILL.md**

  Replace:
  ```markdown
  1. **Ask user** to choose review effort level: `low`, `medium`, `high`, or `xhigh` (default: `medium`). Ask input source: `draft` (user provides message text) or `last` (review last N commits, default 1). Set `EFFORT` and `MODE`.
  ```
  With the **Smart Defaults — Mode Pattern** block from Standard Blocks above.

- [ ] **Step 2: Add detection docs to workflow.md**

  At the top of the file (before `## 1) Collect Inputs`), insert:
  ```markdown
  ## Smart Default Detection

  **mode detection:**
  ```bash
  git diff --cached --quiet
  if [ $? -ne 0 ]; then MODE="draft"; else MODE="last"; fi
  ```

  If `draft`, ask user for the commit message text to review. If `last`, use N=1 default.

  Announce: `"Detected: mode=draft, effort=medium. Proceeding — reply to override."`

  ---

  ```

- [ ] **Step 3: Verify**

  Run: `grep -n "Collect inputs\|Smart Default" "skill-packs/codex-review/skills/codex-commit-review/SKILL.md"`
  Expected: `Collect inputs` in step 1.

- [ ] **Step 4: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-commit-review/SKILL.md \
          skill-packs/codex-review/skills/codex-commit-review/references/workflow.md
  git commit -m "feat(phase3): add smart defaults (mode auto-detect) to codex-commit-review"
  ```

---

### Task 14: Smart Defaults — codex-plan-review

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-plan-review/SKILL.md`
- Modify: `skill-packs/codex-review/skills/codex-plan-review/references/workflow.md`

- [ ] **Step 1: Update Workflow step 1 in SKILL.md**

  Replace:
  ```markdown
  1. **Ask user** to choose debate effort level: `low`, `medium`, `high`, or `xhigh` (default: `high`). Set `EFFORT`.
  ```
  With the **Smart Defaults — Plan-Path+Effort Pattern** block from Standard Blocks above.

- [ ] **Step 2: Add detection docs to workflow.md**

  At the top of the file (before `## 1) Gather Inputs`), insert:
  ```markdown
  ## Smart Default Detection

  **plan-path detection** (matches spec: `plan.md`, `PLAN.md`, `docs/*plan*` only):
  ```bash
  # Check exact names at CWD root level
  PLAN_ROOT=$(ls plan.md PLAN.md 2>/dev/null | head -1)
  # Check docs/ subdirectory for any *plan* file
  PLAN_DOCS=$(find ./docs -maxdepth 2 -name "*plan*" 2>/dev/null | head -5)

  # Count total candidates
  ALL="$([ -n "$PLAN_ROOT" ] && echo "$PLAN_ROOT")
  $PLAN_DOCS"
  COUNT=$(echo "$ALL" | grep -v '^$' | wc -l)

  if [ "$COUNT" -eq 1 ]; then
    PLAN_PATH=$(echo "$ALL" | grep -v '^$')
  elif [ "$COUNT" -gt 1 ]; then
    # List candidates and ask user to choose
    echo "Multiple plan files found: $ALL"
    # Ask: "Which plan file should I use?"
  else
    # Ask user for path
    PLAN_PATH=""
  fi
  ```

  > **Scope:** Only searches `plan.md`/`PLAN.md` at CWD root, and `docs/` subdirectory. Does NOT do deep recursive search to avoid false positives.

  **effort detection:** Default `high` for plan review.

  Announce: `"Detected: plan=docs/superpowers/plans/2026-03-18-example.md, effort=high. Proceeding — reply to override."`

  ---

  ```

- [ ] **Step 3: Verify**

  Run: `grep -n "Collect inputs\|Smart Default" "skill-packs/codex-review/skills/codex-plan-review/SKILL.md"`
  Expected: `Collect inputs` in step 1.

- [ ] **Step 4: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-plan-review/SKILL.md \
          skill-packs/codex-review/skills/codex-plan-review/references/workflow.md
  git commit -m "feat(phase3): add smart defaults (plan-path auto-detect) to codex-plan-review"
  ```

---

### Task 15: Smart Defaults — codex-parallel-review and codex-codebase-review

Both only auto-detect `effort`.

**Files:**
- Modify: `skill-packs/codex-review/skills/codex-parallel-review/SKILL.md`
- Modify: `skill-packs/codex-review/skills/codex-codebase-review/SKILL.md`

- [ ] **Step 1: Update codex-parallel-review Workflow step 1**

  First check current state of step 1 (established in Task 1 Step 4):
  Run: `grep -n "^1\." "skill-packs/codex-review/skills/codex-parallel-review/SKILL.md"`

  Replace the entire step 1 line (regardless of whether it starts with "**Ask user**" or "**Collect inputs**"):
  ```markdown
  1. **Collect inputs**: Auto-detect effort and announce default.
     - **effort**: Run `git diff --name-only | wc -l` — <10 → `medium`, 10–50 → `high`, >50 → `xhigh`; default `high`.
     - Announce: "Detected: effort=`$EFFORT` (N files changed). Proceeding — reply to override effort. Review mode: `full-codebase` (default) / `working-tree` / `branch`."
     - Set `EFFORT`. Ask `MODE` only if user doesn't confirm default.
  ```

  > **Note:** Per spec, only `effort` is auto-detected for parallel-review. `MODE` defaults to `full-codebase` but is not detected — user overrides it by replying. This is intentional to keep the announcement short.

- [ ] **Step 2: Update codex-codebase-review Workflow step 1**

  Replace existing step 1 (`**Collect inputs**: effort level, parallel factor, focus areas.`):
  Use the **Smart Defaults — Effort-Only Pattern** block, then add:
  ```markdown
     - Also ask: parallel factor (default 3 chunks), focus areas (optional).
  ```

- [ ] **Step 3: Verify both files**

  Run: `grep -n "Collect inputs" skill-packs/codex-review/skills/codex-parallel-review/SKILL.md skill-packs/codex-review/skills/codex-codebase-review/SKILL.md`
  Expected: matches in both.

- [ ] **Step 4: Commit**

  ```bash
  git add skill-packs/codex-review/skills/codex-parallel-review/SKILL.md \
          skill-packs/codex-review/skills/codex-codebase-review/SKILL.md
  git commit -m "feat(phase3): add smart defaults (effort auto-detect) to parallel-review and codebase-review"
  ```

---

## Final Verification

### Task 16: Integration Verification

- [ ] **Step 1: Verify all 9 SKILL.md have `When to Use` section**

  Run: `grep -l "## When to Use" skill-packs/codex-review/skills/*/SKILL.md | wc -l`
  Expected: 9

- [ ] **Step 2: Verify all 9 SKILL.md have `Typical time` in Effort table**

  Run: `grep -l "Typical time" skill-packs/codex-review/skills/*/SKILL.md | wc -l`
  Expected: 9

- [ ] **Step 3: Verify section order in each SKILL.md**

  For each skill, check that sections appear in order: Purpose → When to Use → Prerequisites → Runner → Workflow → Required References → Rules. Use line numbers to confirm ordering.

  Run:
  ```bash
  for f in skill-packs/codex-review/skills/*/SKILL.md; do
    echo "=== $(basename $(dirname $f)) ===";
    grep -n "^## Purpose\|^## When to Use\|^## Prerequisites\|^## Runner\|^## Workflow\|^## Required References\|^## Rules" "$f";
    echo "";
  done
  ```
  For each skill, verify the 7 section line numbers are strictly ascending in the order listed. If any section appears out of order, note the file and fix before proceeding.

- [ ] **Step 4: Verify session output sections exist in 5 workflow.md files**

  Run: `grep -rl "Session Output" skill-packs/codex-review/skills/ | wc -l`
  Expected: 5 (impl, pr, plan, commit, security)

- [ ] **Step 5: Verify no stale `auto-runs` or `review.json` references**

  Run:
  ```bash
  grep -rn "auto-runs\|review\.json" skill-packs/codex-review/skills/
  ```
  Expected: no matches.

- [ ] **Step 6: Verify all `Collect inputs` (no more `Ask user` in step 1)**

  Run: `grep -rn "^\*\*Ask user\*\* to choose" skill-packs/codex-review/skills/*/SKILL.md`
  Expected: no matches (all converted to `**Collect inputs**`).

- [ ] **Step 7: Run installer to verify it still works**

  Run: `node bin/codex-skill.js`
  Expected: installer completes without errors, prints success message.
  Verify: `ls ~/.claude/skills/codex-impl-review/`
  Expected: `SKILL.md references/` present in the installed output.

- [ ] **Step 8: Spot-check one installed SKILL.md**

  Run: `grep -n "When to Use\|Typical time\|Collect inputs" ~/.claude/skills/codex-impl-review/SKILL.md`
  Expected: all three terms found — confirms installer correctly propagated template changes.

- [ ] **Step 9: Final commit if any cleanup needed, then tag**

  ```bash
  git add -p   # review any remaining unstaged changes
  git commit -m "feat: complete UX consistency improvements - all 3 phases done"
  ```

---

## Success Criteria Checklist

> See Task 16: Integration Verification for the step-by-step verification process. All checks below are verified there. This checklist is the authoritative summary — all items must pass before the work is considered complete.

- [ ] All 9 SKILL.md have identical section order (Purpose, When to Use, Prerequisites, Runner, Workflow, Required References, Rules)
- [ ] All 9 SKILL.md have `## When to Use` section with content
- [ ] All Effort tables have 4-column format including `Typical time`
- [ ] 5 review skills (impl, pr, plan, commit, security) write to `.codex-review/sessions/<skill-name>-<ts>-<pid>/`
- [ ] `codex-auto-review` uses `.codex-review/sessions/codex-auto-review-<ts>-<pid>/` (not `auto-runs/`)
- [ ] No stale `auto-runs` or `review.json` references in skill files
- [ ] All applicable SKILL.md step 1 uses `**Collect inputs**` with auto-detect pattern
- [ ] Installer runs successfully after all changes
