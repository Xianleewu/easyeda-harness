# Agent Quick Start

This repository is a commercial schematic harness for Codex, Claude Code, and similar coding agents. It is not the EasyEDA API skill.

## Required External Skill

Install and start the official EasyEDA API Skill first:

<https://github.com/easyeda/easyeda-api-skill>

That skill provides:

- EasyEDA Pro API documentation and `SKILL.md`
- WebSocket bridge server
- EasyEDA-side `run-api-gateway.eext` extension

Follow the official skill Quick Start before attempting live write-back. The bridge should expose `http://127.0.0.1:49620/execute` or another port in `49620-49629`.

## Agent Workflow

Run these commands from the repository root:

```powershell
npm.cmd install
npm.cmd run fast
npm.cmd run pipeline
npm.cmd run visual
```

Acceptance requires all three local gates to pass:

- `fast`: `HARD=0 SOFT=0 INFO=0`
- `pipeline`: `HARD=0 SOFT=0 INFO=0`
- `visual`: at least 10 screenshots plus visual audit PASS

Only after local gates pass and the EasyEDA bridge is connected may the agent write back:

```powershell
npm.cmd run apply:gated
```

Do not run `engine/apply_full.mjs` directly unless debugging the low-level writer. `apply:gated` is the fail-closed entry point.

## Quality Rules To Preserve

- Use real wire `Name` attributes for visible single-sheet net labels.
- Do not create fake net labels with `PrimitiveText`.
- Do not use unnecessary NET PORT symbols on a single-sheet schematic.
- Left-side wire `Name` labels use `alignMode=6`; right-side labels use `alignMode=8`.
- Do not draw a duplicate title block; use the native EasyEDA sheet template variables.
- Commercial handoff requires EasyEDA DRC `0 error / 0 warning / 0 info`.

## Evidence To Produce

Before claiming completion, produce or inspect:

- `report.json`
- `visual_review_report.json`
- `visual_crops/00_global_sheet.png`
- Local module crops for USB, LDO, RESET, BOOT, MCU left/right, PMOS, RELAY1, RELAY2, and title/template area

If a visual or DRC issue appears, update the deterministic template/rules first, then rerun the gates.
