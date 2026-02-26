# codex-skill

Single-command installer for the **codex-review** skill pack for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

Three skills powered by [OpenAI Codex CLI](https://github.com/openai/codex):
- `/codex-plan-review` — debate implementation plans before coding
- `/codex-impl-review` — review uncommitted changes before commit
- `/codex-think-about` — peer reasoning/debate on technical topics

## Requirements

- Node.js >= 22
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- [OpenAI Codex CLI](https://github.com/openai/codex) (`codex`) in PATH
- OpenAI API key configured for Codex

## Install

```bash
npx github:lploc94/codex_skill
```

### What it does
1. Copies `codex-runner.js` to `~/.claude/skills/codex-review/scripts/`
2. Injects the absolute runner path into each SKILL.md template
3. Validates templates and references before finalizing
4. Atomic swap: backs up old install, swaps in new, rolls back on failure

### Verify
```bash
node ~/.claude/skills/codex-review/scripts/codex-runner.js version
```

### Reinstall / Update
```bash
npx github:lploc94/codex_skill
```

## Usage

After install, start Claude Code and run:
- `/codex-plan-review` to debate implementation plans before coding.
- `/codex-impl-review` to review uncommitted changes before commit.
- `/codex-think-about` for peer reasoning with Codex.

## License

MIT
