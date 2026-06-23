# Agent Quick Start

This repository is a **generic, public schematic-beautification tool**. It turns **any** EasyEDA
schematic into a clean, commercial-grade 2D layout — like a frontend design workflow, but for
circuits. It is **circuit-agnostic**: it contains **zero specific-circuit content** (no hardcoded
device names, net names, module titles, or per-project fixtures).

## Core principle (non-negotiable)

Never add any specific schematic's content — no specific parts, nets, modules, or project
fixtures. This is a public tool. Generalize via **roles and patterns**, never via a hardcoded
circuit. Any device/net/module-title literal tied to one schematic is a defect.

## Architecture (all generic)

- `engine/role_infer.mjs` — classify components into roles by connectivity.
- `circuit_packs/archetypes/` — role-based cell templates (`support`, `fanout`, `densefanout`,
  `multipart`) built purely from `engine/cell_helpers.mjs` primitives; dispatched via `registry.mjs`.
- `engine/cell_helpers.mjs` — orthogonal geometry primitives; fail-fast on diagonal wires,
  floating labels, oversized stubs, empty net names, insufficient clearance.
- `engine/cluster_generate.mjs` — auto-cluster components by IC anchor + schematic-aware per-module
  layout (IC centered, decoupling at power pins, signals left-in/right-out) + auto module frames/titles.
- `engine/module_repack.mjs` — 2D shelf-pack of clean module geometry; breaks the wide-column vs
  aspect deadlock. Cross-module nets connect by grouped-net-label (same name = connected).
- `engine/geom_qc.mjs` / `engine/label_qc.mjs` — commercial geometry/label gates: orthogonal,
  no different-net contact, no wire-through-visible-object, no overlap, real net labels, no scatter.
- `engine/sheet_renderer.mjs` — render any model to PNG.
- `engine/bridge_*.mjs` — live EasyEDA access via the official bridge.
- delivery: `engine/cluster_generate.mjs` `deliverGenerated`, `engine/preserve_deliver.mjs`,
  `engine/plexus_apply_live.mjs`.
- `bin/plexus.mjs` — the entry point.

## Design language (generic, measurable)

- `docs/schematic-design-rules.md` — DR1–DR18 measurable gates.
- `docs/schematic_design_rulebook.md` — the project-agnostic design language (object/connectivity,
  layout topology, wiring strategy, geometry gates, role-based circuit archetypes, verification flow).

## Required external skill

Install and start the official EasyEDA API Skill first: <https://github.com/easyeda/easyeda-api-skill>.
It provides the WebSocket bridge + the EasyEDA-side extension. The bridge exposes
`http://127.0.0.1:49620/execute` (ports `49620-49629`). Open **any** schematic in EasyEDA Pro.

## Usage

```bash
npm install
npm run live:save                              # capture the open board -> live.json
node bin/plexus.mjs layout  live.json out.png  # any board -> commercial 2D layout + render + gates
node bin/plexus.mjs deliver live.json          # deliver the layout to the live EasyEDA document
npm test                                       # run the generic test suite
```

`layout` prints the geometry/label gate result (DR1 orthogonal, DR2 crossings/shorts, DR3
wire-through-component/pin, DR4-5 overlaps, label hard findings). The commercial target for live
delivery is EasyEDA DRC `0 error / 0 warning / 0 info`.

## Quality rules to preserve

- Real wire `Name` attributes for visible net labels; never fake `PrimitiveText` net names.
- All wires orthogonal; different nets never touch; wires never cross visible objects.
- Power/ground use built-in net-flag symbols; unused pins use the built-in NoConnected state.
- When a gate fails, fix the generic engine / archetype / cell-helper — never by adding
  circuit-specific content.
