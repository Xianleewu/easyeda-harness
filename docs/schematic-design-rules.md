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
| DR6 | Each functional module must occupy its own compact module rectangle; planned rectangles must keep the declared minimum gap, must not interlock, and the generated module bbox must stay inside its planned rectangle. | `project_contract.json` modules plus `project_assembly.json` anchors, `layoutPolicy.moduleRegions`, and `layout_planner_structure.json` module bboxes | `plexus:plan` rules `GP47-module-regions-declared`, `GP57-module-region-gap`; `contract:layout` rules `PL44-module-region-gap`, `PL45-module-region-actual-present`, `PL46-module-region-contains-actual`; `pipeline`, page-composition checks |
| DR7 | Cross-module interfaces must follow `layoutPolicy.flow`, ordered `layoutPolicy.columns`, and declared `layoutPolicy.interfaceRoutes`. | `project_assembly.json` | `contract:layout` |
| DR8 | Every visible signal label must be budgeted in `layoutPolicy.labelColumns`; scattered labels are forbidden. | `project_assembly.json` | `contract:labels` / `contract:labels:live` rules `LL1-label-columns-declared`, `LL14-label-column-match`, `LL16-unbudgeted-visible-label` |
| DR8A | Every grouped-net-label interface must declare source and target module-side label columns before generation. | `layoutPolicy.interfaceRoutes` and `layoutPolicy.labelColumns` | `plexus:plan` rules `GP44-label-column-covers-route-from`, `GP45-label-column-covers-route-to`; `contract:layout` rules `PL31-label-column-covers-route-from`, `PL32-label-column-covers-route-to` |
| DR9 | Single-sheet net labels must be real EasyEDA wire `Name` attributes or generated model signal netflags; fake `PrimitiveText` net labels are forbidden. | writer output and live snapshot | `contract:labels` / `contract:labels:live` rule `LL7-no-fake-text-net-labels` |
| DR10 | A visible signal label origin must land on a same-net wire endpoint. Floating labels and mid-wire labels are forbidden. | label geometry and wire endpoints | `contract:labels` / `contract:labels:live` endpoint checks |
| DR11 | Left-side fanout labels must use EasyEDA `alignMode=6` and export as `LEFT_BOTTOM` (user ruling 2026-09-15, June hand-edited samples): the anchor is the text's left-bottom outer corner, the label sits above its stub, the text expands right toward the circuit, and same-side labels column-align on their outer (left) edges. | `layoutPolicy.labelColumns.side=left` and label attrs | `contract:labels` / `contract:labels:live` rules `LL9-label-origin-mode`, `LL11-label-origin-corner`, `T-NOTHRU-TEXT` |
| DR12 | Right-side fanout labels must use EasyEDA `alignMode=8` and export as `RIGHT_BOTTOM` (user ruling 2026-09-15): the anchor is the text's right-bottom outer corner, the label sits above its stub, the text expands left toward the circuit, and same-side labels column-align on their outer (right) edges. | `layoutPolicy.labelColumns.side=right` and label attrs | `contract:labels` / `contract:labels:live` rules `LL9-label-origin-mode`, `LL11-label-origin-corner`, `T-NOTHRU-TEXT` |
| DR13 | Same-side labels for a module or interface group must share the declared label-column `x` within tolerance. | `layoutPolicy.labelColumns[].x` and `tolerance` | `contract:labels` / `contract:labels:live` rule `LL14-label-column-match` |
| DR14 | Every label column must declare `module` and `routeEnd`, so visible labels are explained as a module-side interface, not a free-floating sheet decoration. | `layoutPolicy.labelColumns[].module` and `routeEnd` | `contract:labels` / `contract:labels:live` rules `LL18-label-column-module`, `LL19-label-column-route-end` |
| DR15 | A net may not display more visible labels than its declared label-column budget, and every declared column/net budget must be realized by an actual visible label on a same-net endpoint. Internal nets without budget must stay hidden. | `layoutPolicy.labelColumns[].nets` | `contract:labels` / `contract:labels:live` rules `LL15-label-endpoint-budget`, `LL16-unbudgeted-visible-label`, `LL22-label-column-realized` |
| DR16 | Labels in one declared column must keep readable row pitch; visually merged label stacks are forbidden. | `layoutPolicy.minLabelRowPitch` or default gate budget | `contract:labels` / `contract:labels:live` rule `LL21-label-column-row-pitch` |
| DR17 | Single-sheet schematics must not use unnecessary NET PORT symbols. | `project_contract.json.qualityPolicy` and generated/live netflag objects | `contract` rule `PC25-no-net-port-default`; `contract:labels` / `contract:labels:live` rule `LL17-no-unnecessary-net-ports` |
| DR18 | Final handoff must prove EasyEDA DRC `0 error / 0 warning / 0 info`. | live EasyEDA project | `live-check`, `accept:live`, `deliver` |
| DR19 | All circuit content must remain inside the usable sheet area and outside the title/information block and its clearance. Missing sheet or title-block bounds block layout delivery. Declared bounds must agree with the live sheet bbox, and the title-block keepout must contain every measured visible sheet-metadata bbox; an inverted or swapped coordinate axis is a hard failure. Divide the actual usable shape into a 4×3 grid and report each cell's available area, occupied area, density and weight. On a spacious sheet with at least two modules and occupied-area ratio at most 55%, the area-weighted content centroid must remain within 8% of each usable-page dimension from the usable-shape centroid; report a grid-snapped corrective shift otherwise. | actual sheet template, live sheet component/attributes, `layoutPolicy.sheetBounds`, `layoutPolicy.titleBlockKeepout`, measured module `contentBox` geometry | `T-PAGE`, candidate and complete live page-boundary/balance checks, full-sheet screenshot |
| DR20 | Net flag symbols must match electrical net roles. Signal nets must never use power or ground symbols, even if their names preserve connectivity; ground and supply nets must never be represented by ordinary signal `NET` labels. Every net flag anchor must coincide with a real wire endpoint or component pin; merely drawing it over a segment interior is electrically floating in EasyEDA. | inferred roles or explicit project net roles; actual symbol bindings and endpoint geometry | `build_source` role gate, `T-FLAG-ALIGN`, live symbol-role readback, native DRC |
| DR21 | Functional-module content boxes must keep at least 60 coordinate units from each other. Every module must have a nearest peer within 180 units unless the project declares an external-interface corridor. The module frame must leave at least 8 units of inner padding around all visible module content. | `layoutPolicy.moduleRegions[].contentBox`, declared exceptions, and generated/live module evidence | `T-MODULE-SPACING`, `contract:layout`, prelayout and live readback |
| DR22 | Unrelated component bodies must keep at least 10 coordinate units of clearance. Parts may be closer only when a verified package/symbol constraint explicitly records the exception; available sheet space is never a reason to crowd a local cell. | component bboxes plus declared placement exceptions | `T-BODY-CLEARANCE`, prelayout and live geometry readback |
| DR23 | Every assembly component must visibly show its designator and a human-readable value or model. R/C/L parts require their electrical value; internal IDs, hidden attributes, unresolved formulas, or supplier codes alone do not count. Completeness is 100%. | live visible attribute bboxes plus resolved component attributes | `T-ANNOT-FULL`, candidate and live geometry readback |
| DR24 | Connector shield and mechanical solder tabs must be explicitly classified. Conductive mounting tabs join the declared protective/chassis/circuit ground unless the project records a verified isolation reason; they must not be left NC by accident. Pin-to-footprint numbering must be checked before connection. Same-side mechanical tabs form one local shield cell: short orthogonal taps join one shared bus and exactly one ground symbol. A vertical side group terminates in one visually downward ground symbol below the group; in live EasyEDA geometry its flag Y is smaller than every pin Y and Ground rotation is `0`. Repeated per-pin ground flags are forbidden. A flag directly over a connector pin is also forbidden because it is an unconnected endpoint overlap. | symbol pins, footprint pad numbers, connector datasheet or verified library metadata, drawable wire connectivity and flag count | `T-CONN-MOUNT`, native DRC, authoritative netlist readback, PCB continuity review |
| DR25 | Audit every placed resistor and capacitor reference individually. Package size must follow electrical stress, derating and assembly capability. For ordinary Small 0402/0603 passives, require exactly two SMD pads, a bounded copper envelope, and no top-silkscreen primitive outside that envelope. A footprint name is insufficient evidence; shared device/footprint bindings still yield one result row per reference. Value, voltage, current/power and regulator-stability evidence is mandatory per reference; missing evidence or REVIEW remains open. Any supplier warning caused by a footprint-only override requires per-placement proof that device, symbol, supplier/manufacturer identity stayed unchanged, the exact before/after footprint UUID pair, and passing mechanical evidence for that replacement; a warning count or shared-device spot check is insufficient. | resolved device association, exported footprint source, actual pad/silkscreen geometry, per-reference electrical review, per-placement supplier binding audit | `T-PASSIVE`, `passive_footprint_audit`, `supplier_binding_audit`, candidate and live package preflight, native DRC after each changed device family |
| DR26 | A module must declare internal functional cells before placement (for example interface, protection, conversion/driver and output roles). Functional-cell content boxes never overlap. They keep at least 40 coordinate units when directly related and at least 60 when not directly related. Membership in one module, a shared ground, or a shared supply does not establish a direct relationship. Generated layouts reserve 10 additional coordinate units for grid snapping. An explicit verified `compactWith` relation may reduce the positive gap for parts that must be physically adjacent, but it never permits overlapping content boxes or interleaved cells whose rectangular extents cover one another. | `layoutPolicy.cellRegions[]`, `relatedTo`, `compactWith`, connectivity-derived signal graph | `T-CELL-SPACING`, prelayout contract and live readback |
| DR27 | Same-class network endpoints attached to different pins on the same side of one component must share the side's visual axis within 5 coordinate units: top/bottom endpoints share `y`, left/right endpoints share `x`. Apply the rule independently to power symbols, ground symbols and signal labels. Adequate symbol spacing and short orthogonal local stubs are required; alignment must not create overlap. | local wire connectivity, component pin/bbox geometry, actual netflag/NET-label anchors | `T-FLAG-ALIGN` plus `T-NOOVERLAP`, candidate and complete live geometry readback |
| DR28 | Every electrical connector must have a project-private, source-cited pin profile covering 100% of its pins. Each row records the physical pin, visible symbol pin name, source-table signal name, authoritative net, and connected/NoConnected state; a physical label such as `A1`/`B19` alone is not semantic evidence. Its projected footprint source must contain real pads, meet the declared pad count, cover every symbol pin through an explicit identity/mapping table, and have no unexplained extra pad. Root-side versus endpoint-side conventions, cable crossovers, and symbol-to-footprint numbering are explicit profile data. A separate source-cited topology review must cover every connector and encode each protocol-required relationship as `same-net`, `different-net`, `not-same-net`, or `through-component`; `not-same-net` permits an endpoint whose pin profile explicitly declares NC while still rejecting a direct short. These relations catch a legal-looking but electrically wrong direct short, omitted strap, or bypassed series element that per-pin checks and native DRC cannot detect. Missing review evidence or one mismatch blocks delivery even when DRC is green. | complete live component pins, authoritative netlist, project-private connector pin and topology profiles, parsed footprint source and cited interface/connector source | `T-PIN-SEMANTICS`, native DRC, symbol/device/footprint identity readback |
| DR29 | Every differential net pair must be covered by a source-cited high-speed profile. The profile declares protocol, target differential impedance, maximum intra-pair skew, positive/negative nets, and the complete endpoint-pin set for both polarities. Every endpoint is cross-checked against DR28's source-table signal and polarity, so a self-consistent but wrong physical-pin map fails. The authoritative netlist must contain exactly those endpoints; added, missing, swapped, or uncovered pairs block delivery. PCB-stage impedance geometry, reference-plane continuity, pair spacing, length matching and via limits remain mandatory downstream evidence. | authoritative netlist, project-private high-speed profile, connector source-table semantics, interface specification, PCB rule/readback evidence | `T-HIGHSPEED`, PCB constraint audit and post-route DRC |
| DR30 | A built-in NoConnected state and a drawable wire are mutually exclusive at the same pin coordinate. The gate checks segment interiors and endpoints; a wire ending exactly on an NC pin is still a hard failure. | complete component-pin state plus drawable wire geometry | `T-NOTHRU`, candidate and complete live geometry readback |
| DR31 | A shared same-net bus beside a multi-pin symbol must remain outside the pin column with at least 10 coordinate units of drawable escape before the first parallel bus segment. Every perpendicular branch terminates at that spine; extending past it to leave a hook/overrun is forbidden. The bus also clears visible pin-number/name typography. Same-side endpoint alignment remains mandatory, so an entire endpoint column moves together. | component pin coordinates, connected wire roots, visible pin-label bboxes and netflag anchors | `T-NOTHRU` plus `T-FLAG-ALIGN`, candidate and complete live geometry readback |
| DR32 | A side-facing supply flag keeps its visible name horizontal and vertically centered on the symbol terminal/stub axis within 1 coordinate unit. An upward or downward flag places the name on the outward side. Exactly one flag attribute renders the supply name. | live flag rotation, terminal coordinate, rendered name bbox and source attributes | `T-FLAG-ORIENT`, `T-NOTHRU-TEXT`, source assertion A6f |
| DR33 | A wire attached to a symbol pin must leave along that pin's outward axis. Its first segment may not run toward the component body or turn perpendicular at the pin terminal; both forms are visible foldback and fail even when electrical DRC is green. | live component bbox, pin terminal, incident wire segment | `T-NOTHRU` rule `pin-escape-inward` |
| DR34 | Every visible component annotation is a keepout even for that component's own connected wire. A designator or value crossed by its own pin route is a hard failure. | visible attribute bbox and complete drawable wire geometry | `T-NOTHRU-TEXT`, candidate and complete live geometry readback |
| DR35 | Signal-label text boxes must not overlap, must keep at least 2 coordinate units of visible separation in a shared column, and must not be crossed by any wire. | complete signal-label bboxes, anchors and drawable wire geometry | `T-LABEL-CROWD`, candidate and complete live geometry readback |
| DR36 | Each fitted component's visible designator and visible value/model must share at least one outside side of the component body. Corner placement may satisfy both adjacent sides; opposite-side placement is a per-component hard failure. | component bbox plus rendered designator and value/model bboxes | `T-ANNOT-SIDE`, candidate and complete live geometry readback |
| DR37 | Every fitted component belongs to exactly one declared module and exactly one declared functional cell. Missing, duplicate, or unknown membership is reported per designator. | complete component census plus module/cell membership | `T-ORPHAN`, candidate and complete live geometry readback |

The token judge must also prove registry coverage before it may pass: every token in
`design_tokens.mjs` has exactly one result, with no missing, duplicate, or unknown
checks. Every repair batch requires complete token coverage, all tier-1/tier-2
results, and fresh native DRC. After those deterministic checks converge, final
delivery additionally requires one visually inspected fresh full-sheet canvas for
the residual tier-3 judgment. Unknown evidence blocks delivery.

## Electrical Symbol Semantics (DR20)

Classify each net before choosing its symbol: ground, supply, or signal. Unknown
names default to signal; unconventional supply names require an explicit project
role. A ground symbol is only valid for a ground net, and a power symbol only for
a supply net. Signal nets use real wire labels at same-net endpoints.

Layout fallbacks must retain the component's electrical role. A pull-up or other
signal-connected passive must not enter a decoupling template that grounds one
end. The source writer must reject role mismatches before producing a candidate.
After writing, inspect actual symbol bindings and net names, then run connectivity,
geometry, DRC, and visual checks. DRC alone cannot prove symbol semantics.

## Sheet Boundary and Title Block Keepout (DR19)

The title/information block, usually at the lower right, is reserved exclusively
for drawing metadata. It is not available circuit area, including its blank cells.
Components, pins, wires, net labels, power/ground flags, NC markers, module frames,
and circuit annotations must not enter it. Keep at least 10 schematic coordinate
units of clearance from the information block and the inner sheet border.

Before any layout write, obtain the actual template bounds and reserve the whole
information block, not only its visible text. Unknown bounds must fail the delivery
preflight. Do not infer a vacant area from an empty cell or a screenshot crop.
Changing paper size requires refreshing both the border and the metadata positions,
then reading back and verifying their geometry again.

If the existing drawing already occupies the information block, relocate those
modules first. Check the complete candidate and the complete live sheet, including
decorative objects; module-only checks do not prove DR19. A full-sheet screenshot
must show the border, an unobstructed information block, and all circuit content.

## Layout Contract

Every project must explain its reading flow and module rectangles before generation:

- `layoutPolicy.flow` names the intended sheet reading order.
- `layoutPolicy.columns` places modules into ordered page columns.
- `layoutPolicy.moduleRegions` declares every module's minimum readable rectangle relative to its anchor, including module, anchor, column, dx/dy, width, height, and role.
- `contract:layout` compares those planned rectangles with actual `layout_planner_structure.json.modules[].box`; a PASS requires every generated module bbox to fit its planned region within tolerance.
- `layoutPolicy.interfaceRoutes` explains cross-module net ownership, direction, and route strategy.
- `layoutPolicy.labelColumns` explains every visible signal label column: role, module, routeEnd, side, x coordinate, tolerance, and allowed nets.
- `minModuleGap`, `minColumnGap`, `maxModuleWireIntrusions`, and `requireNoLaneInterlocks` turn module spacing and no-interlock requirements into measurable checks.
- Harness defaults are `minModuleGap=60`, `maxNearestModuleGap=180`, `minModuleInnerPadding=8`, and `minComponentBodyGap=10`. A project may increase them. Reducing them requires a named, geometry-specific exception rather than a global threshold change.
- A module region carries both `box` (the frame/allocated region) and `contentBox` (the union of its local components, wires, labels, flags, and NC markers). A wire graph touching two modules belongs to a separately declared interface corridor rather than either content box. Spacing is measured between content boxes; inner padding is measured from `contentBox` to `box`.
- Global nearest-neighbor density is diagnostic only. It must never hide a crowded cell inside a mostly empty sheet; DR21 and DR22 are checked independently before delivery.

If a new project omits these fields, the correct fix is to update `project_assembly.json`, not to ask the agent to "make it look cleaner" in prose.

## Label Geometry

EasyEDA label placement is geometry-sensitive. The harness uses these hard rules:

- Left-side fanout labels: `side=left`, `alignMode=6`, EasyEDA `LEFT_BOTTOM`; the origin equals the left-bottom bbox corner (outer edge), the label sits above its stub, and the text expands right toward the circuit; same-side labels column-align on outer edges.
- Right-side fanout labels: `side=right`, `alignMode=8`, EasyEDA `RIGHT_BOTTOM`; the origin equals the right-bottom bbox corner (outer edge), the label sits above its stub, and the text expands left toward the circuit; same-side labels column-align on outer edges.
- The label origin is chosen from the actual free-end geometry, never inferred from the label's existing `alignMode`.
- Every visible label must match one declared `layoutPolicy.labelColumns` entry by net, side, x tolerance, module, and routeEnd.
- Every declared column/net budget must have a matching visible label in the generated model and live snapshot; otherwise the contract is lying about the readable interface.
- Columns without `module` and `routeEnd` are invalid because they do not explain the interface side that owns the label.
- Labels in one column must keep readable row pitch; if they visually merge, the fix is to move the deterministic fanout rows or split the interface column, not to add floating labels.
- The label's visible bbox must not overlap wires from other nets, component bodies, GND flags, NC markers, or other visible labels.
- Labels that appear in `live.json` but are not explained by `layoutPolicy.labelColumns` are hard failures.
- Ordinary text such as `PrimitiveText("USB_DP")` is not a net label and must fail the label gate.
- EasyEDA NET PORT symbols are forbidden on single-sheet schematics unless the project contract explicitly opts out of `singleSheetNoNetPortsByDefault`; use wire `Name` attributes or generated signal netflags attached to wire endpoints instead.
- For grouped cross-module interfaces, the source module column declares `module=<from>` and `routeEnd=from`; the target module column declares `module=<to>` and `routeEnd=to`. If the physical symbol pins make the readable label side different from the default source-right/target-left convention, declare `fromSide` and `toSide` on the `layoutPolicy.interfaceRoutes` entry and make the columns match those sides.

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
