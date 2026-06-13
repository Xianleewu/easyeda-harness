# Reports

Generated reports are ignored by Git, but their shapes are part of the workflow contract.

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
