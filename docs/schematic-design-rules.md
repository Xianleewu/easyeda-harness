# Schematic Design Rules

This file defines the layout rules that agents must treat as executable delivery requirements, not visual preferences.

## Required Geometry

- Wires are orthogonal and must not cross different nets.
- Wires must not pass through component bodies, symbols, text, net labels, GND flags, or NC markers.
- Component attributes, document text, net names, GND symbols, and NC markers must not overlap other visible schematic objects.
- Each functional module occupies its own compact rectangular area. Module rectangles must keep the declared minimum gap and must not interlock with neighboring modules.
- Inter-module nets must follow the declared reading flow in `layoutPolicy.flow`, `layoutPolicy.columns`, and `layoutPolicy.interfaceRoutes`.

## Signal Labels

- Single-sheet signal labels use real EasyEDA wire `Name` attributes or generated model signal netflags. Free `PrimitiveText` objects are not net labels.
- Every visible signal label must be listed in `project_assembly.json` under `layoutPolicy.labelColumns`.
- A visible signal label origin must land on a same-net wire endpoint. Floating labels and mid-wire labels are forbidden.
- Left-side labels use EasyEDA `alignMode=6`, meaning the exported origin is the lower-left text corner.
- Right-side labels use EasyEDA `alignMode=8`, meaning the exported origin is the lower-right text corner.
- Same-side labels for a module or interface group must share the declared label-column `x` within tolerance.
- A net may not display more visible labels than its declared `layoutPolicy.labelColumns` budget.
- Internal nets without a declared label-column budget must not become visible wire names during write-back.

## Evidence

The following gates are responsible for these rules:

- `contract:layout`: module columns, spacing, no interlocks, and no unrelated wire intrusion.
- `contract:geometry`: generated-model wire crossings, wires through visible objects, and text/label/flag/attribute overlaps.
- `contract:geometry:live`: the same geometry audit on the real EasyEDA `live.json` snapshot.
- `contract:labels`: generated-model label columns, label origin geometry, endpoint attachment, fake text labels, and label budget.
- `contract:labels:live`: the same label audit on the real EasyEDA `live.json` snapshot.
- `pipeline`: local model geometry, crossings, text clearance, label clearance, and structured layout checks.
- `contract:visual`: offline visual evidence coverage.
- `live-check`: live model, live label geometry, live screenshots, and EasyEDA DRC `0 error / 0 warning / 0 info`.
- `deliver`: final live evidence gate; local-only PASS is not delivery evidence.

When a rule fails, agents must repair the deterministic source: `project_assembly.json`, the selected circuit pack, cell manifest, label placement logic, or the gated writer. Manual EasyEDA edits are not accepted as the source of truth.
