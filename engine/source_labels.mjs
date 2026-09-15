/* 从文档源解析 net 文本标签几何,补进裁判模型。通用、零特定电路。
 *
 * 为何需要:EasyEDA Pro 运行时 API 不暴露挂在 wire 上的 NET 文本标签几何
 *   (sch_PrimitiveAttribute.getAll(wireId)=[]、全量 attr 中无 key=NET、无 Text 原语、wire 仅暴露 net 名)。
 *   → readGeometry 看不到 net 标签 → 裁判 labels:0 平凡过(标签重叠/对齐根本没被度量)。
 * 正解:net 标签位置在【文档源】里(我们投递时设的 ATTR{key:NET,x,y},=渲染位);标签【尺寸】用 live 可查的
 *   组件可见 attr(Designator/Name)bbox 标定真字体得到 → 算出标签 bbox,喂进 judgeTokens(对齐+重叠)。
 *   这样 `judge --live` 能真正度量 net 标签重叠/对齐(尺子诚实),而非假装 0。
 *
 * 坐标:源 y 向上 → 屏幕 y = -源y(与 readGeometry 屏幕系一致,readGeometry 给 y 向下)。 */

const DEFAULT_CHAR_W = 7, DEFAULT_CHAR_H = 10;

const median = arr => {
	if (!arr.length) return null;
	const s = [...arr].sort((x, y) => x - y);
	return s[Math.floor(s.length / 2)];
};

/* 从可查组件可见 attr(Designator/Name 等)bbox 标定真字体:charW=中位(bbox宽/字数), charH=中位(bbox高)。
 * net 标签与这些 attr 同字体 → 用它们的真渲染尺寸标定,避免凭空设小(凭空设小=漏报重叠=尺子瞎)。 */
export function calibrateFont(components = []) {
	const ws = [], hs = [];
	for (const c of components) {
		for (const a of (c.attrs || [])) {
			if (!a.bbox || !(a.valueVisible || a.keyVisible) || !a.value) continue;
			const len = String(a.value).length;
			const w = a.bbox.maxX - a.bbox.minX, h = a.bbox.maxY - a.bbox.minY;
			if (len >= 1 && w > 0) ws.push(w / len);
			if (h > 0) hs.push(h);
		}
	}
	return { charW: median(ws) ?? DEFAULT_CHAR_W, charH: median(hs) ?? DEFAULT_CHAR_H };
}

/* 解析源里的可见 NET 标签(屏幕系,带 bbox + 实际 alignMode)。
 * alignMode 表示文字展开方向:6=从锚点向右,8=从锚点向左。DR11 左列用6，DR12 右列用8。 */
export function parseNetLabels(sourceText, { charW = DEFAULT_CHAR_W, charH = DEFAULT_CHAR_H } = {}) {
	const wirePts = new Map();   /* wireId → [[x,y(屏幕)], ...] */
	const netAttrs = [];
	for (const ln of String(sourceText || '').split('\n')) {
		const h = ln.indexOf('||');
		if (h < 0) continue;
		let head, atom;
		try { head = JSON.parse(ln.slice(0, h)); atom = JSON.parse(ln.slice(h + 2).replace(/\|$/, '')); } catch (e) { continue; }
		if (head.type === 'LINE' && atom.lineGroup) {
			if (!wirePts.has(atom.lineGroup)) wirePts.set(atom.lineGroup, []);
			wirePts.get(atom.lineGroup).push([atom.startX, -atom.startY], [atom.endX, -atom.endY]);
		} else if (head.type === 'ATTR' && atom.key === 'NET' && atom.valueVisible
			&& String(atom.value || '').trim() && Number.isFinite(atom.x)) {
			netAttrs.push({ value: atom.value, x: atom.x, y: -atom.y, wire: atom.parentId, align: atom.align, rotation: atom.rotation });
		}
	}
	const labels = [];
	for (const a of netAttrs) {
		/* ★bbox 方向必须按【实际渲染】(attr.align),非按几何意图推断——否则尺子看不到 align:null 的标签压体。
		 *   EDA 文字 align "H_V":H=LEFT/START 或【null(默认)】→ 锚在左、文字【向右展】;H=RIGHT/END → 向左展;H=CENTER → 居中。
		 *   (实测:源 NET attr align:null 的左列标签在真板【向右展压进 IC 体】,故 null 归向右展。) */
		const parts = String(a.align || '').toUpperCase().split('_');
		const H = parts[0], V = parts[1] || '';
		const dir = (H === 'RIGHT' || H === 'END') ? 'left' : (H === 'CENTER' || H === 'MIDDLE') ? 'center' : 'right';
		const w = Math.max(1, String(a.value || '').length) * charW, hh = charH;
		/* 垂直(屏幕 y 向下):V=BOTTOM 锚在文字底→文字在锚【上方】(小 y);TOP→下方;MIDDLE/默认→纵向居中(线穿中线)。
		 * 让裁判 bbox 落在真渲染处:*_BOTTOM 文字离开导线、不再被穿;*_MIDDLE 仍被穿(T-NOTHRU-TEXT/per-side 抓)。 */
		const yMin = V === 'BOTTOM' ? a.y - hh : V === 'TOP' ? a.y : a.y - hh / 2;
		const yMax = V === 'BOTTOM' ? a.y : V === 'TOP' ? a.y + hh : a.y + hh / 2;
		const bbox = dir === 'left'
			? { minX: a.x - w, minY: yMin, maxX: a.x, maxY: yMax }
			: dir === 'center'
				? { minX: a.x - w / 2, minY: yMin, maxX: a.x + w / 2, maxY: yMax }
				: { minX: a.x, minY: yMin, maxX: a.x + w, maxY: yMax };
		/* 与全引擎的真盒约定一致:LEFT/默认向右展=6,RIGHT/END 向左展=8。 */
		const alignMode = dir === 'left' ? 8 : 6;
		/* 保留真渲染 align 串(如 LEFT_MIDDLE)→ T-LABEL-ALIGN per-side 锚点检查能判 *_MIDDLE 违规(线穿文字中线)。 */
		labels.push({ kind: 'sig', net: a.value, textX: a.x, textY: a.y, x: a.x, y: a.y, bbox, alignMode, align: a.align || null,
			rotation: a.rotation == null ? 0 : Number(a.rotation), wireId: a.wire });
	}
	return labels;
}

/* 从源解析电源/地符号 GNN 文字的真 align → parentId→nameSide(外缘方向)。
 *   align H=RIGHT(锚右、文字向左)→ nameSide 'left';H=LEFT(锚左、文字向右)→ 'right';CENTER → null(居中)。
 *   供 live judge 的 netflagNameBox 按真渲染算名框(否则 readGeometry 无 nameSide→猜居中→假阳性 T-NOTHRU-TEXT)。 */
export function parseGnnSides(sourceText) {
	const m = new Map();
	for (const ln of String(sourceText || '').split('\n')) {
		const h = ln.indexOf('||'); if (h < 0) continue;
		let head, atom; try { head = JSON.parse(ln.slice(0, h)); atom = JSON.parse(ln.slice(h + 2).replace(/\|$/, '')); } catch (e) { continue; }
		if (head.type === 'ATTR' && atom.key === 'Global Net Name' && atom.valueVisible && atom.parentId) {
			const H = String(atom.align || '').split('_')[0].toUpperCase();
			m.set(atom.parentId, H === 'RIGHT' || H === 'END' ? 'left' : H === 'LEFT' || H === 'START' ? 'right' : null);
		}
	}
	return m;
}

/* 把源里 net 标签富化进 model.netflags(返回新 model;不可变),供 judgeTokens 度量标签对齐/重叠。
 * 同时给电源/地 netflag 补 nameSide(从源 GNN align)→ live netflagNameBox 按真渲染算名框(不猜居中)。 */
export function enrichNetLabels(model, sourceText) {
	if (!sourceText) return model;
	const font = calibrateFont(model.components || []);
	const labels = parseNetLabels(sourceText, font);
	const sides = parseGnnSides(sourceText);
	const netflags = (model.netflags || []).map(f => sides.has(f.id) ? { ...f, nameSide: sides.get(f.id) } : f);
	return { ...model, netflags: [...netflags, ...labels], _font: font, _labelCount: labels.length };
}

/* Live 审计必须证明导线 NET 标签没有从输入中消失。EasyEDA 运行时模型不含这类
 * 标签，因此所有 live gate 都应在 enrich 后调用本函数；缺源或数量不一致时失败，
 * 不能把 labels:0 当成通过。允许原理图确实没有可见 NET 标签。 */
export function assertNetLabelCoverage(model, sourceText) {
	if (typeof sourceText !== 'string' || !sourceText.trim() || !sourceText.includes('||')) {
		throw new Error('NET_LABEL_COVERAGE_UNKNOWN: document source is unavailable or invalid');
	}
	const expected = parseNetLabels(sourceText, model?._font || calibrateFont(model?.components || [])).length;
	const actual = Number.isInteger(model?._labelCount) ? model._labelCount : -1;
	if (actual !== expected) {
		throw new Error(`NET_LABEL_COVERAGE_MISMATCH: source=${expected}, model=${actual}`);
	}
	return { expected, actual };
}
