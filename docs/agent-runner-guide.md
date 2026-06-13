# Agent Runner Guide

Use this repository as an executable schematic workflow, not as permission to draw freely in EasyEDA.

## Required Path

1. Capture user intent in `project_spec.json`.
2. Derive `project_contract.json`.
3. Define required electrical endpoints in `project_netlist.json`.
4. Select or declare the circuit-pack `pack.mjs` and `cell_manifest.json`.
5. Map modules, refs, anchors, nets, and layout policy in `project_assembly.json`.
6. Implement deterministic cells and rules only after those contracts exist.
7. Run `node bin/easyeda-gsd.mjs accept`.
8. Run `node bin/easyeda-gsd.mjs live-check` before final delivery.
9. Write back only with `node bin/easyeda-gsd.mjs apply --gated`.

## Constraints

- Do not free-draw EasyEDA primitives for delivery.
- Do not claim completion from local-only PASS.
- Do not use low-level writer scripts for final delivery.
- Inspect `next_actions.json` first when a gate fails.
- Use `repair_actions.json` to find the owning files and rerun command for each finding.
- Final delivery requires real EasyEDA live evidence and DRC `0 error / 0 warning / 0 info`.

## Commands

```bash
node bin/easyeda-gsd.mjs help
node bin/easyeda-gsd.mjs plan project_spec.json
node bin/easyeda-gsd.mjs generate project_spec.json
node bin/easyeda-gsd.mjs accept
node bin/easyeda-gsd.mjs repair --max-iterations 3
node bin/easyeda-gsd.mjs live-check
node bin/easyeda-gsd.mjs apply --gated
node bin/easyeda-gsd.mjs report
```

`repair` is read-only by default. Automatic write repair is intentionally disabled until allowlisted repair operations are implemented.
