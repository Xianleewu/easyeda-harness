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
