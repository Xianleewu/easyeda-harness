# Claude Code Instructions

Use `AGENTS.md` as the source of truth for this repository.
Use `docs/agent-runner-guide.md` for the neutral runner contract.

In short:

1. Install/start <https://github.com/easyeda/easyeda-api-skill> when live EasyEDA access is needed.
2. Run `npm.cmd install`.
3. For a new project, update `project_spec.json`, pass `workflow:smoke` / `workflow_smoke_report.json`, pass `node bin/easyeda-gsd.mjs plan` / `gsd_plan_report.json`, pass plan-gated `node bin/easyeda-gsd.mjs generate` / `gsd_generate_report.json`, pass `spec:schema`, derive `project_contract.json`, define required endpoints in `project_netlist.json`, choose or declare the circuit-pack `pack.mjs` and `cell_manifest.json` under `circuit_packs/<pack>`, and map deterministic cells/layout policy in `project_assembly.json` before changing cells.
4. Each `cell_manifest.json` cell entry must declare `qualityRules` for orthogonal wiring, real net labels, text clearance, module isolation, no fake net text, and no unnecessary net ports.
5. Never free-draw in EasyEDA for delivery; only edit the machine contracts, deterministic cells, rules, and gated writer path.
6. Prefer `node bin/easyeda-gsd.mjs accept`; it wraps the safe local gate path. For targeted debugging, run `npm.cmd run workflow:smoke`, `npm.cmd run spec:schema`, `npm.cmd run spec`, `npm.cmd run contract`, `npm.cmd run contract:netlist`, `npm.cmd run contract:pack`, `npm.cmd run contract:library`, `npm.cmd run contract:cells`, `npm.cmd run contract:assembly`, `npm.cmd run contract:layout`, then `npm.cmd run accept`.
7. Treat preview images as offline harness-renderer evidence, not real EasyEDA screenshots or final acceptance.
8. Inspect `next_actions.json` first, then `repair_actions.json`, when any gate fails.
9. Use `node bin/easyeda-gsd.mjs repair` for the read-only grouped repair plan from `workflows/repair_loop.mjs`.
10. Keep `next_actions.json` on the `action:schema` contract; see `reports/README.md`.
11. Pull EasyEDA live evidence with `node bin/easyeda-gsd.mjs live-check` before final delivery.
12. Ensure `final_evidence_report.json` passes before final delivery; live delivery uses `npm.cmd run final:evidence:live`.
13. Write back with `node bin/easyeda-gsd.mjs apply --gated` only after all gates pass.
14. `live-check` wraps `accept:live`; `apply --gated` wraps `apply:gated`.
15. Never bypass the fail-closed gate with low-level writer scripts for delivery.
