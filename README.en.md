# EasyEDA Harness

[中文](README.md)

EasyEDA Harness is a schematic generation and checking tool intended for coding agents such as Codex and Claude Code. It is not the EasyEDA API skill. The official `easyeda-api-skill` owns the API docs, bridge, and EasyEDA extension; this repository owns deterministic placement, quality checks, offline previews, real EasyEDA snapshot evidence, and the write-back loop.

The simplest user workflow is to hand this repository to an agent and ask it to follow `AGENTS.md` or `CLAUDE.md`. The agent should install dependencies, verify the official EasyEDA API Skill/Bridge, run the gates, generate visual evidence, and only write back to EasyEDA after every gate passes.

The neutral runner entrypoint is `node bin/easyeda-gsd.mjs`; see `docs/agent-runner-guide.md`.

## Scope

This repository is an executable workflow, not a prompt pack for free-form drawing inside EasyEDA. For a new project, the agent must first create a project contract: functional modules, pins, required nets, module rectangles, allowed symbols, and visual evidence regions. Only then should it implement or modify deterministic templates and rules.

A PASS on the current model only proves the current model. It does not validate another project, another schematic, or manual EasyEDA edits.

`project_spec.json` is the machine-readable user-intent input. `node bin/easyeda-gsd.mjs plan` writes `gsd_plan_report.json`, proving that the spec is realized by the current contract, netlist, assembly, and circuit pack. `node bin/easyeda-gsd.mjs generate` writes `gsd_generate_report.json`, refuses to generate if the plan fails, and runs full layout search by default; `generate --fast` is only a draft iteration mode. `project_contract.json` is the design contract derived from that spec. `npm run spec` checks that the contract covers the spec, and `npm run contract` / `npm run accept` continue checking the contract and generated model.
`npm run spec:schema` validates the spec shape before contract coverage is checked.

`project_contract.json` is the first machine-readable file an agent must update for a new project. Each module must declare `drawingRules` for the reusable schematic-quality rules it expects. `project_netlist.json` records the required electrical endpoints. `circuit_packs/*/cell_manifest.json` declares deterministic cell capabilities for the selected circuit pack, and `project_assembly.json` maps each contract module to those cells, refs, anchors, nets, and layout policy. `npm run contract`, `npm run contract:netlist`, `npm run contract:cells`, `npm run contract:assembly`, `npm run contract:layout`, and `npm run accept` check them; if they fail, the agent should not edit write-back scripts, apply to EasyEDA, or claim completion.
`circuit_packs/*/pack.mjs` owns circuit-family behavior such as cell builders, fallback anchors, and library snapshot normalization. `npm run contract:pack` verifies the selected pack before generation.

## Capabilities

- Deterministic schematic assembly: the selected `circuit_packs/<pack>/pack.mjs` exposes functional cell builders, `circuit_packs/<pack>/cell_manifest.json` declares their contracts, and `engine/assemble.mjs` composes the active `project_assembly.json`.
- Project spec gate: `project_spec.json` defines user-level modules, nets, interfaces, and quality policy.
- Spec schema gate: `spec:schema` validates `project_spec.json` as the first-layer user-intent contract.
- Project contract gate: `project_contract.json` defines modules, key nets, interfaces, visual evidence regions, and the no-free-draw policy.
- Project netlist gate: `project_netlist.json` defines required pins for key nets and proves the generated model connects them.
- Circuit pack gate: `contract:pack` verifies the selected `pack.mjs` is registered and exposes required generation hooks.
- Circuit pack scaffold: `init --pack <new_pack> --out <project-dir>` also creates `circuit_packs/<new_pack>/pack.mjs` and `cell_manifest.json` skeletons, preventing new projects from accidentally reusing the bundled example pack.
- Library contract gate: `contract:library` verifies every required part has approved Symbol, Device, Footprint, name/value, and BOM/PCB state.
- Workflow smoke gate: `workflow:smoke` proves bad specs are stopped by plan, incomplete scaffolds do not pass as ready, missing library bindings fail, and failed generate cannot rewrite `full_model.json`.
- Cell manifest gate: `circuit_packs/*/cell_manifest.json` declares circuit-pack cell roles, required refs, net args, ports, layout intent, and `qualityRules`, while project-contract modules declare matching `drawingRules`; this moves drawing rules such as orthogonal wiring, real net labels, text clearance, and module isolation into the contract before assembly can use those cells.
- Rule coverage check: `contract:rules` proves module registry, required parts, interface contracts, and core rules cover the project contract.
- Assembly coverage check: `contract:assembly` proves every contract module is mapped to a deterministic cell, anchor, refs, and nets before generation.
- Layout policy check: `contract:layout` proves layout search is driven by `project_assembly.json` and that `layoutPolicy.flow`, ordered `layoutPolicy.columns`, generic `anchorVariants` or project search space, module spacing, no interlock, and no unrelated wire intrusion requirements are satisfied.
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

The agent runs the local checks, workflow smoke checks, generates preview evidence, and writes `acceptance_report.json`, `workflow_smoke_report.json`, `next_actions.json`, and `repair_actions.json`. If a check fails, `next_actions.json` is the handoff summary and `repair_actions.json` maps each finding to edit targets, inspection files, and the next command to rerun.
`node bin/easyeda-gsd.mjs repair` builds a read-only grouped repair plan through `workflows/repair_loop.mjs` and writes `repair_loop_report.json`.
`next_actions.json` is a validated `schemaVersion=1` action contract; `npm run action:schema` checks ids, normalized check statuses, targets, evidence, and pass/action consistency.
`final:evidence` writes `final_evidence_report.json`, proving required evidence artifacts are present, fresh, passing, and free of open repair actions.

Preferred agent commands:

```bash
node bin/easyeda-gsd.mjs accept
node bin/easyeda-gsd.mjs repair
node bin/easyeda-gsd.mjs live-check
node bin/easyeda-gsd.mjs deliver
node bin/easyeda-gsd.mjs apply --gated project_spec.json
```

For an external project directory, pass that same spec path through every context-aware command, including final handoff and write-back: `node bin/easyeda-gsd.mjs deliver <project-dir>/project_spec.json` and `node bin/easyeda-gsd.mjs apply --gated <project-dir>/project_spec.json`.

For a new project, the first implementation step is updating `project_spec.json`, realizing it in `project_contract.json` with module-level `drawingRules`, defining required endpoints in `project_netlist.json`, declaring/choosing a circuit-pack `cell_manifest.json`, then mapping the contract and layout policy in `project_assembly.json`. Only then should the agent implement project-specific deterministic cells and rules.
For a new project directory, `node bin/easyeda-gsd.mjs init --pack <pack> --out <project-dir>` writes scaffold versions of those files plus `approved_library_manifest.json` and `gsd_scaffold_report.json`. If `<pack>` does not exist, it also creates `circuit_packs/<pack>/pack.mjs`, `circuit_packs/<pack>/cell_manifest.json`, and updates the pack registry. The scaffold emits generic `layoutPolicy.anchorVariants` with enough candidates for the layout planner's minimum search-space gate, so new projects do not depend on the bundled USB/MCU/relay coordinate fields. The scaffold is intentionally incomplete and must not be treated as ready for generation until pack builders, cell manifest, contracts, netlist, library bindings, and assembly mappings make `plan` pass.

## Write Back To EasyEDA

The agent writes back through `apply:gated`. That entry point runs the checks first and refuses to apply a failing schematic. Low-level write-back scripts are for agent debugging, not for normal user operation.

## Preview, Live Snapshot, And Visual Evidence

Offline preview images are generated by the harness renderer. They are useful for fast structure, module-region, and obvious-overlap review, but they are not real EasyEDA canvas screenshots and are not sufficient as final evidence.

It runs local gates, live snapshot, live canvas image, EasyEDA DRC, module-level live shots, and live diagnostics when needed, then writes `acceptance_report.json`.
When a gate remains open, inspect `next_actions.json` first; it is the machine-readable handoff checklist for the next agent. Then inspect `repair_actions.json` for finding-level edit targets and rerun commands, or run `node bin/easyeda-gsd.mjs repair` to produce `repair_loop_report.json`.

In live mode, `contract:live:model` checks `live.json` from the real EasyEDA canvas against `project_contract.json`. Final acceptance is not based on `full_model.json` alone.

`node bin/easyeda-gsd.mjs deliver` writes `delivery_report.json` and is the final handoff gate. It rejects local-only `accept` output and only passes with `full-with-live` acceptance, live final evidence, `live.json`, `live_canvas.png`, live shots, live model proof, and EasyEDA DRC `0 error / 0 warning / 0 info`.

`live:shots` is fail-closed. It first tries requested EasyEDA zoom-region captures. If the EasyEDA API returns the same full-page rendered image for every zoom request, the harness falls back to coordinate crops from that real EasyEDA rendered schematic image. Those crops are accepted only when at least 10 module images exist, all required crops are inside the real rendered image, hashes are distinct, and every image-quality gate passes.

When `live:shots` reports fixed rendered-area captures, the agent should run live diagnose. The diagnostic report records the EasyEDA canvas list, active document/tab data, and hashes from both `getCurrentRenderedAreaImage()` and the DOM canvas after separate zoom requests.

For handoff, review the global sheet and local crops for USB, LDO, RESET, BOOT, MCU left/right, PMOS, RELAY1, RELAY2, and title-template area.

## Check List

- Project contract check: `project_contract_report.json` has `HARD=0 SOFT=0 INFO=0`
- Project spec coverage check: `project_spec_report.json` has `HARD=0 SOFT=0 INFO=0`
- Spec schema check: `spec_schema_report.json` has `HARD=0 SOFT=0 INFO=0`
- Project rule coverage check: `project_rule_report.json` has `HARD=0 SOFT=0 INFO=0`
- Project netlist check: `project_netlist_report.json` has `HARD=0 SOFT=0 INFO=0`
- Circuit pack check: `project_pack_report.json` has `HARD=0 SOFT=0 INFO=0`
- Cell manifest check: `cell_manifest_report.json` has `HARD=0 SOFT=0 INFO=0`
- Project assembly coverage check: `project_assembly_report.json` has `HARD=0 SOFT=0 INFO=0`
- Project layout policy check: `project_layout_report.json` has `HARD=0 SOFT=0 INFO=0`
- Contract realization check: `project_model_report.json` has `HARD=0 SOFT=0 INFO=0`
- Fast local check: `HARD=0 SOFT=0 INFO=0`
- Full layout check: `HARD=0 SOFT=0 INFO=0`
- Offline preview: at least 10 global/local screenshots generated and visual audit passes
- Contract visual evidence check: `project_visual_report.json` has `HARD=0 SOFT=0 INFO=0`
- EasyEDA live: pull `live.json` and review `live_canvas.png` captured from the real EasyEDA canvas
- EasyEDA live contract check: `project_live_model_report.json` has `HARD=0 SOFT=0 INFO=0`
- EasyEDA DRC: `0 error / 0 warning / 0 info`
- EasyEDA live shots: at least 10 distinct module-level evidence images
- `next_actions.json` has no open handoff summary actions
- `action_schema_report.json` proves `next_actions.json` follows the stable action schema
- `gsd_plan_report.json` proves the current spec is realized by contract, netlist, assembly, and circuit pack
- `gsd_generate_report.json` proves deterministic generation was plan-gated
- `project_library_report.json` proves every required part has approved library bindings
- `repair_actions.json` has no finding-level repair actions
- `repair_loop_report.json` has no grouped repair actions
- `final_evidence_report.json` proves required local/live evidence is present, fresh, and passing
- `delivery_report.json` proves final handoff evidence is live, not local-only
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
- `bin/easyeda-gsd.mjs`: neutral workflow wrapper for agent runners and CI.
- `docs/agent-runner-guide.md`: concise runner contract for Codex, Claude Code, and other agents.
- `reports/README.md`: generated report contract notes, including the `next_actions.json` action schema.
- `harness/`: normalized model, module registry, and rule gates.
- `project_spec.json` / `project_contract.json` / `project_netlist.json` / `project_assembly.json`: user intent, design contract, structured electrical endpoints, executable assembly mapping, and layout policy.
- `contracts/spec_schema.mjs`: reusable schema validation for the first user-intent input.
- `contracts/module_contract.mjs` / `contracts/net_contract.mjs` / `contracts/layout_contract.mjs`: reusable validators for functional modules, electrical endpoint intent, and project-driven layout policy.
- `workflows/repair_loop.mjs`: read-only repair loop planner that groups `next_actions.json` and `repair_actions.json` into fix kinds, files, evidence, and rerun commands, then emits `repair_loop_report.json`.
- `workflows/gsd_plan.mjs`: spec-to-contract realization planner that emits `gsd_plan_report.json`.
- `workflows/gsd_generate.mjs`: plan-gated deterministic generation wrapper that emits `gsd_generate_report.json`.
- `workflows/gsd_scaffold.mjs`: new-project scaffold writer for spec, contract, netlist, assembly, and `gsd_scaffold_report.json`.
- `contracts/library_contract.mjs`: approved library binding validator for required parts.
- `engine/final_evidence_gate.mjs`: fail-closed local/live evidence gate for freshness, zero DRC, live model proof, and empty repair actions.
- `circuit_packs/*/cell_manifest.json`: circuit-pack deterministic cell capability contracts.
- `circuit_packs/*/pack.mjs`: circuit-pack generation hooks and library normalization.
- `snap2.json`: component snapshot input.
- `comp_state.json`: component state input for write-back preservation.
- `engine/bridge_client.mjs` / `engine/bridge_exec.mjs`: cross-platform EasyEDA bridge runners.
- `run.ps1` / `run-save.ps1` / `run-image.ps1`: Windows convenience wrappers.
- `fix_wire_name_anchors.js`: utility for repairing live wire `Name` anchors.
- `remove_duplicate_title_block.js`: migration utility for removing old harness-drawn title blocks.

## License

Add a LICENSE file before a formal public release.
