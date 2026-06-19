# Agent Runner Guide

Use this repository as an executable schematic workflow, not as permission to draw freely in EasyEDA.

## Required Path

1. Capture user intent in `project_spec.json`.
2. For a new project directory, run `node bin/easyeda-plexus.mjs init --pack <pack> --out <project-dir>` to create editable scaffold files and, for a new pack id, `circuit_packs/<pack>/` skeleton files.
3. Run `node bin/easyeda-plexus.mjs plan <project-dir>/project_spec.json` and keep `plexus_plan_report.json` passing as the spec-to-contract realization proof.
4. Run `node bin/easyeda-plexus.mjs design-brief <project-dir>/project_spec.json` and inspect strict `design_brief_report.json` as the short review loop. Use `--draft` only for early incomplete scaffolds.
5. Derive `project_contract.json`, including module-level `drawingRules` for orthogonal wiring, real net labels, text clearance, module isolation, no fake net text, and no unnecessary net ports.
6. Define required electrical endpoints in `project_netlist.json`.
7. Fill `approved_library_manifest.json` so every required part has approved Symbol, Device, and Footprint bindings.
8. Select or declare the circuit-pack `pack.mjs` and `cell_manifest.json`.
9. Map modules, refs, anchors, nets, and layout policy in `project_assembly.json`.
10. Run `npm.cmd run workflow:smoke` and keep `workflow_smoke_report.json` passing so reusable workflow regressions stay blocked.
11. Implement deterministic cells and rules only after those contracts exist and the design brief explains module rectangles, pin/net ownership, interface sides, and label columns.
12. Run `node bin/easyeda-plexus.mjs generate <project-dir>/project_spec.json` and keep `plexus_generate_report.json` passing with full layout-search evidence; use `generate --fast` only for draft iteration.
13. Run `node bin/easyeda-plexus.mjs accept <project-dir>/project_spec.json`; this includes `design:brief`, `contract:geometry`, and `contract:labels`.
14. Run `node bin/easyeda-plexus.mjs live-check <project-dir>/project_spec.json` before final delivery.
15. Write back only with `node bin/easyeda-plexus.mjs apply --gated <project-dir>/project_spec.json`.

## Constraints

- Do not free-draw EasyEDA primitives for delivery.
- Do not claim completion from local-only PASS.
- Do not use low-level writer scripts for final delivery.
- Do not reuse `aihwdebugger` for unrelated schematics; create or fill the target circuit pack first.
- Do not trust a module contract until it declares `drawingRules`; missing drawing rules mean the project has not stated the schematic-quality constraints that deterministic cells must satisfy.
- Do not implement or tune cells from a vague prompt. First make strict `design_brief_report.json` pass and explain the block diagram, pin/net plan, layout/interface plan, label columns, ERC/layout checklist, and next tasks.
- Do not implement a deterministic cell until its `cell_manifest.json` entry declares `qualityRules` for orthogonal wiring, real net labels, text clearance, module isolation, no fake net text, and no unnecessary net ports.
- Do not trust layout work until `project_assembly.json` declares `layoutPolicy.flow` and ordered `layoutPolicy.columns` for every module.
- Do not trust geometry work until `contract:geometry` passes for the generated model and `contract:geometry:live` passes for the real EasyEDA snapshot.
- Prefer generic `layoutPolicy.anchorVariants` for new projects; do not copy the bundled USB/MCU/relay coordinate fields unless you are editing that pack.
- Inspect `next_actions.json` first when a gate fails.
- Use `repair_actions.json` to find the owning files and rerun command for each finding.
- Use `node bin/easyeda-plexus.mjs repair` for the read-only grouped repair plan.
- Run stateful workflow commands serially. `plan`, `design-brief`, `generate`, `accept`, `workflow:smoke`, `repair`, `live-check`, and `apply --gated` write shared report artifacts and are protected by a workspace lock.
- Final delivery requires real EasyEDA live evidence and DRC `0 error / 0 warning / 0 info`.

## Commands

```bash
node bin/easyeda-plexus.mjs help
node bin/easyeda-plexus.mjs plan project_spec.json
node bin/easyeda-plexus.mjs design-brief project_spec.json
node bin/easyeda-plexus.mjs generate project_spec.json
npm.cmd run workflow:smoke
node bin/easyeda-plexus.mjs accept
node bin/easyeda-plexus.mjs repair --max-iterations 3
node bin/easyeda-plexus.mjs live-check
node bin/easyeda-plexus.mjs apply --gated project_spec.json
node bin/easyeda-plexus.mjs report
```

`repair` is read-only by default. Automatic write repair is intentionally disabled until allowlisted repair operations are implemented.
The command builds its plan through `workflows/repair_loop.mjs`, combining `next_actions.json` and `repair_actions.json` into grouped fix kinds, files to inspect, evidence, and rerun commands, then writes `repair_loop_report.json`.
