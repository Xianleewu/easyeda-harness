# Project Field Notes (Reference-Build History)

These are **project-specific field notes** preserved from the original
`schematic_design_rulebook.md`. They record concrete failures, fixes, component
identities, library bindings, and harness-internal wiring discovered while
building specific reference projects (AIHWDEBUGER / TigerBruce / TinyReader).

> **Status: history, not law.** This file is *not* the general design language.
> The durable, transferable principles behind these notes have been distilled
> into the project-agnostic `schematic_design_rulebook.md`. Keep this file for
> traceability and regression context; do not cite a specific designator, hash,
> date, gate ID, or filename below as a general rule for a new project.

## Reference Projects Used

- **TinyReader** — read-only visual target. Inspected metrics: 64 wire objects /
  126 orthogonal segments; 117/126 segments `<= 80` units; 0 segments `>= 250`
  units; 0 diagonals; 0 large explanatory text objects inside the circuit body.
  Design implication: readability comes from placement and short local wires,
  not from labels or long global wiring.
- **TigerBruce** — reference-study source for net-contract, label, document-
  identity, and reference-evidence rules. Pinned by
  `approved_reference_manifest.json` (approved commit + SHA-256/byte count per
  tracked Markdown/tool/PDF/screenshot) and
  `approved_reference_review_manifest.json` (rendered page PNGs + contact sheets).
- **AIHWDEBUGER** — the build target. Live commercial acceptance verified the
  active document identity (project = AIHWDEBUGER, current document is a schematic
  page, document/page UUIDs match, project/schematic/page parent UUIDs agree).
  UI title text was treated as insufficient evidence.

## Component-Specific Lessons

- **D2 / D3 relay flyback diodes (fixed 2026-06-10).** Recreating D3 via EasyEDA
  device search/create produced a visually plausible diode with a different
  internal `Symbol`/`Device`/`Footprint` binding from D2, causing strict DRC
  pin-pad mapping errors. Approved binding for **both** D2 and D3:
  `Symbol=703c18046c7d1ac8`, `Device=cb95f1734719a1ce`,
  `Footprint=1fd32051a468dcc1`. Both stay `BOM=true` and `PCB=true`. Never swap
  only D3; update both relay channels together. An expanded probe across 33
  creatable 1N4148/LL4148/BAS16/1SS355 candidates found only 40 mil schematic
  pin pitch, while CN3/CN4 coil pins use 20 mil pitch — so a diode swap cannot
  fix relay-cell readability; fix it through routing/spacing instead. Recorded as
  a zero-finding decision `keep-approved-current-diode`.
- **Q1/Q2 high-side MOS gate driver.** R1 pull-up and D1 clamp must stay a tight
  row-aligned pair; R1/R2 form the Q1 gate-support column; Q2 sits below that
  column; R3/R4 stay local to Q2.G.
- **Relay low-side drivers.** Terminal/load on the right edge; flyback diode
  directly between coil supply and switched-node rows; gate series resistor
  in-line GPIO→gate; gate pulldown below/local to the MOS gate.
- **LDO output decoupling (C17 cell).** Output caps stay a compact row beside the
  regulator VOUT side, power pins near the VOUT local rail, GND pins returning
  locally below.
- **RESET/BOOT cells (C18).** Pull-up above the switch signal side; RESET's
  capacitor on the local reset signal row with a nearby ground return; BOOT keeps
  the same pull-up grammar without a capacitor.
- **USB-C support passives.** CC pull-downs row-aligned and close to served CC
  pins; D+/D- series resistors a compact aligned column near the data-pin rows.

## Harness-Internal Wiring (Implementation Map)

These names belong to this harness's implementation, not the design language:

- **Write-back path:** `apply_gated.mjs` is the single commercial write-back
  entry. It runs the offline commercial gate before generating/executing apply
  scripts, and after write-back verifies live harness, live net contract, live
  library manifest, zero-severity policy, validateLive, and strict DRC 0/0/0.
  Low-level generators (`apply_full.mjs`, `apply_run.ps1`, `af_*.js`, legacy
  `apply_existing_safe.mjs`) abort unless authorized by `apply_gated.mjs`.
- **Library identity gate:** every approved component compared against
  `approved_library_manifest.json` (`addIntoBom`, `addIntoPcb`, `name`, `value`,
  `Symbol`/`Device`/`Footprint`). Expected coverage was 34 parts / 102 binding
  checks.
- **Zero-severity policy (`severityPolicy`):** acceptance scans engine/harness
  sources for `soft`/`info` emitters and audits the final report for non-zero
  hard/soft/info nodes. Internal rule IDs seen in reports: `C1.3-density`,
  `C2.1-near`, `C2.3-text-over-wire`, `C2.4-text-over-body`, `C2.6-wire-cross`,
  `C4.2-detour`, `C4.4-wander`, `N3-case`, `N4-conn-suffix`, `E1-net-equiv`,
  `PC25-no-net-port-default`, `R21`–`R33`, `RC14`–`RC16`.
- **Reference-evidence gates:** `pdf_full_review.json`, per-PDF contact sheets,
  per-page rendered PNGs, extracted text samples; pixel-quality checks fail
  `R21/R22/R23`; manifest pinning fails `R24`–`R33` / `RC15`/`RC16`.
- **Image gate:** `snapshot-image.js` + `image_gate.mjs` record schematic bbox,
  edge margins, min margin px/ratio; ink pressed against an image edge is a hard
  failure. Raw capture may be white-padded only after non-margin content checks
  pass (`getCurrentRenderedAreaImage()` viewport behavior).
- **Pre-gate:** `pipeline.mjs` is a commercial pre-gate (full registered harness
  rule set), not a compose smoke test; a rule failing `harness_model_report.json`
  must not leave `report.json` PASS.
- **Fail-closed reports:** `commercial_gate.mjs` overwrites its report with
  `pass:false` at startup and on any uncaught exception.
- **Repeated-binding repair:** `repair_repeated_library_bindings_live.js` runs
  before live verification so equivalent devices keep matching key bindings.

## Dated Failure Log

- **2026-06-10:** D2/D3 binding drift identified and fixed (see above); diode
  candidate pin-pitch probe (33 candidates, all 40 mil) concluded
  `keep-approved-current-diode`.
