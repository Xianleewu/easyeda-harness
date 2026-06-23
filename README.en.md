# EasyEDA Schematic Beautifier

[中文](README.md)

A **generic, public tool** that turns **any** EasyEDA schematic into a clean, commercial-grade 2D
layout — like a frontend design workflow, but for circuits. It carries **zero specific-circuit
content**: it adapts to any board via roles and patterns, never hardcoded devices, nets, or modules.

## How it works

1. Capture any open EasyEDA board → `live.json`.
2. Classify components into roles (`role_infer`) → render each module with role-based archetype cells
   (`circuit_packs/archetypes/`) → 2D shelf-pack the clean modules (`module_repack`, breaking the
   wide-column vs aspect-ratio deadlock) → run the commercial geometry/label gates
   (`geom_qc` / `label_qc`).
3. Deliver the clean layout back to the live EasyEDA document.

## Quick start

```bash
npm install
npm run live:save                              # capture the open board -> live.json (incl. pin electrical types)
node bin/plexus.mjs qc      live.json          # net QC: shorts / stray power flags / malformed wires / ERC pin types / dangling flags
node bin/plexus.mjs repair  live.json          # auto-repair (delete stray power-short flags / straighten malformed wires) + report DRC before/after
node bin/plexus.mjs layout  live.json out.png  # any board -> commercial 2D layout + render + gates
node bin/plexus.mjs deliver live.json          # deliver to the live EasyEDA document
npm test                                       # generic test suite
```

> Detect→repair loop: `qc` detects, `repair` fixes the schematic-layer issues (geometry / short flags) and reports the
> DRC delta. ERC pin-electrical-type mistypes (passives flagged IN, GPIOs Undefined) are *detected* by `qc` but must be
> corrected in the EasyEDA symbol library editor — pin electrical type is symbol-defined and read-only via the extension API.

Requires the official [EasyEDA API skill](https://github.com/easyeda/easyeda-api-skill) bridge
(`http://127.0.0.1:49620`, ports `49620-49629`). Open **any** schematic in EasyEDA Pro.

## Design language

`docs/schematic-design-rules.md` (DR1–DR18 measurable gates) and `docs/schematic_design_rulebook.md`
(the project-agnostic design language). Commercial delivery target: EasyEDA DRC `0/0/0`.

See `AGENTS.md` for the full architecture. **Never add any specific-circuit content — this is a
public tool.**
