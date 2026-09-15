# Generic PCB Placement and Routing Rules

These rules apply to every PCB handled through the EasyEDA bridge. They are
circuit-agnostic and use geometry and functional roles rather than reference or
net-name literals.

## Placement gates

1. Place connectors at the board edge with the mating direction facing out.
   Verify the direction from footprint geometry or 3D data for each board edge;
   do not derive every edge orientation from one rotation value.
2. Prefer a single assembly side. Use the second side only when routing or
   thermal constraints cannot be met after a measured top-side placement pass.
3. Snap component origins to the declared placement grid. Repeated channels use
   identical relative coordinates, rotations, and spacing.
4. Measure clearance from the actual placed component/courtyard bounding boxes:
   - general components, unrelated cells, ICs, power parts, and connectors:
     at least 1.0 mm;
   - hand-solder access around ICs, power parts, and connectors: target 1.5 mm;
   - aligned resistor/capacitor arrays in the same functional cell, with the
     same orientation and unobstructed pad access: at least 0.5 mm.
5. The 0.5 mm passive-array exception is invalid if it blocks iron access,
   violates copper or solder-mask clearance, mixes unrelated cells, or places a
   taller part in the reflow shadow of its neighbor.
6. Keep every copper pad inside the board-edge clearance required by native DRC.
   Connector shells may meet the mechanical edge only when the footprint is
   intended for edge mounting.
7. Board outlines use the smallest measured envelope that passes placement,
   routing, edge-clearance, and mechanical-access gates. Rounded rectangular
   outlines default to a 1.0 mm corner radius unless the enclosure says otherwise.
8. Re-anchor all visible designators after the final component move. Designators
   must be readable, consistently oriented, inside the board, and free of pad,
   body, and other text overlaps.
9. Every placement policy declares a minimum measured component-area utilization,
   or records the mechanical constraint that prevents a density target. The judge
   computes exact union area from live footprint bounding boxes, so large empty
   regions cannot pass merely because the outer margins happen to be small.

## Executable placement workflow

1. Synchronize the associated schematic through `node wf.mjs pcb-sync --pcb <uuid>`.
   The transaction backs up the PCB source, imports schematic changes, and blocks unless every
   fitted schematic component exists on the PCB with a nonempty footprint whose pads cover every
   symbol pin. Every connected symbol pin must also carry the same live PCB pad net. A footprint
   name or external library file alone is not acceptance evidence. Catalog operations run as
   bounded sequential bridge requests so a timed-out mutation cannot race its rollback.
2. Capture a fresh live snapshot with `npm run pcb:snapshot -- <snapshot.json>`.
   The snapshot must contain every component, its measured bounding box, every
   visible designator, exactly one supported board outline, and fresh native DRC.
3. Store circuit-specific module, cell, repeated-channel, connector-direction,
   and passive-array declarations in a policy file outside this public repository.
4. Run `npm run pcb:qc -- <snapshot.json> <policy.json> <report.json>`. Every
   deterministic gate must pass before a canvas image is used for residual visual
   review. A placement-stage policy may waive only native `Connection Error`
   findings; all clearance, board-edge, netlist, and other findings remain blocking.
5. After the deterministic report is green, capture and inspect a fresh EasyEDA
   canvas image. Record that artifact in the policy's `visualReview`; then run
   `npm run pcb:judge -- <policy.json> --pcb <uuid> --snapshot <snapshot.json>
   --report <report.json>` for the final fail-closed result.

The policy is declarative. The judge derives positions, rotations, layers,
bounding boxes, designator geometry, board margins, and DRC findings from the
live PCB. No circuit-specific reference or net name belongs in the engine.

## Routing gates

1. Placement serves routing: short current loops, short local support nets,
   direct connector escapes, and reserved routing corridors come before density.
2. Use 45-degree routing. Right-angle tracks, arbitrary zigzags, and avoidable
   neck-downs are blocked.
3. Route power paths for their actual current and thermal rise. Keep switching
   loops compact and keep sensitive signals away from switching nodes.
4. Use continuous ground pours on both copper layers where possible, with local
   stitching vias. Do not replace a ground plane with long point-to-point ground
   tracks.
5. Run native PCB DRC after placement, after each routing class, and after pours.
   Clearing the DRC result is never evidence; the check must be run and its
   detailed findings inspected.
6. Final DRC evidence must come from the intended deliverable PCB UUID while it
   remains associated with its source schematic/netlist. A scratch PCB or cloned
   routing sandbox may be used for experiments, but its DRC result cannot satisfy
   an acceptance gate; rerun the full check after applying the result to the
   deliverable PCB.
7. Audit both segment direction and junction turn angle. A path made only from
   horizontal and vertical segments still fails when those segments form a
   90-degree corner; chamfer every such corner before acceptance.
