# EasyEDA Schematic Design Rulebook (General)

This is the **project-agnostic design language** for every schematic the harness
produces or optimizes. It defines *what a commercial-grade EasyEDA schematic
looks like and how it connects* — the aesthetic and connectivity grammar — for
**any** board, independent of a specific project, reference design, component,
or net.

It is the prose layer. Each principle here is enforced by a measurable gate in
[`schematic-design-rules.md`](schematic-design-rules.md) (DR1–DR18). When a
principle and a gate disagree, fix the gap; principles state intent, gates state
the pass/fail. Project-specific history (concrete failures, component bindings,
harness file/gate names) lives in [`project-field-notes.md`](project-field-notes.md)
and is **not** part of this language.

Use it two ways: as the **target** the generator/optimizer designs toward, and
as the **review grammar** for judging any existing schematic.

---

## 0. Operating Policy

1. **Plan before routing.** Never reach a layout by iterative collision repair.
   First produce a prelayout plan that names each functional block, its
   placement, keepout, pin-escape direction, and reserved routing corridor.
2. **Candidate before commit.** Generate an offline candidate-geometry model and
   pass the prelayout planner gate plus the local geometry checker *before*
   touching a live schematic.
3. **Readback proves it.** After applying changes, export the actual EasyEDA
   readback geometry and re-verify. Candidate success alone is never proof.
4. **Reference projects are read-only.** When a user opens a project as a
   reference, never create, modify, delete, move, save, or clean it up unless
   explicitly asked to edit *that* project.
5. **Reserve the sheet information block before placing parts (DR19).** The
   entire title block, including empty cells, belongs to drawing metadata.
   Read its actual bounds, reserve a clearance of at least 10 coordinate units,
   and prohibit all circuit content and module decoration there. The declared
   sheet bbox must match the live sheet primitive, and every visible metadata
   attribute bbox must be contained by the declared keepout; this prevents an
   inverted coordinate axis from producing a false pass. Unknown bounds block
   delivery. Relocate existing violations first. After changing paper size,
   recheck the border, metadata positions and the complete sheet screenshot.
6. **Make every fitted part identifiable (DR23).** Show both the designator and
   the value/model on the schematic. Resolve bound attributes and measure their
   rendered boxes; a hidden field or an internal supplier ID is not visible evidence.
   The two visible annotations share at least one outside side of the component
   body; corner placements may share either adjacent side, while opposite-side
   placement fails per component.
7. **Classify connector mounting metal (DR24).** Verify symbol pin numbers against
   footprint pads before joining conductive shield or mounting tabs to the chosen
   ground domain. Same-side mechanical pins use short orthogonal taps into one
   shared bus and exactly one ground symbol; a vertical side group ends in one
   visually downward ground symbol below the group. In live EasyEDA geometry this
   means the flag Y is smaller than every pin Y and Ground rotation is `0`.
   Never draw a comb of repeated per-pin
   ground flags. Direct pin-on-flag overlap is not a connection in EasyEDA. An
   intentional isolated tab needs an explicit recorded exception.
   Every power, ground, and signal net flag elsewhere on the sheet must likewise
   land on a real wire endpoint or directly on a component pin. Touching the
   interior of a drawn segment is not an electrical connection in EasyEDA.
8. **Audit small passive packages (DR25).** Select 0402/0603 size from voltage,
   capacitance derating, current, power and assembly limits. Inspect the exported
   footprint source and reject an enclosing silkscreen outline; names are hints,
   not proof. Produce one evidence row for every placed reference even when several
   parts share one device or footprint. Record the actual pad envelope, top-silk
   result, value/rating decision and preservation of symbol/device/value. Missing
   source or electrical evidence fails closed, and a REVIEW item remains open.
   When an intentional footprint-only override triggers a supplier-property
   warning, audit every placed reference again: device, symbol, supplier identity
   and manufacturer part must remain unchanged; record the exact catalog and
   replacement footprint UUIDs and attach passing mechanical evidence for that
   replacement. A shared-device sample or unchanged warning count is not evidence.
9. **Declare functional cells inside modules (DR26).** Give interface, protection,
   driver/conversion and output cells separate content boxes. Record direct peers
   and compact dependencies before placement. Sharing a module, ground, or supply
   rail does not make two cells direct peers; direct relations come from their
   functional signal path. Free sheet space should expand cells instead of forcing
   unrelated roles together.
10. **Align same-side electrical endpoints (DR27).** For one component or connector,
    endpoints of each visual class on the same side share one axis: compare power,
    ground and signal groups independently. Use
    short local orthogonal stubs when pin pitch would otherwise force staggered
    symbols, and re-run overlap checks after alignment.
11. **Prove connector semantics (DR28).** Every connector uses a private, cited
    pin profile with complete pin coverage. Compare the live physical pin number,
    symbol pin name, authoritative net, and connected/NoConnected state. A green
    connectivity DRC cannot substitute for endpoint/root-side or cable-crossover
    semantics. Add a source-cited topology review covering every connector and
    encode required straps, isolation and intervening parts as `same-net`,
    `different-net`, `not-same-net` or `through-component`; use `not-same-net`
    when one endpoint may be explicitly NC. DRC-clean topology mistakes must fail
    before the first write.
12. **Prove high-speed intent (DR29).** Infer candidate differential pairs from
    the authoritative netlist and require complete coverage by private, cited
    pair contracts. Each contract fixes protocol, impedance, skew, polarity,
    lane identity and both endpoint pins. Missing or extra endpoints and any
    uncovered pair fail before PCB layout.
13. **Prove judge coverage before accepting a result.** The executable judge returns
    exactly one result for every registered design token. Missing, duplicate, or
    unknown token results fail closed. After each edit, run the complete live model
    through token coverage, geometry and native DRC. Once those deterministic checks
    converge, capture one fresh full-sheet canvas for the residual visual judgment;
    any unknown or failed evidence blocks delivery.
14. **Edit machine contracts, not the canvas.** For delivery, change the
   structured contracts, deterministic cells, rules, and the gated writer path —
   never free-draw in the GUI.

---

## 1. Object & Connectivity Policy

1. **No pointed net-port symbols** as the default connectivity device. Local
   functional connections use direct orthogonal wires.
2. **Unused pins use the built-in `NoConnected` pin state**, not graphical
   `NC_...` ports. NC markers are *visible* schematic symbols with their own
   keepout: no power/ground symbol, net label, readable text, or unrelated wire
   may overlap a NoConnected marker. Model the marker geometry from the pin
   coordinate even when a snapshot only exposes `pin.noConnected`. No drawable
   wire may touch that coordinate, including a wire whose endpoint lands exactly
   on the pin.
3. **Power and ground use built-in net-flag symbols.** Supply and return rails
   (ground, board supplies, input rails) are drawn with EasyEDA built-in
   power/ground flag symbols, placed local to the part or local rail they serve —
   not as bare text/net-name stubs and not as decorative labels.
4. **Power/ground symbols have keepout and direction.** No wire, net label, value
   text, or other symbol may pass through or cover a power/ground symbol body. A
   wire may terminate at the symbol pin but must not continue through it, and the
   symbol's rotation must match the incoming wire direction — an endpoint that is
   electrically valid but visually pierces the graphic is not acceptable. Prefer
   a short side-entry stub or relocate the symbol. A horizontal supply symbol
   renders its name horizontally and vertically centered on the terminal axis;
   vertical symbols render the name on the outward side. Only one source
   attribute may visibly render that name.
5. **Ordinary net labels are for signals**, cross-block controls, buses, and
   external-terminal semantics — not the default representation of ground or
   board supply rails.
6. **Preserve hidden component/library state.** Do not overwrite a component's
   full library `otherProperty`, symbol, footprint, or pin-pad mapping. If a
   pin-pad map is damaged, replace the part from a verified official device item
   rather than patching display properties.

---

## 2. Layout Topology

1. **Blocks before parts before wires.** Place functional blocks first; never
   place parts opportunistically.
2. **Signal-flow columns.** Inputs and connectors at the edge; the controller
   central to the circuits it serves; outputs and loads on the opposite side.
   Inputs read left-to-right into processing/control, then outputs continue
   right; local supply-to-ground cells may read top-to-bottom.
3. **Compact by topology, not by squeezing.** A readable schematic is compact
   because related parts are close, not because everything is crammed together.
   Do not spread parts evenly across the sheet.
4. **Support parts beside the pin they serve.** Put each support part on the side
   of the IC pin it supports before routing; if a direct wire would be long or
   cross other pins, move the part. Keep repeated passives in ordered, aligned
   stacks beside the served pin rows — never scattered islands.
5. **Conventional orientation.** Pull-ups above the controlled node, pull-downs
   below it, when symbol orientation allows.
6. **A functional cell has a documented anchor and four sides:** source/input,
   output/load, control, and local return/power-reference.
7. **Reserve escape corridors.** Before routing, reserve at least one clear
   horizontal or vertical escape corridor for every non-trivial pin group
   (and around tactile switches and multi-pin symbols). If none exists, move the
   component before drawing any wire. Do not place RC or pull parts inside those
   corridors.
8. **Grid discipline.** Prefer the coarse placement grid. A finer placement is
   allowed only when it aligns two real pins for a direct local connection, and
   the exception is recorded in the prelayout report — never discovered after
   writing to the live schematic.
9. **Module rectangles, no jigsaw.** Each functional module occupies its own
   compact rectangle that keeps the declared minimum gap from its neighbors.
   Left/right neighbors must have vertical spans that are clearly separated or
   intentionally aligned; a mid-range partial overlap (a "jigsaw" interlock) is a
   failure. The same applies to horizontal spans for top/bottom neighbors.
10. **Use two spacing scales.** Keep unrelated component bodies at least 10
    coordinate units apart. Keep functional-module content boxes at least 60
    units apart, and normally no more than 180 units from their nearest peer.
    These are separate gates: a good page-wide average cannot excuse one
    crowded cell or one isolated block.
11. **Measure allocated and occupied geometry.** Every module plan records an
    allocated `box` and the union of its visible geometry as `contentBox`.
    Leave at least 8 units of padding on every side. Local wires, labels, flags
    and NC markers count as content; a wire graph touching two modules belongs
    to a separately reserved interface corridor. An apparently empty frame is
    not usable clearance.
12. **Align the whitespace.** Modules in a reading row share a baseline or
    centerline within one coarse grid step. Repeated channels use the same box
    size, orientation and inter-channel gap. Large residual page space stays at
    the page margin or between major flow bands instead of being inserted
    randomly inside one functional cell.
13. **Measure whole-sheet balance.** Divide the actual usable sheet shape (after
    subtracting the information-block keepout) into a fixed grid. Record available
    area, occupied module-content area, density and normalized content weight for
    every cell. When a multi-module sheet is spacious, keep the occupied-area
    centroid inside the declared centre band of the usable shape; use the reported
    grid-snapped shift as a placement input, then re-run page, module and cell gates.

---

## 3. Wiring Strategy

1. **Prefer direct local wires** for support circuits: connector pin to its
   immediate passive/filter, decoupling cap to IC power pin, pull-up/pull-down to
   its signal pin, gate resistor to a transistor gate, switched node to
   terminal/load, clamp across the node it protects.
2. **All wires orthogonal.** Horizontal/vertical only; zero diagonal segments.
   Leave IC pins horizontally where possible, then turn at most once. Avoid
   multi-turn wandering routes.
3. **Named stubs only after local escapes are clean.** Cross-block connectivity
   may use short visible pin stubs with explicit net names, but only once local
   pin escapes are short and readable. A short-stub-only schematic is not an
   acceptable final form — it can pass DRC while looking unlike real engineering
   work.
4. **One net, one connected graph.** A signal net must be a real connected wire
   graph (or a permitted connectivity object), not several disconnected wire
   objects that merely share a `net` property. A single connected wire graph
   carries exactly one net-name assignment; for continuous local nets, route one
   named polyline through the served pins rather than touching same-net segments
   that the editor may merge into a "multiple net names on one wire" error.
5. **No long wires through unrelated blocks.** If a wire wants to cross a block,
   fix placement first. Any non-local route beyond the long-segment threshold
   must become a named net connection or be shortened by moving the blocks
   closer, unless a documented bus/rail corridor makes the long route clearer.
6. **Different nets never touch.** Different-net wires must never share endpoints
   or overlap collinearly. Minimize perpendicular crossings even when they are
   not electrical shorts — they reduce readability. A crossing is a legal
   junction only when both segments share that exact endpoint.
7. **Every elbow has a reason:** escaping a real keepout, preserving functional
   flow, or joining more than two pins on a deliberate local bus. If two pins in
   a cell can be made collinear by a reasonable move or rotation, that direct
   one-segment connection is required — do not add doglegs to compensate for
   avoidable pin misalignment.
8. **Wires never cross visible objects.** A wire must not pass through a component
   symbol body, symbol text, pin field, net label, power/ground symbol, NC
   marker, or expanded keepout. This is a hard gate, not a cosmetic note.
9. **Repeated cells share one visual grammar.** Repeated drivers/channels use
   matching orientation, part ordering, and aligned terminals unless a real
   pinout constraint forces a difference; and they keep a clean horizontal or
   vertical gap so each channel reads as an independent block.

---

## 4. Geometry Gates

Hard local-checker gates unless a deliberate exception is recorded. Numeric
thresholds are harness defaults; treat them as the floor, not the target.

1. Placement on the coarse grid where possible.
2. Minimum clearance from a wire to an unrelated pin.
3. Minimum clearance from a wire or text to a component bounding box.
4. A wire never passes through a component body or keepout box.
5. A net name or text never covers a component body, keepout, pin, wire endpoint,
   or junction.
6. Different-net endpoint/overlap contacts: **0**.
7. Diagonal segments: **0**.
8. Component spacing violations: **0** (a body gap below the minimum is a hard
   readability failure, not harmless info).
9. Any segment longer than the long-segment threshold is a finding unless it is
   an intentional external bus/rail outside all keepouts.
10. NC markers, power/ground symbols, value text, and labels keep their keepout;
    text overlapping a wire or body is a hard failure.
11. No module lane-interlock (see 2.9).
12. Explanatory block text is optional and usually omitted; never use text to
    compensate for weak placement.
13. Module content-box gap below 60, nearest-module gap above 180 without a
    declared corridor, or module inner padding below 8: **0 violations**.
14. Unrelated component body gap below 10: **0 violations**.

---

## 5. Reference-Study Discipline

When deriving rules from any reference design, follow a method, not a vibe:

1. **Inventory first.** List the reference's document, image, and PDF set before
   claiming it was studied.
2. **Inspect, don't count.** Visually inspect every image used as a design basis;
   for PDFs, at least record page count and inspect the architecture page. If an
   artifact cannot be rendered or text-extracted, say so and do not cite it.
3. **Convert patterns to gates.** A rule copied from a reference is not acceptance
   criteria until it is a measurable gate. Record both the qualitative pattern
   and the quantitative evidence (segment-length distributions, label counts,
   module spacing, crossing counts).
4. **Most readability comes from placement and short local wires**, not from
   labels or long global wiring — verify this on the reference before adopting
   it as a target.

---

## 6. Circuit Pattern Archetypes

Reusable, role-based cells. Names are roles, not parts — map any project's
components onto them.

### 6.1 Input / Connector Cell
Connector on the input edge. Series/termination passives close to the connector
or destination pins, aligned with the signal row. Keep data pairs away from
unrelated power or switching circuitry. Unused mechanical/non-electrical pins use
built-in NoConnected.

### 6.2 Power / Regulator Cell
Input capacitor near the input pin and local return; output capacitor(s) near the
output pin and local return. Regulator, input cap, and output caps stay one
compact power cell. Do not drag supply/return rails through other blocks.

### 6.3 Controller / Core Cell
The controller is central to what it serves. Each served pin escapes the symbol
edge with a short horizontal segment; named stubs sit in one or two aligned label
columns *outside* the chip body; no vertical named signal segments woven beside
the IC. Reset/boot support (pull-up above the signal side, optional cap on the
local signal row with a nearby return) stays local and separate from power
switching. Unused pins use built-in NoConnected.

### 6.4 High-Side Switch Cell
Input/source terminal on the left of the high-side switch; switched output
terminal on the right. Gate-source pull-up and gate clamp sit directly between
source/input and gate. The low-side driver (transistor/BJT) sits below or near
the gate node, with its source/emitter to local return. Control input enters from
the far side of the driver gate/base resistor. No gate-drive wire passes through
source/emitter return pins.

### 6.5 Low-Side Driver Cell
Load/terminal node on the right. The switch drain/output node sits close to the
terminal it switches. A flyback/clamp diode goes directly across the load and the
switched node. The gate series resistor runs in-line from the control input to
the gate; the gate pulldown sits below/local to the gate. Local return stays at
the switch source and pulldown.

### 6.6 Local Support Passives
Pull-ups/pull-downs/decoupling/series resistors are placement-critical: keep them
row- or column-aligned next to the pin they serve, with power pins toward the
local rail and return pins returning locally. A block can pass electrical DRC and
still fail commercial readability if support passives drift into scattered
islands.

---

## 7. Verification Flow

Every candidate edit passes this sequence:

1. **Prelayout report** from the proposed placements, before routing. Confirm: no
   keepout collisions, no blocked pin-escape corridors, all mandatory local
   support connections listed as direct-wired, no unrecorded off-grid placement,
   and every power/ground symbol planned on the same coordinates as its wire
   endpoint after grid snapping.
2. **Offline geometry model**, then **local checker**. Confirm zero for: pointed
   net ports, graphical NC ports, diagonal wires, wires crossing unrelated pins,
   wires crossing keepouts, text/net-name overlaps, disconnected expected signal
   nets, different-net contacts, and component-spacing violations. Disconnected
   *power* nets may be ignored only when readback proves matching built-in
   power/ground flags at the wire endpoints; disconnected *signal* nets must be 0.
3. **Supply representation check.** Ground leaves a local cell through a built-in
   ground symbol; board supply rails use built-in power symbols where practical;
   plain text/net-name stubs are allowed only as a local annotation beside an
   actual symbol or terminal.
4. **Apply through the gated writer** only after candidate gates pass.
5. **Readback and re-check.** Export actual EasyEDA geometry and run the checker
   again on the readback, not the candidate.
6. **Strict DRC.** Run EasyEDA DRC; the authoritative result is the completion
   line totals (fatal/error/warning/info), not the left-panel log counts. A
   strict failure is not acceptable unless the root cause is identified and the
   user explicitly waives it.
7. **Rendered evidence.** Capture the rendered canvas and verify it is a real,
   non-blank image with reviewable page margins on all sides — ink pressed
   against an image edge is a failure. Wire objects existing in the document is
   not proof they are visibly rendered.

---

## 8. EasyEDA API Safety Notes

Transferable EasyEDA behaviors to design around:

1. Do not trust `sch_PrimitiveWire.create()` counts alone; the editor may merge
   created segments and document indexes can lag. Create complex nets in
   validated small batches; `create()` is reliable for single straight segments —
   split polylines into validated segment creates.
2. Avoid one `create(flatSegments, net)` call for a whole branched net.
3. `SCH_PrimitiveComponent.modify()` can be unstable for bulk moves; prefer
   per-component `setState_X(...).setState_Y(...).done()`.
4. Delete old wires before moving components when wire-linked updates time out.
5. Normalize coordinates before comparing endpoints; the editor can return values
   like `959.9999999999999`.
6. Do not use whole-document `setDocumentSource()` as a first repair method on a
   live schematic.
7. Recreating connectors or multi-pin symbols can reset NoConnected state;
   restore built-in NoConnected after replacement.
8. Create power/ground references with
   `sch_PrimitiveComponent.createNetFlag('Ground', '<net>', ...)` or
   `createNetFlag('Power', '<rail>', ...)` using the appropriate built-in symbol —
   never emulate them with text, generic components, or pointed net ports.
9. Live wire readback may pack multiple independent single-segment wires into one
   primitive, while template wires may be continuous polylines. Parse both
   encodings deterministically; never infer a diagonal/looping polyline from a
   clean segment-pair list, and trust parsed segments over object counts.

---

## 9. Durable-Rule Discipline

How this language stays honest and grows:

1. **Every subjective complaint becomes a measurable gate.** After any "it looks
   wrong" feedback, add a geometry/topology gate (module spacing, forbidden
   intrusion, max local doglegs, interior crossing count) before tuning
   coordinates again.
2. **Every repeated failure becomes a durable artifact** — a rule here, a
   validator rule, or a script that removes the manual step. Critical knowledge
   never lives only in chat, screenshots, or scrollback.
3. **Structure is guarded by topology checks, not only local DRC:** inputs and
   power left of the controller, output/load drivers right of it, repeated
   outputs matching shape and alignment, connectors on the edge of the cell they
   serve.
4. **Repeated equivalent devices share key library bindings.** Two parts playing
   the same role must keep matching symbol/device/footprint bindings; fixing one
   channel without the other reintroduces pin-pad drift. Library-identity drift,
   disabled BOM/PCB state, device drift, or an extra/missing part is a hard
   failure — not an info item.
5. **Zero-severity policy.** A commercial gate may have zero findings only. Naming
   style, net-contract drift, density, text/attribute visibility, and local
   detour/bend findings are hard failures, not soft preferences — no soft/info
   debt hidden outside the harness layer.
6. **Commercial readiness is the total gate result, not a waiver counter.** The
   readiness flag is computed from the same strict predicate as the process exit
   code; any warning, info item, failed sub-gate, or known exception makes both
   readiness and pass false.
7. **Reports are fail-closed.** A readiness report is written `pass:false` at
   startup and on any uncaught exception, so an interrupted run never leaves a
   stale `ready:true` artifact for downstream tools or humans to trust.
8. **Write-back inherits acceptance.** The single gated write-back entry runs the
   full offline gate before generating apply steps, and after write-back verifies
   live harness, live net contract, live library identity, zero-severity policy,
   and strict DRC 0/0/0/0. Low-level generators are never public entry points and
   abort unless the gated path authorizes them.
9. **Net-contract coverage is production-facing.** Audit the real interfaces
   (external connectors, power and return rails, switch/driver chains, controller
   control outputs, support paths) — a green DRC over a handful of checked nets is
   not enough.
10. **Footprint-only changes use the device association.** Change the project
    device's footprint association through the library API, one shared device family
    at a time. Do not patch the placed component's `Footprint` source attribute and
    do not clone an ad hoc symbol/device pair. After each family, read back every
    affected reference and prove footprint resolution, unchanged symbol/device/value,
    authoritative netlist continuity, and native DRC before continuing.
