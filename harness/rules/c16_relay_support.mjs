import { CONFIG } from '../config.mjs';

const RELAYS = [
	{ name: 'relay1', Q: 'Q3', Rs: 'R13', Rpd: 'R15', D: 'D2', CN: 'CN3' },
	{ name: 'relay2', Q: 'Q4', Rs: 'R14', Rpd: 'R16', D: 'D3', CN: 'CN4' },
];

function part(parts, ref) {
	return parts.get(ref) || null;
}

function pin(p, numOrName) {
	return (p?.pins || []).find(x => String(x.num) === String(numOrName) || String(x.name) === String(numOrName)) || null;
}

function center(p) {
	const b = p?.bodyBBox || p?.bbox;
	return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : null;
}

function fail(F, rule, msg, where) {
	F.push({ rule, severity: 'hard', category: 'layout', msg, where });
}

function directHorizontalSegment(segs, a, b, net, tol = 0.5) {
	if (!a || !b || Math.abs(a.y - b.y) > tol) return null;
	for (const s of segs || []) {
		if ((s.net || '') !== net) continue;
		if (Math.abs(s.y1 - s.y2) > tol) continue;
		if (Math.abs(s.y1 - a.y) > tol) continue;
		const endpoints = [
			[s.x1, s.y1, s.x2, s.y2],
			[s.x2, s.y2, s.x1, s.y1],
		];
		if (endpoints.some(([x1, y1, x2, y2]) =>
			Math.abs(x1 - a.x) <= tol && Math.abs(y1 - a.y) <= tol &&
			Math.abs(x2 - b.x) <= tol && Math.abs(y2 - b.y) <= tol)) return s;
	}
	return null;
}

function shortOrthogonalBridge(segs, a, b, net, cfg, tol = 0.5) {
	const direct = directHorizontalSegment(segs, a, b, net, tol);
	const run = a && b ? Math.abs(b.x - a.x) : 0;
	const drop = a && b ? Math.abs(b.y - a.y) : 0;
	if (direct) return { ok: true, mode: 'direct', run, drop, len: direct.len ?? run };
	if (!a || !b) return { ok: false, mode: 'missing-pin', run, drop, len: 0 };
	const midA = { x: b.x, y: a.y };
	const h = directHorizontalSegment(segs, a, midA, net, tol);
	const v = (segs || []).find(s => {
		if ((s.net || '') !== net) return false;
		if (Math.abs(s.x1 - s.x2) > tol) return false;
		if (Math.abs(s.x1 - b.x) > tol) return false;
		const ys = [s.y1, s.y2].sort((x, y) => x - y);
		const want = [a.y, b.y].sort((x, y) => x - y);
		return Math.abs(ys[0] - want[0]) <= tol && Math.abs(ys[1] - want[1]) <= tol;
	});
	const len = (h?.len ?? run) + (v?.len ?? drop);
	return {
		ok: !!h && !!v &&
			run >= (cfg.minFlybackDirectRun ?? 45) &&
			run <= (cfg.maxFlybackDirectRun ?? 90) &&
			drop <= (cfg.maxFlybackBridgeDrop ?? 25),
		mode: 'short-l',
		run,
		drop,
		len,
		horizontal: !!h,
		vertical: !!v,
	};
}

function checkRelay(F, parts, spec) {
	const cfg = CONFIG.relaySupport || {};
	const q = part(parts, spec.Q);
	const rs = part(parts, spec.Rs);
	const rpd = part(parts, spec.Rpd);
	const d = part(parts, spec.D);
	const cn = part(parts, spec.CN);
	if (!q || !rs || !rpd || !d || !cn) return;

	const qc = center(q);
	const rsc = center(rs);
	const rpdc = center(rpd);
	const dc = center(d);
	const cnc = center(cn);
	if (!qc || !rsc || !rpdc || !dc || !cnc) return;

	const qGate = pin(q, '1') || pin(q, 'G');
	const qDrain = pin(q, '3') || pin(q, 'D');
	const rsOut = pin(rs, '2');
	const rpdGate = pin(rpd, '1');
	const diodeA = pin(d, '2') || pin(d, 'A');
	const diodeK = pin(d, '1') || pin(d, 'K');
	const cnA = pin(cn, '2');
	const cnV = pin(cn, '1');

	const terminalRightOfMos = cnc.x - qc.x;
	const terminalRowDelta = Math.abs(cnc.y - dc.y);
	if (terminalRightOfMos < (cfg.minTerminalRightOfMos ?? 105) ||
		terminalRightOfMos > (cfg.maxTerminalRightOfMos ?? 190) ||
		terminalRowDelta > (cfg.maxTerminalRowDelta ?? 90)) {
		fail(F, 'C16.1-relay-terminal-edge', 'Relay terminal must sit on the right edge of the low-side driver cell', {
			cell: spec.name,
			refs: [spec.Q, spec.CN],
			terminalRightOfMos,
			terminalRowDelta,
			minRight: cfg.minTerminalRightOfMos ?? 105,
			maxRight: cfg.maxTerminalRightOfMos ?? 190,
			maxRowDelta: cfg.maxTerminalRowDelta ?? 90,
		});
	}

	const diodeRightOfMos = dc.x - qc.x;
	const diodeLeftOfTerminal = cnc.x - dc.x;
	const diodeCoilRowDelta = Math.max(
		diodeA && cnA ? Math.abs(diodeA.y - cnA.y) : 0,
		diodeK && cnV ? Math.abs(diodeK.y - (cnV.y + 20)) : 0,
	);
	if (diodeRightOfMos < (cfg.minDiodeRightOfMos ?? 35) ||
		diodeRightOfMos > (cfg.maxDiodeRightOfMos ?? 90) ||
		diodeLeftOfTerminal < (cfg.minDiodeLeftOfTerminal ?? 45) ||
		diodeLeftOfTerminal > (cfg.maxDiodeLeftOfTerminal ?? 110) ||
		diodeCoilRowDelta > (cfg.maxDiodeCoilRowDelta ?? 5)) {
		fail(F, 'C16.2-relay-flyback-diode-placement', 'Flyback diode must sit directly between MOS drain/switch node and relay terminal coil rows', {
			cell: spec.name,
			refs: [spec.Q, spec.D, spec.CN],
			diodeRightOfMos,
			diodeLeftOfTerminal,
			diodeCoilRowDelta,
			minRightOfMos: cfg.minDiodeRightOfMos ?? 35,
			maxRightOfMos: cfg.maxDiodeRightOfMos ?? 90,
			minLeftOfTerminal: cfg.minDiodeLeftOfTerminal ?? 45,
			maxLeftOfTerminal: cfg.maxDiodeLeftOfTerminal ?? 110,
			maxCoilRowDelta: cfg.maxDiodeCoilRowDelta ?? 5,
		});
	}

	const nets = netsFor(spec);
	const coilASeg = directHorizontalSegment(parts.__segments, diodeA, cnA, nets.COILA);
	const coilVBridge = shortOrthogonalBridge(parts.__segments, diodeK, cnV, nets.COILV, cfg);
	const coilALen = diodeA && cnA ? Math.abs(cnA.x - diodeA.x) : 0;
	if (!coilASeg || !coilVBridge.ok ||
		coilALen < (cfg.minFlybackDirectRun ?? 45) ||
		coilALen > (cfg.maxFlybackDirectRun ?? 90)) {
		fail(F, 'C16.6-relay-flyback-direct-bridges', 'Flyback diode must bridge relay terminal coil pins with short direct local runs', {
			cell: spec.name,
			refs: [spec.D, spec.CN],
			coilA: { found: !!coilASeg, len: coilALen, net: nets.COILA },
			coilV: { ...coilVBridge, net: nets.COILV },
			min: cfg.minFlybackDirectRun ?? 45,
			max: cfg.maxFlybackDirectRun ?? 90,
			maxDrop: cfg.maxFlybackBridgeDrop ?? 25,
		});
	}

	if (qGate && rsOut) {
		const rsGateRowDelta = Math.abs(rsOut.y - qGate.y);
		const rsLeftOfMosGate = qGate.x - rsOut.x;
		if (rsGateRowDelta > (cfg.maxRsGateRowDelta ?? 5) ||
			rsLeftOfMosGate < (cfg.minRsLeftOfMosGate ?? 35) ||
			rsLeftOfMosGate > (cfg.maxRsLeftOfMosGate ?? 75)) {
			fail(F, 'C16.3-relay-gate-resistor', 'Relay gate resistor must sit between GPIO input and MOS gate on the same row', {
				cell: spec.name,
				refs: [spec.Rs, spec.Q],
				rsGateRowDelta,
				rsLeftOfMosGate,
				maxRowDelta: cfg.maxRsGateRowDelta ?? 5,
				minLeft: cfg.minRsLeftOfMosGate ?? 35,
				maxLeft: cfg.maxRsLeftOfMosGate ?? 75,
			});
		}
	}

	if (qGate && rpdGate) {
		const rpdBelowGate = qGate.y - rpdc.y;
		const rpdGateXGap = Math.abs(rpdGate.x - qGate.x);
		if (rpdBelowGate < (cfg.minRpdBelowGate ?? 20) ||
			rpdBelowGate > (cfg.maxRpdBelowGate ?? 65) ||
			rpdGateXGap > (cfg.maxRpdGateXGap ?? 40)) {
			fail(F, 'C16.4-relay-gate-pulldown', 'Relay gate pulldown must stay below and local to the MOS gate node', {
				cell: spec.name,
				refs: [spec.Rpd, spec.Q],
				rpdBelowGate,
				rpdGateXGap,
				minBelow: cfg.minRpdBelowGate ?? 20,
				maxBelow: cfg.maxRpdBelowGate ?? 65,
				maxXGap: cfg.maxRpdGateXGap ?? 40,
			});
		}
	}

	if (qDrain && cnA && Math.abs(qDrain.x - cnA.x) > (cfg.maxTerminalRightOfMos ?? 190)) {
		fail(F, 'C16.5-relay-drain-terminal-span', 'MOS drain to relay terminal switched node is too stretched for a local relay cell', {
			cell: spec.name,
			refs: [spec.Q, spec.CN],
			span: Math.abs(qDrain.x - cnA.x),
			max: cfg.maxTerminalRightOfMos ?? 190,
		});
	}

}

function netsFor(spec) {
	const suffix = spec.name === 'relay1' ? '1' : '2';
	return {
		COILA: `RLY${suffix}_COIL_A`,
		COILV: `RLY${suffix}_COIL_V`,
	};
}

export function c16RelaySupport(m) {
	const F = [];
	const parts = new Map((m.parts || []).map(p => [p.designator, p]));
	parts.__segments = m.segments || [];
	for (const spec of RELAYS) checkRelay(F, parts, spec);
	return F;
}
