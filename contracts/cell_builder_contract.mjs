import { asArray } from './module_contract.mjs';

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'cell-builder-contract', msg, where });
}

function finitePoint(point) {
	return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function refValues(refs) {
	return Object.values(refs || {}).filter(Boolean);
}

function wireSegments(wire) {
	const line = asArray(wire?.line);
	const segments = [];
	for (let i = 0; i + 3 < line.length; i += 2) {
		segments.push([line[i], line[i + 1], line[i + 2], line[i + 3]]);
	}
	return segments;
}

function validateCellOutput(output, mod, manifestCell) {
	const findings = [];
	const refs = new Set(refValues(mod.refs));
	if (!output || typeof output !== 'object') {
		hard(findings, 'CB1-output-object', `${mod.id} builder must return an object`, { module: mod.id, cell: mod.cell });
		return findings;
	}
	if (!output.place || typeof output.place !== 'object') {
		hard(findings, 'CB2-place-object', `${mod.id} builder must return place object`, { module: mod.id, cell: mod.cell });
	} else {
		for (const ref of refs) {
			const place = output.place[ref];
			if (!finitePoint(place) || !Number.isFinite(place.rot)) {
				hard(findings, 'CB3-place-covers-refs', `${mod.id} builder place must cover every mapped ref with x/y/rot`, {
					module: mod.id,
					cell: mod.cell,
					ref,
					place: place || null,
				});
			}
		}
		const unknownPlacedRefs = Object.keys(output.place).filter(ref => !refs.has(ref));
		if (unknownPlacedRefs.length) {
			hard(findings, 'CB4-no-unknown-placed-refs', `${mod.id} builder placed refs outside project_assembly.json mapping`, {
				module: mod.id,
				cell: mod.cell,
				unknownPlacedRefs,
			});
		}
	}
	if (!Array.isArray(output.wires)) {
		hard(findings, 'CB5-wires-array', `${mod.id} builder must return wires array`, { module: mod.id, cell: mod.cell });
	} else {
		for (const [index, wire] of output.wires.entries()) {
			if (wire?.net != null && typeof wire.net !== 'string') {
				hard(findings, 'CB6-wire-net', `${mod.id} builder wire net must be a string when present`, { module: mod.id, cell: mod.cell, index, wire });
			}
			const line = asArray(wire?.line);
			if (line.length < 4 || line.length % 2 !== 0 || !line.every(Number.isFinite)) {
				hard(findings, 'CB7-wire-line-shape', `${mod.id} builder wire line must contain finite x/y pairs`, { module: mod.id, cell: mod.cell, index, line });
				continue;
			}
			for (const [x1, y1, x2, y2] of wireSegments(wire)) {
				if (x1 !== x2 && y1 !== y2) {
					hard(findings, 'CB8-wire-orthogonal', `${mod.id} builder wires must be orthogonal before model generation`, {
						module: mod.id,
						cell: mod.cell,
						index,
						segment: [x1, y1, x2, y2],
					});
				}
			}
		}
	}
	if (!Array.isArray(output.flags)) {
		hard(findings, 'CB9-flags-array', `${mod.id} builder must return flags array`, { module: mod.id, cell: mod.cell });
	} else {
		for (const [index, flag] of output.flags.entries()) {
			if (!flag?.net || typeof flag.net !== 'string' || !Number.isFinite(flag.x) || !Number.isFinite(flag.y)) {
				hard(findings, 'CB10-flag-shape', `${mod.id} builder flags must be real netflag objects with net/x/y`, {
					module: mod.id,
					cell: mod.cell,
					index,
					flag,
				});
			}
		}
	}
	if (output.noConnects !== undefined && !Array.isArray(output.noConnects)) {
		hard(findings, 'CB11-noconnects-array', `${mod.id} builder noConnects must be an array when present`, { module: mod.id, cell: mod.cell });
	}
	const declaredPorts = new Set(asArray(manifestCell?.ports));
	const declaredNets = new Set(asArray(mod.nets));
	const outputNets = new Set([
		...asArray(output.wires).map(wire => wire?.net).filter(Boolean),
		...asArray(output.flags).map(flag => flag?.net).filter(Boolean),
	]);
	const unresolvedPorts = [...declaredPorts].filter(port => {
		const resolved = mod.netArgs?.[port] || (declaredNets.has(port) ? port : '');
		return !resolved;
	});
	if (unresolvedPorts.length) {
		hard(findings, 'CB12-ports-resolve-before-build', `${mod.id} manifest ports must resolve through assembly netArgs or nets`, {
			module: mod.id,
			cell: mod.cell,
			unresolvedPorts,
		});
	}
	const undeclaredOutputNets = [...outputNets].filter(net => !declaredNets.has(net));
	if (undeclaredOutputNets.length) {
		hard(findings, 'CB13-output-nets-declared', `${mod.id} builder output nets must be declared in project_assembly.json`, {
			module: mod.id,
			cell: mod.cell,
			undeclaredOutputNets,
			declaredNets: [...declaredNets],
		});
	}
	return findings;
}

export function validateCellBuilderDryRun({ assembly, manifest, pack, byDes = null }) {
	const findings = [];
	if (!assembly || !manifest || !pack?.cellBuilders) return findings;
	const manifestCells = new Map(asArray(manifest.cells).map(cell => [cell.id, cell]));
	for (const mod of asArray(assembly.modules)) {
		const build = pack.cellBuilders[mod.cell];
		const manifestCell = manifestCells.get(mod.cell);
		if (!build || !manifestCell) continue;
		const moduleByDes = byDes || new Map(refValues(mod.refs).map(ref => [ref, { designator: ref, pins: [], localBox: { minX: 0, minY: 0, maxX: 1, maxY: 1 } }]));
		let output = null;
		try {
			output = build(moduleByDes, mod.refs || {}, assembly.anchors?.[mod.anchor] || { x: 0, y: 0 }, mod.netArgs || {});
		} catch (e) {
			hard(findings, 'CB0-builder-dry-run', `${mod.id} builder threw during contract dry-run`, {
				module: mod.id,
				cell: mod.cell,
				error: e.message,
			});
			continue;
		}
		findings.push(...validateCellOutput(output, mod, manifestCell));
	}
	return findings;
}
