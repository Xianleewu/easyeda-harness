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

## Must-Read Files

- `AGENTS.md`: primary operating contract for agents.
- `docs/agent-runner-guide.md`: neutral runner workflow.
- `docs/schematic-design-rules.md`: drawing and geometry rulebook.
- `workflows/design_brief.mjs`: strict short-cycle review artifact.
- `workflows/gsd_generate.mjs`: generation entrypoint; must stay fail-closed on plan and design brief.
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

1. Strengthen generic cell helpers.
   Add reusable helpers for module rectangles, pin fanout rows, label-column attachment, GND/NC clearance, component attribute placement, and no-crossing local route templates. New packs should use helpers instead of hand-placing labels and wires.

2. Improve label failure reports.
   Every label finding should identify net, module, routeEnd, expected side, expected align/origin corner, actual `x/y/textX/textY/alignMode`, bbox, nearest same-net endpoint, and owning source file.

3. Improve geometry failure reports.
   Every overlap/crossing finding should include object ids, object kinds, nets, bboxes, sample point, owning module if known, and suggested contract or cell file to inspect.

4. Add a new-project fixture.
   Create a small non-AIHWDEBUGER sample circuit pack and smoke test it. This is the best way to prove the workflow is not only a regression harness for one schematic.

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
node bin/easyeda-gsd.mjs live-check
node bin/easyeda-gsd.mjs deliver
```

Only write back with:

```powershell
node bin/easyeda-gsd.mjs apply --gated project_spec.json
```

## Handoff Standard

A good next-session result should not merely add another document. It should add one or more executable constraints, reusable generation helpers, or negative tests that prevent known bad behavior from returning.

The most valuable proof is a failing fixture that used to pass, plus a gate/helper change that makes the failure actionable and keeps `workflow:smoke` and `accept` passing.
