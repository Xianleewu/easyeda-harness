# Agent Quick Start

This repository is a schematic design collaboration and checking harness for Codex, Claude Code, and similar coding agents. It is not the EasyEDA API skill, and it is not a complete automatic layout solver.

Use `docs/agent-runner-guide.md` as the neutral runner contract. Prefer `node bin/easyeda-gsd.mjs ...` for agent workflows; npm scripts remain lower-level debugging and CI building blocks.

For continuation work, read `docs/next-session-handoff.md` before changing code. It records the current objective, known weaknesses, non-negotiable drawing rules, and the next architecture work needed to make the harness useful beyond the bundled sample project.

## Scope Boundary

This harness is an executable workflow, not a free-form schematic drawing assistant.

For a new schematic project, do not draw directly in EasyEDA and then hope the gates catch the result. Start with `node bin/easyeda-gsd.mjs init --pack <pack> --out <project-dir>` to create the editable spec/contract/netlist/assembly scaffold. If `<pack>` is new, this also creates `circuit_packs/<pack>/pack.mjs`, `circuit_packs/<pack>/cell_manifest.json`, and updates the registry. Fill that scaffold until `gsd_plan_report.json` passes. First create or update the project-specific structure that the gates can reason about:

- module contracts: functional blocks, pins, required nets, intended signal flow, and `drawingRules`
- deterministic cells/templates: component placement, fanout wires, labels, and local routing
- approved library bindings: every required part must have Symbol, Device, Footprint, name/value, and BOM/PCB state
- assembly contract: block rectangles, spacing, inter-block net ownership, and sheet-template policy
- rule coverage: project-specific required parts, required nets, allowed symbols, DRC policy, and visual evidence regions

A PASS on the bundled model only proves that the bundled model passes. It does not validate another project, another schematic, or hand-drawn EasyEDA edits.

`project_spec.json` is the first user-intent input. `node bin/easyeda-gsd.mjs plan` writes `gsd_plan_report.json` and proves that the current spec is actually realized by `project_contract.json`, `project_netlist.json`, `approved_library_manifest.json`, `project_assembly.json`, and a registered circuit pack. `node bin/easyeda-gsd.mjs design-brief` writes `design_brief_report.json`, the strict fast review artifact for block diagram, module assumptions, pin/net plan, layout/interface plan, label-column plan, ERC/layout checklist, and next tasks. Review that brief before generation; if it cannot explain module rectangles, label columns, pin maps, interface sides, and open tasks with `HARD=0 SOFT=0 INFO=0`, the project is not ready for deterministic cells. Use `node bin/easyeda-gsd.mjs design-brief --draft` only for early exploration; draft output is not generation or delivery evidence. `node bin/easyeda-gsd.mjs generate` then writes `gsd_generate_report.json` and refuses to run deterministic generation unless that plan passes; the public generate command runs full layout search by default, while `generate --fast` is draft-only. `workflow:smoke` writes `workflow_smoke_report.json` and proves the reusable workflow rejects bad specs, incomplete scaffolds, missing library bindings, and a missing/empty design brief. `spec:schema` validates that input before any contract is trusted. `project_contract.json` is the required machine contract derived from it. `project_netlist.json` records required electrical endpoints. `approved_library_manifest.json` locks every required part to approved Symbol/Device/Footprint bindings. `circuit_packs/*/pack.mjs` owns circuit-family generation behavior, `circuit_packs/*/cell_manifest.json` declares deterministic cell capabilities for the selected circuit pack, and `project_assembly.json` maps each contract module to those cells, refs, anchors, nets, and layout policy. Update all of them before changing cells for a new project, then run `npm.cmd run workflow:smoke`, `npm.cmd run gsd:plan`, `npm.cmd run design:brief`, `npm.cmd run gsd:generate`, `npm.cmd run spec:schema`, `npm.cmd run spec`, `npm.cmd run contract`, `npm.cmd run contract:netlist`, `npm.cmd run contract:pack`, `npm.cmd run contract:library`, `npm.cmd run contract:cells`, `npm.cmd run contract:assembly`, and `npm.cmd run accept`. A failing workflow smoke, plan, design brief, generate, spec schema, spec coverage, contract, netlist, circuit-pack, library, cell-manifest, assembly, or layout gate blocks all write-back and delivery claims.

Every project-contract module must include `drawingRules` for the reusable schematic-quality rules it expects before deterministic cells are trusted. Every cell manifest entry must include matching `qualityRules` for the reusable drawing contracts it is designed to satisfy: orthogonal wiring, real net labels, text clearance, module box isolation, no fake net text, and no unnecessary single-sheet net ports. Missing `drawingRules` or `qualityRules` is a pre-generation failure, not a visual polish note.

Every `project_assembly.json` layoutPolicy must include a readable `layoutPolicy.flow` string, ordered `layoutPolicy.columns`, and `layoutPolicy.moduleRegions` that place each assembly module into the intended left-to-right schematic reading order and declare its minimum readable rectangle. New projects should use generic `layoutPolicy.anchorVariants` for candidate generation instead of AIHWDEBUGER-specific fields such as `usbX`, `mcuX`, or `relayX`. Missing columns, missing moduleRegions, reversed anchor X order, or overlapping planned module regions are layout-contract failures.
`contract:geometry` audits actual generated geometry for orthogonal wires, different-net or unnamed wire crossings, wires through visible objects, and overlaps among text, labels, flags, attributes, and component bodies. `contract:geometry:live` repeats that audit on the real EasyEDA snapshot, so local previews cannot hide live geometry regressions.
Every visible signal label must be covered by `layoutPolicy.labelColumns`. Each label column declares role, module, routeEnd, side, x coordinate, tolerance, and allowed nets; `contract:labels` audits the generated model and `contract:labels:live` audits the real EasyEDA wire `Name` objects in `live.json`. For grouped-net-label interfaces, `gsd:plan` and `contract:layout` require source and target module-side label columns before generation; use `fromSide`/`toSide` on `layoutPolicy.interfaceRoutes` when the physical symbol side is not the default source-right/target-left convention. Floating labels, fake `PrimitiveText` net names, wrong `alignMode`, wrong left-bottom/right-bottom origin, mid-wire labels, unbudgeted scattered labels, and declared label budgets that are not realized by actual labels are hard failures. See `docs/schematic-design-rules.md`.

## Required External Skill

Install and start the official EasyEDA API Skill first:

<https://github.com/easyeda/easyeda-api-skill>

That skill provides:

- EasyEDA Pro API documentation and `SKILL.md`
- WebSocket bridge server
- EasyEDA-side `run-api-gateway.eext` extension

Follow the official skill Quick Start before attempting live write-back. The bridge should expose `http://127.0.0.1:49620/execute` or another port in `49620-49629`.

## Agent Workflow

For an existing harnessed project, run these commands from the repository root:

```powershell
npm.cmd install
npm.cmd run spec:schema
npm.cmd run spec
npm.cmd run contract
npm.cmd run contract:netlist
npm.cmd run contract:pack
npm.cmd run contract:cells
npm.cmd run contract:helpers
npm.cmd run contract:assembly
npm.cmd run design:brief
npm.cmd run accept
```

The equivalent neutral entrypoint is:

```powershell
node bin/easyeda-gsd.mjs design-brief
node bin/easyeda-gsd.mjs accept
```

`design-brief` is the short feedback loop. It writes `design_brief_report.json`; inspect it before generation work so missing block structure, pin maps, interface sides, label columns, and open layout assumptions are visible while the edit is still small. By default it is strict and must pass with no hard findings before generation. Use `design-brief --draft` only to inspect early incomplete scaffolds.
`accept` runs the local gates in order and writes `acceptance_report.json`.
`accept` is fail-closed: even when every local gate is green it exits non-zero in `local-only` mode because `final:evidence` and `next:actions` require real EasyEDA live evidence. That is the intended delivery-safety semantics and must not be weakened. For a CI/dev local-green signal, run `npm.cmd run status:local` (reads `acceptance_report.json`): it exits 0 when all local gates pass, while still printing that final delivery requires live evidence. `status:local` never claims delivery and never replaces `live-check`/`deliver`.
It also writes `next_actions.json` and `repair_actions.json`. Inspect `next_actions.json` first for the handoff summary, then `repair_actions.json` for finding-level edit targets, inspection files, and rerun commands.
Use `node bin/easyeda-gsd.mjs repair` for the read-only grouped repair plan; it is backed by `workflows/repair_loop.mjs`, writes `repair_loop_report.json`, and must not write source files unless a future allowlisted repair mode is explicitly implemented.
`next_actions.json` is a stable `schemaVersion=1` action contract validated by `npm.cmd run action:schema`; see `reports/README.md`.
Acceptance requires all local gates to pass:

- `gsd:plan`: `project_spec.json` is realized by the current contract, netlist, assembly, and circuit pack
- `design:brief`: `design_brief_report.json` explains the block diagram, pin/net plan, layout/interface plan, label-column plan, ERC/layout checklist, and next tasks
- `gsd:generate`: a passing GSD plan produced `full_model.json` and `report.json` through deterministic generation
- `workflow:smoke`: reusable workflow regressions are blocked; bad specs, incomplete scaffolds, and missing library bindings must fail. It also proves generalization beyond AIHWDEBUGER: `WS25` assembles the registered `circuit_packs/divider` sample pack from `samples/divider` and asserts the model passes the real project geometry/label validators, so an engine/rule change that silently breaks non-AIHWDEBUGER projects fails here. The full-pipeline generalization regression is `npm.cmd run examples:divider:accept` (the `samples/divider` project reaches the same local-gate status as the bundled project; only the live-gated steps remain).
- `spec`: `project_contract.json` covers `project_spec.json`
- `spec:schema`: `project_spec.json` is a valid first-layer user-intent contract
- `contract`: `HARD=0 SOFT=0 INFO=0`
- `contract:netlist`: `project_netlist.json` covers contract nets and generated pin connectivity
- `contract:pack`: the selected circuit pack is registered and exposes generation hooks
- `contract:library`: every required part has approved EasyEDA library bindings
- `contract:cells`: the selected circuit-pack `cell_manifest.json` declares every deterministic cell used by `project_assembly.json` and matches implemented builders
- `contract:helpers`: the reusable cell-helper primitives in `engine/cell_helpers.mjs` build gate-clean geometry (orthogonal wires, attached real net labels, aligned label columns) and fail-fast on diagonals, floating labels, oversized stubs, empty net names, and insufficient GND/clearance; new circuit packs must build modules with these helpers instead of hand-placing wires and labels
- `contract:rules`: harness registries and core rules cover `project_contract.json`
- `contract:assembly`: `project_assembly.json` maps every contract module to deterministic cells, anchors, refs, and nets
- `fast`: `HARD=0 SOFT=0 INFO=0`
- `pipeline`: `HARD=0 SOFT=0 INFO=0`
- `contract:layout`: layout search is driven by `project_assembly.json` layout policy, `layoutPolicy.flow`, ordered `layoutPolicy.columns`, and final module spacing/interlock/intrusion checks pass
- `contract:geometry`: actual generated geometry has no wire crossings, wires through visible objects, or visible-object overlaps
- `contract:labels`: actual visible signal labels satisfy `layoutPolicy.labelColumns`, endpoint attachment, left-bottom/right-bottom origins, label budgets, and declared budget realization
- `contract:model`: generated `full_model.json` satisfies `project_contract.json`
- `preview`: at least 10 offline preview screenshots plus visual audit PASS
- `contract:visual`: preview evidence covers every `project_contract.json` visual region
- `action:schema`: `next_actions.json` contains normalized checks and action ids/evidence when repairs are open
- `final:evidence`: required local evidence is present, fresh, passing, and has no open repair actions

Important: preview screenshots are generated by the harness renderer, not by the EasyEDA canvas. They are a fast local gate, not final visual proof.

Before final delivery, pull a real EasyEDA live snapshot through the official bridge:

```bash
node bin/easyeda-gsd.mjs bridge-check   # verify the bridge is up; prints startup guidance if not
node bin/easyeda-gsd.mjs live-check
```

`bridge-check` (also `npm.cmd run bridge:check`) probes ports `49620-49629` for the `easyeda-bridge` service and reports connected EDA windows. `live-check` pre-flights this check and aborts with actionable guidance if the bridge is down, instead of failing deep inside a live step.

`live:image` captures the current EasyEDA canvas. `live:shots` attempts 10+ module-level EasyEDA visual evidence. It prefers true zoom-region captures. If the EasyEDA API returns the same full-page rendered image for every zoom request, it may accept coordinate crops from that real EasyEDA rendered schematic image, but only when all required crops exist, hashes are distinct, and every image-quality gate passes. When it fails, inspect `live_shots_report.json.zoomEvidence` first.

`accept:live` also runs `contract:live:model`. This checks `live.json` from the real EasyEDA canvas against `project_contract.json`; local-only `full_model.json` PASS is not final acceptance.
`accept:live` also runs `contract:geometry:live` and `contract:labels:live`, so final evidence must prove the real EasyEDA geometry and wire `Name` placement obey the same rules as the generated model.

If the report points to fixed rendered-area screenshots, run `npm run live:diagnose` and inspect `live_diagnose_report.json.zoomChecks`; matching hashes after different zoom requests prove the issue is the EasyEDA capture API behavior, not schematic coordinates.

`accept:live` also runs `npm run drc`; final handoff requires `drc_report.json` to prove EasyEDA DRC `0 error / 0 warning / 0 info`.

After `live-check`, run the final handoff gate:

```bash
node bin/easyeda-gsd.mjs deliver
```

`deliver` writes `delivery_report.json`. It must pass before handoff or write-back claims; it rejects local-only `accept` output and requires `full-with-live` acceptance, live final evidence, `live.json`, `live_canvas.png`, live shots, live model proof, and DRC `0 error / 0 warning / 0 info`.

Only after local gates pass, live snapshot/DRC checks pass, and the EasyEDA bridge is connected may the agent write back:

```powershell
node bin/easyeda-gsd.mjs apply --gated project_spec.json
```

Do not run `engine/apply_full.mjs` directly unless debugging the low-level writer. `apply:gated` is the fail-closed entry point.

## Quality Rules To Preserve

- Use real wire `Name` attributes for visible single-sheet net labels.
- Do not create fake net labels with `PrimitiveText`.
- Do not use unnecessary NET PORT symbols on a single-sheet schematic.
- Left-side wire `Name` labels use `alignMode=6`; right-side labels use `alignMode=8`.
- Declare `layoutPolicy.labelColumns` for every visible signal label, and keep each label origin on a same-net wire endpoint.
- Do not draw a duplicate title block; use the native EasyEDA sheet template variables.
- Write-back review requires EasyEDA DRC `0 error / 0 warning / 0 info`.

## Evidence To Produce

Before claiming completion, produce or inspect:

- `report.json`
- `design_brief_report.json` proving the block diagram, pin/net plan, layout/interface plan, label-column plan, ERC/layout checklist, and next tasks are explicit before generation
- `visual_review_report.json`
- `visual_crops/00_global_sheet.png`
- `live.json` pulled from EasyEDA for final review
- `project_live_model_report.json` proving `live.json` satisfies `project_contract.json`
- `project_label_layout_report.json` proving model/live label columns, origins, endpoint attachment, and visible-label budgets pass
- `live_canvas.png` captured from the real EasyEDA canvas for final visual proof
- `drc_report.json` with `pass=true` and `errors=0`, `warnings=0`, `info=0`
- `live_shots_report.json` with `pass=true`, `screenshots>=10`, and distinct module-level live evidence
- `next_actions.json` with no open actions before final delivery
- `project_library_report.json` proving every required part has approved library bindings
- `repair_actions.json` with no finding-level repair actions before final delivery
- `repair_loop_report.json` with no grouped repair actions before final delivery
- `workflow_smoke_report.json` proving reusable workflow regressions are still blocked
- `final_evidence_report.json` proving required local/live evidence is present, fresh, and passing
- `delivery_report.json` proving final handoff evidence is live, not local-only
- `gsd_generate_report.json` proving deterministic generation was plan-gated
- Local module crops for USB, LDO, RESET, BOOT, MCU left/right, PMOS, RELAY1, RELAY2, and title/template area

If a visual or DRC issue appears, update the deterministic template/rules first, then rerun the gates.

## New Project Workflow

When adapting this repository to a different schematic:

1. Read the electrical spec and encode it in `project_spec.json` before placing symbols.
2. For a new project directory, run `node bin/easyeda-gsd.mjs init --pack <pack> --out <project-dir>` and use the generated scaffold files plus `circuit_packs/<pack>/` as the editing surface.
3. Derive/update `project_contract.json` from the spec and run `npm.cmd run gsd:plan`, `npm.cmd run design:brief`, `npm.cmd run spec`, and `npm.cmd run contract` until all pass and the brief explains the intended layout before generation.
4. Define required electrical endpoints in `project_netlist.json` and run `npm.cmd run contract:netlist` until it passes.
5. Fill `approved_library_manifest.json` and run `npm.cmd run contract:library` until every required part has approved bindings.
6. Map every contract module and layout policy in `project_assembly.json`, then run `npm.cmd run contract:assembly` until it passes.
7. Implement or update deterministic cells for that assembly mapping.
8. Add/adjust rules so the project-specific contract is enforced by `project_rule_report.json`, `project_netlist_report.json`, `project_assembly_report.json`, `project_layout_report.json`, `report.json`, `project_model_report.json`, `project_visual_report.json`, live DRC, and visual evidence.
9. Iterate from `next_actions.json`; do not bypass failed findings with manual EasyEDA edits.
   Use `node bin/easyeda-gsd.mjs repair` when you need the grouped repair plan and rerun commands.
10. Write back only through `node bin/easyeda-gsd.mjs apply --gated <project-dir>/project_spec.json`, then validate using live snapshot, real canvas image, DRC, and live shots.

Do not claim completion from offline preview images alone.
