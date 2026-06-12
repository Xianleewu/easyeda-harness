import { CONFIG } from '../config.mjs';

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

export function c17LdoDecoupling(m) {
	const F = [];
	const cfg = CONFIG.ldoSupport || {};
	const parts = new Map((m.parts || []).map(p => [p.designator, p]));
	const u2 = part(parts, 'U2');
	const c2 = part(parts, 'C2');
	const c4 = part(parts, 'C4');
	if (!u2 || !c2 || !c4) return F;

	const u2c = center(u2);
	const c2c = center(c2);
	const c4c = center(c4);
	if (!u2c || !c2c || !c4c) return F;

	const u2VoutRight = pin(u2, '4') || pin(u2, 'VOUT');
	const c2Power = pin(c2, '1');
	const c2Gnd = pin(c2, '2');
	const c4Power = pin(c4, '1');
	const c4Gnd = pin(c4, '2');
	if (!u2VoutRight || !c2Power || !c2Gnd || !c4Power || !c4Gnd) return F;

	const nearestCapRight = Math.min(c2c.x, c4c.x) - u2c.x;
	const farthestCapRight = Math.max(c2c.x, c4c.x) - u2c.x;
	const capColumnSkew = Math.abs(c2c.y - c4c.y);
	const capPitch = Math.abs(c2c.x - c4c.x);
	if (nearestCapRight < (cfg.minCapRightOfRegulator ?? 45) ||
		farthestCapRight > (cfg.maxCapRightOfRegulator ?? 170) ||
		capColumnSkew > (cfg.maxCapColumnSkew ?? 8) ||
		capPitch < (cfg.minCapPitch ?? 35) ||
		capPitch > (cfg.maxCapPitch ?? 70)) {
		fail(F, 'C17.1-ldo-output-cap-column', 'LDO output capacitors must form a compact row to the right of the regulator', {
			refs: ['U2', 'C2', 'C4'],
			nearestCapRight,
			farthestCapRight,
			capColumnSkew,
			capPitch,
			minCapRight: cfg.minCapRightOfRegulator ?? 45,
			maxCapRight: cfg.maxCapRightOfRegulator ?? 170,
			maxColumnSkew: cfg.maxCapColumnSkew ?? 8,
			minPitch: cfg.minCapPitch ?? 35,
			maxPitch: cfg.maxCapPitch ?? 70,
		});
	}

	const capPowerRowDelta = Math.max(
		Math.abs(c2Power.y - u2VoutRight.y),
		Math.abs(c4Power.y - u2VoutRight.y),
	);
	const capPowerToBusDelta = Math.max(
		Math.abs(c2Power.y - c2c.y - 20),
		Math.abs(c4Power.y - c4c.y - 20),
	);
	if (capPowerRowDelta > (cfg.maxVoutRowDelta ?? 35) ||
		capPowerToBusDelta > (cfg.maxPowerPinToBusDelta ?? 35)) {
		fail(F, 'C17.2-ldo-vout-cap-power-pins', 'LDO output capacitor power pins must stay close to the VOUT local rail', {
			refs: ['U2', 'C2', 'C4'],
			u2Vout: { x: u2VoutRight.x, y: u2VoutRight.y },
			c2Power: { x: c2Power.x, y: c2Power.y },
			c4Power: { x: c4Power.x, y: c4Power.y },
			capPowerRowDelta,
			capPowerToBusDelta,
			maxRowDelta: cfg.maxVoutRowDelta ?? 35,
			maxPinToBusDelta: cfg.maxPowerPinToBusDelta ?? 35,
		});
	}

	const c2GndBelow = c2Power.y - c2Gnd.y;
	const c4GndBelow = c4Power.y - c4Gnd.y;
	const minBelow = Math.min(c2GndBelow, c4GndBelow);
	const maxBelow = Math.max(c2GndBelow, c4GndBelow);
	if (minBelow < (cfg.minGndBelowPowerPin ?? 25) || maxBelow > (cfg.maxGndBelowPowerPin ?? 55)) {
		fail(F, 'C17.3-ldo-local-ground-return', 'LDO output capacitor GND pins must return locally below the VOUT pins', {
			refs: ['C2', 'C4'],
			c2GndBelow,
			c4GndBelow,
			minBelow: cfg.minGndBelowPowerPin ?? 25,
			maxBelow: cfg.maxGndBelowPowerPin ?? 55,
		});
	}

	return F;
}
