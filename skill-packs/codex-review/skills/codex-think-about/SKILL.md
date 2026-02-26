---
name: codex-think-about
description: Peer debate between Claude Code and Codex on any technical question. Both sides think independently, challenge each other, and converge to consensus or explicit disagreement.
---

# Codex Think About

## Purpose
Use this skill for peer reasoning, not code review. Claude and Codex are equal thinkers.

## Prerequisites
- A clear question or decision topic from the user.
- `codex` CLI installed and authenticated.
- `codex-review` skill pack is installed (`npx github:lploc94/codex_skill`).

## Runner

```bash
RUNNER="{{RUNNER_PATH}}"
```

## Workflow
1. Gather factual context only (no premature opinion).
2. Build round-1 prompt from `references/prompts.md`.
3. Start Codex thread with `node "$RUNNER" start --working-dir "$PWD" --effort "$EFFORT"`.
4. Poll using `node "$RUNNER" poll <STATE_DIR>` until terminal status.
5. Claude responds with agree/disagree points and new perspectives.
6. Resume via `--thread-id` and loop until consensus or stalemate.
7. Present user-facing synthesis with agreements, disagreements, and confidence.

## Required References
- Execution loop: `references/workflow.md`
- Prompt templates: `references/prompts.md`
- Output contract: `references/output-format.md`

## Rules
- Keep roles as peers; no reviewer/implementer framing.
- Separate facts from opinions.
- Detect stalemate when arguments repeat with no new evidence.
- End with clear recommendations and open questions.
