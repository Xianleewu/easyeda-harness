// 命名导线 / 网名几何：竖直网名、stub 过长、锚点未落在引出端点
const EPS = 1;
const STUB_MAX = 55;
const STUB_MAX_BY_NET = new Map([
	['USB_CC1', 90],
	['USB_CC2', 90],
	['USB_DN', 100],
	['USB_DP', 100],
	['EXT_PWR_EN', 110],
	['RELAY1_EN', 100],
	['RELAY2_EN', 100],
	['RESET_EN', 100],
	['BOOT_IO9', 80],
]);
const POWER_NETS = new Set(['GND', 'SYS_5V', 'SYS_3V3', 'VIN_12_19V', 'VOUT_SW']);

export function segsFromWires(wires) {
	const out = [];
	for (const w of wires || []) {
		const l = w.line || [];
		for (let i = 0; i + 3 < l.length; i += 2) {
			const a = [l[i], l[i + 1]], b = [l[i + 2], l[i + 3]];
			if (a[0] === b[0] && a[1] === b[1]) continue;
			const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
			out.push({ a, b, net: w.net || '', len, horiz: a[1] === b[1], vert: a[0] === b[0], pointCount: l.length / 2, wireId: w.id });
		}
	}
	return out;
}

function isSignalNet(net) {
	return net && !POWER_NETS.has(net) && !net.startsWith('NC_');
}

function sigFlags(flags) {
	return (flags || []).filter(f => f.kind === 'sig');
}

function stubMax(net) {
	return STUB_MAX_BY_NET.get(net) ?? STUB_MAX;
}

function labelWidth(net) {
	return Math.max(38, String(net || '').length * 6 + 16);
}

function labelBoxFromVisibleAttr(a) {
	const w = labelWidth(a.value);
	const h = 8;
	const x = Number(a.x);
	const y = Number(a.y);
	const mode = a.alignMode == null ? null : Number(a.alignMode);
	if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
	if (mode === 2) return { minX: x - w / 2, maxX: x + w / 2, minY: y - h / 2, maxY: y + h / 2 };
	if (mode === 1) return { minX: x, maxX: x + w, minY: y - h, maxY: y };
	if (mode === 3) return { minX: x - w, maxX: x, minY: y - h, maxY: y };
	if (mode === 7 || mode == null) return { minX: x, maxX: x + w, minY: y, maxY: y + h };
	if (mode === 9) return { minX: x - w, maxX: x, minY: y, maxY: y + h };
	return { minX: x, maxX: x + w, minY: y, maxY: y + h };
}

function segmentIntersectsBoxInterior(s, box) {
	if (!box) return false;
	const x1 = s.line[0], y1 = s.line[1], x2 = s.line[2], y2 = s.line[3];
	if (Math.abs(y1 - y2) <= EPS) {
		const y = y1;
		if (y <= box.minY + EPS || y >= box.maxY - EPS) return false;
		return Math.max(Math.min(x1, x2), box.minX) < Math.min(Math.max(x1, x2), box.maxX) - EPS;
	}
	if (Math.abs(x1 - x2) <= EPS) {
		const x = x1;
		if (x <= box.minX + EPS || x >= box.maxX - EPS) return false;
		return Math.max(Math.min(y1, y2), box.minY) < Math.min(Math.max(y1, y2), box.maxY) - EPS;
	}
	return false;
}

function overlap(a, b) {
	return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

function expandRect(r, d) {
	return { minX: r.minX - d, minY: r.minY - d, maxX: r.maxX + d, maxY: r.maxY + d };
}

function pointOnSegmentLoose(x, y, s, tol = EPS) {
	if (s.horiz) return Math.abs(y - s.a[1]) <= tol && x >= Math.min(s.a[0], s.b[0]) - tol && x <= Math.max(s.a[0], s.b[0]) + tol;
	if (s.vert) return Math.abs(x - s.a[0]) <= tol && y >= Math.min(s.a[1], s.b[1]) - tol && y <= Math.max(s.a[1], s.b[1]) + tol;
	return false;
}

function hasExplicitLabelOnSegment(labels, s) {
	return labels.some(f => f.net === s.net && pointOnSegmentLoose(f.x, f.y, s));
}

function autoWireLabelBoxes(s) {
	const w = labelWidth(s.net);
	const h = 11;
	const minX = Math.min(s.a[0], s.b[0]);
	const maxX = Math.max(s.a[0], s.b[0]);
	const minY = Math.min(s.a[1], s.b[1]);
	const maxY = Math.max(s.a[1], s.b[1]);
	const midX = (s.a[0] + s.b[0]) / 2;
	const midY = (s.a[1] + s.b[1]) / 2;
	if (s.horiz) {
		return [
			{ role: 'mid', minX: midX - w / 2, maxX: midX + w / 2, minY: midY - h / 2, maxY: midY + h / 2 },
			{ role: 'right-end', minX: maxX + 6, maxX: maxX + 6 + w, minY: midY - h / 2, maxY: midY + h / 2 },
			{ role: 'left-end', minX: minX - 6 - w, maxX: minX - 6, minY: midY - h / 2, maxY: midY + h / 2 },
		];
	}
	if (s.vert) {
		return [
			{ role: 'mid', minX: midX - h / 2, maxX: midX + h / 2, minY: midY - w / 2, maxY: midY + w / 2 },
			{ role: 'top-end', minX: midX - h / 2, maxX: midX + h / 2, minY: maxY + 6, maxY: maxY + 6 + w },
			{ role: 'bottom-end', minX: midX - h / 2, maxX: midX + h / 2, minY: minY - 6 - w, maxY: minY - 6 },
		];
	}
	return [];
}

function autoWireLabelRiskFindings(segs, labels, components) {
	const findings = [];
	const comps = (components || []).filter(c => c?.bbox);
	const explicitNets = new Set(labels.map(f => f.net).filter(Boolean));
	for (const s of segs) {
		if (!isSignalNet(s.net) || explicitNets.has(s.net) || hasExplicitLabelOnSegment(labels, s)) continue;
		for (const c of comps) {
			const body = c.bodyBBox || c.bbox;
			const keepout = expandRect(body, 4);
			const hit = autoWireLabelBoxes(s).find(bb => overlap(bb, keepout));
			if (!hit) continue;
			findings.push({
				rule: 'C6.3-auto-wire-label-over-comp',
				severity: 'hard',
				category: 'overlap',
				msg: `Auto-rendered wire net name [${s.net}] can overlap ${c.designator}`,
				where: {
					net: s.net,
					comp: c.designator,
					seg: [...s.a, ...s.b],
					labelBox: hit,
				},
			});
			break;
		}
	}
	return findings;
}

/** pipeline / full_model：带 sig 锚点的网名导线规则 */
export function wireLabelQC(model) {
	const findings = [];
	const S = segsFromWires(model.wires);
	const sigs = sigFlags(model.netflags);
	const visibleNets = new Set(sigs.map(f => f.net).filter(Boolean));

	// L7 汇流竖直带网名（同 x 列另有水平命名段 → EDA 竖排网名）
	for (const s of S) {
		if (!visibleNets.has(s.net) || !isSignalNet(s.net) || !s.vert || s.len < 8) continue;
		const colX = s.a[0];
		const paired = S.some(t => t.net === s.net && t.horiz
			&& (Math.abs(t.a[0] - colX) < EPS || Math.abs(t.b[0] - colX) < EPS));
		if (!paired) continue;
		findings.push({ rule: 'L7-net-vertical', severity: 'hard', category: 'wiring',
			msg: `信号网 [${s.net}] 汇流竖直段带网名 len=${Math.round(s.len)}（应改为无网名竖直+水平 stub）`,
			where: { net: s.net, seg: [...s.a, ...s.b] } });
	}

	// L8 左向网标锚点须为水平命名段外端点 (xLbl, tapY)
	for (const f of sigs) {
		const rot = ((f.rotation ?? f.rot ?? 0) % 360 + 360) % 360;
		if (rot !== 180) continue;
		const hit = S.find(s => s.net === f.net && s.horiz
			&& Math.abs(s.a[1] - f.y) < EPS
			&& (Math.abs(s.b[0] - f.x) < EPS || Math.abs(s.a[0] - f.x) < EPS)
			&& Math.abs(s.a[0] - s.b[0]) > EPS);
		if (!hit)
			findings.push({ rule: 'L8-label-not-at-stub-end', severity: 'hard', category: 'label',
				msg: `网名 [${f.net}] 锚点 (${f.x},${f.y}) 非水平命名导线端点`,
				where: { net: f.net, x: f.x, y: f.y } });
	}

	// L9 水平命名 stub 过长
	for (const s of S) {
		if (!visibleNets.has(s.net) || !isSignalNet(s.net) || !s.horiz) continue;
		if (s.len > stubMax(s.net))
			findings.push({ rule: 'L9-stub-too-long', severity: 'hard', category: 'wiring',
				msg: `网名 [${s.net}] 水平 stub 过长 ${Math.round(s.len)} > ${STUB_MAX}`,
				where: { net: s.net, len: Math.round(s.len), seg: [...s.a, ...s.b] } });
	}

	// L10 同网同高度多条水平命名 stub（重复网名/覆盖）
	const buckets = new Map();
	for (const s of S) {
		if (!visibleNets.has(s.net) || !isSignalNet(s.net) || !s.horiz || s.len < 12) continue;
		const y = Math.round(s.a[1]);
		const k = `${s.net}|${y}`;
		if (!buckets.has(k)) buckets.set(k, []);
		buckets.get(k).push(s);
	}
	for (const [k, arr] of buckets) {
		if (arr.length < 2) continue;
		const net = k.split('|')[0];
		// 仅当同网同 y 的水平命名段【x 范围真重叠】才算重复/覆盖(视觉互压)。同 y 但 x 相距远 = 不同列的
		// 同一跨模块网的两个合法标签(各模块界面一个),不重叠、非缺陷——不报,避免密集板跨列误报。
		const ranges = arr.map(s => [Math.min(s.a[0], s.b[0]), Math.max(s.a[0], s.b[0])]).sort((p, q) => p[0] - q[0]);
		let overlap = false;
		for (let i = 1; i < ranges.length; i++) { if (ranges[i][0] < ranges[i - 1][1] - 1) { overlap = true; break; } }
		if (!overlap) continue;
		findings.push({ rule: 'L10-dup-named-stub', severity: 'hard', category: 'wiring',
			msg: `网名 [${net}] 在 y=${k.split('|')[1]} 有多条 x 重叠的水平命名段`, where: { net, count: arr.length } });
	}

	return findings;
}

/** EDA 快照：无 sig 锚点，仅凭导线几何检测 */
export function wireLabelQCFromSnap(snap) {
	const findings = [];
	const S = segsFromWires(snap.wires);

	for (const s of S) {
		if (!isSignalNet(s.net) || !s.vert || s.len <= 20) continue;
		const colX = s.a[0];
		const paired = S.some(t => t.net === s.net && t.horiz
			&& (Math.abs(t.a[0] - colX) < EPS || Math.abs(t.b[0] - colX) < EPS));
		if (!paired) continue;
		findings.push({ rule: 'C6.1-net-vertical', severity: 'hard', category: 'wiring',
			msg: `信号网 [${s.net}] 汇流竖直段带网名 len=${Math.round(s.len)}`,
			where: { net: s.net, seg: [...s.a, ...s.b] } });
	}

	for (const s of S) {
		if (!isSignalNet(s.net) || !s.horiz) continue;
		if (s.len > stubMax(s.net))
			findings.push({ rule: 'C6.2-stub-too-long', severity: 'hard', category: 'wiring',
				msg: `网名 [${s.net}] 水平 stub 过长 ${Math.round(s.len)} > ${STUB_MAX}`,
				where: { net: s.net, len: Math.round(s.len) } });
	}

	return findings;
}

export function wireLabelQCFromLiveSnap(snap) {
	const labels = (snap.netflags || [])
		.filter(f => (f.kind === 'sig') || (f.type === 'netport') || (f.type === 'netlabel'))
		.filter(f => f.net && Number.isFinite(f.x) && Number.isFinite(f.y));
	const explicitWires = [];
	for (const w of snap.wires || []) {
		const visibleBoxes = (w.attrs || [])
			.filter(a => (a.key === 'NET' || a.key === 'Name') && a.valueVisible !== false)
			.map(labelBoxFromVisibleAttr)
			.filter(Boolean);
		const l = w.line || [];
		const step = w.id && l.length >= 8 && l.length % 4 === 0 ? 4 : 2;
		for (let i = 0; i + 3 < l.length; i += step) {
			const line = [l[i], l[i + 1], l[i + 2], l[i + 3]];
			if (line[0] === line[2] && line[1] === line[3]) continue;
			const seg = { id: w.id, net: w.net || '', line };
			const visible = visibleBoxes.some(box => segmentIntersectsBoxInterior(seg, box));
			explicitWires.push({ id: w.id, net: visible ? w.net : '', line });
		}
	}
	const findings = wireLabelQCFromSnap({ wires: explicitWires });
	if (snap.assumeVisibleWireNetNames) {
		const namedWires = [];
		for (const w of snap.wires || []) {
			const l = w.line || [];
			const step = w.id && l.length >= 8 && l.length % 4 === 0 ? 4 : 2;
			for (let i = 0; i + 3 < l.length; i += step) {
				const line = [l[i], l[i + 1], l[i + 2], l[i + 3]];
				if (line[0] === line[2] && line[1] === line[3]) continue;
				namedWires.push({ id: w.id, net: w.net || '', line });
			}
		}
		findings.push(...autoWireLabelRiskFindings(segsFromWires(namedWires), labels, snap.components || snap.parts || []));
	}
	return findings;
}
