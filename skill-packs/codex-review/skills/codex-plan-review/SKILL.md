---
name: codex-plan-review
description: Debate implementation plans between Claude Code and Codex CLI before coding. Use this skill after a plan file exists; Claude and Codex iterate until consensus or explicit stalemate.
---

# Codex Plan Review

## Purpose
Use this skill to adversarially review a plan before implementation starts.

## Prerequisites
- A plan file exists (`plan.md` or equivalent).
- `codex` CLI is installed and authenticated.
- `codex-review` skill pack is installed (`npx github:lploc94/codex_skill`).

## Runner

```bash
RUNNER="{{RUNNER_PATH}}"
```

## Workflow
1. Gather config (plan path, effort, user request, current context).
2. Build prompt from `references/prompts.md` (`Plan Review Prompt`).
3. Start round 1 with `node "$RUNNER" start --working-dir "$PWD" --effort "$EFFORT"`.
4. Poll with `node "$RUNNER" poll <STATE_DIR>` every ~15 seconds until terminal status.
5. Parse Codex issues (`ISSUE-{N}` + `VERDICT`) using `references/output-format.md`.
6. Apply valid fixes to the plan, rebut invalid points, and resume with `--thread-id`.
7. Repeat until `APPROVE` or deterministic stalemate.
8. Return final debate summary and final plan.

## Required References
- Detailed execution steps: `references/workflow.md`
- Prompt templates: `references/prompts.md`
- Output contract: `references/output-format.md`

## Rules
- Keep debate in plan mode when available.
- Do not implement code in this skill.
- Do not claim consensus without explicit `VERDICT: APPROVE` or user-accepted stalemate.
- Preserve traceability: each accepted issue maps to a concrete plan edit.
