/* 源式整板投递构造器:把结构化布局 model 写成完整 V3 文档源(替换整板,旧线/旧网标不留)。
 * 通用、零特定电路。
 *
 * 为何源式:EDA bridge 的 sch_PrimitiveWire.delete/modify 不持久(重开还原)→ "删旧线+建新线"
 * 在 reload 后旧斜线复活,tier2 永远清不掉。setDocumentSource 整源替换:旧元素不在新源里 → 真删除。
 *
 * 坐标系:model 为屏幕系(y 向下);V3 源为 y 向上 → source_y = -model_y(组件/标注/线段/网标一致,
 *   已用真板某件 源(x,-y)↔live(x,y) 标定)。
 * 自洽前提(setDocumentSource 接受完整自洽文档,拒绝向旧源"拼接"新行):
 *   - DOCHEAD/CANVAS/标题栏框(无 Designator 的 COMPONENT)及其全部 ATTR 原样保留。
 *   - 真实组件沿用原 id,仅改 x/y/rotation/isMirror;可见 Designator/Name 标注改到 model 给定位置。
 *   - 删除全部旧 WIRE/LINE 及挂在线上的 NET 标注;按 model.wires 重建正交线段、按 model.netflags 重建可见网标。
 *   - ticket 从原最大值续号,所有新原语用新 16-hex id;末行不带结尾 '|'。
 */
import crypto from 'node:crypto';
import { classifyNet } from './structured_layout.mjs';

/* 引擎自有装饰层签名(块框/块标题)—— 用于源式投递【幂等】:删本引擎历次投的旧框/旧标题、再重建,
 * 只认本引擎自己的样式(不碰设计者可能存在的 RECT/TEXT 内容)。零特定电路(纯装饰风格常量)。 */
const FRAME_STROKE = '#8c8c8c', FRAME_DASH = 'SHORT_DASH';
const TITLE_COLOR = '#2b6cb0', TITLE_FONT = 18;
/* 图纸边框(标准尺寸 A3/A4 实线外框 + 右下标题栏框)——治"板无边界";本引擎自有装饰,幂等剔除按此签名。 */
const SHEET_STROKE = '#000000', SHEET_SOLID = 'SOLID';
const TB_W = 360, TB_H = 120;   /* 标题栏框尺寸 */

const new_id = () => crypto.randomBytes(8).toString('hex');
const flip_y = v => -v;                                  /* 屏幕 y → 源 y */
const pt_key = (x, y) => `${Math.round(x)},${Math.round(y)}`;

/* 解析文档源为记录数组(保留原始行,便于原样回写) */
function parse_source(src) {
	const out = [];
	for (const raw of src.split('\n')) {
		const h = raw.indexOf('||');
		if (h < 0) { out.push({ raw, type: null }); continue; }
		const head = JSON.parse(raw.slice(0, h));
		let atom = {};
		try { atom = JSON.parse(raw.slice(h + 2).replace(/\|$/, '')); } catch (e) { /* keep {} */ }
		out.push({ raw, head, atom, type: head.type });
	}
	return out;
}

const fmt_line = (head, atom) => `${JSON.stringify(head)}||${JSON.stringify(atom)}|`;

/* base = 原始文档源字符串;model = structuredLayout 产出(components/wires/netflags,屏幕系)。
 * opts.netflag = { partId, ground:{symbol,device}, power:{symbol,device} }:电源/地符号(netflag)的库 uuid,
 *   由投递侧探测 createNetFlag 实得(引擎不硬编 uuid)。给定时,kind 为 power/ground 的网标用【符号 COMPONENT】
 *   渲染(电源朝上/地朝下,符号脚=origin 落桩末端 → 连通由桩的隐藏 NET 名 + 符号 Global Net Name 双保);
 *   否则该网标退化为可见文本标签(优雅降级)。kind=sig 一律文本标签。
 * 返回完整新文档源字符串(可直接 setDocumentSource)。 */
export function build_source(base, model, opts = {}) {
	// A valid net name does not make the wrong electrical symbol acceptable.
	// Explicit project roles support supply names outside conventional patterns.
	for (const f of model.netflags || []) {
		if (f.kind !== 'power' && f.kind !== 'ground') continue;
		const role = opts.netRoles?.[f.net] ?? classifyNet(f.net);
		if (role !== f.kind) throw new Error(`Net flag role mismatch: ${f.net} is ${role}, symbol is ${f.kind}`);
	}
	const recs = parse_source(base);
	const nf = opts.netflag;
	const sym_kind = k => (nf && (k === 'power' || k === 'ground')) ? k : null;

	/* 组件 id → 其 Designator 值(判断该 ATTR 是否真件子标注、用于按 model 重定位) */
	const wire_ids = new Set(recs.filter(r => r.type === 'WIRE').map(r => r.head.id));
	/* ★旧网标【符号】COMPONENT(partId=netflag 库)= 历次投递累积的电源/地符号垃圾 → 整组(符号+子ATTR)删除,
	 *   由本次 model.netflags 重建 → 源式投递【幂等】(治"网标线性累积成废图")。仅在给定 netflag 库时启用。 */
	// V3 pages may share a partId between ordinary parts, the sheet and net flags.
	// Identify flags by their symbol binding; partId alone is not a component type.
	const flagSymbols = new Set(nf ? [nf.ground?.symbol, nf.power?.symbol].filter(Boolean) : []);
	const nf_sym_ids = new Set(recs.filter(r => r.type === 'ATTR' && r.atom.key === 'Symbol'
		&& flagSymbols.has(r.atom.value)).map(r => r.atom.parentId));
	const des_of_comp = new Map();
	for (const r of recs) {
		if (r.type === 'ATTR' && r.atom && r.atom.key === 'Designator' && r.atom.parentId) {
			des_of_comp.set(r.atom.parentId, r.atom.value);
		}
	}
	const model_by_des = new Map((model.components || []).map(c => [c.designator, c]));
	/* 组件 id → model attr(key→model attr),用于重定位可见标注 */
	const model_attr_for = new Map();
	for (const [cid, des] of des_of_comp) {
		const m = model_by_des.get(des);
		if (m) model_attr_for.set(cid, new Map((m.attrs || []).map(a => [a.key, a])));
	}

	let ticket = 0;
	for (const r of recs) {
		if (r.head && typeof r.head.ticket === 'number') ticket = Math.max(ticket, r.head.ticket);
	}
	const next_ticket = () => ++ticket;

	const lines = [];

	/* 1) 单遍保序:删 WIRE/LINE 与挂在线上的旧 ATTR(NET/Relevance);组件改位姿;真件可见标注按 model 重定位;
	 *    其余(标题栏框、组件其它 attr、NO_CONNECT/Pin Number 等孤儿 attr、未知原语)一律原样保留。 */
	for (const r of recs) {
		if (r.type === 'DOCHEAD' || r.type === 'CANVAS') {
			lines.push(r.raw.endsWith('|') ? r.raw : r.raw + '|');
			continue;
		}
		if (r.type === 'WIRE' || r.type === 'LINE') continue;        /* 旧线全删 */
		if (nf_sym_ids.has(r.head.id)) continue;                     /* 旧网标符号 COMPONENT:删(本次重建) */
		if (r.type === 'COMPONENT') {
			const des = des_of_comp.get(r.head.id);
			const m = des ? model_by_des.get(des) : null;
			if (!m) { lines.push(fmt_line(r.head, r.atom)); continue; }
			lines.push(fmt_line(r.head, { ...r.atom, x: m.x, y: flip_y(m.y), rotation: m.rotation || 0, isMirror: !!m.mirror }));
			continue;
		}
		if (r.type === 'ATTR') {
			if (wire_ids.has(r.atom.parentId)) continue;             /* 挂在旧线上的 NET/Relevance:删 */
			if (nf_sym_ids.has(r.atom.parentId)) continue;           /* 旧网标符号的子 ATTR(Symbol/Device/Name/Global Net Name):删 */
			if (opts.ncPins && r.atom.key === 'NO_CONNECT') continue; /* 旧 NO_CONNECT:删(下方按完整无网脚集重发,幂等;漏标脚补上 → DRC 悬空 warn 清零) */
			const m_attrs = model_attr_for.get(r.atom.parentId);
			const ma = m_attrs && m_attrs.get(r.atom.key);
			/* 重定位 + 值覆盖:model attr 给定 value 时用之(治无源件 Name="={Value}" 渲染空白 → 投递侧填人读值显示) */
			if (ma) lines.push(fmt_line(r.head, { ...r.atom, x: ma.x, y: flip_y(ma.y), valueVisible: true, value: (ma.value != null && ma.value !== '') ? ma.value : r.atom.value }));
			else lines.push(fmt_line(r.head, r.atom));               /* 不重定位的组件 attr / 孤儿 attr:原样 */
			continue;
		}
		if (r.type === 'RECT' && r.atom && r.atom.strokeStyle === FRAME_DASH && r.atom.strokeColor === FRAME_STROKE) continue;   /* 旧块框:删(下方重建) */
		if (r.type === 'RECT' && r.atom && r.atom.strokeStyle === SHEET_SOLID && r.atom.strokeColor === SHEET_STROKE) continue;   /* 旧图纸外框/标题栏框:删(下方重建) */
		if (r.type === 'TEXT' && r.atom && r.atom.color === TITLE_COLOR) continue;   /* 旧块标题(投递侧 API 建):删(投递侧重建) */
		lines.push(r.raw.endsWith('|') ? r.raw : r.raw + '|');       /* 未知原语:原样保留 */
	}

	/* 3) 新线段 + 网标(旧 WIRE/LINE/NET 已全部丢弃) */
	/* 仅 kind=sig(及无符号 uuid 时的 power/ground 降级)进"可见文本标签"位置表;power/ground 符号另行发 COMPONENT */
	const sig_at = new Map();
	const sym_flags = [];
	for (const f of (model.netflags || [])) {
		if (sym_kind(f.kind)) sym_flags.push(f);
		else sig_at.set(pt_key(f.textX ?? f.x, f.textY ?? f.y), f);
	}
	/* 段集:每 model.wire 拆成正交段(去退化) */
	const segs = [];
	for (const w of (model.wires || [])) {
		const L = w.line || [];
		for (let i = 0; i + 3 < L.length; i += 2) {
			if (L[i] === L[i + 2] && L[i + 1] === L[i + 3]) continue;
			segs.push({ a: [L[i], L[i + 1]], b: [L[i + 2], L[i + 3]], net: w.net });
		}
	}
	/* 按共享端点 union-find 合并成"逻辑连接"(一脚→标签/符号的全部段=一组、同网)→ 每组【一条带名 WIRE 多段】,
	 * 消掉去冗余标签后中间无名段的 DRC warn、走线更整洁(每连接单线、单网名)。 */
	const par = segs.map((_, i) => i);
	const find = x => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
	const ep_map = new Map();
	segs.forEach((s, i) => { for (const p of [s.a, s.b]) { const k = pt_key(p[0], p[1]); if (!ep_map.has(k)) ep_map.set(k, []); ep_map.get(k).push(i); } });
	for (const list of ep_map.values()) { for (let j = 1; j < list.length; j++) par[find(list[j])] = find(list[0]); }
	const groups = new Map();
	segs.forEach((s, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(s); });

	for (const group of groups.values()) {
		const wire_id = new_id();
		lines.push(fmt_line({ type: 'WIRE', ticket: next_ticket(), id: wire_id }, { zIndex: 62254 }));
		for (const s of group) {
			lines.push(fmt_line({ type: 'LINE', ticket: next_ticket(), id: new_id() }, {
				fillColor: null, fillStyle: null, strokeColor: null, strokeStyle: null, strokeWidth: null,
				startX: s.a[0], startY: flip_y(s.a[1]), endX: s.b[0], endY: flip_y(s.b[1]), lineGroup: wire_id,
			}));
		}
		/* 网标:组内任一端点吻合 sig 文本标签位 → 发【可见】NET 文本(消费防重复);电源/地组(端点在符号处)不发,靠符号 Global Net Name */
		const net = group[0].net;
		let label_pt = null, label_flag = null;
		for (const s of group) { for (const p of [s.a, s.b]) { const k = pt_key(p[0], p[1]); if (sig_at.has(k)) { label_pt = p; label_flag = sig_at.get(k); sig_at.delete(k); break; } } if (label_pt) break; }
		if (label_pt) {
			/* ★显式 align「H_V」遵循 DR11/12:左列 alignMode 6→LEFT_BOTTOM，右列 8→RIGHT_BOTTOM。
			 *   V=BOTTOM(锚在文字底=文字落【导线上方】,不被导线穿中线,
			 *   per-side 锚点 T-LABEL-ALIGN 验)。模型若带 anchor 用之,否则按 alignMode 推。RK 源实证 *_BOTTOM 为主。 */
			const labelKey = pt_key(label_pt[0], label_pt[1]);
			const attached = group.find(s => pt_key(s.a[0], s.a[1]) === labelKey || pt_key(s.b[0], s.b[1]) === labelKey);
			const other = attached && (pt_key(attached.a[0], attached.a[1]) === labelKey ? attached.b : attached.a);
			const inferredMode = other && other[0] > label_pt[0] ? 6 : other && other[0] < label_pt[0] ? 8 : null;
			const mode = label_flag?.alignMode ?? inferredMode;
			const align = label_flag?.anchor || (mode === 8 ? 'RIGHT_BOTTOM' : 'LEFT_BOTTOM');
			lines.push(fmt_line({ type: 'ATTR', ticket: next_ticket(), id: new_id() }, {
				x: label_pt[0], y: flip_y(label_pt[1]), rotation: null, color: null, fontFamily: null, fontSize: null,
				fontWeight: null, italic: null, underline: null, align, value: net,
				keyVisible: false, valueVisible: true, key: 'NET', fillColor: null, parentId: wire_id, zIndex: 3,
			}));
		}
	}

	/* 4) 电源/地符号(netflag COMPONENT + 子 ATTR)。符号脚=origin,放在桩末端(=该网标位置)→ 脚落桩上连通。
	 *    电源默认朝上、地默认朝下(rotation 0)。子 ATTR:Symbol(图形uuid)/Device/Relevance/Name(可见=网名)/Global Net Name(网绑定)。
	 *    attr 源-y 偏移按 createNetFlag 实测复刻(地:Name 在下;电源:Name 在上)。 */
	let zf = 62255;
	const NF_DY = { ground: { sym: 30, name: 0 }, power: { sym: 30, name: 0 } };
	for (const f of sym_flags) {
		const lib = nf[f.kind];
		if (!lib) continue;
		const fx = f.x ?? f.textX, fy = f.y ?? f.textY;
		const ox = fx, oy = flip_y(fy);                       /* 符号 origin(源坐标)= 脚位 */
		const cid = new_id();
		const dy = NF_DY[f.kind] || NF_DY.ground;
		const pose=((Number(f.rotation)||0)%360+360)%360;
		lines.push(fmt_line({ type: 'COMPONENT', ticket: next_ticket(), id: cid },
			{ partId: nf.partId, x: ox, y: oy, rotation: pose, isMirror: false, attrs: {}, zIndex: zf++ }));
		const attr = (key, value, vis, ax, ay, z, align = null) => lines.push(fmt_line({ type: 'ATTR', ticket: next_ticket(), id: new_id() },
			{ x: ax, y: ay, rotation: null, color: null, fontFamily: null, fontSize: null, fontWeight: null,
				italic: null, underline: null, align, value, keyVisible: false, valueVisible: vis, key, fillColor: null, parentId: cid, zIndex: z }));
		const symbolOffset=pose===90?[dy.sym,0]:pose===180?[0,-dy.sym]:pose===270?[-dy.sym,0]:[0,dy.sym];
		attr('Symbol', lib.symbol, false, ox+symbolOffset[0], oy+symbolOffset[1], 26);
		attr('Device', lib.device, false, null, null, 40);
		attr('Relevance', '[]', false, null, null, 5);
		/* ★实验(照 RK Power Port):Name vis=false(不靠 Name 文字显名→治穿线);网名靠 Global Net Name vis=true 显,
		 *   align CENTER_BOTTOM(锚中下、文字向上=在符号上方、不被连接线穿)。验:a649 能否这样显名+不穿线。 */
		attr('Name', f.net, false, ox, oy + dy.name, 6, 'CENTER_MIDDLE');
		/* GNN 显名:竖向 power 在 glyph【上方】(BOTTOM 文字向上)、ground 在【下方】(TOP);水平默认 CENTER,
		 *   f.nameSide 给定时朝【外缘】(left→锚右 RIGHT 文字向左、right→锚左 LEFT 文字向右)避开 comb jog(治 T-NOTHRU-TEXT)。 */
		const vA = f.kind === 'ground' ? 'TOP' : 'BOTTOM';
		const hA = f.nameSide === 'left' ? 'RIGHT' : f.nameSide === 'right' ? 'LEFT' : 'CENTER';
		const side=pose===90||pose===270;
		const nameAlign=side?`${hA}_MIDDLE`:`${hA}_${vA}`;
		const nameX=Number.isFinite(f.textX)?f.textX:ox,nameY=Number.isFinite(f.textY)?flip_y(f.textY):oy+dy.name;
		attr('Global Net Name', f.net, f.nameVisible !== false, nameX, nameY, 7, nameAlign);
	}

	/* 5) 功能块虚线圆角【框边】RECT(model.blocks=[{title,bbox}],屏幕系)。
	 *    RECT 是非电气原语,readGeometry 不读 → 不进裁判几何(不会因框套件产生假重叠)。
	 *    V3 格式实测:dotX1/X2=左右、dotY1/Y2=源 y(=-model_y)、strokeStyle SHORT_DASH、fillStyle NONE、radiusX/Y 圆角。
	 *    ★标题不进源:实测【源/自定义 key ATTR 不渲染、API 建的 TEXT 渲染且 reopen 持久】→ 标题由投递侧用
	 *      sch_PrimitiveText.create(API)创建(坐标见 blockTitleAnnots);源只负责框边。框名/范围由布局给定(引擎不认块语义)。 */
	for (const blk of (model.blocks || [])) {
		if (!blk || !blk.bbox || !blk.title) continue;
		const { x1, x2, yTop, yBot } = blockFrameRect(blk.bbox);
		lines.push(fmt_line({ type: 'RECT', ticket: next_ticket(), id: new_id() }, {
			radiusX: 12, radiusY: 12, dotX1: x1, dotX2: x2, dotY1: flip_y(yBot), dotY2: flip_y(yTop),
			strokeColor: FRAME_STROKE, strokeStyle: FRAME_DASH, fillColor: null, strokeWidth: 1, fillStyle: 'NONE', rotation: 0, zIndex: zf++, locked: false,
		}));
	}

	/* 6) ★图纸边框/标题栏:【不画假框】(用户怒点:画 RECT 假框充 A3 边框=歪门邪道)。
	 *    真页模板(A4 图框+标准标题栏)由投递侧投后调真 API dmt_Schematic.modifySchematicPageTitleBlock(true,…) 恢复。
	 *    此处仅【剔除】历史假框(上方 SHEET_SOLID/SHEET_STROKE RECT 已删),不再生成任何 sheetRect。 */

	/* 7) NO_CONNECT 标记:对【全部未连脚】(opts.ncPins = 权威网表无网脚 = spec-NC 未用脚)打 NC='yes' ATTR
	 *    (parentId=脚 primitiveId compId-eN,x/y=脚源坐标)→ 清 DRC 悬空 warn 到真 0/0/0/0;标准商用做法、不动任何连接。 */
	for (const p of (opts.ncPins || [])) {
		if (!p || !p.pid) continue;
		lines.push(fmt_line({ type: 'ATTR', ticket: next_ticket(), id: new_id() }, {
			parentId: p.pid, key: 'NO_CONNECT', x: p.x, y: flip_y(p.y), value: 'yes', keyVisible: false, valueVisible: false, zIndex: zf++,
		}));
	}

	return lines.join('\n').replace(/\|$/, '');
}

/* 块框矩形几何(屏幕系):框边比块 bbox 外扩 BLK_PAD(贴内容、减块内留白),顶部再留 TITLE_BAND 容标题。 */
const BLK_PAD = 16, TITLE_BAND = 22;
function blockFrameRect(bbox) {
	return { x1: bbox.minX - BLK_PAD, x2: bbox.maxX + BLK_PAD, yTop: bbox.minY - BLK_PAD - TITLE_BAND, yBot: bbox.maxY + BLK_PAD };
}

/* 功能块标题(供投递侧 sch_PrimitiveText.create 创建;源注入/自定义 key ATTR 不渲染,故走 API——实测 API TEXT reopen 持久渲染)。
 * 返回 [{value,x,y,fontSize,bold,color}],供 create(x,y,...)。★坐标系实测:sch_PrimitiveText.create 的 y 是【y-up】
 *   (与源/组件 y-down 相反、渲染时再翻一次)→ 要落在【框视觉顶】须取框模型【底】edge:create_y = yBot - 内缩;
 *   create_x 与源同向(直接用框左)。 */
export function blockTitleAnnots(model) {
	const out = [];
	for (const blk of (model.blocks || [])) {
		if (!blk || !blk.bbox || !blk.title) continue;
		const { x1, yBot } = blockFrameRect(blk.bbox);
		out.push({ value: String(blk.title), x: x1 + 10, y: yBot - (TITLE_BAND - 5), fontSize: TITLE_FONT, bold: true, color: TITLE_COLOR });
	}
	return out;
}
