import { CONFIG } from '../config.mjs';

const BUTTONS = [
	{ name: 'reset', sw: 'SW1', pullup: 'R18', cap: 'C3' },
	{ name: 'boot', sw: 'SW2', pullup: 'R17' },
];

function part(parts, ref) {
	return parts.get(ref) || null;
}

function pin(p, num) {
	return (p?.pins || []).find(x => String(x.num) === String(num)) || null;
}

function center(p) {
	const b = p?.bodyBBox || p?.bbox;
	return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : null;
}

function fail(F, rule, msg, where) {
	F.push({ rule, severity: 'hard', category: 'layout', msg, where });
}

function signalPins(sw, pullupPin) {
	const pins = (sw?.pins || []).filter(p => !p.noConnected);
	if (!pins.length || !pullupPin) return [];
	const minDist = Math.min(...pins.map(p => Math.abs(p.x - pullupPin.x)));
	return pins.filter(p => Math.abs(Math.abs(p.x - pullupPin.x) - minDist) < 1e-6);
}

function checkButton(F, parts, spec) {
	const cfg = CONFIG.buttonSupport || {};
	const sw = part(parts, spec.sw);
	const rpu = part(parts, spec.pullup);
	if (!sw || !rpu) return;
	const swc = center(sw);
	const rpuc = center(rpu);
	const rpuSignal = pin(rpu, '1');
	if (!swc || !rpuc || !rpuSignal) return;

	const sigPins = signalPins(sw, rpuSignal);
	const signalXGap = sigPins.length ? Math.min(...sigPins.map(p => Math.abs(p.x - rpuSignal.x))) : Infinity;
	const signalTopY = sigPins.length ? Math.max(...sigPins.map(p => p.y)) : null;
	const signalYGap = signalTopY == null ? Infinity : rpuSignal.y - signalTopY;
	const pullupXOffset = Math.abs(rpuc.x - swc.x);
	const pullupAboveSwitch = rpuc.y - swc.y;
	if (pullupXOffset > (cfg.maxPullupXOffset ?? 35) ||
		pullupAboveSwitch < (cfg.minPullupAboveSwitch ?? 45) ||
		pullupAboveSwitch > (cfg.maxPullupAboveSwitch ?? 80) ||
		signalXGap > (cfg.maxPullupSignalXGap ?? 8) ||
		signalYGap < (cfg.minPullupSignalYGap ?? 10) ||
		signalYGap > (cfg.maxPullupSignalYGap ?? 45)) {
		fail(F, 'C18.1-button-pullup-placement', 'Reset/boot pull-up must sit above the switch signal side as a compact local cell', {
			cell: spec.name,
			refs: [spec.sw, spec.pullup],
			pullupXOffset,
			pullupAboveSwitch,
			signalXGap,
			signalYGap,
			maxXOffset: cfg.maxPullupXOffset ?? 35,
			minAbove: cfg.minPullupAboveSwitch ?? 45,
			maxAbove: cfg.maxPullupAboveSwitch ?? 80,
			maxSignalXGap: cfg.maxPullupSignalXGap ?? 8,
			minSignalYGap: cfg.minPullupSignalYGap ?? 10,
			maxSignalYGap: cfg.maxPullupSignalYGap ?? 45,
		});
	}

	if (!spec.cap) return;
	const cap = part(parts, spec.cap);
	if (!cap) return;
	const capc = center(cap);
	const capSignal = pin(cap, '1');
	const capGnd = pin(cap, '2');
	if (!capc || !capSignal || !capGnd || signalTopY == null) return;
	const capRightOfSwitch = capc.x - swc.x;
	const capRowDelta = Math.abs(capc.y - swc.y);
	const capSignalRowDelta = Math.abs(capSignal.y - rpuSignal.y);
	const capGndRightOfSignal = capGnd.x - capSignal.x;
	if (capRightOfSwitch < (cfg.minResetCapRightOfSwitch ?? 65) ||
		capRightOfSwitch > (cfg.maxResetCapRightOfSwitch ?? 125) ||
		capRowDelta > (cfg.maxResetCapRowDelta ?? 40) ||
		capSignalRowDelta > (cfg.maxResetCapSignalRowDelta ?? 15) ||
		capGndRightOfSignal < (cfg.minResetCapGndRightOfSignal ?? 25) ||
		capGndRightOfSignal > (cfg.maxResetCapGndRightOfSignal ?? 55)) {
		fail(F, 'C18.2-reset-cap-placement', 'Reset capacitor must stay on the local reset signal row with a nearby ground return', {
			cell: spec.name,
			refs: [spec.sw, spec.pullup, spec.cap],
			capRightOfSwitch,
			capRowDelta,
			capSignalRowDelta,
			capGndRightOfSignal,
			minRight: cfg.minResetCapRightOfSwitch ?? 65,
			maxRight: cfg.maxResetCapRightOfSwitch ?? 125,
			maxRowDelta: cfg.maxResetCapRowDelta ?? 40,
			maxSignalRowDelta: cfg.maxResetCapSignalRowDelta ?? 15,
			minGndRight: cfg.minResetCapGndRightOfSignal ?? 25,
			maxGndRight: cfg.maxResetCapGndRightOfSignal ?? 55,
		});
	}
}

export function c18ResetBootSupport(m) {
	const F = [];
	const parts = new Map((m.parts || []).map(p => [p.designator, p]));
	for (const spec of BUTTONS) checkButton(F, parts, spec);
	return F;
}
