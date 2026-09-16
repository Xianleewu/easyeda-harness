# Agent Quick Start

## Mandatory execution contract

`wf.mjs` is the only entry point for work on a live EasyEDA document. At the start of every
work turn, run `wf check` and read the emitted `workflow-context.json` before proposing or
executing edits. The context is the authoritative state packet: document identity, complete
token coverage, DRC evidence, deviation vector, exact targets, and the next deterministic batch.

Before planning any batch, also read `docs/workflow-review-2026-09-15.md`. It is the active
priority ruling layered on this contract: judge-freeze first (P0), live-for-acceptance-only,
the parameterized-cell direction for transforms, and the narrowed PCB scope. Its stop-list
and priority order bind every live task in this iteration.

All live writes must use one of these transactions:

- `wf commit <transform.mjs>` for source edits;
- `wf seed <manifest.json>` for catalog device instantiation;
- `wf api <plan.mjs>` only for primitives that cannot be instantiated through source.

Calling bridge mutation APIs from an ad-hoc script is forbidden. `bridge_client.mjs` must reject
such calls without a recognized transaction context. Attempts, API calls, and screenshots are
not progress. Progress means a saved and reloaded batch with a strictly improved deviation vector
and no new higher-priority finding. Coordinates, bounding boxes, connectivity, label anchors,
spacing, and rule conformance are determined by code. AI judgment is reserved for circuit intent,
part choice, and choosing among candidates already proven valid by the deterministic gates.

`wf check` emits a time-limited preflight receipt bound to the active document, stable source,
workflow context, token evidence, and every mandatory rule file. `wf commit`, `wf seed`, and
`wf api` fail closed when that receipt is absent or stale. Before a source commit, `srccommit`
builds a source twin from the compiled candidate source and captured live geometry, recovers the
candidate netlist, checks source/object coverage, and runs the full deterministic token/delivery
ratchet before the first live write.

The standard authoring loop is **compile-first** (2026-09-15, user ruling): after writing or
editing a transform, run `node compile.mjs <transform.mjs>` (with `EASYEDA_ARTIFACT_DIR` and
`EASYEDA_TOKEN_EVIDENCE` set). It runs the entire offline stack — transform → compileSourcePlan
→ assertSource → candidate twin → judgeTokens → delivery gate — in under a second with zero
bridge calls, printing every finding with rule, object, coordinates, and expected-vs-actual,
plus the pre-write gate verdict. Iterate transform ↔ compile until green with strictly
decreasing deviation; only then `wf check` → `wf commit`. Candidate defects are never discovered
through wf commit, and candidates are never produced by trial enumeration.

Do not repeatedly inspect screenshots while converging. Read complete source and geometry, apply
one functional-cell batch, and run the deterministic ratchet. Capture one fresh canvas only after
all deterministic gates pass.

This repository is a **generic, public schematic-beautification tool**. It turns **any** EasyEDA
schematic into a clean, commercial-grade 2D layout — like a frontend design workflow, but for
circuits. It is **circuit-agnostic**: it contains **zero specific-circuit content** (no hardcoded
device names, net names, module titles, or per-project fixtures).

## Core principle (non-negotiable)

Never add any specific schematic's content — no specific parts, nets, modules, or project
fixtures. This is a public tool. Generalize via **roles and patterns**, never via a hardcoded
circuit. Any device/net/module-title literal tied to one schematic is a defect.

## Operating charter — read and apply on every EasyEDA task

This repository has two inseparable deliverables: **finish the user's currently open design to
commercial quality** and **improve the generic workflow whenever that design exposes a weakness**.
Working on only one of them is incomplete. A clean board produced by ad-hoc edits does not improve
the tool; engine work that leaves the open board visibly unchanged does not serve the user.

For every schematic or PCB task in this repository, the agent must do all of the following:

1. Start from this repository, read this file and the applicable rule documents, then print or inspect
   the current workflow runbook before editing. Do not rely on remembered rules from another session.
2. Use the repository workflow as the only write path. Existing schematic edits go through
   `node wf.mjs commit`; checks go through `node wf.mjs check` and final acceptance through
   `node wf.mjs audit`. PCB work must use the repository's PCB capture/QC/transaction path. If the
   requested edit is not supported, add the missing generic workflow capability first instead of
   bypassing the workflow with an ad-hoc live API write.
3. Keep circuit-specific evidence, transforms, device identities and artifacts outside this public
   repository. Feed them into the generic engine at runtime. Never solve a live board by hardcoding
   its references, net names or geometry into repository code or tests.
4. Convert every repeated user correction or newly discovered failure mode into the smallest generic
   rule, deterministic detector, actionable diagnostic and regression test that prevents recurrence.
   A count-only diagnostic is insufficient when the source geometry can identify the offending
   objects or coordinates.
5. Run the deterministic gates after each bounded repair batch. A repair may proceed from an existing
   red page only through the monotonic repair ratchet: no token or native DRC severity may regress and
   the total measured deviation must strictly decrease. A failed batch is rolled back and read back.
6. Do not report progress from intent, generated files, cleared DRC results or uncommitted candidates.
   Report only persisted changes confirmed by save/reload/readback, plus the exact remaining gate
   findings. Do not claim commercial completion until source coverage, every design token, fresh native
   DRC and the final fresh canvas inspection all pass.
7. Optimize iteration cost with source data first: use pin coordinates, bounding boxes, wire groups,
   netlist connectivity and rule diagnostics to plan a complete batch. Use screenshots once after the
   deterministic gates converge, or when a residual visual question cannot be expressed geometrically.

This charter is a hard gate. If current repository tests or the workflow contradict the rulebook, fix
that inconsistency before modifying the user's document.

### Efficiency objective (Goal 2)

The workflow must save engineering time. Treat repeated bridge calls, screenshots, one-object repair
commits and manual JSON inspection as workflow defects. For a normal small or medium design:

- Take one complete deterministic baseline, turn it into an actionable queue containing object names,
  nets, coordinates and boxes, then repair a whole functional cell per candidate.
- Validate candidates against cached source/geometry evidence before a live write whenever the evidence
  is sufficient. Perform at most one save/reload/readback cycle for an accepted repair batch.
- Do not rerun an identical failed operation. Record the failure condition, change the generic tool or
  candidate, and retry only with new evidence.
- Run focused tests while changing one engine area; run the full generic suite once after that area is
  green and again before final delivery. Full-suite repetition is not a substitute for diagnosis.
- Keep screenshots out of the deterministic loop. Use coordinate and connectivity data for all
  expressible checks, then take one fresh final canvas capture for residual visual judgment.
- Report progress by persisted functional milestones and deviation reduction. Generated candidates,
  exploratory reads and elapsed effort are not milestones.

If a design of at most 25 fitted parts cannot produce its first persisted, read-back-verified functional
cell within two live write cycles after the baseline, stop repeating edits and improve the workflow
primitive or diagnostic that caused the stall.

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
- `engine/design_tokens.mjs` / `engine/token_conformance.mjs` / `engine/commercial_judge.mjs` /
  `engine/bridge_windows.mjs` — design-token conformance judge. `design_tokens` is the single source
  of truth (strict values from DR1-18, e.g. orthogonal=100%; density/annotation values from commercial
  reference measurement). `token_conformance.judgeTokens` checks each token deterministically and
  returns a **3-tier deviation report** (tier1 DRC `0/0/0/0` → tier2 geometry tokens → tier3 residual
  visual), **no composite percentage**. `commercial_judge.runLiveJudge` collects real EasyEDA evidence
  (geometry + `sch_Drc.check` + full/region screenshots via `bridge_windows`). `engine/rubric_audit.mjs`
  guards the zero-specific-circuit rule. (`commercial_rubric.mjs` soft-threshold `scoreAll` is DEPRECATED.)
- `engine/eda_twin.mjs` / `engine/twin_renderer.mjs` / `engine/twin_calibrate.mjs` / `engine/live_loop.mjs` —
  可信镜头(Spec B1):twinPredict 按 eda_transform 忠实预测 EDA 几何(bbox/脚/标注按放置重算),
  twin_renderer 取代 sheet_renderer 当质量预览,twin_calibrate 用真 EDA 钉死,live_loop 安全闭环。
  几何裁判已补全到 DR4/DR5(可见标注不重叠)+ DR11-16(同侧扇出对齐)。
- `bin/plexus.mjs` — the entry point (`layout` / `twin` / `calibrate` / `deliver` / `judge` / `repair` / `qc` / `audit`).

## Design language (generic, measurable)

- `docs/schematic-design-rules.md` — DR1–DR18 measurable gates.
- `docs/schematic_design_rulebook.md` — the project-agnostic design language (object/connectivity,
  layout topology, wiring strategy, geometry gates, role-based circuit archetypes, verification flow).
- `docs/pcb-design-rules.md` — generic PCB placement/manufacturing/routing gates, including the
  measured 0.5 mm exception for aligned same-cell passive arrays and the 1.0 mm general clearance.

## Required external skill

Install and start the official EasyEDA API Skill first: <https://github.com/easyeda/easyeda-api-skill>.
It provides the WebSocket bridge + the EasyEDA-side extension. The bridge exposes
`http://127.0.0.1:49620/execute` (ports `49620-49629`). Open **any** schematic in EasyEDA Pro.
For a clean-machine installation, Bridge setup, project-private evidence bootstrap, and the supported user paths,
follow `docs/getting-started.md` (Chinese) or `docs/getting-started.en.md` (English). Run `npm run doctor`
before diagnosing workflow failures; it distinguishes dependency, API-skill, Bridge, and EasyEDA-window faults.

## Usage

```bash
npm ci
npm run doctor:offline
node wf.mjs lint                              # live read-only root-cause queue; no screenshot
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

## Delivery Discipline (added 2026-09-09, from a real two-round failure on a 95-part SAS board)

Non-negotiable delivery gates. Violating any of these produced a board the user judged
"worse than before" after two full-sheet delivers:

1. **Never deliver a red gate.** If `reportGates` shows any nonzero finding (or
   `faith.unsafe > 0`), deliver is blocked. Fix the engine first; there is no "deliver
   anyway and clean up later".
2. **Backup page before first write.** Copy the schematic page (copySchematicPage) before
   any deliver/repair that moves parts. The backup page is deleted only after the user
   accepts the final layout.
3. **Module-incremental deliver.** Deliver ONE module first (smallest cluster), then run
   complete source/netlist coverage + deterministic geometry tokens + EasyEDA DRC.
   Only after those checks are green, deliver the next module. Full-sheet single-shot
   deliver is forbidden for boards > 1 cluster. Capture the canvas once, after every
   deterministic check has converged, for the residual final visual review.
4. **Treat `getCurrentRenderedAreaImage` as unreliable after document reload**: deliver's
   close+open reload freezes it to a stale frame (same md5 every capture). After reload,
   re-verify the final residual visual review via a fresh extension connection or ask
   the user before trusting any screenshot. Screenshots never replace coordinate gates.
5. **Engine self-inconsistency check at entry**: before running plexus on a live board,
   assert the engine's own mechanisms satisfy the rulebook (e.g. cross-module netport
   usage vs DR17). A tool that violates its own DR rules must be fixed before it touches
   a user's board.
6. **Use complete live geometry only.** A live quality decision must include document-source
   wire `NET` labels and prove label-count coverage. Missing source, missing visible attributes,
   or incomplete enrichment is a failed gate, never an empty passing population.
7. **Annotation completeness is universal.** Every fitted part must visibly show its designator
   and human-readable value/model before delivery; apply this to every new project without waiting
   for a user reminder.
8. **Preserve verified passive packages.** Size R/C/L packages from electrical and assembly
   constraints, then require the project's small no-outline-silkscreen variant. Inspect actual
   footprint primitives before replacement; never infer compliance from `R0603`/`C0603` names alone.
9. **Plan subcells as well as modules.** Before moving parts, declare interface/protection/driver/
   output cell boxes and their direct relationships. Run `T-CELL-SPACING`; a green module-level gap
   does not excuse crowded unrelated cells inside one module.
10. **Align same-side endpoints.** Run `T-FLAG-ALIGN` on complete live geometry. Power, ground and
    signal endpoint groups connected to pins on the same side of a component each share one visual axis;
    every reported object is fixed before delivery, then overlap and wire gates run again.
11. **Point labels toward the circuit (user ruling 2026-09-15, June hand-edited samples).** A label
    on the left of its circuit uses `LEFT_BOTTOM` (`alignMode=6`, anchor = outer left-bottom corner,
    text expands right toward the circuit, label above its stub); a label on the right uses
    `RIGHT_BOTTOM` (`alignMode=8`, anchor = outer right-bottom corner, text expands left toward the
    circuit). Same-side labels column-align on outer edges. Derive the side from the horizontal
    free-end wire geometry, never from the label's current mode. `T-LABEL-ALIGN` and `T-NOTHRU-TEXT`
    must both pass on complete live geometry.
12. **Declare module geometry before moving parts.** Every non-trivial layout must
   provide allocated module boxes and actual content boxes. Block delivery when
   component-body clearance, module gap, module inner padding, nearest-peer
   distance, repeated-channel alignment, or title-block keepout is unknown or
   outside the executable design-token limits.
13. **Fail closed on token-judge coverage.** Every entry in `design_tokens.mjs` must
   produce exactly one judge result. Missing, duplicate, or unknown results block
   acceptance. A complete token report still requires fresh native DRC and a fresh
   canvas capture that the agent actually inspects after the final edit.
14. **Use gates as a compiler, not as a search oracle.** Build candidates from typed,
   role-based primitives that satisfy the rules by construction. One check returns the
   complete defect set; fix that set as a functional batch. Repeated one-coordinate
   guesses against the live document are a workflow failure.
15. **Treat flag typography as geometry.** Exactly one attribute visibly renders a
   supply name. Side-facing supply names remain horizontal and their rendered bbox is
   centered on the terminal axis within one coordinate unit. Vertical flags put the
   name on the outward side. Read rendered bboxes; attribute intent alone is insufficient.
16. **Give connector-side buses a real escape corridor.** A shared bus parallel to a
   multi-pin symbol stays at least 10 coordinate units outside the pin column. Move the
   complete same-side endpoint column together so `T-FLAG-ALIGN` remains green. Any
   wire contact with a pin in built-in NoConnected state is a hard failure.
17. **A rollback mismatch invalidates the working state.** Immediately reread the live
   document source, diff it against the rollback target, and repair the exact residual
   before any further candidate. Never reuse the pre-rollback model or receipt.
18. **Inspect a fresh visual matrix after convergence.** Capture the full sheet and each
   edited functional cell or critical connector corridor. Verify distinct region hashes
   after reload and inspect every image. One full-sheet thumbnail cannot prove local
   typography, pin escape, or overlap quality.
19. **A PCB footprint exists only when the deliverable PCB contains it.** A schematic
   footprint name, UUID, or external library source is insufficient. After synchronization,
   read the live PCB and prove one component per fitted schematic designator, at least one
   real pad per footprint, complete symbol-pin-to-pad coverage, and exact connected-pad net
   agreement. Stale or unrelated PCB components are blocking findings.
20. **Keep bridge mutations shorter than the bridge request deadline.** Split catalog
   placement and other variable-latency work into bounded sequential requests with a source
   backup and exact rollback readback. Never send one long mutation that can continue running
   after the HTTP caller has timed out. After a cold application restart, open missing tabs
   with `openDocument`; `activateDocument` only switches tabs that already exist.
21. **A branch terminates at its shared bus.** A perpendicular wire from a symbol pin ends
   exactly on the parallel same-net spine. Any extension past the spine creates a hook or
   foldback and is a hard `T-NOTHRU` failure, even when native electrical DRC is green.
22. **A pin escape always points away from the symbol body.** The first schematic wire segment
   at an external pin terminal follows the pin's outward axis. A segment that heads toward the
   body or turns perpendicular at the terminal is a hard `T-NOTHRU` foldback failure.
23. **Verify connector footprints from the bound live library object.** A caller-supplied
   `.elibu`, matching UUID string, or schematic `Footprint` attribute is supporting intent only.
   Every live schematic check resolves the library namespace in deterministic order (explicit
   evidence library, current project library, then system library), downloads the footprint,
   records the namespace that succeeded, extracts its source, and checks its real pads and pin
   mapping. An unavailable or empty bound object is one blocking root-cause finding; do not emit
   a per-pin cascade from missing source.
24. **Preserve only proven EasyEDA source omissions in the candidate twin.** EasyEDA may expose
   resolved library metadata in live geometry while leaving a null source placeholder. The twin
   may inherit an explicit allowlist of such metadata only when the baseline and candidate have
   the same Symbol/Device identity and the source placeholder is unchanged. It must never
   resurrect an attribute intentionally removed by a transform.
25. **Converge safe rollback residue automatically.** When the first rollback readback differs,
   a second cleanup pass may remove only unexpected, hidden `3D Model`, `3D Model Title`, and
   `3D Model Transform` cache attributes whose parent existed in the rollback target. Reopen and
   require an exact second readback. Any visible, electrical, binding, missing, or changed record
   remains a hard rollback failure.
26. **Bind private token evidence to the document once.** The first `wf lint` for a document takes
   an explicit `EASYEDA_TOKEN_EVIDENCE` path and writes that external path into both the document-bound
   receipt and workflow context. Later `wf lint/audit/commit/seed/api/pcb-sync` calls recover it only
   when the active document UUID, receipt, and context agree; they still reread and rehash the file.
   A new document, missing record, or disagreement fails closed and requires one explicit path.
27. **Turn visual-review corrections into named tokens.** Signal-label crowding, per-part annotation
   side consistency, and unassigned parts are deterministic geometry failures. `T-LABEL-CROWD`,
   `T-ANNOT-SIDE`, and `T-ORPHAN` must each return object-level evidence and participate in candidate
   and live token coverage. Aggregate percentages or a thrown evidence-construction error may not hide
   an individual violation.
