# Claude Code Instructions

Use `AGENTS.md` as the source of truth for this repository.

In short:

1. Install/start <https://github.com/easyeda/easyeda-api-skill> when live EasyEDA access is needed.
2. Run `npm.cmd install`.
3. For a new project, update `project_spec.json` and derive `project_contract.json` before changing cells or assembly; never free-draw in EasyEDA for delivery.
4. Run `npm.cmd run spec`, `npm.cmd run contract`, then `npm.cmd run accept`.
5. Treat preview images as offline harness-renderer evidence, not real EasyEDA screenshots.
6. Pull EasyEDA live evidence with `npm run accept:live` before final delivery.
7. Write back with `npm.cmd run apply:gated` only after all gates pass.
8. Never bypass the gate with low-level writer scripts for delivery.
