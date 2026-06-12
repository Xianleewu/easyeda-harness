// 电源/地符号：导线入向 vs 旋转是否匹配（规则书 §1.6 / §4.13）
import { readFileSync } from 'node:fs';
import { flagBBox } from './buildmodel.mjs';

const EPS = 1e-3;

function segs(model) {
	const out = [];
	for (const w of model.wires || []) {
		const l = w.line || [];
		for (let i = 0; i + 3 < l.length; i += 2) {
			const a = [l[i], l[i + 1]], b = [l[i + 2], l[i + 3]];
			if (a[0] === b[0] && a[1] === b[1]) continue;
			out.push({ a, b, net: w.net || '' });
		}
	}
	return out;
}

/* 导线从 from 进入锚点 to。GND rot0=体在下方(y-) rot180=体在上方 rot90=体在右 rot270=体在左 */
function expectRot(kind, dx, dy) {
	if (Math.abs(dx) >= Math.abs(dy)) {
		if (dx > EPS) return kind === 'gnd' ? 270 : 180;
		if (dx < -EPS) return kind === 'gnd' ? 90 : 0;
	}
	if (dy > EPS) return kind === 'gnd' ? 0 : 180;
	if (dy < -EPS) return kind === 'gnd' ? 180 : 0;
	return null;
}

function wireAtFlag(segs, fx, fy) {
	for (const s of segs) {
		if (Math.abs(s.a[0] - fx) < EPS && Math.abs(s.a[1] - fy) < EPS)
			return { from: s.b, to: s.a };
		if (Math.abs(s.b[0] - fx) < EPS && Math.abs(s.b[1] - fy) < EPS)
			return { from: s.a, to: s.b };
	}
	return null;
}

export function flagQC(model) {
	const S = segs(model);
	const badRot = [];
	const wireThru = [];
	for (const f of model.netflags || []) {
		if (f.kind !== 'gnd' && f.kind !== 'power') continue;
		const rot = ((f.rotation ?? f.rot ?? 0) % 360 + 360) % 360;
		const hit = wireAtFlag(S, f.x, f.y);
		if (hit) {
			const dx = hit.from[0] - hit.to[0], dy = hit.from[1] - hit.to[1];
			const want = expectRot(f.kind, dx, dy);
			if (want !== null && want !== rot)
				badRot.push({ net: f.net, kind: f.kind, x: f.x, y: f.y, rot, want, entry: [dx, dy] });
		}
		const bb = f.bbox || flagBBox({ ...f, rotation: rot });
		const body = { minX: bb.minX + 2, maxX: bb.maxX - 2, minY: bb.minY + 2, maxY: bb.maxY - 2 };
		const inside = (x, y) => x > body.minX && x < body.maxX && y > body.minY && y < body.maxY;
		for (const s of S) {
			if (s.net !== f.net && s.net !== 'GND' && f.net !== 'GND') continue;
			const ax = s.a[0], ay = s.a[1], bx = s.b[0], by = s.b[1];
			const atA = Math.abs(ax - f.x) < EPS && Math.abs(ay - f.y) < EPS;
			const atB = Math.abs(bx - f.x) < EPS && Math.abs(by - f.y) < EPS;
			if (atA || atB) continue;
			if (ax === bx) {
				const y0 = Math.min(ay, by), y1 = Math.max(ay, by);
				if (ax > body.minX && ax < body.maxX && y0 < body.maxY && y1 > body.minY)
					wireThru.push({ net: f.net, x: f.x, y: f.y, seg: [ax, ay, bx, by] });
			} else if (ay === by) {
				const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
				if (ay > body.minY && ay < body.maxY && x0 < body.maxX && x1 > body.minX)
					wireThru.push({ net: f.net, x: f.x, y: f.y, seg: [ax, ay, bx, by] });
			}
		}
	}
	return { badRot, wireThru };
}

if (process.argv[1]?.endsWith('flag_qc.mjs') && process.argv[2]) {
	const m = JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
	const r = flagQC(m);
	console.log('GND/Power 旋转不符:', r.badRot.length);
	for (const b of r.badRot) console.log(' ', b.net, `@(${b.x},${b.y})`, `rot=${b.rot}`, `want=${b.want}`, `entry=[${b.entry}]`);
	console.log('导线穿 GND/Power 体:', r.wireThru.length);
	for (const w of r.wireThru.slice(0, 12)) console.log(' ', w.net, `@(${w.x},${w.y})`, w.seg);
}
