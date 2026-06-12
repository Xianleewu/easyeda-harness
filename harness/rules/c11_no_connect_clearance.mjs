import { CONFIG } from '../config.mjs';
import { segIntersectsRect, samePt } from '../model.mjs';
import { flagBBox } from '../../engine/buildmodel.mjs';

function expandRect(r, d) {
	return { minX: r.minX - d, maxX: r.maxX + d, minY: r.minY - d, maxY: r.maxY + d };
}

function overlap(a, b) {
	return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

function ncBBox(pin) {
	const h = CONFIG.noConnect.halfSize + CONFIG.noConnect.clearance;
	return { minX: pin.x - h, maxX: pin.x + h, minY: pin.y - h, maxY: pin.y + h };
}

function netflagBBox(f) {
	if (f.bbox) return expandRect(f.bbox, CONFIG.noConnect.clearance);
	const kind = f.kind || (f.type === 'netport' ? 'sig' : (f.net === 'GND' ? 'gnd' : 'power'));
	const rotation = f.rotation ?? f.rot ?? 0;
	return expandRect(flagBBox({ ...f, kind, rotation }), CONFIG.noConnect.clearance);
}

function markerRef(part, pin) {
	return `${part.designator}.${pin.num || pin.name || '?'}`;
}

export function c11NoConnectClearance(m) {
	const F = [];
	const markers = [];
	for (const part of m.parts || []) {
		for (const pin of part.pins || []) {
			if (pin.noConnected) markers.push({ part, pin, bbox: ncBBox(pin), ref: markerRef(part, pin) });
		}
	}

	for (const nc of markers) {
		for (const f of m.netflags || []) {
			const fb = netflagBBox(f);
			if (!overlap(nc.bbox, fb)) continue;
			F.push({ rule: 'C11.1-nc-symbol-overlap', severity: 'hard', category: 'overlap',
				msg: `NoConnected marker ${nc.ref} overlaps ${f.net || f.kind || f.type || 'netflag'} symbol @(${f.x},${f.y})`,
				where: { noConnect: nc.ref, pin: [nc.pin.x, nc.pin.y], symbol: { net: f.net, x: f.x, y: f.y } } });
		}

		for (const s of m.segments || []) {
			const touchesNcPin = samePt(s.x1, s.y1, nc.pin.x, nc.pin.y) || samePt(s.x2, s.y2, nc.pin.x, nc.pin.y);
			if (touchesNcPin) {
				F.push({ rule: 'C11.3-nc-pin-wired', severity: 'hard', category: 'electrical',
					msg: `NoConnected marker ${nc.ref} is attached to an electrical wire`,
					where: { noConnect: nc.ref, seg: [s.x1, s.y1, s.x2, s.y2], net: s.net || '' } });
				break;
			}
			if (samePt(s.x1, s.y1, s.x2, s.y2)) continue;
			const pinOnSegment = segIntersectsRect(s, { minX: nc.pin.x - 0.5, maxX: nc.pin.x + 0.5, minY: nc.pin.y - 0.5, maxY: nc.pin.y + 0.5 });
			if (pinOnSegment) {
				F.push({ rule: 'C11.3-nc-pin-wired', severity: 'hard', category: 'electrical',
					msg: `NoConnected marker ${nc.ref} is crossed by an electrical wire at the pin`,
					where: { noConnect: nc.ref, seg: [s.x1, s.y1, s.x2, s.y2], net: s.net || '' } });
				break;
			}
		}

		for (const s of m.segments || []) {
			const touchesNcPin = samePt(s.x1, s.y1, nc.pin.x, nc.pin.y) || samePt(s.x2, s.y2, nc.pin.x, nc.pin.y);
			if (touchesNcPin || !segIntersectsRect(s, nc.bbox)) continue;
			F.push({ rule: 'C11.2-wire-over-nc-symbol', severity: 'hard', category: 'overlap',
				msg: `Wire visually crosses NoConnected marker ${nc.ref} seg=[${s.x1},${s.y1},${s.x2},${s.y2}]`,
				where: { noConnect: nc.ref, seg: [s.x1, s.y1, s.x2, s.y2], net: s.net || '' } });
			break;
		}
	}

	return F;
}
