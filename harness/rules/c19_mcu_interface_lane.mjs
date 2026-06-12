import { CONFIG } from '../config.mjs';

const EPS = 1e-6;

function pin(part, num) {
	return (part?.pins || []).find(p => String(p.num) === String(num)) || null;
}

function fail(F, rule, msg, where) {
	F.push({ rule, severity: 'hard', category: 'wiring', msg, where });
}

function horiz(s) {
	return Math.abs(s.y1 - s.y2) < EPS;
}

function vert(s) {
	return Math.abs(s.x1 - s.x2) < EPS;
}

function between(v, a, b, tol = EPS) {
	return v >= Math.min(a, b) - tol && v <= Math.max(a, b) + tol;
}

function leftEscapeSegments(segs, pinPt) {
	return segs.filter(s => horiz(s)
		&& Math.abs(s.y1 - pinPt.y) < EPS
		&& ((Math.abs(s.x1 - pinPt.x) < EPS && s.x2 < pinPt.x) ||
			(Math.abs(s.x2 - pinPt.x) < EPS && s.x1 < pinPt.x)));
}

function rowRunFromPin(segs, pinPt, net) {
	const intervals = segs
		.filter(s => horiz(s)
			&& (!s.net || s.net === net)
			&& Math.abs(s.y1 - pinPt.y) < EPS
			&& Math.min(s.x1, s.x2) < pinPt.x + EPS
			&& Math.max(s.x1, s.x2) <= pinPt.x + EPS)
		.map(s => ({ seg: s, minX: Math.min(s.x1, s.x2), maxX: Math.max(s.x1, s.x2) }));
	let left = pinPt.x;
	const used = [];
	let changed = true;
	while (changed) {
		changed = false;
		for (const it of intervals) {
			if (used.includes(it)) continue;
			if (it.maxX >= left - EPS && it.minX < left - EPS) {
				used.push(it);
				left = Math.min(left, it.minX);
				changed = true;
			}
		}
	}
	return used.length ? { minX: left, maxX: pinPt.x, segs: used.map(it => it.seg), len: pinPt.x - left } : null;
}

function segmentTouchesPoint(s, pt, tol = EPS) {
	return (Math.abs(s.x1 - pt.x) <= tol && Math.abs(s.y1 - pt.y) <= tol) ||
		(Math.abs(s.x2 - pt.x) <= tol && Math.abs(s.y2 - pt.y) <= tol);
}

function nearMcuEscapeJog(segs, pinPt, escape, cfg) {
	const x0 = Math.min(escape.x1, escape.x2);
	const y0 = escape.y1;
	const maxLen = cfg.maxPinEscapeJogLen ?? 12;
	return segs.find(s => vert(s)
		&& Math.abs(s.x1 - x0) <= EPS
		&& segmentTouchesPoint(s, { x: x0, y: y0 })
		&& Math.abs(s.y1 - s.y2) > EPS
		&& Math.abs(s.y1 - s.y2) <= maxLen
		&& Math.abs(s.x1 - pinPt.x) <= (cfg.pinEscapeMax ?? 18) + 2);
}

function namedStubs(segs, net, pinPt, mcuBox, cfg) {
	return segs.filter(s => s.net === net
		&& horiz(s)
		&& Math.max(s.x1, s.x2) <= mcuBox.minX - (cfg.pinEscapeMin ?? 8) + 25
		&& Math.min(s.x1, s.x2) >= mcuBox.minX - (cfg.maxLabelStubLeftOfMcu ?? 160) - 20
		&& s.y1 >= mcuBox.minY - (cfg.maxLabelLaneYMargin ?? 80)
		&& s.y1 <= mcuBox.maxY + (cfg.maxLabelLaneYMargin ?? 80));
}

function rightEscapeSegments(segs, pinPt) {
	return segs.filter(s => horiz(s)
		&& Math.abs(s.y1 - pinPt.y) < EPS
		&& ((Math.abs(s.x1 - pinPt.x) < EPS && s.x2 > pinPt.x) ||
			(Math.abs(s.x2 - pinPt.x) < EPS && s.x1 > pinPt.x)));
}

function labelAnchor(m, net, pinPt, run) {
	const flags = [
		...(m.netflags || []),
		...(m.netports || []),
		...(m.netlabels || []),
	];
	const laneFlags = flags.filter(x => x.net === net
		&& Number.isFinite(x.x)
		&& Number.isFinite(x.y)
		&& x.x <= pinPt.x + EPS
		&& x.y >= pinPt.y - (CONFIG.mcuInterface?.maxLabelLaneYMargin ?? 80)
		&& x.y <= pinPt.y + (CONFIG.mcuInterface?.maxLabelLaneYMargin ?? 80));
	const sameRow = laneFlags.find(x => Math.abs(x.y - pinPt.y) <= EPS);
	const any = sameRow || laneFlags.find(x => Math.abs(x.x - run.minX) <= (CONFIG.mcuInterface?.labelColumnTolerance ?? 2));
	return Number.isFinite(any?.x) && Number.isFinite(any?.y)
		? { x: any.x, y: any.y }
		: { x: run.minX, y: pinPt.y };
}

export function c19McuInterfaceLane(m) {
	const F = [];
	const cfg = CONFIG.mcuInterface || {};
	const u1 = (m.parts || []).find(p => p.designator === 'U1');
	if (!u1) return F;
	const mcuBox = u1.bodyBBox || u1.bbox;
	if (!mcuBox) return F;
	const specs = cfg.leftSignals || [];
	const segs = m.segments || [];
	const escapeXs = [];
	const labelXs = [];
	const labelYs = [];

	const gndPins = ['19', '20', '21', '22', '23', '24', '25', '26', '27']
		.map(num => pin(u1, num))
		.filter(Boolean);
	if (gndPins.length) {
		const gndEscapeXs = [];
		for (const p of gndPins) {
			const pinPt = { x: p.x, y: p.y };
			const exits = rightEscapeSegments(segs, pinPt);
			if (!exits.length) {
				fail(F, 'C19.11-mcu-right-gnd-escape', `U1 GND pin ${p.num} must exit horizontally to the shared right-side GND rail`, {
					pin: `U1.${p.num}`,
					pinPt,
				});
				continue;
			}
			const exit = exits
				.map(s => ({ s, x: Math.max(s.x1, s.x2), len: Math.max(s.x1, s.x2) - pinPt.x }))
				.sort((a, b) => a.len - b.len)[0];
			gndEscapeXs.push(exit.x);
		}
		if (gndEscapeXs.length > 1) {
			const spread = Math.max(...gndEscapeXs) - Math.min(...gndEscapeXs);
			if (spread > (cfg.maxGndRailColumnDelta ?? 4)) {
				fail(F, 'C19.12-mcu-right-gnd-single-rail', 'U1 right-side GND pins must collapse into one clean shared rail, not stepped sub-rails', {
					escapeXs: gndEscapeXs,
					spread,
					max: cfg.maxGndRailColumnDelta ?? 4,
				});
			}
		}
		const rightGndFlags = (m.netflags || [])
			.filter(f => f.net === 'GND'
				&& Number.isFinite(f.x)
				&& Number.isFinite(f.y)
				&& f.x > mcuBox.maxX
				&& f.x <= mcuBox.maxX + (cfg.maxRightGndFlagDistance ?? 140)
				&& f.y >= mcuBox.minY - (cfg.maxRightGndFlagYMargin ?? 80)
				&& f.y <= mcuBox.maxY + (cfg.maxRightGndFlagYMargin ?? 80));
		if (rightGndFlags.length !== 1) {
			fail(F, 'C19.13-mcu-right-gnd-symbol-count', 'U1 right-side GND bank must use exactly one local GND symbol', {
				count: rightGndFlags.length,
				flags: rightGndFlags.map(f => ({ x: f.x, y: f.y, rotation: f.rotation ?? f.rot ?? 0 })),
			});
		}
	}

	for (const spec of specs) {
		const p = pin(u1, spec.pin);
		if (!p) continue;
		const pinPt = { x: p.x, y: p.y };
		const run = rowRunFromPin(segs, pinPt, spec.net);
		if (!run) {
			fail(F, 'C19.1-mcu-pin-left-escape', `${spec.net} must leave U1 pin ${spec.pin} horizontally to the left`, {
				pin: `U1.${spec.pin}`,
				net: spec.net,
				pinPt,
			});
			continue;
		}
		const preferredEscapeLen = cfg.preferredPinEscapeLen ?? 20;
		const escapeLen = Math.min(run.len, preferredEscapeLen);
		const escapeColumnX = pinPt.x - escapeLen;
		const escape = { x1: pinPt.x, y1: pinPt.y, x2: escapeColumnX, y2: pinPt.y };
		escapeXs.push(escapeColumnX);
		if (escape.net && escape.net !== spec.net) {
			fail(F, 'C19.2-mcu-escape-net-name', `${spec.net} U1 pin escape must be unnamed or carry only its served net`, {
				pin: `U1.${spec.pin}`,
				expectedNet: spec.net,
				actualNet: escape.net,
				seg: [escape.x1, escape.y1, escape.x2, escape.y2],
			});
		}
		if (escapeLen < (cfg.pinEscapeMin ?? 8) || escapeLen > (cfg.pinEscapeMax ?? 18)) {
			fail(F, 'C19.3-mcu-pin-escape-length', `${spec.net} U1 pin escape length must stay compact`, {
				pin: `U1.${spec.pin}`,
				net: spec.net,
				len: escapeLen,
				min: cfg.pinEscapeMin ?? 8,
				max: cfg.pinEscapeMax ?? 18,
			});
		}
		const jog = nearMcuEscapeJog(segs, pinPt, escape, cfg);
		if (jog) {
			fail(F, 'C19.10-mcu-left-escape-jog', `${spec.net} U1 left escape must stay on the pin row without a tiny vertical dogleg`, {
				pin: `U1.${spec.pin}`,
				net: spec.net,
				pinPt,
				escape: [escape.x1, escape.y1, escape.x2, escape.y2],
				jog: [jog.x1, jog.y1, jog.x2, jog.y2],
				maxJogLen: cfg.maxPinEscapeJogLen ?? 12,
			});
		}

		const label = labelAnchor(m, spec.net, pinPt, run);
		const labelX = label.x;
		const availableLabelRun = escapeColumnX - labelX;
		if (availableLabelRun < (cfg.minNamedStubLen ?? 24)) {
			fail(F, 'C19.4-mcu-named-stub', `${spec.net} must have a horizontal named stub in the MCU interface lane`, {
				pin: `U1.${spec.pin}`,
				net: spec.net,
				pinPt,
				labelX,
				escapeColumnX,
				availableLabelRun,
			});
			continue;
		}
		const stubLen = Math.min(availableLabelRun, cfg.preferredNamedStubLen ?? 40);
		labelXs.push(labelX);
		labelYs.push({ x: labelX, y: label.y, net: spec.net });
		if (stubLen < (cfg.minNamedStubLen ?? 24) || stubLen > (cfg.maxNamedStubLen ?? 55)) {
			fail(F, 'C19.5-mcu-named-stub-length', `${spec.net} MCU named stub length must be readable but not sprawl`, {
				pin: `U1.${spec.pin}`,
				net: spec.net,
				len: stubLen,
				min: cfg.minNamedStubLen ?? 24,
				max: cfg.maxNamedStubLen ?? 55,
				visualRun: [pinPt.x, pinPt.y, labelX, pinPt.y],
				escapeColumnX,
			});
		}
	}

	if (escapeXs.length > 1) {
		const spread = Math.max(...escapeXs) - Math.min(...escapeXs);
		if (spread > (cfg.maxEscapeColumnDelta ?? 4)) {
			fail(F, 'C19.6-mcu-escape-column', 'MCU left interface escapes must share one clean column', {
				escapeXs,
				spread,
				max: cfg.maxEscapeColumnDelta ?? 4,
			});
		}
	}

	if (labelXs.length > 1) {
		const tol = cfg.labelColumnTolerance ?? 2;
		const columns = [];
		for (const x of labelXs.sort((a, b) => a - b)) {
			const col = columns.find(c => Math.abs(c.x - x) <= tol);
			if (col) {
				col.items.push(x);
				col.x = col.items.reduce((sum, v) => sum + v, 0) / col.items.length;
			} else {
				columns.push({ x, items: [x] });
			}
		}
		if (columns.length > (cfg.maxLabelColumns ?? 2)) {
			fail(F, 'C19.7-mcu-label-columns', 'MCU left interface named stubs must use a small number of aligned label columns', {
				labelXs,
				columns: columns.map(c => ({ x: c.x, count: c.items.length })),
				max: cfg.maxLabelColumns ?? 2,
			});
		}
	}

	if (labelYs.length > 1) {
		const tol = cfg.labelColumnTolerance ?? 2;
		const columns = [];
		for (const item of [...labelYs].sort((a, b) => a.x - b.x)) {
			const col = columns.find(c => Math.abs(c.x - item.x) <= tol);
			if (col) {
				col.items.push(item);
				col.x = col.items.reduce((sum, v) => sum + v.x, 0) / col.items.length;
			} else {
				columns.push({ x: item.x, items: [item] });
			}
		}
		const minPitch = cfg.minLabelRowPitch ?? 18;
		const tight = [];
		for (const col of columns) {
			const sorted = [...col.items].sort((a, b) => a.y - b.y);
			for (let i = 0; i + 1 < sorted.length; i++) {
				const pitch = sorted[i + 1].y - sorted[i].y;
				if (pitch < minPitch) tight.push({ columnX: col.x, a: sorted[i], b: sorted[i + 1], pitch });
			}
		}
		if (tight.length) {
			fail(F, 'C19.9-mcu-label-row-pitch', 'MCU interface contract labels must use readable row pitch in one clean lane', {
				labelRowsByColumn: columns.map(c => ({ x: c.x, rows: c.items.map(item => ({ net: item.net, y: item.y })) })),
				tight,
				minPitch,
			});
		}
	}

	for (const s of segs) {
		if (!s.net || !specs.some(spec => spec.net === s.net) || !vert(s)) continue;
		const inLaneX = s.x1 <= mcuBox.minX + EPS && s.x1 >= mcuBox.minX - (cfg.maxLabelStubLeftOfMcu ?? 160) - 20;
		const inLaneY = between(s.y1, mcuBox.minY - 5, mcuBox.maxY + 5) || between(s.y2, mcuBox.minY - 5, mcuBox.maxY + 5);
		if (inLaneX && inLaneY && Math.abs(s.y1 - s.y2) > (cfg.maxInterfaceVerticalLen ?? 8)) {
			fail(F, 'C19.8-mcu-named-vertical', `${s.net} must not use a vertical named segment in the MCU interface lane`, {
				net: s.net,
				seg: [s.x1, s.y1, s.x2, s.y2],
				len: Math.abs(s.y1 - s.y2),
				max: cfg.maxInterfaceVerticalLen ?? 8,
			});
		}
	}

	return F;
}
