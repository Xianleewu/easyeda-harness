import { CONFIG } from '../config.mjs';

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

function checkCc(F, parts, spec) {
	const j = part(parts, 'J1');
	const r = part(parts, spec.ref);
	const jPin = pin(j, spec.jPin);
	const rPin = pin(r, '2');
	if (!jPin || !rPin) return;
	const rowDelta = Math.abs(jPin.y - rPin.y);
	const xGap = jPin.x - rPin.x;
	const maxRowDelta = CONFIG.usbSupport?.maxCcRowDelta ?? 1;
	const minGap = CONFIG.usbSupport?.minCcPinGap ?? 10;
	const maxGap = CONFIG.usbSupport?.maxCcPinGap ?? 35;
	if (rowDelta > maxRowDelta || xGap < minGap || xGap > maxGap) {
		F.push({
			rule: 'C14.1-usb-cc-pull-down-placement',
			severity: 'hard',
			category: 'layout',
			msg: `${spec.ref} must sit close and row-aligned to J1.${spec.jPin}: rowDelta=${rowDelta}, xGap=${xGap}`,
			where: { ref: spec.ref, jPin: spec.jPin, rowDelta, xGap, maxRowDelta, minGap, maxGap },
		});
	}
}

function checkSeries(F, parts) {
	const j = part(parts, 'J1');
	const r11 = part(parts, 'R11');
	const r12 = part(parts, 'R12');
	if (!j || !r11 || !r12) return;
	const c11 = center(r11);
	const c12 = center(r12);
	if (!c11 || !c12) return;
	const maxColumnSkew = CONFIG.usbSupport?.maxSeriesColumnSkew ?? 4;
	const minRowPitch = CONFIG.usbSupport?.minSeriesRowPitch ?? 20;
	const maxRowPitch = CONFIG.usbSupport?.maxSeriesRowPitch ?? 45;
	const columnSkew = Math.abs(c11.x - c12.x);
	const rowPitch = Math.abs(c11.y - c12.y);
	if (columnSkew > maxColumnSkew || rowPitch < minRowPitch || rowPitch > maxRowPitch) {
		F.push({
			rule: 'C14.2-usb-series-resistor-column',
			severity: 'hard',
			category: 'layout',
			msg: `USB D+/D- series resistors must form a compact aligned column: columnSkew=${columnSkew}, rowPitch=${rowPitch}`,
			where: { refs: ['R11', 'R12'], columnSkew, rowPitch, maxColumnSkew, minRowPitch, maxRowPitch },
		});
	}

	const maxRowDelta = CONFIG.usbSupport?.maxSeriesRowDelta ?? 35;
	const maxPinGap = CONFIG.usbSupport?.maxSeriesPinGap ?? 90;
	const checks = [
		{ ref: 'R11', r: r11, jPins: ['B7', 'A7'] },
		{ ref: 'R12', r: r12, jPins: ['B6', 'A6'] },
	];
	for (const spec of checks) {
		const rPin = pin(spec.r, '2');
		const candidates = spec.jPins.map(n => pin(j, n)).filter(Boolean);
		if (!rPin || !candidates.length) continue;
		const best = candidates
			.map(p => ({ pin: p.num, rowDelta: Math.abs(p.y - rPin.y), xGap: p.x - rPin.x }))
			.sort((a, b) => a.rowDelta - b.rowDelta || Math.abs(a.xGap) - Math.abs(b.xGap))[0];
		if (best.rowDelta > maxRowDelta || best.xGap < 0 || best.xGap > maxPinGap) {
			F.push({
				rule: 'C14.3-usb-series-near-data-pin',
				severity: 'hard',
				category: 'layout',
				msg: `${spec.ref} must stay close to its USB data pin row: best J1.${best.pin} rowDelta=${best.rowDelta}, xGap=${best.xGap}`,
				where: { ref: spec.ref, best, maxRowDelta, maxPinGap },
			});
		}
	}
}

export function c14UsbSupport(m) {
	const F = [];
	const parts = new Map((m.parts || []).map(p => [p.designator, p]));
	checkCc(F, parts, { ref: 'R9', jPin: 'A5' });
	checkCc(F, parts, { ref: 'R10', jPin: 'B5' });
	checkSeries(F, parts);
	return F;
}
