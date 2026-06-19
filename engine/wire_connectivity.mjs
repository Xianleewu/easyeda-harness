// 连通性门(纯函数):验证合成模型的导线/网标几何确实实现了逻辑网的引脚连通。
//
// 合成把连通表示为:脚 →(无名逃逸线)→ 命名线/网标。EDA 按几何相连 + 同名网连通。
// 本检查重构同口径连通:并查集合并所有线的顶点 + 引脚坐标 → 几何簇;命名线/网标在其
// 位置给所在簇打网名;每个逻辑信号网的每个脚都须落在带该网名的簇,否则该脚断连。
// 守护"离线模型电气正确"这一性质不被未来改动破坏。

const refOfPin = p => p.slice(0, p.lastIndexOf('.'));
const key = (x, y) => Math.round(x) + ',' + Math.round(y);

export function wireConnectivity({ model, logical } = {}) {
	if (!model || !Array.isArray(model.components)) throw new TypeError('wireConnectivity: model.components required');
	if (!logical || !Array.isArray(logical.nets)) throw new TypeError('wireConnectivity: logical.nets required');

	const par = new Map();
	const find = x => { if (!par.has(x)) par.set(x, x); let r = x; while (par.get(r) !== r) r = par.get(r); while (par.get(x) !== r) { const n = par.get(x); par.set(x, r); x = n; } return r; };
	const uni = (a, b) => par.set(find(a), find(b));

	// 合并每条线的相邻顶点(整条线一簇)。
	const segs = [];
	for (const w of (model.wires || [])) {
		const l = w.line || []; const pts = [];
		for (let i = 0; i + 1 < l.length; i += 2) pts.push(key(l[i], l[i + 1]));
		for (let i = 1; i < pts.length; i++) uni(pts[i - 1], pts[i]);
		for (let i = 0; i + 3 < l.length; i += 2) {
			if (l[i] === l[i + 2] && l[i + 1] === l[i + 3]) continue;
			segs.push({ a: [l[i], l[i + 1]], b: [l[i + 2], l[i + 3]] });
		}
	}
	// T 接 / 点压线:线顶点 + 引脚坐标若落在某轴向线段上(含内部),union 入该段——匹配 EDA 几何连通。
	// 原 union 只连每条线自身相邻顶点,漏「端点落在另一线内部」的 T 接 → 靠无名线 T 接连通的脚被误判断连。
	const onSeg = (px, py, s) => {
		const [ax, ay] = s.a, [bx, by] = s.b;
		if (ay === by) return Math.abs(py - ay) < 1 && px >= Math.min(ax, bx) - 0.5 && px <= Math.max(ax, bx) + 0.5;
		if (ax === bx) return Math.abs(px - ax) < 1 && py >= Math.min(ay, by) - 0.5 && py <= Math.max(ay, by) + 0.5;
		return false;
	};
	const touchPts = [];
	for (const w of (model.wires || [])) { const l = w.line || []; for (let i = 0; i + 1 < l.length; i += 2) touchPts.push([l[i], l[i + 1]]); }
	for (const c of model.components) for (const p of (c.pins || [])) touchPts.push([p.x, p.y]);
	for (const [px, py] of touchPts) {
		for (const s of segs) {
			if (onSeg(px, py, s)) { const k = key(px, py); uni(k, key(s.a[0], s.a[1])); uni(k, key(s.b[0], s.b[1])); }
		}
	}

	// 簇 → 网名(命名线首端点 + 网标位置)。
	const clusterNets = new Map();
	const addName = (k, net) => { const r = find(k); if (!clusterNets.has(r)) clusterNets.set(r, new Set()); clusterNets.get(r).add(net); };
	for (const w of (model.wires || [])) { if (!w.net) continue; const l = w.line || []; if (l.length < 2) continue; addName(key(l[0], l[1]), w.net); }
	for (const f of (model.netflags || [])) { if (f.net) addName(key(f.x, f.y), f.net); }

	// 引脚 → 其几何簇的网名集。
	const pinPos = new Map();
	for (const c of model.components) for (const p of (c.pins || [])) pinPos.set(`${c.designator}.${p.num}`, key(p.x, p.y));
	const pinNets = ref => { const k = pinPos.get(ref); if (k === undefined) return null; const set = clusterNets.get(find(k)); return set ? set : null; };

	const findings = [];
	for (const net of logical.nets) {
		if (net.class !== 'signal' || !net.name) continue;
		const refs = [...new Set((net.pins || []).map(p => p))].filter(p => pinPos.has(p));
		if (refs.length < 2) continue;   // 单脚无连通可验
		const broken = refs.filter(r => { const ns = pinNets(r); return !ns || !ns.has(net.name); });
		if (broken.length) {
			findings.push({
				rule: 'WC-disconnected', severity: 'hard', category: 'connectivity',
				msg: `网 ${net.name} 的脚 ${broken.join(',')} 未连到带该网名的几何簇(断连)`,
				where: { net: net.name, broken },
			});
		}
	}
	return findings;
}
