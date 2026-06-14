# Schematic Design Rules

This file is the executable drawing rulebook for EasyEDA Harness. Agents must treat these requirements as delivery gates, not visual preferences or prompt guidance.

## Rule Contract

| ID | Requirement | Contract Source | Gate Evidence |
| --- | --- | --- | --- |
| DR1 | Wires must be orthogonal. Diagonal wire segments are forbidden. | deterministic cell output and writer output | `contract:geometry` / `contract:geometry:live` rule `PG1-wire-orthogonal` |
| DR2 | Different-net wires and unnamed wires must not cross or touch mid-segment. | deterministic routing and `layoutPolicy.interfaceRoutes` | `contract:geometry` / `contract:geometry:live` rule `PG3-wire-crossing` |
| DR3 | Wires must not pass through component bodies, symbols, visible text, net labels, GND flags, or NC markers. | component geometry plus cell routing | `contract:geometry` / `contract:geometry:live` rule `PG4-wire-through-visible-object` |
| DR4 | Text, component attributes, net names, GND symbols, NC markers, and other visible objects must not overlap. | text/attribute/flag geometry | `contract:geometry` / `contract:geometry:live` rule `PG5-visible-object-overlap` |
| DR5 | Text, net labels, flags, and attributes must not overlap component bodies. | component body bbox and visible object bbox | `contract:geometry` / `contract:geometry:live` rule `PG6-visible-object-over-component` |
| DR6 | Each functional module must occupy its own compact module rectangle; planned rectangles must keep the declared minimum gap, must not interlock, and the generated module bbox must stay inside its planned rectangle. | `project_contract.json` modules plus `project_assembly.json` anchors, `layoutPolicy.moduleRegions`, and `layout_planner_structure.json` module bboxes | `gsd:plan` rules `GP47-module-regions-declared`, `GP57-module-region-gap`; `contract:layout` rules `PL44-module-region-gap`, `PL45-module-region-actual-present`, `PL46-module-region-contains-actual`; `pipeline`, page-composition checks |
| DR7 | Cross-module interfaces must follow `layoutPolicy.flow`, ordered `layoutPolicy.columns`, and declared `layoutPolicy.interfaceRoutes`. | `project_assembly.json` | `contract:layout` |
| DR8 | Every visible signal label must be budgeted in `layoutPolicy.labelColumns`; scattered labels are forbidden. | `project_assembly.json` | `contract:labels` / `contract:labels:live` rules `LL1-label-columns-declared`, `LL14-label-column-match`, `LL16-unbudgeted-visible-label` |
| DR8A | Every grouped-net-label interface must declare source and target module-side label columns before generation. | `layoutPolicy.interfaceRoutes` and `layoutPolicy.labelColumns` | `gsd:plan` rules `GP44-label-column-covers-route-from`, `GP45-label-column-covers-route-to`; `contract:layout` rules `PL31-label-column-covers-route-from`, `PL32-label-column-covers-route-to` |
| DR9 | Single-sheet net labels must be real EasyEDA wire `Name` attributes or generated model signal netflags; fake `PrimitiveText` net labels are forbidden. | writer output and live snapshot | `contract:labels` / `contract:labels:live` rule `LL7-no-fake-text-net-labels` |
| DR10 | A visible signal label origin must land on a same-net wire endpoint. Floating labels and mid-wire labels are forbidden. | label geometry and wire endpoints | `contract:labels` / `contract:labels:live` endpoint checks |
| DR11 | Left-side fanout labels must use EasyEDA `alignMode=6`, with the exported origin at the left-bottom text bbox corner. | `layoutPolicy.labelColumns.side=left` and label attrs | `contract:labels` / `contract:labels:live` rules `LL9-label-origin-mode`, `LL11-label-origin-corner` |
| DR12 | Right-side fanout labels must use EasyEDA `alignMode=8`, with the exported origin at the right-bottom text bbox corner. | `layoutPolicy.labelColumns.side=right` and label attrs | `contract:labels` / `contract:labels:live` rules `LL9-label-origin-mode`, `LL11-label-origin-corner` |
| DR13 | Same-side labels for a module or interface group must share the declared label-column `x` within tolerance. | `layoutPolicy.labelColumns[].x` and `tolerance` | `contract:labels` / `contract:labels:live` rule `LL14-label-column-match` |
| DR14 | A net may not display more visible labels than its declared label-column budget. Internal nets without budget must stay hidden. | `layoutPolicy.labelColumns[].nets` | `contract:labels` / `contract:labels:live` budget checks |
| DR15 | Single-sheet schematics must not use unnecessary NET PORT symbols. | `project_contract.json.qualityPolicy` and generated/live netflag objects | `contract` rule `PC25-no-net-port-default`; `contract:labels` / `contract:labels:live` rule `LL17-no-unnecessary-net-ports` |
| DR16 | Final handoff must prove EasyEDA DRC `0 error / 0 warning / 0 info`. | live EasyEDA project | `live-check`, `accept:live`, `deliver` |

## Layout Contract

Every project must explain its reading flow and module rectangles before generation:

- `layoutPolicy.flow` names the intended sheet reading order.
- `layoutPolicy.columns` places modules into ordered page columns.
- `layoutPolicy.moduleRegions` declares every module's minimum readable rectangle relative to its anchor, including module, anchor, column, dx/dy, width, height, and role.
- `contract:layout` compares those planned rectangles with actual `layout_planner_structure.json.modules[].box`; a PASS requires every generated module bbox to fit its planned region within tolerance.
- `layoutPolicy.interfaceRoutes` explains cross-module net ownership, direction, and route strategy.
- `layoutPolicy.labelColumns` explains every visible signal label column: role, module, routeEnd, side, x coordinate, tolerance, and allowed nets.
- `minModuleGap`, `minColumnGap`, `maxModuleWireIntrusions`, and `requireNoLaneInterlocks` turn module spacing and no-interlock requirements into measurable checks.

If a new project omits these fields, the correct fix is to update `project_assembly.json`, not to ask the agent to "make it look cleaner" in prose.

## Label Geometry

EasyEDA label placement is geometry-sensitive. The harness uses these hard rules:

- Left-side fanout labels: `side=left`, `alignMode=6`, origin equals the left-bottom bbox corner, and the origin coincides with the same-net wire endpoint.
- Right-side fanout labels: `side=right`, `alignMode=8`, origin equals the right-bottom bbox corner, and the origin coincides with the same-net wire endpoint.
- The label's visible bbox must not overlap wires from other nets, component bodies, GND flags, NC markers, or other visible labels.
- Labels that appear in `live.json` but are not explained by `layoutPolicy.labelColumns` are hard failures.
- Ordinary text such as `PrimitiveText("USB_DP")` is not a net label and must fail the label gate.
- EasyEDA NET PORT symbols are forbidden on single-sheet schematics unless the project contract explicitly opts out of `singleSheetNoNetPortsByDefault`; use wire `Name` attributes or generated signal netflags attached to wire endpoints instead.
- For grouped cross-module interfaces, the source module column should declare `module=<from>`, `routeEnd=from`, and a readable output side; the target module column should declare `module=<to>`, `routeEnd=to`, and a readable input side.

This rule exists because checking only the intended `alignMode` is not enough. The gate must audit actual EasyEDA exported geometry: netflag or wire `Name`, `textX`, `textY`, `alignMode`, bbox, and same-net wire endpoint.

## Geometry Audit

The geometry gate must audit actual generated and live objects, not only JSON intent:

- wire segment endpoints and orientation
- component and symbol bboxes
- visible text and attribute bboxes
- GND/NC/netflag bboxes
- EasyEDA wire `Name` attribute bboxes when available
- crossing points and overlap samples in the failure report

Failure reports must identify the rule id, net or object names, x/y coordinates, and sample bboxes so the next agent can make a deterministic edit without guessing.

## Evidence Chain

The following gates are responsible for this rulebook:

- `contract:layout`: module columns, spacing, no interlocks, and no unrelated wire intrusion.
- `contract:geometry`: generated-model wire crossings, wires through visible objects, and text/label/flag/attribute overlaps.
- `contract:geometry:live`: the same geometry audit on the real EasyEDA `live.json` snapshot.
- `contract:labels`: generated-model label columns, label origin geometry, endpoint attachment, fake text labels, and label budget.
- `contract:labels:live`: the same label audit on the real EasyEDA `live.json` snapshot.
- `pipeline`: local model geometry, crossings, text clearance, label clearance, and structured layout checks.
- `contract:visual`: offline visual evidence coverage.
- `live-check`: live model, live label geometry, live screenshots, and EasyEDA DRC `0 error / 0 warning / 0 info`.
- `deliver`: final live evidence gate; local-only PASS is not delivery evidence.

When a rule fails, agents must repair the deterministic source: `project_assembly.json`, the selected circuit pack, `cell_manifest.json`, label placement logic, geometry gate, or the gated writer. Manual EasyEDA edits are not accepted as the source of truth.
