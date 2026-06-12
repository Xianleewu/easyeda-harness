# Claude Code Instructions

Use `AGENTS.md` as the source of truth for this repository.

In short:

1. Install/start <https://github.com/easyeda/easyeda-api-skill> when live EasyEDA access is needed.
2. Run `npm.cmd install`.
3. Run `npm.cmd run fast`, `npm.cmd run pipeline`, and `npm.cmd run preview`.
4. Treat preview images as offline harness-renderer evidence, not real EasyEDA screenshots.
5. Pull EasyEDA live evidence with `npm run live:save` and `npm run live:image` before final delivery.
6. Write back with `npm.cmd run apply:gated` only after all gates pass.
7. Never bypass the gate with low-level writer scripts for delivery.
