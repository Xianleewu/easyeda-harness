# Reports

Generated reports are ignored by Git, but their shapes are part of the workflow contract.

## `gsd_plan_report.json`

`gsd_plan_report.json` is written by `node bin/easyeda-gsd.mjs plan`.

It must pass before generation work is trusted. It proves that `project_spec.json` is covered by `project_contract.json`, `project_netlist.json`, `project_assembly.json`, and a registered circuit pack, preventing a new spec from accidentally reusing the bundled reference schematic contracts.

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

`repair_loop_report.json` follows `schemaVersion: 1` and is written by `node bin/easyeda-gsd.mjs repair`.

It groups `next_actions.json` and `repair_actions.json` by `fixKind`, with the source files to edit, files to inspect, evidence files, and rerun commands. It is read-only: `automaticWriteSupported` must remain `false` until allowlisted repair operations are implemented.

## `final_evidence_report.json`

`final_evidence_report.json` follows the local or live evidence mode selected by `npm run final:evidence` or `npm run final:evidence:live`.

It fails closed when required reports or images are missing, stale, failing, or when final live proof lacks zero DRC, live model contract PASS, real EasyEDA canvas evidence, distinct live shots, or empty repair actions.
