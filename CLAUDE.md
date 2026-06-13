# Claude Code Instructions

Use `AGENTS.md` as the source of truth for this repository.
Use `docs/agent-runner-guide.md` for the neutral runner contract.

In short:

1. Install/start <https://github.com/easyeda/easyeda-api-skill> when live EasyEDA access is needed.
2. Run `npm.cmd install`.
3. For a new project, update `project_spec.json`, pass `spec:schema`, derive `project_contract.json`, define required endpoints in `project_netlist.json`, choose or declare the circuit-pack `cell_manifest.json`, and map deterministic cells/layout policy in `project_assembly.json` before changing cells.
4. Never free-draw in EasyEDA for delivery; only edit the machine contracts, deterministic cells, rules, and gated writer path.
5. Prefer `node bin/easyeda-gsd.mjs accept`; it wraps the safe local gate path. For targeted debugging, run `npm.cmd run spec:schema`, `npm.cmd run spec`, `npm.cmd run contract`, `npm.cmd run contract:netlist`, `npm.cmd run contract:cells`, `npm.cmd run contract:assembly`, `npm.cmd run contract:layout`, then `npm.cmd run accept`.
6. Treat preview images as offline harness-renderer evidence, not real EasyEDA screenshots or final acceptance.
7. Inspect `next_actions.json` first, then `repair_actions.json`, when any gate fails.
8. Keep `next_actions.json` on the `action:schema` contract; see `reports/README.md`.
9. Pull EasyEDA live evidence with `node bin/easyeda-gsd.mjs live-check` before final delivery.
10. Write back with `node bin/easyeda-gsd.mjs apply --gated` only after all gates pass.
11. `live-check` wraps `accept:live`; `apply --gated` wraps `apply:gated`.
12. Never bypass the fail-closed gate with low-level writer scripts for delivery.
