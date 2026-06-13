# EasyEDA Harness

[中文](README.md)

EasyEDA Harness is a schematic generation and checking tool intended for coding agents such as Codex and Claude Code. It is not the EasyEDA API skill. The official `easyeda-api-skill` owns the API docs, bridge, and EasyEDA extension; this repository owns deterministic placement, quality checks, offline previews, real EasyEDA snapshot evidence, and the write-back loop.

The simplest user workflow is to hand this repository to an agent and ask it to follow `AGENTS.md` or `CLAUDE.md`. The agent should install dependencies, verify the official EasyEDA API Skill/Bridge, run the gates, generate visual evidence, and only write back to EasyEDA after every gate passes.

## Scope

This repository is an executable workflow, not a prompt pack for free-form drawing inside EasyEDA. For a new project, the agent must first create a project contract: functional modules, pins, required nets, module rectangles, allowed symbols, and visual evidence regions. Only then should it implement or modify deterministic templates and rules.

A PASS on the current model only proves the current model. It does not validate another project, another schematic, or manual EasyEDA edits.

`project_spec.json` is the machine-readable user-intent input. `project_contract.json` is the design contract derived from that spec. `npm run spec` checks that the contract covers the spec, and `npm run contract` / `npm run accept` continue checking the contract and generated model.

`project_contract.json` is the first machine-readable file an agent must update for a new project. `npm run contract` and `npm run accept` check it; if the contract fails, the agent should not edit write-back scripts, apply to EasyEDA, or claim completion.

## Capabilities

- Deterministic schematic assembly: functional cells live in `engine/cells.mjs`, and whole-sheet composition lives in `engine/assemble.mjs`.
- Project spec gate: `project_spec.json` defines user-level modules, nets, interfaces, and quality policy.
- Project contract gate: `project_contract.json` defines modules, key nets, interfaces, visual evidence regions, and the no-free-draw policy.
- Rule coverage check: `contract:rules` proves module registry, required parts, interface contracts, and core rules cover the project contract.
- Contract realization check: after `full_model.json` is generated, `contract:model` proves the model actually expresses the contract modules, parts, nets, and interfaces.
- Visual evidence check: after offline previews are generated, `contract:visual` proves every contract visual evidence region exists and passes image inspection.
- Fast offline check: validates the schematic model on local CPU and is intended for daily coordinate and rule iteration.
- Full layout check: `npm run pipeline` runs layout search, structure checks, visual rhythm checks, text clearance, and system-intent audits.
- Real EasyEDA loop: write back through the WebSocket bridge, then pull a live schematic snapshot with `snapshot2.js`.
- Net-label discipline: single-sheet signal labels use the real wire `Name` attribute instead of fake `PrimitiveText` labels.
- Native sheet-template friendly: title-block metadata should come from the EasyEDA native sheet template, not a duplicate title block drawn by the harness.

## Design Principles

- Electrical correctness first: key nets must be connected, and wire endpoints must land exactly on pin coordinates.
- Readability is a gate, not decoration: orthogonal wiring, clean module boxes, same-side alignment, no labels on component bodies, and no wires through symbols.
- Check before write-back: template checks, live checks, and EasyEDA DRC must pass before applying changes.
- Fast iteration: use `npm run fast` for coordinate and rule edits, then run the full pipeline and live EasyEDA checks before handoff.

## Requirements

- Windows, Linux, or macOS
- Node.js 18 or newer
- EasyEDA / JLC EDA desktop client
- Official EasyEDA API Skill: <https://github.com/easyeda/easyeda-api-skill>
- EasyEDA API bridge, normally at `http://127.0.0.1:49620/execute`

Install and start the official skill first. It provides the EasyEDA Pro API docs, `SKILL.md`, WebSocket bridge, and the EasyEDA-side `run-api-gateway.eext` extension. Its official Quick Start includes `npm install`, `npm run build:docs`, `npm run server`, and installing that extension in EasyEDA; the bridge then waits for the EasyEDA client on ports `49620-49629`.

Then hand this repository to Codex, Claude Code, or a similar agent. Users do not need to run the harness commands one by one; the agent should follow `AGENTS.md` to install dependencies, verify the bridge, run checks, collect evidence, and write back only after the checks pass.

## Quick Start

One prompt for an agent:

```text
Follow AGENTS.md for this repository. For a new project, create the project contract, module templates, and rule coverage first; do not free-draw in EasyEDA. Verify easyeda-api-skill/Bridge, run the local gates, and before write-back pull real EasyEDA live snapshot/screenshot/DRC evidence. Write back only after every check passes.
```

The agent runs the local checks, generates preview evidence, and writes `acceptance_report.json` plus `next_actions.json`. If a check fails, `next_actions.json` is the handoff list for the next repair step.

For a new project, the first implementation step is updating `project_spec.json`, then realizing it in `project_contract.json` and passing the spec/contract gates. Only then should the agent implement project-specific deterministic cells, assembly, and rules.

## Write Back To EasyEDA

The agent writes back through `apply:gated`. That entry point runs the checks first and refuses to apply a failing schematic. Low-level write-back scripts are for agent debugging, not for normal user operation.

## Preview, Live Snapshot, And Visual Evidence

Offline preview images are generated by the harness renderer. They are useful for fast structure, module-region, and obvious-overlap review, but they are not real EasyEDA canvas screenshots and are not sufficient as final evidence.

It runs local gates, live snapshot, live canvas image, EasyEDA DRC, module-level live shots, and live diagnostics when needed, then writes `acceptance_report.json`.
When a gate remains open, inspect `next_actions.json` first; it is the machine-readable handoff checklist for the next agent.

`live:shots` is fail-closed. It first tries requested EasyEDA zoom-region captures. If the EasyEDA API returns the same full-page rendered image for every zoom request, the harness falls back to coordinate crops from that real EasyEDA rendered schematic image. Those crops are accepted only when at least 10 module images exist, all required crops are inside the real rendered image, hashes are distinct, and every image-quality gate passes.

When `live:shots` reports fixed rendered-area captures, the agent should run live diagnose. The diagnostic report records the EasyEDA canvas list, active document/tab data, and hashes from both `getCurrentRenderedAreaImage()` and the DOM canvas after separate zoom requests.

For handoff, review the global sheet and local crops for USB, LDO, RESET, BOOT, MCU left/right, PMOS, RELAY1, RELAY2, and title-template area.

## Check List

- Project contract check: `project_contract_report.json` has `HARD=0 SOFT=0 INFO=0`
- Project spec coverage check: `project_spec_report.json` has `HARD=0 SOFT=0 INFO=0`
- Project rule coverage check: `project_rule_report.json` has `HARD=0 SOFT=0 INFO=0`
- Contract realization check: `project_model_report.json` has `HARD=0 SOFT=0 INFO=0`
- Fast local check: `HARD=0 SOFT=0 INFO=0`
- Full layout check: `HARD=0 SOFT=0 INFO=0`
- Offline preview: at least 10 global/local screenshots generated and visual audit passes
- Contract visual evidence check: `project_visual_report.json` has `HARD=0 SOFT=0 INFO=0`
- EasyEDA live: pull `live.json` and review `live_canvas.png` captured from the real EasyEDA canvas
- EasyEDA DRC: `0 error / 0 warning / 0 info`
- EasyEDA live shots: at least 10 distinct module-level evidence images
- No fake text net labels
- No unnecessary NET PORT symbols on a single-sheet schematic
- Readable wire `Name` anchors: left-side labels use bottom-left origin, right-side labels use bottom-right origin
- Functional modules occupy clean rectangular regions with reasonable gaps
- No overlap among text, component attributes, net names, GND symbols, and NC markers

## Lessons Captured

- EasyEDA wire `Name` is the real visible net label; `PrimitiveText` is only text.
- Live testing showed wire `Name` origin modes: left-side labels use `alignMode=6`, right-side labels use `alignMode=8`.
- Use `eda.sch_PrimitiveAttribute.modify()` to patch wire `Name` attributes. Some `toAsync().setState_*().done()` paths can flip the Y coordinate.
- EasyEDA wire creation is more reliable when every polyline is split into single two-point segments.
- Slow live/DRC/screenshot loops should be final acceptance steps. Coordinate and rule work should start with the local fast gate.

## Repository Layout

- `engine/`: template assembly, layout search, write-back, rendering, DRC and live helpers.
- `harness/`: normalized model, module registry, and rule gates.
- `snap2.json`: component snapshot input.
- `comp_state.json`: component state input for write-back preservation.
- `engine/bridge_client.mjs` / `engine/bridge_exec.mjs`: cross-platform EasyEDA bridge runners.
- `run.ps1` / `run-save.ps1` / `run-image.ps1`: Windows convenience wrappers.
- `fix_wire_name_anchors.js`: utility for repairing live wire `Name` anchors.
- `remove_duplicate_title_block.js`: migration utility for removing old harness-drawn title blocks.

## License

Add a LICENSE file before a formal public release.
