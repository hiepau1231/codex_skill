# Design: UX Consistency Improvements for codex-review Skills

**Date:** 2026-03-18
**Branch:** feature/codex-auto-review
**Status:** Approved

---

## Problem Statement

The codex-review skill pack has 9 skills with inconsistent UX across three dimensions:

1. **SKILL.md structure varies** — sections appear in different orders, some skills have extra sections others don't (e.g., `codex-security-review` has an "Output Format" section inline; others delegate to references)
2. **Setup questions differ per skill** — each skill asks inputs in different ways, with no consistent vocabulary or ordering
3. **Effort table incomplete** — `codex-pr-review` and `codex-security-review` missing "Typical time" column that other skills have
4. **Output location inconsistent** — only `codex-auto-review` writes structured output to disk; other 5 review skills produce no persistent output

---

## Goals

- User invoking any skill experiences the same interaction pattern
- New skills added in future have a clear blueprint to follow
- Review outputs from any skill are findable in a predictable location
- Reduce friction: minimize required user responses before execution starts

---

## Non-Goals

- Changing the review/debate logic inside any skill
- Modifying `codex-runner.js` execution engine
- Adding new skills

---

## Design

### A: SKILL.md Standard Template

All SKILL.md files will follow this section order exactly:

```
---
name: codex-<skill-name>
description: <1-line description>
---

# Codex <Skill Name>

## Purpose
## When to Use
## Prerequisites
## Runner
## Workflow
  ### Effort Level Guide  (5-column table including Typical time)
  ### Scope Guide         (only for skills with scope parameter)
## Required References
## Rules
```

**Specific fixes:**

| File | Change |
|------|--------|
| `codex-pr-review/SKILL.md` | Add "Typical time" column to Effort table |
| `codex-security-review/SKILL.md` | Add "Typical time" column; move inline "Output Format" and "Security Categories" sections to `references/output-format.md` |
| All SKILL.md | Standardize Workflow step 1 to: `**Collect inputs**: <list>` |
| All SKILL.md | Ensure "When to Use" section present (add where missing) |

**Effort table standard (5 columns):**

| Level  | Depth           | Best for                    | Typical time |
|--------|-----------------|-----------------------------|--------------|
| low    | Surface check   | Quick sanity check          | ~X-Y min     |
| medium | Standard        | Most day-to-day work        | ~X-Y min     |
| high   | Deep analysis   | Important features          | ~X-Y min     |
| xhigh  | Exhaustive      | Critical/security-sensitive | ~X-Y min     |

---

### B: Unified Output Location

All skills write persistent output to a standard location.

**Directory structure:**

```
.codex-review/
├── cache/                              ← unchanged (detect cache)
├── runs/                               ← unchanged (codex process state)
└── sessions/
    └── <skill-name>-<timestamp>-<pid>/
        ├── review.md                   ← primary output (always present)
        └── meta.json                   ← session metadata
```

**meta.json schema:**

```json
{
  "skill": "codex-impl-review",
  "version": 14,
  "effort": "high",
  "scope": "working-tree",
  "rounds": 2,
  "verdict": "APPROVE",
  "timing": { "total_seconds": 143 },
  "timestamp": "2026-03-18T07:00:00Z"
}
```

**Migration for `codex-auto-review`:**
- Current: `.codex-review/auto-runs/<ts>-<pid>/`
- New: `.codex-review/sessions/codex-auto-review-<ts>-<pid>/`

**Skills affected:**
- `codex-impl-review` — add session dir creation + review.md write
- `codex-pr-review` — add session dir creation + review.md write
- `codex-plan-review` — add session dir creation + review.md write
- `codex-commit-review` — add session dir creation + review.md write
- `codex-security-review` — add session dir creation + review.md write
- `codex-auto-review` — update path from `auto-runs/` to `sessions/`

Each skill's `references/workflow.md` documents when/how to write these files.

---

### C: Smart Defaults for Setup Questions

Skills auto-detect context and proceed with defaults. User only responds to override.

**Detection logic per input:**

| Input | Detection method | Fallback if undetectable |
|-------|-----------------|--------------------------|
| `scope` | `git status --short` → has changes = `working-tree`; `git rev-list @{u}..HEAD` → has commits = `branch` | Ask user |
| `effort` | Count files in diff: <10 = `medium`, 10–50 = `high`, >50 = `xhigh` | Default `high` |
| `base-branch` | Check `git remote show origin` default branch; fallback check for `main`/`master` refs | Ask user |
| `mode` (commit-review) | `git diff --cached --quiet` fails = staged changes = `draft`; else `last` | Default `last` |
| `plan-path` (plan-review) | Scan CWD for `plan.md`, `PLAN.md`, `docs/*plan*` | Ask user |

**Interaction pattern:**

```
# Before (current)
Skill: "Choose effort level: low/medium/high/xhigh (default: high)"
[user waits, types reply]
Skill: "Choose scope: working-tree/branch (default: working-tree)"
[user waits, types reply]

# After (new)
Skill: "Detected: scope=working-tree, effort=high (23 files changed)
        Proceeding — reply to override scope, effort, or both."
[user can reply or stay silent → execution starts]
```

**Rules:**
- Always display detected defaults before starting — never silently assume
- Only block on inputs that cannot be auto-detected (e.g., PR title/description, plan file path when multiple candidates exist)
- Never ask about optional inputs (e.g., PR description is optional — skip if user doesn't provide)

**Skills and applicable smart defaults:**

| Skill | Auto-detectable inputs |
|-------|----------------------|
| `codex-impl-review` | scope, effort |
| `codex-pr-review` | base-branch, effort |
| `codex-security-review` | scope, effort |
| `codex-commit-review` | mode (draft vs last) |
| `codex-plan-review` | plan file path |
| `codex-parallel-review` | effort |
| `codex-think-about` | (no setup inputs) |
| `codex-codebase-review` | effort |

---

## Implementation Order

1. **Phase 1: SKILL.md standardization** (Section A)
   - Update all 9 SKILL.md files to follow standard template
   - Fix Effort tables for `codex-pr-review` and `codex-security-review`
   - Move `codex-security-review` inline sections to references

2. **Phase 2: Unified output location** (Section B)
   - Update `references/workflow.md` for 5 review skills to include session dir creation
   - Update `codex-auto-review/references/workflow.md` to use new path

3. **Phase 3: Smart defaults** (Section C)
   - Update Workflow step 1 in each applicable SKILL.md
   - Document detection logic in each skill's `references/workflow.md`

---

## Files Changed

```
skill-packs/codex-review/skills/
├── codex-plan-review/
│   ├── SKILL.md                          ← template alignment, smart defaults
│   └── references/workflow.md            ← session dir output, detection logic
├── codex-impl-review/
│   ├── SKILL.md                          ← template alignment, smart defaults
│   └── references/workflow.md            ← session dir output, detection logic
├── codex-commit-review/
│   ├── SKILL.md                          ← template alignment, smart defaults
│   └── references/workflow.md            ← session dir output, detection logic
├── codex-pr-review/
│   ├── SKILL.md                          ← template alignment + Typical time, smart defaults
│   └── references/workflow.md            ← session dir output, detection logic
├── codex-security-review/
│   ├── SKILL.md                          ← template alignment + Typical time, move inline sections
│   └── references/
│       ├── output-format.md              ← absorb inline Output Format section
│       └── workflow.md                   ← session dir output, detection logic
├── codex-parallel-review/
│   ├── SKILL.md                          ← template alignment
│   └── references/workflow.md            ← session dir output
├── codex-codebase-review/
│   └── SKILL.md                          ← template alignment
├── codex-think-about/
│   └── SKILL.md                          ← template alignment
└── codex-auto-review/
    ├── SKILL.md                          ← template alignment
    └── references/workflow.md            ← update session dir path
```

---

## Success Criteria

- [ ] All 9 SKILL.md files have identical section order
- [ ] All Effort tables have 5 columns including "Typical time"
- [ ] All review skills write `review.md` + `meta.json` to `.codex-review/sessions/<skill>-<ts>/`
- [ ] All review skills display detected defaults before asking any question
- [ ] A user invoking any two skills sees consistent interaction pattern
