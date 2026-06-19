# Reports

Generated reports are ignored by Git, but their shapes are part of the workflow contract.

## `plexus_scaffold_report.json`

`plexus_scaffold_report.json` is written by `node bin/easyeda-plexus.mjs init --pack <pack> --out <project-dir>` when `<project-dir>` is a directory path.

It documents the scaffold files created for a new project. Scaffolds are intentionally not ready for generation; agents must fill contract parts, approved library bindings, netlist pins, assembly cells/refs/anchors, and layout policy until `plexus_plan_report.json` passes.
The default scaffold includes a generic layout candidate space large enough for the planner's minimum candidate gate, but it still fails planning until electrical, library, and executable cell contracts are filled.

## `plexus_plan_report.json`

`plexus_plan_report.json` is written by `node bin/easyeda-plexus.mjs plan`.

It must pass before generation work is trusted. It proves that `project_spec.json` is covered by `project_contract.json`, `project_netlist.json`, `project_assembly.json`, and a registered circuit pack, preventing a new spec from accidentally reusing the bundled reference schematic contracts.

## `plexus_generate_report.json`

`plexus_generate_report.json` is written by `node bin/easyeda-plexus.mjs generate`.

It must pass before local acceptance is trusted. The public `generate` command runs full layout search by default and records layout evidence in the report. `generate --fast` is draft-only; draft reports are useful for iteration but are not final layout evidence by themselves.

## `workflow_smoke_report.json`

`workflow_smoke_report.json` is written by `npm run workflow:smoke`.

It must pass before local acceptance is trusted. It proves workflow regressions are blocked: bad specs fail planning, incomplete scaffolds are not generation-ready, missing approved library bindings fail, and invalid generate does not rewrite `full_model.json`.

## `next_actions.json`

`next_actions.json` follows `schemaVersion: 1` and is validated by `npm run action:schema`.

Required top-level fields:

- `schemaVersion`
- `generatedAt`
- `pass`
- `mode`
- `checks`
- `actions`

Each check has a normalized `status` of `pass`, `fail`, `missing`, or `available`, plus an `evidence` field.

Each action has:

- `id`
- `severity`
- `source`
- `title`
- `target`
- `evidence`
- `suggestedFix`

When `pass` is true, `actions` must be empty. When a hard gate fails, actions should point to evidence and the owning contract, rule, deterministic cell, or workflow file.

Project-contract, project-netlist, and project-layout findings should also point agents at `contracts/module_contract.mjs`, `contracts/net_contract.mjs`, or `contracts/layout_contract.mjs` when the reusable validator itself needs to change.

## `repair_loop_report.json`

`repair_loop_report.json` follows `schemaVersion: 1` and is written by `node bin/easyeda-plexus.mjs repair`.

It groups `next_actions.json` and `repair_actions.json` by `fixKind`, with the source files to edit, files to inspect, evidence files, and rerun commands. It is read-only: `automaticWriteSupported` must remain `false` until allowlisted repair operations are implemented.

## `final_evidence_report.json`

`final_evidence_report.json` follows the local or live evidence mode selected by `npm run final:evidence` or `npm run final:evidence:live`.

It fails closed when required reports or images are missing, stale, failing, or when final live proof lacks zero DRC, live model contract PASS, real EasyEDA canvas evidence, distinct live shots, or empty repair actions.
