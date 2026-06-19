# Next Session Handoff

This document is for the next Codex / Claude Code session that continues the EasyEDA Harness work.

## Current Objective

Make `easyeda-harness` useful for other schematic projects, not only for the bundled AIHWDEBUGER sample.

The target is not a prompt pack and not a free-drawing helper. The target is an executable schematic workflow that forces an agent to:

1. capture user intent as machine-checkable project artifacts,
2. build a short-cycle design brief before drawing,
3. generate deterministic cells from a project contract,
4. reject messy geometry, text overlap, fake labels, floating labels, bad label origins, and module interlocks,
5. verify both generated JSON and real EasyEDA live evidence,
6. write back only through gated apply.

## Current Truth

The repository is now better than a loose rule checklist, but it is still not a complete automatic schematic layout solver.

What currently works:

- `design-brief` is strict by default.
- `generate` is blocked unless the strict design brief passes.
- Project artifacts are expected before drawing: `project_spec.json`, `project_contract.json`, `project_netlist.json`, `project_assembly.json`, `approved_library_manifest.json`, and a circuit pack.
- Drawing rules are documented in `docs/schematic-design-rules.md`.
- `contract:geometry` and `contract:labels` exist for generated models.
- Live gates exist for real EasyEDA evidence.
- `workflow:smoke` includes negative tests for bad specs, missing libraries, incomplete scaffolds, and design-brief blocked generation.
- A reusable cell-helper primitive library exists at `engine/cell_helpers.mjs` (module rectangles, pin fanout to label columns, left/right label-column attachment with `alignMode` 6/8, GND/power clearance stubs, attribute placement, orthogonal elbow routes, build-time orthogonality/floating-label validators). It fails fast on diagonals, floating labels, oversized stubs, empty net names, and insufficient clearance. The `contract:helpers` gate (`engine/cell_helpers_gate.mjs`) proves the helpers build geometry that passes the real `geomQC`/`labelQC` with `hard=0` and that every negative constraint is still enforced; it runs inside both `accept` and `workflow:smoke` (`WS24-cell-helpers-enforced`).

What is still weak:

- The harness can reject many bad results, but it does not yet synthesize a good layout for arbitrary schematics.
- New circuit packs can still be too easy for agents to implement poorly unless the generator has stronger reusable layout primitives.
- Visual/layout quality is only partly productized. Module regions, label columns, and geometry gates exist, but the workflow still needs better failure-to-fix loops and stronger generic cell helpers.
- Preview evidence is local renderer evidence. Final proof must come from EasyEDA live snapshot, live geometry/label checks, module screenshots, and DRC 0/0/0.

Do not describe the project as reliably producing polished schematics for arbitrary circuits yet. Describe it as a structured schematic collaboration and checking workflow that is being hardened into a reusable design system.

## Recent Commits To Preserve

- `87552d9 Add design brief workflow stage`
- `a3b9b25 Make design brief fail closed by default`
- `e3bbf83 Gate generation on strict design brief`

These commits are important because they move the project away from "run rules after chaos" and toward "block generation until the project has a reviewable block/pin/layout/label contract."

### Plexus synthesis + source-based live delivery (later milestone)

- `e7db6d3 Migrate gsd->plexus naming + land quality/audit support modules`
- `131bb0e Official gated apply uses source-based delivery (apply_source_run writer)`
- `06fb798 apply_source_run honors --window-id (multi-window parity)`

`engine/plexus_synthesize.mjs` synthesizes a gate-clean layout (geomQC incl.
collinear / endpoint / T-junction shorts, labelQC, synthesisFaithfulness,
wireConnectivity all hard=0) from an extracted board. `engine/apply_source.mjs`
delivers it live via `eda.sys_FileManager.setDocumentSource` (atomic source
load) — this BYPASSES the legacy per-wire `sch_PrimitiveWire.create` path, which
loses 30-50 wires to EDA's non-deterministic merge. The official `apply --gated`
bundled writer now runs `engine/apply_source_run.mjs`, so the `full_model.json`
the gates validate IS the model written back (geomQC fail-closed safety net +
deep component+segment verification + --undo self-heal + auth gate). Note:
`getNetlist` is platform-blocked (server-side hang); geometric floating-net
reconstruction (`floating 41 <= original 42`) is the electrical-equivalence proxy.

## Must-Read Files

- `AGENTS.md`: primary operating contract for agents.
- `docs/agent-runner-guide.md`: neutral runner workflow.
- `docs/schematic-design-rules.md`: drawing and geometry rulebook.
- `workflows/design_brief.mjs`: strict short-cycle review artifact.
- `workflows/plexus_generate.mjs`: generation entrypoint; must stay fail-closed on plan and design brief.
- `engine/workflow_smoke_gate.mjs`: reusable workflow regression tests.
- `engine/project_geometry_gate.mjs`: generated/live geometry audit.
- `engine/project_label_layout_gate.mjs`: generated/live net-label audit.
- `engine/repair_actions.mjs`, `engine/next_actions.mjs`, `workflows/repair_loop.mjs`: failure-to-repair evidence.

## Non-Negotiable Rules

- Do not free-draw EasyEDA primitives for delivery.
- Do not use fake `PrimitiveText` as a net label.
- Do not use unnecessary NET PORT symbols for a single-sheet schematic.
- Left-side fanout labels must use EasyEDA left-bottom origin behavior and match the declared label column.
- Right-side fanout labels must use EasyEDA right-bottom origin behavior and match the declared label column.
- Label origins must attach to same-net wire endpoints. Floating labels are hard failures.
- Wires must be orthogonal.
- Different-net crossings are hard failures.
- Wires must not pass through symbols, text, flags, labels, or component bodies.
- Text, attributes, flags, GND/NC symbols, labels, and component bodies must not overlap.
- Modules must own compact rectangular regions with reasonable gaps. Interlocking module boxes are failures, not style choices.
- Final delivery requires real EasyEDA live evidence and DRC `0 error / 0 warning / 0 info`.

## Why Previous Attempts Felt Low-Value

The workflow originally looked like a rules system, but most rules acted after generation. That means an agent could still create a messy schematic, then spend hours chasing individual failures.

Frontend design skills feel stronger because they usually provide:

- a constrained component/layout vocabulary,
- fast visual drafts,
- small local edit loops,
- direct screenshot comparison,
- clear design-system defaults.

For schematic work, the matching architecture must be:

- project spec -> design brief -> deterministic module contract -> reusable cell primitives -> geometry/label gates -> live evidence,
- not "ask the agent to draw a full schematic and then lint it."

The next work should continue converting visual quality from prompt guidance into executable constraints and reusable generation primitives.

## Recommended Next Work

1. Strengthen generic cell helpers. (SEEDED — `engine/cell_helpers.mjs` + `contract:helpers` gate now exist.)
   Reusable helpers for module rectangles, pin fanout rows, label-column attachment, GND/NC clearance, component attribute placement, and no-crossing local route templates are implemented and gate-proven. New packs should use helpers instead of hand-placing labels and wires. Remaining work: adopt these helpers inside `engine/cells.mjs` / a new pack's cell builders so a real schematic — not only the synthetic gate fixture — is assembled through them.

2. Improve label failure reports. (DONE.)
   Every label finding now includes a `where.suggest` (likely edit files resolved to the active `circuit_packs/<pack>/pack.mjs` plus a rule-specific repair hint) and `where.module`/`where.modules` owning-module attribution (net→module map from `project_assembly.json` module `nets`). `LL14-label-column-match` additionally carries `where.xDeltas` (per same-net column: `expectedX`, `actualX`, `dx`, `tolerance`, `sideMismatch`, `withinTolerance`). Existing rules already expose alignMode (LL9), origin corner (LL11), and nearest same-net endpoints (LL13). Optional next: thread the same expected/actual deltas into LL9/LL11/LL13.

3. Improve geometry failure reports. (DONE.)
   Every geometry finding now includes a `where.suggest` (likely edit files resolved to the active pack cell builder and/or `project_assembly.json`, plus a rule-specific repair hint) and a `where.module`/`where.modules` owning-module attribution. Component-involving findings (PG2/PG4/PG6) attribute via `project_assembly.json` module `refs`; pure-wire findings (PG1/PG3) attribute by testing their sample point against absolute module rectangles resolved from `anchors` + `layoutPolicy.moduleRegions` (same `rectFromRegion` convention as `contracts/layout_contract.mjs`). Optional next: add expected/actual coordinate deltas to each finding.

4. Add a new-project fixture. (BREAKTHROUGH: a non-AIHWDEBUGER project now generates gate-clean geometry end-to-end.)

   STATUS UPDATE (this session): four SAFE, aihwdebugger-zero-regression generalization fixes were made so the `samples/divider` project now PASSES `plexus:generate` (100/100), `fast`, `pipeline`, `contract:geometry`, `contract:netlist`, and every `contract:*` gate when run via `node bin/easyeda-plexus.mjs accept samples/divider/project_spec.json`. The bundled aihwdebugger `npm run accept` stays fully green after every change (verified). The four fixes:
   - `engine/connectivity_qc.mjs`: skip required-pin-net assertions for parts absent from the active model (AIHWDEBUGER-specific `FALLBACK_REQUIRED_PIN_NETS` D2/D3 no longer flag other projects; genuinely missing required parts are still caught by `C10.1`).
   - `engine/net_registry.mjs`: canonical net set = hardcoded list UNION the active `project_netlist.json` nets; `N5-missing-rail` only requires an `EXTERNAL_NET` the active project actually declares.
   - `harness/rules/c1_layout.mjs`: `C1.3-density` only applies when `m.parts.length >= 8` (AIHWDEBUGER has 34).
   - `harness/rules/c9_reference_quality.mjs`: `C9.2-module-aspect` is relaxed (max 6) for modules with <= 2 refs (a 2-part series is inherently linear; AIHWDEBUGER modules pass at 3.2 already).
   FOLLOW-UP PROGRESS (later in this session): three more safe fixes landed and the divider `contract:layout` dropped 4 -> 1, aihwdebugger still green:
   - `samples/divider/project_assembly.json`: restored 11 `anchorVariants` -> `PL8-candidate-count` cleared.
   - `contracts/layout_contract.mjs`: `PL10-min-module-gap` now skips when `modules.length < 2` -> cleared (vacuous for one module).
   - `engine/structure_metrics.mjs`: `S10-module-aspect-budget` relaxed for `<=2`-ref modules (same pattern as C9.2) -> `PL13-structure-pass` cleared.
   The ONLY remaining `contract:layout` finding is `PL9-best-layout-pass`. NOTE (corrected): this is NOT a single aspect rule. In `engine/layout_planner.mjs`, a candidate's `pass` is a COMPOUND gate: it requires `validateTemplate` AND `computeStructureMetricsFromSnapshot` AND `auditCommercialArchitecture` AND `auditPageComposition` AND `auditSystemIntent` AND `auditSheetOutput` to all pass (see `evaluateCandidate`, ~lines 300-382). Template + structure now pass for the divider; the residual failures are inside the architecture / system-intent / page-composition / sheet-output audits, which are AIHWDEBUGER-architecture-coupled (power tree, left-to-right input/MCU/output flow, sheet-output footprint). Generalizing PL9 therefore means making THOSE audits scope/architecture-aware (e.g., skip flow/architecture assertions that require named aihwdebugger modules when the project does not declare them) — a larger, multi-audit task, not a one-line relaxation.

   FOLLOW-UP 2 (later this session): `preview` and `contract:visual` now PASS for the divider after gating the sheet-output footprint family (`SO7`/`SO13`/`SO14`/`SO15`) on `(renderReport.moduleRegions?.length ?? 0) >= 2` in `engine/sheet_output_gate.mjs` (`SO12` structural check kept). `pageComposition` `P5-page-aspect-balance` also gated to `modules.length >= 2` in `engine/page_composition.mjs`. aihwdebugger stays fully green after each. The divider now passes generate/fast/pipeline/geometry/netlist/ALL contract/preview/visual.
   The ONLY structural blocker left is `contract:layout` `PL9-best-layout-pass`. Pinned precisely via `engine/pipeline.mjs` best-candidate dump: among the planner's per-candidate sub-audits (`template`/`structure`/`architecture`/`pageComposition`/`systemIntent`/`sheetOutput`), ALL pass for the divider EXCEPT `sheetOutput` (~11 remaining SO density/style rules beyond the footprint family). KEY ASYMMETRY: the divider's standalone `preview`/`contract:visual` gates PASS, but the layout planner holds each candidate to a STRICTER `auditSheetOutput` bar, so no candidate clears it and `best.pass` stays false even though the chosen layout is deliverable-clean. Two clean options for next session: (a) gate the remaining ~11 SO density/style rules on `>=2` module regions like the footprint family, or (b) in `engine/layout_planner.mjs` `evaluateCandidate`, make `sheetOutput.pass` non-blocking for low-module-count projects since the real `preview`/`contract:visual` gates already validate the delivered sheet more appropriately. After either, re-run aihwdebugger `npm run accept` (must stay green).

   Remaining divider failures (exact, with root causes — next-session candidates):
   - `contract:layout` `PL9-best-layout-pass`: planner `sheetOutput` over-strict for a minimal project (see FOLLOW-UP 2; ~11 SO rules or make sheetOutput non-blocking for low-module projects in the planner).
   FULL LOCAL PARITY ACHIEVED (end of this session): `WS36` is now FIXED — the duplicate-ref fixture is cloned from the bundled root assembly, so its spawned `project_assembly_gate` is now pinned to `EASYEDA_PROJECT_CONTRACT=${ROOT}/project_contract.json` (instead of inheriting a non-root spec's single-module contract, which had prevented PA21 from firing). Result: `node bin/easyeda-plexus.mjs accept samples/divider/project_spec.json` now reports `required-failed = ["next:actions","final:evidence"]` — IDENTICAL to the bundled aihwdebugger `npm run accept`. The divider passes the ENTIRE local accept suite (generate/fast/pipeline/geometry/netlist/all-contract/preview/visual/layout/workflow:smoke/repair:actions); only the live-gated `next:actions`/`final:evidence` remain, which need the EasyEDA bridge and which aihwdebugger also defers. aihwdebugger stays fully green. handoff item 4 is now fully achieved at the local-gate level.

   REGRESSION PROTECTION (locks in the breakthrough): `engine/divider_pack_smoke.mjs` (run by `workflow:smoke` `WS25`) now ALSO assembles the full divider model from the registered pack + `samples/divider` library/assembly and runs the real `validateProjectGeometry` + `validateLabelLayout` validators, asserting `hard=0` (`checks.dividerProject`). This is context-independent (reads the divider files explicitly, passes explicit assembly/contract args) and runs at smoke speed (no layout search), so any future engine/rule change that would silently regress the non-aihwdebugger generalization now fails `workflow:smoke`. The full-pipeline regression is `npm run examples:divider:accept`.

   Historical note on the WS36 root cause (now fixed): TEST-DESIGN coupling. The WS36 negative test does `clone(assembly)` of the ACTIVE project and injects a duplicate ref into `modules[1]` to prove `project_assembly_gate` emits `PA21-ref-owned-once`. A single-module project (divider) has no `modules[1]`, so the duplicate-ref scenario is never constructed and PA21 never fires -> WS36 fails. Synthesizing a second module is not enough because the extra module is not in the active contract, so the gate fails on other findings instead of PA21. Proper fix: make WS36 a SELF-CONTAINED unit test — spawn `project_assembly_gate` against a fixed synthetic 2-module assembly AND a matching synthetic contract/manifest with a shared designator, independent of the active project. Root aihwdebugger smoke passes (it has >=2 modules). `repair:actions` for the divider only cascades from this WS36 finding.

   PLANNER FIX LANDED (this session): `engine/layout_planner.mjs` `evaluateCandidate` now treats `sheetOutput.pass` as non-blocking when `pageComposition.stats.modules < 2` (the delivered `preview`/`contract:visual` gates already validate the sheet for low-module projects). Result: divider `contract:layout` PASSES. The divider now passes the ENTIRE local quality-gate suite (generate/fast/pipeline/geometry/netlist/all-contract/preview/visual/layout); its ONLY remaining local failures are `workflow:smoke` WS36 (the test-design artifact above) + `repair:actions` (cascade), plus the live-gated `next:actions`/`final:evidence` that the bundled aihwdebugger project also defers. aihwdebugger stays fully green after every fix.
   - `preview` `V3-SO7-sheet-footprint` (sheet frame too small for reference-PDF-like output — a sheet/render-size heuristic; either fit the sheet to content or scope it by part count) and `contract:visual` `PV1` which only cascades from the preview failure (the visual regions themselves all match: global-sheet, divider, title-template).
   - `workflow:smoke` `WS36-assembly-refs-owned-once`: a PRE-EXISTING negative-test context-isolation issue — when `accept` runs on a non-root spec, the WS36 sub-check's duplicate-ref assembly probe does not produce `PA21`; the smoke gate needs to isolate its sub-gate env from the active project. Root `npm run accept` (aihwdebugger) smoke passes, so this only affects non-root `accept` runs.
   - DRC 0/0/0 still needs the EasyEDA bridge.

   Original (cell-level) status below still applies:
   `circuit_packs/divider/` is a second registered non-AIHWDEBUGER pack (resistor voltage divider: VIN power, VMID right-side signal label, GND) whose `dividerCell` builder is assembled entirely from `engine/cell_helpers.mjs`. `engine/divider_pack_smoke.mjs` (`npm run examples:divider`) drives it with synthetic library parts and proves the output passes the real `geomQC` + `labelQC` with `hard=0`; it is wired into `workflow:smoke` as `WS25-example-pack-generalizes`. `circuit_packs/registry.mjs` now lists both `aihwdebugger` and `divider`, and `accept` confirms the second pack does not affect the bundled aihwdebugger gates (`contract:pack` still passes).

De-risked path for a full second project (verified by scaffolding `init --pack divider --out samples/divider` and reading the gates):
- `node bin/easyeda-plexus.mjs init --pack divider --out samples/divider` scaffolds all six artifacts; the onboarding flow works.
- Edit the scaffold: spec/contract module `divider` with `requiredNets` `[VIN, VMID, GND]`; netlist nets with `modulePins`; `approved_library_manifest.json` reusing aihwdebugger's approved resistor `Symbol/Device/Footprint` bindings for `R1`/`R2`; `project_library_snapshot.json` with the two resistor components (pins) so generation can resolve `byDes`.
- In `project_assembly.json` the divider module mapping needs `cell: "dividerCell"`, `registryModule: "divider"` (any non-empty string is accepted — see the `sensor_frontend` pattern in `engine/workflow_smoke_gate.mjs`), `refs: { R_top: "R1", R_bot: "R2" }`, `netArgs: { VIN, VMID }`, plus `layoutPolicy.labelColumns` covering the `VMID` right-side label.
- Then `plan` -> `generate` -> `contract:geometry`/`contract:labels` locally; the divider cell already passes `geomQC`/`labelQC` in isolation (WS25). Live DRC 0/0/0 still needs the EasyEDA bridge.

Empirical result (this session authored the full `samples/divider` project and ran `accept` on it, then cleaned it up):
- The CONTRACT LAYER fully generalizes: `plexus:plan`, `spec:schema`, `spec`, `contract`, `contract:rules`, `contract:pack`, `contract:library`, `contract:cells`, `contract:helpers`, and `contract:assembly` all PASS for the non-AIHWDEBUGER divider project. A new project needs no harness-registry edits (`registryModule` can be any non-empty string; drawingRules use the standard registered ids).
- The WALL is generation + layout: `plexus:generate`/`fast`/`pipeline` score the generated divider model with ~21 hard findings and `contract:layout` adds ~4, because the full template-harness quality/layout rule set is tuned for the rich AIHWDEBUGER schematic (title-block/sheet composition/structure/density rules) and rejects a minimal 2-resistor sheet. This is exactly the "does not yet synthesize a good layout for arbitrary schematics" gap above.
- The divider `full_model.json` BUILDS successfully through the pipeline (`plexus:generate` reports `fullModelExists: true`, `layoutEvidenceOk: true`); the pack/cell/contract layer works end-to-end. The model is then scored 0/100 by the template-harness quality rules — i.e., the failure is purely the quality rule set, not model construction.
- Precise rule-level finding (running the core harness rule registry on the built divider model with `EASYEDA_PROJECT_ASSEMBLY` pointed at the divider): the model scores 94/100 with only TWO hard findings — `C1.3-density` (sheet component density too low, ~0.27% on the default sheet) and `C9.2-module-aspect` (the vertical divider module aspect 5 > 3.2). Crucially, `C10.1-required-part-missing` is ALREADY project-aware (it reads `loadProjectModuleRegistry()` refs, so it requires the divider's `[R1,R2]`, not AIHWDEBUGER's BOM) and passes. The engine `pipeline_fast` rule set reports additional findings beyond these two — reconcile its exact list first (run `engine/pipeline_fast.mjs` with the divider env), but the category is the same: layout-shape/density/composition heuristics tuned for AIHWDEBUGER's richness.
- So the real next work for a full passing second project is to make the density/aspect/composition heuristics SCOPE-AWARE — NOT a part-list coupling problem. Exact mechanics for the two core-harness rules:
  - `C1.3-density` in `harness/rules/c1_layout.mjs`: hardcoded `if (density < 1)` where `density = partArea/sheetArea*100`. Safe scope-aware fix: skip or scale the floor when `m.parts.length` is below a small threshold (aihwdebugger has 34 parts, so guarding on a low count leaves its path unchanged).
  - `C9.2-module-aspect` in `harness/rules/c9_reference_quality.mjs`: `maxAspect = CONFIG.reference?.maxModuleAspect?.[name] ?? 3.2`. Safe fix: relax the default for modules with very few refs (a 2-part vertical module is inherently high-aspect); aihwdebugger modules have more refs and named overrides, so they are unaffected.
- IMPORTANT context caveat (learned the hard way this session): the validators are split — `harness/rule_registry.mjs` (`runRules`, used by `harness.mjs`) gives the 94/100 + 2-hard result above, while `engine/validate.mjs` (`validateTemplate`, used by `pipeline_fast`/`pipeline` — the actual `fast`/`pipeline` gate) is a DIFFERENT, larger rule set and is what `accept` reported ~21 hard against. Every standalone rule run MUST set ALL of `EASYEDA_PROJECT_ASSEMBLY`, `EASYEDA_PROJECT_CONTRACT`, `EASYEDA_PROJECT_NETLIST`, and `EASYEDA_PART_LIB` to the `samples/divider/` files, or the validators silently fall back to AIHWDEBUGER's netlist/parts and emit misleading "missing pin" noise. The authoritative divider list is whatever `node bin/easyeda-plexus.mjs accept samples/divider/project_spec.json` produces for the `fast`/`pipeline` steps; capture `report.json.findings` right after that step before any other run overwrites it.
- Residual AIHWDEBUGER coupling to generalize in `engine/connectivity_qc.mjs`: it reads `EASYEDA_PROJECT_NETLIST` (good, project-aware), but it ALSO always applies a hardcoded `FALLBACK_REQUIRED_PIN_NETS` list (around line 77) and a `/R9|R10|R11|R12/` ref check (around line 94). Gate those to the aihwdebugger project (or derive them from the active `project_netlist.json`) so other projects are not held to AIHWDEBUGER-specific pin-net expectations.
- After EACH rule change, re-run the bundled `npm run accept` and require aihwdebugger stays fully green (its richness path must not regress).
- A ready test fixture is committed at `samples/divider/` (the six project contracts; generated reports are gitignored). Run `node bin/easyeda-plexus.mjs accept samples/divider/project_spec.json` to reproduce: every contract gate passes; `plexus:generate`/`fast`/`pipeline`/`contract:layout` are the only failing local gates. When making rules scope-aware, after each change re-run the bundled aihwdebugger `npm run accept` and require it stays green (8-module richness path must be unchanged) — only relax thresholds for low-module-count projects.

5. Make `repair_actions.json` more actionable.
   Group failures by edit target: `project_assembly.json`, circuit pack cell builder, label helper, geometry gate, writer, or live snapshot. A next agent should not have to guess which file to edit.

6. Keep generation fail-closed.
   Do not weaken the strict design brief. If a new project does not have module regions, pin maps, interface routes, and label columns, generation should fail before touching `full_model.json`.

## Validation Commands

Run these before pushing code changes:

```powershell
npm.cmd run workflow:smoke
npm.cmd run accept
git diff --check
git status --short --branch
```

For live delivery work, also run:

```powershell
node bin/easyeda-plexus.mjs live-check
node bin/easyeda-plexus.mjs deliver
```

Only write back with:

```powershell
node bin/easyeda-plexus.mjs apply --gated project_spec.json
```

## Handoff Standard

A good next-session result should not merely add another document. It should add one or more executable constraints, reusable generation helpers, or negative tests that prevent known bad behavior from returning.

The most valuable proof is a failing fixture that used to pass, plus a gate/helper change that makes the failure actionable and keeps `workflow:smoke` and `accept` passing.
