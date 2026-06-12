# EasyEDA Harness

[中文](README.md)

EasyEDA Harness is a commercial-grade schematic generation and gating workflow for EasyEDA / JLC EDA. It separates deterministic schematic assembly, offline quality gates, real EasyEDA write-back, and live snapshot verification into a repeatable delivery loop.

The repository includes `AIHWDEBUGER` as a reference design: USB-C input, 5V to 3V3 regulation, ESP32-C3 MCU, RESET/BOOT support, high-side power switching, and two relay outputs.

## Capabilities

- Deterministic schematic assembly: functional cells live in `engine/cells.mjs`, and whole-sheet composition lives in `engine/assemble.mjs`.
- Fast offline gate: `npm run fast` validates the reference template on local CPU and is intended for daily coordinate and rule iteration.
- Full layout gate: `npm run pipeline` runs layout search, structure checks, visual rhythm checks, text clearance, and system-intent audits.
- Real EasyEDA loop: write back through the WebSocket bridge, then pull a live schematic snapshot with `snapshot2.js`.
- Net-label discipline: single-sheet signal labels use the real wire `Name` attribute instead of fake `PrimitiveText` labels.
- Native sheet-template friendly: title-block metadata should come from the EasyEDA native sheet template, not a duplicate title block drawn by the harness.

## Design Principles

- Electrical correctness first: key nets must be connected, and wire endpoints must land exactly on pin coordinates.
- Readability is a gate, not decoration: orthogonal wiring, clean module boxes, same-side alignment, no labels on component bodies, and no wires through symbols.
- Fail closed: template gates, live gates, and EasyEDA DRC must pass before delivery.
- Fast iteration: use `npm run fast` for coordinate and rule edits, then run the full pipeline and live EasyEDA checks before handoff.

## Requirements

- Windows + PowerShell
- Node.js 18 or newer
- EasyEDA / JLC EDA desktop client
- Official EasyEDA API Skill: <https://github.com/easyeda/easyeda-api-skill>
- EasyEDA API bridge, normally at `http://127.0.0.1:49620/execute`

Install and start the official skill first. It provides the EasyEDA Pro API docs, `SKILL.md`, WebSocket bridge, and the EasyEDA-side `run-api-gateway.eext` extension. Its official Quick Start includes `npm install`, `npm run build:docs`, `npm run server`, and installing that extension in EasyEDA; the bridge then waits for the EasyEDA client on ports `49620-49629`.

Then install this harness:

```powershell
npm install
# If PowerShell blocks npm.ps1, use npm.cmd install
```

## Quick Start

```powershell
git clone https://github.com/Xianleewu/easyeda-harness.git
cd easyeda-harness
npm install
npm run fast
npm run pipeline
```

The full gate uses a deterministic candidate set for quality evaluation by default. To audit every generated candidate, set:

```powershell
$env:EASYEDA_LAYOUT_MAX_CANDIDATES='0'
npm run pipeline
```

A passing run prints output similar to:

```text
Fast Template Harness | Score 100/100 | PASS
HARD=0 SOFT=0 INFO=0
```

## Write Back To EasyEDA

Start the EasyEDA bridge and make sure the target editor window is connected, then run:

```powershell
npm run apply:gated
```

`apply:gated` runs the gates before write-back and refuses to apply a failing schematic. Low-level write-back is only for debugging:

```powershell
$env:EASYEDA_APPLY_FULL_AUTHORIZED='1'
node engine/apply_full.mjs
powershell -ExecutionPolicy Bypass -File apply_run.ps1
```

## Live Snapshot And Visual Evidence

Pull the current schematic from EasyEDA:

```powershell
powershell -ExecutionPolicy Bypass -File run-save.ps1 -JsFile snapshot2.js -OutFile live.json
```

Generate local visual crops:

```powershell
npm run crops
```

For handoff, review the global sheet and local crops for USB, LDO, RESET, BOOT, MCU left/right, PMOS, RELAY1, RELAY2, and title-template area.

## Commercial Acceptance Criteria

- `npm run fast`: `HARD=0 SOFT=0 INFO=0`
- `npm run pipeline`: `HARD=0 SOFT=0 INFO=0`
- EasyEDA DRC: `0 error / 0 warning / 0 info`
- No fake text net labels
- No unnecessary NET PORT symbols on a single-sheet schematic
- Readable wire `Name` anchors: left-side labels use bottom-left origin, right-side labels use bottom-right origin
- Functional modules occupy clean rectangular regions with reasonable gaps
- No overlap among text, component attributes, net names, GND symbols, and NC markers

## Lessons Captured

- EasyEDA wire `Name` is the real visible net label; `PrimitiveText` is only text.
- Live testing showed wire `Name` origin modes: left-side labels use `alignMode=6`, right-side labels use `alignMode=8`.
- Use `eda.sch_PrimitiveAttribute.modify()` to patch wire `Name` attributes. Some `toAsync().setState_*().done()` paths can flip the Y coordinate.
- EasyEDA wire creation is more reliable when every polyline is split into single two-point segments.
- Slow live/DRC/screenshot loops should be final acceptance steps. Coordinate and rule work should start with the local fast gate.

## Repository Layout

- `engine/`: template assembly, layout search, write-back, rendering, DRC and live helpers.
- `harness/`: normalized model, module registry, and rule gates.
- `snap2.json`: reference project component snapshot.
- `comp_state.json`: reference component state for write-back preservation.
- `run.ps1` / `run-save.ps1` / `run-image.ps1`: EasyEDA bridge runners.
- `fix_wire_name_anchors.js`: utility for repairing live wire `Name` anchors.
- `remove_duplicate_title_block.js`: migration utility for removing old harness-drawn title blocks.

## License

Add a LICENSE file before a formal public release.
