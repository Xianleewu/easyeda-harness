/* 结构化布局引擎(像前端 CSS:确定性构造,规则由构造满足,非自由优化+事后修补)。零特定电路内容。
 *
 * 设计语言(对应 design_tokens 的 tier2 几何 token,逐条由构造保证):
 *   - 器件按 flex-wrap 行网格摆放,行内左→右、满列换行 → 紧凑(T-DENSITY)、互不重叠(T-NOOVERLAP)。
 *   - 每件 origin 吸 5 栅格、rotation 取 0 → 脚落统一栅格(T-GRID,本地脚偏移在快照已对格)。
 *   - 2 脚件标号+阻值同侧件外堆叠:横置件→上方堆叠;竖置件→右侧堆叠(T-ANNOT-PLACE/FULL)。
 *   - footprint = 本体 bbox ∪ 标注 bbox,网格按 footprint 定步距 → 标注不压邻件(T-NOOVERLAP)。
 *   - 里程碑1:无导线、无网标 → T-ORTHO/T-NOCROSS/T-NOTHRU/T-LABEL-ALIGN 平凡成立。
 *
 * 几何反解/正算复用 local_geom(与 eda_twin 裁判同一几何 → 构造与裁判逐位一致)。 */
import { fillVisibleAttrBBoxes } from './eda_transform.mjs';
import { localGeom, placeGeom } from './local_geom.mjs';

const GRID = 5;
const r5 = v => Math.round(v / GRID) * GRID;
/* net 标签列 x 吸 grid-10:异宽模块竖叠时,相近列(差<5)归并到同一 grid-10 点、明显不同的列拉开 ≥10,
 * 避免"差几 px 的伪同列"被裁判判 column-x-spread。脚仍 grid-5(10 是 5 的倍数,不影响脚对格)。 */
const r10 = v => Math.round(v / 10) * 10;

/* 标注堆叠间距(件外、行间) */
const ANNOT_GAP = 6;   /* 本体边 → 第一行标注 */
const ROW_GAP = 4;     /* 标注行间 */
const SIDE_GAP = 6;    /* 竖置件:本体右边 → 标注 */

/* 网格步距余量(footprint 外加的间隙,控密度) */
const COL_GAP = 10;    /* 行内列间 */
const ROW_GAP_V = 6;  /* 行间 */

const DEFAULT_BODY = { minX: -5, minY: -5, maxX: 5, maxY: 5 };

/* 单件预处理:本地几何 → 本体框、脚、同侧标注布局(本地坐标)、footprint(本体∪标注)。
 * rotation:放置朝向(bank 把竖置无源件旋 90° 转横置 → 脚变左右、标注上方堆叠)。 */
function prepComponent(filledComp, rotation = 0) {
	const lg = localGeom(filledComp);
	const base = placeGeom(lg, 0, 0, rotation, false);   /* origin 帧(指定朝向) */
	const body = base.bbox || DEFAULT_BODY;
	const pins = base.pins;
	const bcx = (body.minX + body.maxX) / 2, bcy = (body.minY + body.maxY) / 2;

	/* 可见 标号/阻值,带 bbox。rel = bbox 相对 anchor 的偏移(还原 anchor 用),w/h = 字框尺寸。 */
	const visAttrs = base.attrs
		.filter(a => (a.key === 'Designator' || a.key === 'Name') && a.valueVisible && a.bbox)
		.map(a => ({
			key: a.key, value: a.value,
			rx: a.bbox.minX - a.x, ry: a.bbox.minY - a.y,
			w: a.bbox.maxX - a.bbox.minX, h: a.bbox.maxY - a.bbox.minY,
		}));
	const ordered = ['Designator', 'Name'].map(k => visAttrs.find(a => a.key === k)).filter(Boolean);

	/* 2 脚件按脚向定同侧方向;非 2 脚(IC)标号一律置上方(T-ANNOT-PLACE 只判 2 脚件)。 */
	const twoPin = pins.length === 2;
	const horiz = twoPin ? Math.abs(pins[0].x - pins[1].x) >= Math.abs(pins[0].y - pins[1].y) : true;

	/* annots[i] = { key, value, lbx, lby, w, h, rx, ry }(lbx/lby = 字框本地左上角) */
	const annots = [];
	if (horiz) {
		/* 标号+阻值【同一行并排】置本体上方(底对齐)——比竖叠矮一半 → 件 footprint 矮 → bank 更密(T-DENSITY)。
		 * 仍同侧(都在上方,perp 同号)满足 T-ANNOT-PLACE;并排间留 gap 不重叠。 */
		const gap = 4;
		const totalW = ordered.reduce((s, a) => s + a.w, 0) + gap * Math.max(0, ordered.length - 1);
		let lbx = bcx - totalW / 2;
		for (const a of ordered) {
			const lby = body.minY - ANNOT_GAP - a.h;
			annots.push({ key: a.key, value: a.value, lbx, lby, w: a.w, h: a.h, rx: a.rx, ry: a.ry });
			lbx += a.w + gap;
		}
	} else {
		const lbx = body.maxX + SIDE_GAP;     /* 右侧堆叠 */
		const totalH = ordered.reduce((s, a) => s + a.h, 0) + ROW_GAP * Math.max(0, ordered.length - 1);
		let lby = bcy - totalH / 2;
		for (const a of ordered) {
			annots.push({ key: a.key, value: a.value, lbx, lby, w: a.w, h: a.h, rx: a.rx, ry: a.ry });
			lby += a.h + ROW_GAP;
		}
	}

	/* footprint = 本体框 ∪ 标注字框 */
	const fp = { minX: body.minX, minY: body.minY, maxX: body.maxX, maxY: body.maxY };
	for (const a of annots) {
		fp.minX = Math.min(fp.minX, a.lbx); fp.minY = Math.min(fp.minY, a.lby);
		fp.maxX = Math.max(fp.maxX, a.lbx + a.w); fp.maxY = Math.max(fp.maxY, a.lby + a.h);
	}
	/* 脚 0 的本地偏移:按它把 origin 对齐使全部脚落格(比吸 origin 更稳健 —— 真板 origin 可能脱格,
	 * 但脚两两间距是格倍数,对齐一只脚即对齐全部)。 */
	const pin0 = pins.length ? { lx: pins[0].x, ly: pins[0].y } : null;
	return { designator: filledComp.designator, annots, footprint: fp, body, pin0, localPins: pins, rotation };
}

/* net 分类(通用电源/地命名【约定】,零特定网名):决定该网用电源符号(朝上)/地符号(朝下)/还是信号文本标签。
 * 商用图电源地用【符号】而非文本网标(通用商用章法)。匹配约定:GND/AGND/DGND/PGND/VSS/VEE=地;
 * 以 + 开头、或 VCC/VDD/VBAT/VBUS/VSYS/VIN/VOUT/VREF… 前缀、或含 数字V数字(如 3V3/5V/1V8)=电源;其余=信号。 */
export function classifyNet(net) {
	const n = String(net || '');
	if (/(^|[_\-./])(a|d|p)?gnd\d*([_\-./]|$)|(^|[_\-./])v(ss|ee)\d*([_\-./]|$)/i.test(n)) return 'ground';
	if (/^\+/.test(n)
		|| /(^|[_\-./])(vcc|vdd|vbat|vbus|vsys|vin|vout|vdda|vddio|vref|vpp|vaa)\d*/i.test(n)
		|| /(^|[_\-./])\d+v\d*([_\-./]|$)/i.test(n)
		|| /\d+v\d+/i.test(n)) return 'power';
	return 'sig';
}

const STUB_LEN = 20;          /* 脚 → 网标列 的短桩长 */
/* net 标签字框尺寸:按 live 真板实测标定(原板 net 标签字高 6、每字符宽 ~7),勿凭空设。
 * 字高 6 < 脚间距(常见 10,最密 5)→ 单列标签竖向不压(geomQC inset-1 容差:h<12 适配 pitch10、h<7 适配 pitch5)。 */
const LABEL_H = 6;
const LABEL_CHAR_W = 7;
const labelLen = s => Math.max(1, String(s || '').length) * LABEL_CHAR_W;

const SLOT_PITCH = 10;   /* 顶/底脚 jog 到侧列的扩展槽位行距(≥ T-LABEL-ALIGN minPitch、> 字高) */
const FLAG_GAP = 12;     /* 电源/地梳状路由转折 x 步距(错位避免竖段重叠/交叉) */

/* 电源/地符号真实占位(相对脚 x,y,createNetFlag rotation-0,live readGeometry 实测;见 scratchpad/flag_footprint.json)。
 * 用它做 netflag bbox → twin 与 live 一致;ground 在脚【上方】(dy<0,宽22)、power 在脚【下方】(dy>0,宽12)。 */
const FLAG_FP = {
	ground: { dyMin: -20, dyMax: -10, dxMin: -11, dxMax: 11 },
	power: { dyMin: 5, dyMax: 11, dxMin: -6, dxMax: 6 },
};
/* flagBox = 符号【本体】真占位(用于 netflag.bbox → NOOVERLAP 准确度量)。 */
const rotateFlagPoint = (dx, dy, rotation) => {
	const r=((Number(rotation)||0)%360+360)%360;
	if(r===90)return[-dy,dx];
	if(r===180)return[-dx,-dy];
	if(r===270)return[dy,-dx];
	return[dx,dy];
};
export const flagBox = (kind, x, y, rotation = 0) => {
	const f = FLAG_FP[kind] || FLAG_FP.ground;
	const pts=[[f.dxMin,f.dyMin],[f.dxMin,f.dyMax],[f.dxMax,f.dyMin],[f.dxMax,f.dyMax]].map(([dx,dy])=>rotateFlagPoint(dx,dy,rotation));
	return {minX:x+Math.min(...pts.map(p=>p[0])),minY:y+Math.min(...pts.map(p=>p[1])),maxX:x+Math.max(...pts.map(p=>p[0])),maxY:y+Math.max(...pts.map(p=>p[1]))};
};
/* flagExtent = 符号本体 ∪【连接点】(脚/桩末端 origin)。符号本体在 ground 上方/power 下方,连接点【不在】本体框内
 * → 模块 bbox 必须按 extent 增长,否则相邻模块的符号桩端点装箱时重合(异网短路);netflag.bbox 仍用本体 box。 */
const flagExtent = (kind, x, y, rotation = 0) => { const b = flagBox(kind, x, y, rotation); return { minX: Math.min(b.minX, x), minY: Math.min(b.minY, y), maxX: Math.max(b.maxX, x), maxY: Math.max(b.maxY, y) }; };
const sideFlagRotation = (kind,left) => kind==='power'?(left?90:270):(left?270:90);
const makeSideFlag = (kind,net,x,y,left) => {
	const rotation=sideFlagRotation(kind,left);
	return{kind,net,x,y,textX:x+(left?-15:15),textY:y,rotation,nameSide:left?'left':'right',
		nameVisible:kind==='power',bbox:flagBox(kind,x,y,rotation)};
};
/* 竖向相邻两 flag 不重叠所需最小槽距:上 flag 下沿(dyMax)与下 flag 上沿(dyMin+pitch)留余量。
 * 最坏=上 power(dyMax 11)+下 ground(dyMin -20):pitch ≥ 11-(-20)+2 = 33 → 取 34(grid 倍数余量)。 */
const FLAG_PITCH = 34;   /* 电源/地符号专列/堆叠统一最小槽距(按实测最坏占位,治各处符号竖撞) */
/* 符号 Name 文字伸向(相对脚:电源 Name 在上方、地 Name 在下方,匹配 source_deliver NF_DY + 字高)→ 相邻符号
 * Name 在夹缝相遇(下件Name上伸 + 上件Name下伸)须额外让开,否则文字互压(治 U8 VBUS×GND "VBGND5V")。 */
const NAME_REACH = { power: { up: 16, down: 0 }, ground: { up: 0, down: 31 } };
function flagGap(prevKind, curKind) {
	const a = FLAG_FP[prevKind] || FLAG_FP.ground, b = FLAG_FP[curKind] || FLAG_FP.ground;
	const glyph = Math.max(0, a.dyMax - b.dyMin) + 3;   /* glyph 不重叠 */
	const na = NAME_REACH[prevKind] || NAME_REACH.ground, nb = NAME_REACH[curKind] || NAME_REACH.ground;
	const name = na.up + nb.down + 4;                    /* 下件(prev)Name上伸 + 上件(cur)Name下伸 + 余量 → Name 不互压 */
	return Math.max(glyph, name);
}

/* 网标【可见网名文字】bbox(model 坐标;单一真源 = NAME_REACH 纵向伸 + labelLen 横向宽,与 flagGap/sig 标签同口径)。
 * 电源名在脚【上方】居中、地名在脚【下方】居中(匹配 source_deliver ② 的 kind-aware CENTER 对齐);宽=网名居中展开。
 * 供 geom_qc 把"网名文字 × 文字/符号"重叠纳入 NOOVERLAP——治"复位簇 VCC_3V3×GND 文字重叠却报 0"的瞎尺。
 * sig 网标的 f.bbox 本身即文字标签框(labelLen),无需另算 → 返 null(避免与自身 bbox 自重叠假报)。 */
export function netflagNameBox(f, kind = f && f.kind) {
	if (!f || (kind !== 'power' && kind !== 'ground')) return null;
	if (f.nameVisible === false) return null;
	/* ★live readGeometry 给的【真实渲染名框】(getPrimitivesBBox)优先 → 用真名框测重叠,不靠下方字形偏移假设
	 *   (假设是 model 预测用;live 验证用实测,治真名×名重叠漏检如 5V_LED×GND)。 */
	if (f.nameBox && Number.isFinite(f.nameBox.minX) && f.nameBox.maxX > f.nameBox.minX) return f.nameBox;
	const tx = Number.isFinite(f.textX) ? f.textX : f.x;
	const ty = Number.isFinite(f.textY) ? f.textY : f.y;
	if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
	const half = labelLen(f.net) / 2, w = labelLen(f.net);
	/* 水平:默认居中(tx±half);f.nameSide 给定时朝【外缘】展(left=名在 tx 左侧[tx-w,tx]、right=右侧[tx,tx+w])——
	 *   combFlags 同列堆叠符号用之,名背离 comb jog → jog 不穿名(治 T-NOTHRU-TEXT)。 */
	const hx = f.nameSide === 'left' ? [tx - w, tx] : f.nameSide === 'right' ? [tx, tx + w] : [tx - half, tx + half];
	/* 竖直:名在符号字形【外侧】紧贴(ground 名在 glyph 外/小 y 侧、power 在大 y 侧);贴 glyph 外缘 → 不与自身字形自压。
	 * kind 显式传入:live readGeometry 的 netflag 无 f.kind → 调用方按 classOfNet(f.net) 推后传(live 不判瞎)。 */
	const pose=((Number(f.rotation)||0)%360+360)%360;
	if(pose===90||pose===270)return {minX:hx[0],minY:ty-LABEL_H/2,maxX:hx[1],maxY:ty+LABEL_H/2};
	return kind === 'ground'
		? { minX: hx[0], minY: ty, maxX: hx[1], maxY: ty + LABEL_H }
		: { minX: hx[0], minY: ty - LABEL_H, maxX: hx[1], maxY: ty };
}

/* 电源/地符号【网名文字框】(精确:NAME_REACH 纵向伸 + labelLen 横向宽 + nameSide 横向方向)——匹配 source_deliver
 * GNN 真实渲染(power 名在脚上方 reach.up、ground 在下方 reach.down),用于 deconflictFlagNames 检测名×名重叠。 */
function flagNameReachBox(f, nameSide = f && f.nameSide) {
	if (!f || (f.kind !== 'power' && f.kind !== 'ground')) return null;
	const tx = Number.isFinite(f.textX) ? f.textX : f.x, ty = Number.isFinite(f.textY) ? f.textY : f.y;
	if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
	const w = labelLen(f.net), reach = NAME_REACH[f.kind] || NAME_REACH.ground;
	const hx = nameSide === 'left' ? [tx - w, tx] : nameSide === 'right' ? [tx, tx + w] : [tx - w / 2, tx + w / 2];
	const pose=((Number(f.rotation)||0)%360+360)%360;
	const vy = pose===90||pose===270?[ty-LABEL_H/2,ty+LABEL_H/2]:f.kind === 'power' ? [ty - LABEL_H, ty] : [ty, ty + LABEL_H];
	return { minX: hx[0], minY: vy[0], maxX: hx[1], maxY: vy[1] };
}

/* 去冲突:相邻电源/地符号【网名互压】(脚位固定如 IC 电源脚×地脚相邻,名各朝间隙伸 → 撞,judge 漏检过 5V_LED×GND)。
 * 检测重叠名对 → 给【未设 nameSide 的】横向错开(x 小的名向左展、x 大的向右展)→ 名分离。保留 combFlags 已设的 nameSide。
 * 由构造消名×名重叠(结构修复,非事后);live readGeometry 真名框验证。 */
export function deconflictFlagNames(netflags) {
	const flags = (netflags || []).filter(f => (f.kind === 'power' || f.kind === 'ground') && Number.isFinite(f.textX ?? f.x) && Number.isFinite(f.textY ?? f.y));
	const ov = (a, b) => a && b && a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
	for (let iter = 0; iter < 4; iter++) {
		let changed = false;
		for (let i = 0; i < flags.length; i++) {
			for (let j = i + 1; j < flags.length; j++) {
				const A = flags[i], B = flags[j];
				if (!ov(flagNameReachBox(A), flagNameReachBox(B))) continue;
				const ax = A.textX ?? A.x, bx = B.textX ?? B.x;
				const lo = ax <= bx ? A : B, hi = ax <= bx ? B : A;
				if (lo.nameSide == null) { lo.nameSide = 'left'; changed = true; }
				if (hi.nameSide == null) { hi.nameSide = 'right'; changed = true; }
			}
		}
		if (!changed) break;
	}
	return netflags;
}

/* IC 扇出(支持脚在 4 边):左/右脚直接水平短桩 → 左/右 net 标签列;顶/底脚 jog 到最近侧列下/上方
 * 扩展槽位(脚→竖直→水平→列)。net 标签按名连通(无两头尖网口、无全局走线)。由构造:
 *   - 段全正交(T-ORTHO);顶/底脚按 x 升序配升序槽位 → jog 互不交叉(数学保证,见下);桩/jog 在体外(T-NOTHRU)。
 *   - 同侧(含 jog 扩展)标签共列 x、行距≥SLOT_PITCH(T-LABEL-ALIGN);标签字框竖向不压(T-NOOVERLAP)。
 * 返回 { icModel, wires, netflags, bbox }。 */
export function icFanout(snapComp, pinNet, icx, icy) {
	const lg = localGeom(snapComp);
	const g = placeGeom(lg, icx, icy, 0, false);
	const body = g.bbox || DEFAULT_BODY;
	const bcx = (body.minX + body.maxX) / 2;

	const wires = [], netflags = [];
	const fp = { minX: body.minX, minY: body.minY, maxX: body.maxX, maxY: body.maxY };
	const grow = (x, y) => { fp.minX = Math.min(fp.minX, x); fp.minY = Math.min(fp.minY, y); fp.maxX = Math.max(fp.maxX, x); fp.maxY = Math.max(fp.maxY, y); };
	const addLabel = (colX, y, net, left) => {
		const cls = classifyNet(net);
		if (cls !== 'sig') {
			/* 电源/地:渲染为【符号】→ 用实测符号占位 bbox(twin=live);无 alignMode(非文本列) */
			const f=makeSideFlag(cls,net,colX,y,left),b=f.bbox,e=flagExtent(cls,colX,y,f.rotation);
			netflags.push(f);
			grow(e.minX, e.minY); grow(e.maxX, e.maxY);
			return;
		}
		const len = labelLen(net), h = LABEL_H;
		const b = left ? { minX: colX, minY: y, maxX: colX + len, maxY: y + h } : { minX: colX - len, minY: y, maxX: colX, maxY: y + h };
		netflags.push({ kind: 'sig', net, alignMode: left ? 6 : 8, anchor: left ? 'LEFT_BOTTOM' : 'RIGHT_BOTTOM', textX: colX, textY: y, x: colX, y, bbox: b });
		grow(b.minX, b.minY); grow(b.maxX, b.maxY);
	};

	/* 按【脚伸出的边】分类(伸出最远的边 = 该脚所属边),而非纯 x<中线(那会把底排脚错分) */
	const edge = p => {
		const dl = body.minX - p.x, dr = p.x - body.maxX, dt = body.minY - p.y, db = p.y - body.maxY;
		const m = Math.max(dl, dr, dt, db);
		return m === dl ? 'L' : m === dr ? 'R' : m === dt ? 'T' : 'B';
	};
	const grp = { L: [], R: [], T: [], B: [] };
	for (const p of g.pins) { if (pinNet[p.num]) grp[edge(p)].push(p); }
	const isPwr = num => classifyNet(pinNet[num]) !== 'sig';

	/* 列线基于【脚实际外缘】(非 body 边):保证桩非零长(脚恰落 body±STUB 时会退化 → wire.create 失败丢连)。
	 * 信号标签在电路左侧用 LEFT_BOTTOM 向右朝电路展开、右侧用 RIGHT_BOTTOM 向左朝电路展开；
	 * 不应反过来拉长脚到标签锚点的短桩。含 T/B jog 到本侧列的脚。 */
	const bcx0 = (body.minX + body.maxX) / 2;
	const leftSignalPins=[...grp.L.filter(p=>!isPwr(p.num)),...grp.B.filter(p=>p.x<bcx&&!isPwr(p.num)),...grp.T.filter(p=>p.x<bcx&&!isPwr(p.num))];
	const rightSignalPins=[...grp.R.filter(p=>!isPwr(p.num)),...grp.B.filter(p=>p.x>=bcx&&!isPwr(p.num)),...grp.T.filter(p=>p.x>=bcx&&!isPwr(p.num))];
	const leftTextWidth=leftSignalPins.length?Math.max(...leftSignalPins.map(p=>labelLen(pinNet[p.num]))):0;
	const rightTextWidth=rightSignalPins.length?Math.max(...rightSignalPins.map(p=>labelLen(pinNet[p.num]))):0;
	const leftColX = r10((grp.L.length ? Math.min(...grp.L.map(p => p.x)) : body.minX) - STUB_LEN-leftTextWidth);
	const rightColX = r10((grp.R.length ? Math.max(...grp.R.map(p => p.x)) : body.maxX) + STUB_LEN+rightTextWidth);
	/* ★电源/地【符号】列保持贴脚(原 STUB_LEN 位)——去耦电容挂这条轨,列若随 sig 标签加宽外移会推远 decap(T-ADJACENCY 回归)。
	 *   sig 标签列(宽,文字朝IC)与电源符号列(窄,贴脚)分离。 */
	const pwrLeftColX = r10((grp.L.length ? Math.min(...grp.L.map(p => p.x)) : body.minX) - STUB_LEN);
	const pwrRightColX = r10((grp.R.length ? Math.max(...grp.R.map(p => p.x)) : body.maxX) + STUB_LEN);

	/* 电源/地脚【单独成区】:梳状路由到信号列【外侧】的专列、按 ≥FLAG_PITCH 槽位铺开 → 电源/地【符号】竖向延伸
	 * 不压相邻信号标签/彼此(治"符号内联塞密脚列"重叠)。错位转折(顶脚转折最靠外)→ 无交叉(同侧列证法)。
	 * left: 专列在更左;符号 kind=power/ground(投递侧渲染为符号,电源朝上/地朝下),【不发文本标签】。 */
	const combFlags = (pins, sigColX, left) => {
		if (!pins.length) return;
		const sorted = [...pins].sort((a, b) => a.y - b.y);
		const sameSig = (left ? grp.L : grp.R).filter(p => !isPwr(p.num));
		const sigLen = sameSig.length ? Math.max(...sameSig.map(p => labelLen(pinNet[p.num]))) : 0;
		/* ★符号【名半宽】:同列电源/地符号名居中宽 labelLen → comb 竖向 jog 起点须避开名(turnX > flagColX + 名半宽),
		 *   否则下脚的 jog 竖段穿过同列上符号的网名(治 T-NOTHRU-TEXT 竖线穿 5V_AUDIO 名)。channel 同步加宽容纳。 */
		const channel = (sorted.length + 1) * FLAG_GAP + sigLen + 12;
		const flagColX = r10(left ? sigColX - channel : sigColX + channel);
		let prevSlot = -Infinity, prevKind = null, prevNet = null, prevPinY = -Infinity;
		sorted.forEach((p, i) => {
			const net = pinNet[p.num], cls = classifyNet(net);
			const turnX = r5(left ? flagColX + (i + 1) * FLAG_GAP : flagColX - (i + 1) * FLAG_GAP);
			/* ★连续【同网且相邻(y 近)】的电源/地脚 → 并到上一符号(不再生成冗余符号+名):消重叠/名被 jog clip,
			 *   且符合商用(一个电源/地符号服务相邻同网脚,如 U10 双 VDD、IC 相邻多 GND)。仅相邻才并(远的仍各自符号,避长线)。 */
			if (net === prevNet && prevSlot !== -Infinity && Math.abs(p.y - prevPinY) <= FLAG_PITCH) {
				wires.push({ line: [p.x, p.y, turnX, p.y], net });
				if (p.y !== prevSlot) wires.push({ line: [turnX, p.y, turnX, prevSlot], net });
				wires.push({ line: [turnX, prevSlot, flagColX, prevSlot], net });
				prevPinY = p.y;
				return;
			}
			/* 槽距按实测符号占位逐对算(flagGap),保证相邻 flag 竖向不撞(治电源上/地下对撞) */
			const minSlot = prevKind === null ? -Infinity : prevSlot + flagGap(prevKind, cls);
			const slot = r5(Math.max(p.y, minSlot));
			prevSlot = slot; prevKind = cls; prevNet = net; prevPinY = p.y;
			wires.push({ line: [p.x, p.y, turnX, p.y], net });          /* 水平到转折 */
			if (slot !== p.y) wires.push({ line: [turnX, p.y, turnX, slot], net });   /* 竖直到槽 */
			wires.push({ line: [turnX, slot, flagColX, slot], net });   /* 水平到专列 */
			const f=makeSideFlag(cls,net,flagColX,slot,left),b=f.bbox,e=flagExtent(cls,flagColX,slot,f.rotation);
			netflags.push(f);
			grow(e.minX, e.minY); grow(e.maxX, e.maxY);
		});
	};

	/* 左/右边:信号脚直接水平短桩→侧列文本标签;电源地脚梳状→外侧符号专列 */
	for (const p of grp.L.filter(p => !isPwr(p.num))) { wires.push({ line: [p.x, p.y, leftColX, p.y], net: pinNet[p.num] }); addLabel(leftColX, p.y, pinNet[p.num], true); }
	for (const p of grp.R.filter(p => !isPwr(p.num))) { wires.push({ line: [p.x, p.y, rightColX, p.y], net: pinNet[p.num] }); addLabel(rightColX, p.y, pinNet[p.num], false); }
	combFlags(grp.L.filter(p => isPwr(p.num)), pwrLeftColX, true);
	combFlags(grp.R.filter(p => isPwr(p.num)), pwrRightColX, false);

	/* 顶/底脚:jog 到最近侧列的扩展槽位。底脚槽位在体下,顶脚在体上。
	 * 无交叉证明:同一侧脚按"离列近→远"(左列升序 x、右列降序 x)配"近体→远体"槽位,
	 * 则任一脚的水平段所在槽位都比更靠列的脚的竖直段更远离体 → 不落其竖直段区间 → 不交叉。 */
	const bottomY0 = Math.max(body.maxY, ...g.pins.map(p => p.y)) + SLOT_PITCH;
	const topY0 = Math.min(body.minY, ...g.pins.map(p => p.y)) - SLOT_PITCH;
	const jog = (pins, colX, left, startY, dir) => {
		let slot = startY;
		for (const p of pins) {
			wires.push({ line: [p.x, p.y, p.x, slot], net: pinNet[p.num] });      /* 竖直 */
			wires.push({ line: [p.x, slot, colX, slot], net: pinNet[p.num] });     /* 水平到列 */
			addLabel(colX, slot, pinNet[p.num], left);
			slot += dir * SLOT_PITCH;
		}
	};
	jog(grp.B.filter(p => p.x < bcx).sort((a, b) => a.x - b.x), leftColX, true, bottomY0, +1);
	jog(grp.B.filter(p => p.x >= bcx).sort((a, b) => b.x - a.x), rightColX, false, bottomY0, +1);
	jog(grp.T.filter(p => p.x < bcx).sort((a, b) => a.x - b.x), leftColX, true, topY0, -1);
	jog(grp.T.filter(p => p.x >= bcx).sort((a, b) => b.x - a.x), rightColX, false, topY0, -1);

	/* IC 的可见 Designator+Name 全部重摆到占位上方堆叠(件外,不压列/桩/标签)——
	 * 否则未重摆的可见 attr 会留在原快照位、飘出去压邻模块(实测 overlap 根因)。 */
	const icAttrs = [];
	let stackY = fp.minY - ANNOT_GAP;
	for (const key of ['Designator', 'Name']) {
		const src = (snapComp.attrs || []).find(a => a.key === key);
		const visible = key === 'Designator' || (src && (src.valueVisible || src.keyVisible));
		if (!visible) continue;
		const value = src ? src.value : (key === 'Designator' ? snapComp.designator : '');
		const w = labelLen(value || snapComp.designator), h = LABEL_H;
		const ay = stackY - h, ax = bcx - w / 2;
		icAttrs.push({ key, value: value || snapComp.designator, valueVisible: true, keyVisible: false, x: ax, y: ay });
		grow(ax, ay); grow(ax + w, ay + h);
		stackY = ay - ROW_GAP;
	}
	const icModel = { designator: snapComp.designator, x: icx, y: icy, rotation: 0, mirror: false, attrs: icAttrs };
	return { icModel, wires, netflags, bbox: fp };
}

const CELL_GAP = 70;  /* DR26 非直接关系最小60 + 最多10单位的放置吸格余量。 */
const MODULE_GAP = 70;/* DR21 最小60 + 最多10单位的放置吸格余量。 */
const PB_GAP = 8;    /* IC 与其归属无源 bank 的间隙(贴近=去耦电容紧邻 IC) */

const shiftBox = (b, dx, dy) => b ? { minX: b.minX + dx, minY: b.minY + dy, maxX: b.maxX + dx, maxY: b.maxY + dy } : b;
const padBox = (b, pad) => b ? { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad } : b;

/* 模块整体平移(组件 origin+标注、导线、网标+bbox 全同量移)。模块 = {components,wires,netflags,bbox}。 */
function translateModule(mod, dx, dy) {
	return {
		components: mod.components.map(c => ({ ...c, x: c.x + dx, y: c.y + dy, attrs: (c.attrs || []).map(a => ({ ...a, x: a.x + dx, y: a.y + dy })) })),
		wires: mod.wires.map(w => ({ ...w, line: w.line.map((vv, i) => vv + (i % 2 === 0 ? dx : dy)) })),
		netflags: mod.netflags.map(f => ({ ...f, x: f.x + dx, y: f.y + dy, textX: (f.textX ?? f.x) + dx, textY: (f.textY ?? f.y) + dy, bbox: shiftBox(f.bbox, dx, dy) })),
		bbox: shiftBox(mod.bbox, dx, dy),
		cells: (mod.cells || []).map(c => ({ ...c, bbox: shiftBox(c.bbox, dx, dy) })),
	};
}

/* icFanout 结果 → 统一模块形 */
function icModule(snapComp, pinNet) {
	const fo = icFanout(snapComp, pinNet, 0, 0);
	return { components: [fo.icModel], wires: fo.wires, netflags: fo.netflags, bbox: fo.bbox };
}

/* 无源件 bank 模块:2 脚件竖向堆叠成一组,左脚→共享左列 net 标签、右脚→共享右列,各一条正交短桩。
 * 同侧≥2 标签共列(T-LABEL-ALIGN);标注同侧上方(T-ANNOT-PLACE/FULL);脚间内连由符号本身(无内部线)。 */
function passiveBank(passives, pinNets) {
	const infos = passives.map(comp => {
		/* 竖置件(native 脚纵向)旋 90° 转横置 → 脚成左右、可入扇出列 */
		const lp0 = prepComponent(comp, 0).localPins;
		const vertical = lp0.length === 2 && Math.abs(lp0[0].x - lp0[1].x) < Math.abs(lp0[0].y - lp0[1].y);
		const prep = vertical ? prepComponent(comp, 90) : prepComponent(comp, 0);
		const lp = prep.localPins;
		const left = lp[0].x <= lp[1].x ? lp[0] : lp[1];
		const right = lp[0].x <= lp[1].x ? lp[1] : lp[0];
		return { comp, prep, left, right, span: right.x - left.x, fh: prep.footprint.maxY - prep.footprint.minY };
	});
	const maxSpan = Math.max(...infos.map(i => i.span));
	const components = [], wires = [], netflags = [];
	const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
	const grow = b => { if (!b) return; bbox.minX = Math.min(bbox.minX, b.minX); bbox.minY = Math.min(bbox.minY, b.minY); bbox.maxX = Math.max(bbox.maxX, b.maxX); bbox.maxY = Math.max(bbox.maxY, b.maxY); };

	/* 第一遍:逐行定位件(左脚基准 x=STUB_LEN;每行只占自身 footprint 高,不被最高件拉散 → 保密度);
	 *   收集标注水平范围(上置标注与地符号同 y 带 → 符号列须推到标注外侧,否则压标注,治 [GND]×Name 重叠)。 */
	let cursorTop = 0, annL = Infinity, annR = -Infinity;
	const placed = [];
	const FLAG_ROW_GAP = 48;   /* 同列上下两电源/地【符号】不撞、网名不互伸的最小脚距(power名伸17+ground名伸26+余量) */
	let prevLK = null, prevRK = null;
	for (const info of infos) {
		const fp0 = info.prep.footprint;
		const nets = pinNets[info.comp.designator] || {};
		const lk = classifyNet(nets[info.left.num] || ''), rk = classifyNet(nets[info.right.num] || '');
		/* 与上一行【同列】都放电源/地符号 → 竖向须 ≥FLAG_ROW_GAP(否则名/字形交叉,治 VCC_3V3×GND=C9/R4)。 */
		const conflict = placed.length && ((prevLK !== 'sig' && lk !== 'sig') || (prevRK !== 'sig' && rk !== 'sig'));
		if (conflict) {
			const prev = placed[placed.length - 1];
			const minPinY = prev.oy + prev.info.left.y + FLAG_ROW_GAP;
			const wantCursor = (minPinY - info.left.y) + fp0.minY;
			if (wantCursor > cursorTop) cursorTop = wantCursor;
		}
		let ox = STUB_LEN - info.left.x, oy = cursorTop - fp0.minY;
		if (info.prep.pin0) { ox = r5(ox + info.prep.pin0.lx) - info.prep.pin0.lx; oy = r5(oy + info.prep.pin0.ly) - info.prep.pin0.ly; }
		for (const a of info.prep.annots) { annL = Math.min(annL, ox + a.lbx); annR = Math.max(annR, ox + a.lbx + a.w); }
		placed.push({ info, ox, oy });
		cursorTop += (fp0.maxY - fp0.minY) + ROW_GAP_V;
		prevLK = lk; prevRK = rk;
	}
	if (!Number.isFinite(annL)) { annL = 0; annR = STUB_LEN + maxSpan; }
	const SYM_HALF = 12, COL_CLEAR = 6;   /* 地/电源符号半宽 + 余量 */
	/* ★电源/地符号【网名】居中在列 x、宽 labelLen → 列须按【名半宽】推出标注外(非仅 glyph SYM_HALF),
	 *   否则宽名(如 VBUS_5V 半宽 24.5 > SYM_HALF 12)回压电阻标号/阻值(治 T-TEXT-OVERLAP name[电源]×位号)。 */
	let maxLNameHalf = 0, maxRNameHalf = 0, maxLSigWidth=0, maxRSigWidth=0, minLpin = Infinity, maxRpin = -Infinity;
	for (const { info, ox } of placed) {
		const nets = pinNets[info.comp.designator] || {};
		const lNet = nets[info.left.num], rNet = nets[info.right.num];
		minLpin = Math.min(minLpin, ox + info.left.x); maxRpin = Math.max(maxRpin, ox + info.right.x);
		if (lNet && classifyNet(lNet) !== 'sig') maxLNameHalf = Math.max(maxLNameHalf, labelLen(lNet) / 2);
		else if(lNet) maxLSigWidth=Math.max(maxLSigWidth,labelLen(lNet));
		if (rNet && classifyNet(rNet) !== 'sig') maxRNameHalf = Math.max(maxRNameHalf, labelLen(rNet) / 2);
		else if(rNet) maxRSigWidth=Math.max(maxRSigWidth,labelLen(rNet));
	}
	/* 信号文字由外缘锚点朝模块展开；电源/地符号名称仍按实际半宽避开可见标注。 */
	const xL = r10(Math.min(0, annL - Math.max(SYM_HALF, maxLNameHalf) - COL_CLEAR, minLpin - STUB_LEN-maxLSigWidth));
	const xR = r10(Math.max(STUB_LEN + maxSpan + STUB_LEN, annR + Math.max(SYM_HALF, maxRNameHalf) + COL_CLEAR, maxRpin + STUB_LEN+maxRSigWidth));

	/* net 标:电源/地→【符号】(flagBox 占位、flagExtent 增长,twin 与真板一致);信号→文本标签(同侧成列) */
	const bankLabel = (colX, pinY, net, left) => {
		const cls = classifyNet(net);
		if (cls !== 'sig') {
			const f=makeSideFlag(cls,net,colX,pinY,left),fb=f.bbox,e=flagExtent(cls,colX,pinY,f.rotation);
			netflags.push(f);
			grow({ minX: e.minX, minY: e.minY, maxX: e.maxX, maxY: e.maxY });
			return;
		}
		const len = labelLen(net), h = LABEL_H;
		const b = left ? { minX: colX, minY: pinY, maxX: colX + len, maxY: pinY + h } : { minX: colX - len, minY: pinY, maxX: colX, maxY: pinY + h };
		netflags.push({ kind: 'sig', net, alignMode: left ? 6 : 8, anchor: left ? 'LEFT_BOTTOM' : 'RIGHT_BOTTOM', textX: colX, textY: pinY, x: colX, y: pinY, bbox: b }); grow(b);
	};

	for (const { info, ox, oy } of placed) {
		const leftX = ox + info.left.x, rightX = ox + info.right.x, pinY = oy + info.left.y;
		components.push({
			designator: info.comp.designator, x: ox, y: oy, rotation: info.prep.rotation || 0, mirror: false,
			attrs: info.prep.annots.map(a => ({ key: a.key, value: a.value, valueVisible: true, keyVisible: false, x: ox + a.lbx, y: oy + a.lby })),
		});
		const nets = pinNets[info.comp.designator] || {};
		const lNet = nets[info.left.num], rNet = nets[info.right.num];
		if (lNet) { wires.push({ line: [leftX, pinY, xL, pinY], net: lNet }); bankLabel(xL, pinY, lNet, true); }
		if (rNet) { wires.push({ line: [rightX, pinY, xR, pinY], net: rNet }); bankLabel(xR, pinY, rNet, false); }
		const fp = info.prep.footprint;
		grow({ minX: ox + fp.minX, minY: oy + fp.minY, maxX: ox + fp.maxX, maxY: oy + fp.maxY });
	}
	return { components, wires, netflags, bbox };
}

/* 模块整体 bbox(含 components.origin、netflags.bbox、wires 端点)——用于填版面缩放/居中 */
function moduleSpan(placed) {
	const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
	const grow = (x, y) => { b.minX = Math.min(b.minX, x); b.minY = Math.min(b.minY, y); b.maxX = Math.max(b.maxX, x); b.maxY = Math.max(b.maxY, y); };
	for (const c of placed.components) grow(c.x, c.y);
	for (const f of placed.netflags) { if (f.bbox) { grow(f.bbox.minX, f.bbox.minY); grow(f.bbox.maxX, f.bbox.maxY); } else grow(f.x, f.y); }
	for (const w of placed.wires) { const l = w.line; for (let i = 0; i + 1 < l.length; i += 2) grow(l[i], l[i + 1]); }
	return b;
}

/* 多模块编排:货架装箱(shelf packing)。无 opts.sheet → 紧凑铺成 ~横版矩形(原行为)。
 *   - 目标行宽 W = √(Σ模块面积 × aspect);模块按高降序(同架高度齐,少浪费);行内累加宽度超 W 换行。
 * 有 opts.sheet={w,h,fillX,fillY} → 紧凑装箱后,按比例把【模块原点】绕内容中心放大(只胀不缩)、
 *   再整体居中到 sheet 中心:模块间距撑开填满版面、模块【内部】几何不变 → 治"挤一角"且 T-DENSITY
 *   (件中心最近邻中位)基本不变(多数件最近邻在模块内)。方向无关(绕中心对称缩放+居中)。 */
function arrangeModules(modules, opts = {}) {
	const aspect = opts.aspect ?? 1.4;
	const gap = opts.gap ?? CELL_GAP;
	const dim = m => ({ w: m.bbox.maxX - m.bbox.minX, h: m.bbox.maxY - m.bbox.minY });
	const sheet = opts.sheet;
	const totalArea = modules.reduce((s, m) => { const d = dim(m); return s + d.w * d.h; }, 0);
	const targetW = sheet ? sheet.w * (sheet.fillX ?? 0.92) : Math.max(1, Math.sqrt(totalArea * aspect));
	/* keepOrder:保留输入顺序(超模块按信号流左→右铺,不按高重排);byCluster:先按簇号聚拢;否则纯高降序(货架高度齐) */
	const sorted = opts.keepOrder ? [...modules]
		: [...modules].sort((a, b) => (opts.byCluster ? ((a.cluster ?? 0) - (b.cluster ?? 0)) : 0) || (dim(b).h - dim(a).h));

	/* 1) 紧凑装箱:记录每模块的紧凑平移量(原点处) */
	const placedMods = [];   /* { mod, tx, ty } */
	let cursorX = 0, rowY = 0, rowMaxH = 0, rowW = 0;
	for (const m of sorted) {
		const { w, h } = dim(m);
		if (rowW > 0 && rowW + w > targetW) { rowY += rowMaxH + gap; cursorX = 0; rowMaxH = 0; rowW = 0; }
		placedMods.push({ mod: m, tx: r10(cursorX - m.bbox.minX), ty: r10(rowY - m.bbox.minY) });
		cursorX += w + gap; rowW += w + gap;
		rowMaxH = Math.max(rowMaxH, h);
	}

	const emit = list => {
		const out = { components: [], wires: [], netflags: [], placed: [], cells: [], bbox: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity } };
		for (const { mod, tx, ty } of list) {
			const t = translateModule(mod, tx, ty);
			out.components.push(...t.components); out.wires.push(...t.wires); out.netflags.push(...t.netflags);
			out.placed.push({ id: mod.id, cluster: mod.cluster, title: mod.title, bbox: t.bbox });   /* 每模块【最终】bbox+簇+标题(供块标题框) */
			out.cells.push(...(t.cells || []));
			if (t.bbox) { out.bbox.minX = Math.min(out.bbox.minX, t.bbox.minX); out.bbox.minY = Math.min(out.bbox.minY, t.bbox.minY); out.bbox.maxX = Math.max(out.bbox.maxX, t.bbox.maxX); out.bbox.maxY = Math.max(out.bbox.maxY, t.bbox.maxY); }
		}
		return out;   /* 含 bbox = 各模块 footprint 并集(供超模块嵌套编排,勿用 origin-only 的 moduleSpan) */
	};

	if (!sheet) return emit(placedMods);

	/* 2) 填版面:量紧凑内容 bbox → 求绕中心放大系数(只胀不缩)→ 模块原点缩放 → 居中到 sheet 中心 */
	const compact = emit(placedMods);
	const cb = moduleSpan(compact);
	const cw = Math.max(1, cb.maxX - cb.minX), ch = Math.max(1, cb.maxY - cb.minY);
	const ccx = (cb.minX + cb.maxX) / 2, ccy = (cb.minY + cb.maxY) / 2;
	const sx = Math.max(1, Math.min(opts.maxScale ?? 2.2, (sheet.w * (sheet.fillX ?? 0.92)) / cw));
	const sy = Math.max(1, Math.min(opts.maxScale ?? 2.2, (sheet.h * (sheet.fillY ?? 0.82)) / ch));
	const scx = (sheet.cx ?? sheet.w / 2), scy = (sheet.cy ?? sheet.h / 2);
	const spread = placedMods.map(({ mod, tx, ty }) => {
		const b = mod.bbox;
		const ox = tx + (b.minX + b.maxX) / 2, oy = ty + (b.minY + b.maxY) / 2;  /* 紧凑放置后该模块中心 */
		const ncx = scx + (ox - ccx) * sx, ncy = scy + (oy - ccy) * sy;          /* 缩放并居中后的目标中心 */
		return { mod, tx: r10(tx + (ncx - ox)), ty: r10(ty + (ncy - oy)) };
	});
	return emit(spread);
}

/* 均衡网格编排:n 个超模块(功能块)排成 cols 列的【内容尺寸表格】(列宽=该列最宽块、行高=该行最高块),
 * 块在各自格内居中、格间均匀 gap(自适应填到 sheet 的 fill 比例、有上限防过疏),整张表居中 sheet
 * → 均匀(对称)页边、无孤块、无大空区。块【内部几何不动】(只整体平移)→ tier2 不回退、连接不变。
 * 返回 { components, wires, netflags, placed, bbox }(placed 带 cluster/title/最终 bbox,供块标题框)。 */
function arrangeGrid(modules, opts = {}) {
	const sheet = opts.sheet;
	const cols = Math.max(1, opts.cols || Math.ceil(Math.sqrt(modules.length)));
	const rows = Math.max(1, Math.ceil(modules.length / cols));
	const dim = m => ({ w: m.bbox.maxX - m.bbox.minX, h: m.bbox.maxY - m.bbox.minY });
	const colW = new Array(cols).fill(0), rowH = new Array(rows).fill(0);
	modules.forEach((m, i) => { const r = Math.floor(i / cols), c = i % cols; const d = dim(m); colW[c] = Math.max(colW[c], d.w); rowH[r] = Math.max(rowH[r], d.h); });
	const sumW = colW.reduce((a, b) => a + b, 0), sumH = rowH.reduce((a, b) => a + b, 0);
	const cap = opts.gapCap ?? 340;
	const gapX = cols > 1 ? Math.min(cap, Math.max(60, (sheet.w * (opts.fillX ?? 0.92) - sumW) / (cols - 1))) : 0;
	const gapY = rows > 1 ? Math.min(cap, Math.max(60, (sheet.h * (opts.fillY ?? 0.88) - sumH) / (rows - 1))) : 0;
	const gridW = sumW + (cols - 1) * gapX, gridH = sumH + (rows - 1) * gapY;
	const ox0 = (sheet.cx ?? sheet.w / 2) - gridW / 2, oy0 = (sheet.cy ?? sheet.h / 2) - gridH / 2;
	const colX = []; let cx = ox0; for (let c = 0; c < cols; c++) { colX.push(cx); cx += colW[c] + gapX; }
	const rowY = []; let cy = oy0; for (let r = 0; r < rows; r++) { rowY.push(cy); cy += rowH[r] + gapY; }
	const out = { components: [], wires: [], netflags: [], placed: [], cells: [], bbox: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity } };
	modules.forEach((m, i) => {
		const r = Math.floor(i / cols), c = i % cols, d = dim(m);
		const tx = r10(colX[c] + (colW[c] - d.w) / 2 - m.bbox.minX);   /* 块在格内居中 */
		const ty = r10(rowY[r] + (rowH[r] - d.h) / 2 - m.bbox.minY);
		const t = translateModule(m, tx, ty);
		out.components.push(...t.components); out.wires.push(...t.wires); out.netflags.push(...t.netflags);
		out.placed.push({ id: m.id, cluster: m.cluster, title: m.title, bbox: t.bbox });
		out.cells.push(...(t.cells || []));
		if (t.bbox) { out.bbox.minX = Math.min(out.bbox.minX, t.bbox.minX); out.bbox.minY = Math.min(out.bbox.minY, t.bbox.minY); out.bbox.maxX = Math.max(out.bbox.maxX, t.bbox.maxX); out.bbox.maxY = Math.max(out.bbox.maxY, t.bbox.maxY); }
	});
	return out;
}

/* flex-wrap 网格摆放:preps → [{p,ox,oy}]。startX/startY = 网格左上起点(默认 0,用于让网格避开扇出区)。
 * footprint 左上角对齐行游标;按脚 0 对齐 origin 保脚落格。 */
function gridPlace(preps, cols, startX = 0, startY = 0) {
	const placed = [];
	let cursorX = startX, rowY = startY, rowMaxH = 0, colIdx = 0;
	for (const p of preps) {
		if (colIdx >= cols) { rowY += rowMaxH + ROW_GAP_V; cursorX = startX; rowMaxH = 0; colIdx = 0; }
		const fp = p.footprint, fw = fp.maxX - fp.minX, fh = fp.maxY - fp.minY;
		let ox = r5(cursorX - fp.minX), oy = r5(rowY - fp.minY);
		if (p.pin0) { ox = r5(ox + p.pin0.lx) - p.pin0.lx; oy = r5(oy + p.pin0.ly) - p.pin0.ly; }
		placed.push({ p, ox, oy });
		cursorX += fw + COL_GAP;
		rowMaxH = Math.max(rowMaxH, fh);
		colIdx++;
	}
	return placed;
}

/* 网格件 → model 件(标注同侧件外) */
function gridToComponents(placed) {
	return placed.map(({ p, ox, oy }) => ({
		designator: p.designator, x: ox, y: oy, rotation: p.rotation || 0, mirror: false,
		attrs: p.annots.map(a => ({
			key: a.key, value: a.value, valueVisible: true, keyVisible: false,
			x: ox + a.lbx, y: oy + a.lby,
		})),
	}));
}

/* 连接驱动归属:每个 2 脚无源件 → 原图位置【最近的锚件(IC/连接器)】。设计者把去耦电容放在它的 IC 旁,
 * 故"原图邻近"= 归属。idOf 给定(外部功能分区)时【限同簇】最近锚 → 去耦贴本功能块的 IC,不跨块。
 * 返回 Map(锚 designator → [无源件]) + 无(同簇)锚的 leftover。 */
function assignPassives(passives, anchors, idOf = null) {
	const map = new Map(anchors.map(a => [a.designator, []]));
	const leftover = [];
	for (const p of passives) {
		let best = null, bd = Infinity;
		for (const a of anchors) {
			if (idOf && idOf.get(p.designator) !== idOf.get(a.designator)) continue;   /* 限同簇 */
			const d = Math.hypot((p.x ?? 0) - (a.x ?? 0), (p.y ?? 0) - (a.y ?? 0));
			if (d < bd) { bd = d; best = a; }
		}
		if (best) map.get(best.designator).push(p); else leftover.push(p);
	}
	return { map, leftover };
}

/* 合并两个模块几何(bbox 取并) */
function mergeModules(...mods) {
	const out = { components: [], wires: [], netflags: [], bbox: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity } };
	for (const m of mods) {
		if (!m) continue;
		out.components.push(...m.components); out.wires.push(...m.wires); out.netflags.push(...m.netflags);
		if (m.bbox) { out.bbox.minX = Math.min(out.bbox.minX, m.bbox.minX); out.bbox.minY = Math.min(out.bbox.minY, m.bbox.minY); out.bbox.maxX = Math.max(out.bbox.maxX, m.bbox.maxX); out.bbox.maxY = Math.max(out.bbox.maxY, m.bbox.maxY); }
	}
	return out;
}

const DECAP_GAP = 8;     /* 去耦电容横向【间隙】(pitch = 槽宽 + 此);槽宽=body/标注/地符号三者最宽 → 件中心 NN 紧(治 T-DENSITY) */
const PWR_STUB = 22;     /* 电容脚 → 电源/地符号 长桩:把符号推远,向内延伸够不到电容/彼此(治"电源上地下"对撞) */

/* —— 去耦电容【贴 IC 电源脚 + 直连短线】(连接驱动相邻 + T-WIRE-DIRECT,照 RK3576 直放直连)——
 * RK3576 式:从 IC 电源符号节点(rail)沿 y=ry 拉【横向电源轨】,归属去耦电容【并排垂下】挂在轨上(电源脚在轨上=与 IC 电源脚同
 * wire 连通分量 → 直连 T-ADJACENCY);电容地脚→正下方地符号(单段直线);标注竖叠外侧让开电源符号。无 spine/jog(治"强行拐弯")。 */
const DECAP_FIRST = 30;    /* rail 节点 → 第一个电容 的横向外移量(收紧,去耦更贴 IC) */
const DECAP_DX = 60;       /* 并排相邻电容横向间距(收紧回密;> 电容体 + 外侧标注列宽,避免邻容标注互压) */
const DECAP_GND_STUB = 25; /* 电容地脚 → 正下方地符号；留出可见地网名高度，避免名称压到电容体/标注 */
const PULL_STUB = 20;      /* 上拉信号脚 → 横桩节点 的竖直短桩(把件体抬到横桩之上,避盖桩 NOTHRU) */
const PULL_REACH = 110;    /* 上拉 cap 节点离同网 IC 脚的最大距(超出=注定 too-far,退 bank 不硬贴) */

/* 去耦电容判定:2 脚件且【一脚电源一脚地】(通用,零特定电路)。 */
export function isDecoupling(comp, nets) {
	if ((comp.pins || []).length !== 2) return false;
	const m = nets[comp.designator] || {};
	const cls = (comp.pins || []).map(p => classifyNet(m[p.num] || ''));
	return cls.includes('power') && cls.includes('ground');
}

/* 信号-轨无源件判定:2 脚件,一脚【轨】(电源或地)一脚【信号】。EE 章法 = 竖放(轨端符号、信号端标签)。
 * 覆盖:滤波/旁路 cap(信号+地)、上拉 R(信号+电源)、下拉 R(信号+地)。横放只给【两端同类】=串联(电源+电源 0Ω / 信号+信号)。 */
export function isSigRailPassive(comp, nets) {
	if (!/^[RCL]\d/.test(comp.designator || '') || (comp.pins || []).length !== 2) return false;   /* 仅 R/C/L,排除按钮 SW/连接器 */
	const m = nets[comp.designator] || {};
	const cls = (comp.pins || []).map(p => classifyNet(m[p.num] || ''));
	const rail = cls.filter(c => c === 'power' || c === 'ground').length;
	const sig = cls.filter(c => c === 'sig').length;
	return rail === 1 && sig === 1;
}
/* 保留 isFilterCap 旧名(=信号+地的 cap),供既有引用;新路由用 isSigRailPassive。 */
export function isFilterCap(comp, nets) {
	if (!/^C/.test(comp.designator || '')) return false;
	const m = nets[comp.designator] || {};
	const cls = (comp.pins || []).map(p => classifyNet(m[p.num] || ''));
	return cls.includes('ground') && cls.includes('sig');
}

/* 信号-轨无源件【竖向成排】:件竖置、轨脚接【符号】(电源符号朝上/地符号朝下)、信号脚接【信号 net 标签】。
 * EE 章法:上拉 R=VCC符号在上/信号在下;滤波cap、下拉 R=信号在上/GND符号在下。竖放治"上拉/滤波横放反常"。 */
function sigPassiveRow(comps, nets) {
	const components = [], wires = [], netflags = [];
	const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
	const grow = b => { if (!b) return; bbox.minX = Math.min(bbox.minX, b.minX); bbox.minY = Math.min(bbox.minY, b.minY); bbox.maxX = Math.max(bbox.maxX, b.maxX); bbox.maxY = Math.max(bbox.maxY, b.maxY); };
	let cursorX = 0;
	for (const comp of comps) {
		const m = nets[comp.designator] || {};
		const railOf = p => { const c = classifyNet(m[p.num] || ''); return c === 'power' || c === 'ground' ? c : null; };
		/* EasyEDA 坐标 y 向上。轨在外侧:地→较小 y(视觉下);电源→较大 y(视觉上)。 */
		let prep = null, pSig = null, pRail = null, railCls = null;
		for (const r of [0, 90, 180, 270]) {
			const pp = prepComponent(comp, r), lp = pp.localPins;
			if (lp.length !== 2 || Math.abs(lp[0].y - lp[1].y) <= Math.abs(lp[0].x - lp[1].x)) continue;   /* 仅竖置 */
			const a = lp[0], b = lp[1], ra = railOf(a), rb = railOf(b);
			if (ra && !rb) { const railDown = ra === 'ground'; if ((railDown && a.y < b.y) || (!railDown && a.y > b.y)) { prep = pp; pRail = a; pSig = b; railCls = ra; break; } }
			if (rb && !ra) { const railDown = rb === 'ground'; if ((railDown && b.y < a.y) || (!railDown && b.y > a.y)) { prep = pp; pRail = b; pSig = a; railCls = rb; break; } }
		}
		if (!prep) {
			prep = prepComponent(comp, 90); const lp = prep.localPins, a = lp[0], b = lp[1];
			const ra = railOf(a); pRail = ra ? a : b; pSig = pRail === a ? b : a; railCls = railOf(pRail) || 'ground';
		}
		const body = prep.body;
		let ox = cursorX - body.minX, oy = 0;
		if (prep.pin0) { ox = r5(ox + prep.pin0.lx) - prep.pin0.lx; oy = r5(oy + prep.pin0.ly) - prep.pin0.ly; }
		const sigX = ox + pSig.x, sigYp = oy + pSig.y, railX = ox + pRail.x, railYp = oy + pRail.y;
		/* 轨脚→外侧符号(地朝下/电源朝上);信号脚→外侧短桩+标签 */
		const railDown = railCls === 'ground';
		const railSymY = r5(railYp + (railDown ? -PWR_STUB : PWR_STUB));
		const sigY = r5(sigYp + (railDown ? STUB_LEN : -STUB_LEN));   /* 信号在轨的对侧 */
		/* 标号/阻值贴体右侧竖叠 */
		const bcy = oy + (body.minY + body.maxY) / 2;
		const annH = prep.annots.reduce((s, a) => s + a.h, 0) + ROW_GAP * Math.max(0, prep.annots.length - 1);
		const axi = ox + body.maxX + SIDE_GAP;
		let ay = bcy - annH / 2, annotW = 0;
		const attrs = [];
		for (const a of prep.annots) {
			attrs.push({ key: a.key, value: a.value, valueVisible: true, keyVisible: false, x: axi, y: ay });
			grow({ minX: axi, minY: ay, maxX: axi + a.w, maxY: ay + a.h });
			ay += a.h + ROW_GAP; annotW = Math.max(annotW, a.w);
		}
		components.push({ designator: comp.designator, x: ox, y: oy, rotation: prep.rotation || 0, mirror: false, attrs });
		/* 信号脚 → 桩 + sig 标签；标签在电路左侧时用 LEFT_BOTTOM 向右朝电路展开。 */
		wires.push({ line: [sigX, sigYp, sigX, sigY], net: m[pSig.num] });
		const sigNet = m[pSig.num], len = labelLen(sigNet);
		const lbY = sigY, lb = { minX: sigX, minY: lbY - LABEL_H, maxX: sigX + len, maxY: lbY };
		netflags.push({ kind: 'sig', net: sigNet, alignMode: 6, anchor: 'LEFT_BOTTOM', textX: sigX, textY: lbY, x: sigX, y: lbY, bbox: lb });
		grow(lb); grow({ minX: sigX, minY: Math.min(sigYp, sigY), maxX: sigX, maxY: Math.max(sigYp, sigY) });
		/* 轨脚 → 外侧符号(电源/地) */
		wires.push({ line: [railX, railYp, railX, railSymY], net: m[pRail.num] });
		const rb = flagBox(railCls, railX, railSymY); netflags.push({ kind: railCls, net: m[pRail.num], x: railX, y: railSymY, textX: railX, textY: railSymY, nameSide: 'left', bbox: rb }); grow(flagExtent(railCls, railX, railSymY));
		grow({ minX: ox + body.minX, minY: oy + body.minY, maxX: ox + body.maxX, maxY: oy + body.maxY });
		const slotW = Math.max(22, (body.maxX - body.minX) + SIDE_GAP + annotW) + FLAG_GAP;
		cursorX += slotW + DECAP_GAP;
	}
	return { components, wires, netflags, bbox };
}

/* 去耦电容竖向成排:电容竖置、电源脚在上接【电源符号】、地脚在下接【地符号】(顶电源底地,通用商用章法)。
 * 长桩 PWR_STUB 把符号推到电容外侧;电容靠 net 名(符号 Global Net Name)连通、不与 IC 物理连线 →
 * 整排放 IC【侧旁】空白区(icWithPassives stackRight),竖桩不穿 IC 扇出 → 无交叉。 */
function decouplingRow(caps, nets) {
	const components = [], wires = [], netflags = [];
	const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
	const grow = b => { if (!b) return; bbox.minX = Math.min(bbox.minX, b.minX); bbox.minY = Math.min(bbox.minY, b.minY); bbox.maxX = Math.max(bbox.maxX, b.maxX); bbox.maxY = Math.max(bbox.maxY, b.maxY); };
	let cursorX = 0;
	for (const cap of caps) {
		const m = nets[cap.designator] || {};
		/* EasyEDA 坐标 y 向上:选择电源脚在较大 y、地脚在较小 y 的竖置朝向。 */
		let prep = null, pPow = null, pGnd = null;
		for (const r of [0, 90, 180, 270]) {
			const pp = prepComponent(cap, r), lp = pp.localPins;
			if (lp.length !== 2 || Math.abs(lp[0].y - lp[1].y) <= Math.abs(lp[0].x - lp[1].x)) continue;   /* 仅竖置 */
			const a = lp[0], b = lp[1], ca = classifyNet(m[a.num] || ''), cb = classifyNet(m[b.num] || '');
			if (ca === 'power' && cb === 'ground' && a.y > b.y) { prep = pp; pPow = a; pGnd = b; break; }
			if (cb === 'power' && ca === 'ground' && b.y > a.y) { prep = pp; pPow = b; pGnd = a; break; }
		}
		if (!prep) {   /* 兜底:取竖置,按 net 定电源/地脚(符号仍按角色放,电源朝外) */
			prep = prepComponent(cap, 90); const lp = prep.localPins, a = lp[0], b = lp[1];
			const ca = classifyNet(m[a.num] || '');
			pPow = ca === 'power' ? a : b; pGnd = pPow === a ? b : a;
		}
		const body = prep.body;
		let ox = cursorX - body.minX, oy = 0;
		if (prep.pin0) { ox = r5(ox + prep.pin0.lx) - prep.pin0.lx; oy = r5(oy + prep.pin0.ly) - prep.pin0.ly; }
		const powX = ox + pPow.x, powYp = oy + pPow.y, gndX = ox + pGnd.x, gndYp = oy + pGnd.y;
		/* 电源符号在电源脚上方(+Y)，地符号在地脚下方(-Y)。 */
		const pwrY = r5(powYp + PWR_STUB), gndY = r5(gndYp - PWR_STUB);
		/* 标号/阻值【贴电容体右侧】竖叠居中(左缘贴 body.maxX+SIDE_GAP):离体近、同侧、位号值紧挨(RK 式,
		 * 治"离器件远";原版堆在电源符号上方被符号隔开离体 40+,=用户骂的瞎放)。 */
		const bcy = oy + (body.minY + body.maxY) / 2;
		const annH = prep.annots.reduce((s, a) => s + a.h, 0) + ROW_GAP * Math.max(0, prep.annots.length - 1);
		const axi = ox + body.maxX + SIDE_GAP;
		let ay = bcy - annH / 2, annotW = 0;
		const attrs = [];
		/* attr 水平渲染 → live 锚字框左上角于 attr x/y;竖向电容 prepComponent rx/ry 是旋转后偏移(对水平文字无效)
		 * → 直接取 box 左上角(axi,ay)做 anchor,twin/live 一致、值宽无关恒贴体(见 placeDecapStraight 同理)。 */
		for (const a of prep.annots) {
			attrs.push({ key: a.key, value: a.value, valueVisible: true, keyVisible: false, x: axi, y: ay });
			grow({ minX: axi, minY: ay, maxX: axi + a.w, maxY: ay + a.h });
			ay += a.h + ROW_GAP; annotW = Math.max(annotW, a.w);
		}
		components.push({ designator: cap.designator, x: ox, y: oy, rotation: prep.rotation || 0, mirror: false, attrs });
		wires.push({ line: [powX, powYp, powX, pwrY], net: m[pPow.num] });
		const pb = flagBox('power', powX, pwrY); netflags.push({ kind: 'power', net: m[pPow.num], x: powX, y: pwrY, textX: powX, textY: pwrY, nameSide: 'left', bbox: pb }); grow(flagExtent('power', powX, pwrY));
		wires.push({ line: [gndX, gndYp, gndX, gndY], net: m[pGnd.num] });
		const gb = flagBox('ground', gndX, gndY); netflags.push({ kind: 'ground', net: m[pGnd.num], x: gndX, y: gndY, textX: gndX, textY: gndY, nameSide: 'left', bbox: gb }); grow(flagExtent('ground', gndX, gndY));
		grow({ minX: ox + body.minX, minY: oy + body.minY, maxX: ox + body.maxX, maxY: oy + body.maxY });
		/* 槽宽 = 符号(宽22,居中于 cx)左半 + body + 右侧标注(SIDE_GAP+annotW);下件符号左伸 11 → 加 FLAG_GAP 余量不撞 */
		const slotW = Math.max(22, (body.maxX - body.minX) + SIDE_GAP + annotW) + FLAG_GAP;
		cursorX += slotW + DECAP_GAP;
	}
	return { components, wires, netflags, bbox };
}

/* 信号-轨无源件【贴锚件信号脚直连】(连接驱动,无 net 标签):竖置,信号脚【tap 到锚件 sig 节点】(同 wire 分量=直连
 *   T-ADJACENCY direct)、轨脚接电源/地符号(外侧)。tapX/tapY=锚件该网 sig 节点;sgn=节点在锚右(+1 向右放)/左(-1)。
 *   返回 { component, wires, netflags, bbox }。NO sig 标签(直连,标签由锚件节点保留供跨块)。 */
function placeSigPassiveDirect(comp, nets, tapX, tapY, sgn, slot = 0) {
	const m = nets[comp.designator] || {};
	const railOf = p => { const c = classifyNet(m[p.num] || ''); return c === 'power' || c === 'ground' ? c : null; };
	let prep = null, pSig = null, pRail = null, railCls = null;
	for (const r of [0, 90, 180, 270]) {
		const pp = prepComponent(comp, r), lp = pp.localPins;
		if (lp.length !== 2 || Math.abs(lp[0].y - lp[1].y) <= Math.abs(lp[0].x - lp[1].x)) continue;   /* 仅竖置 */
		const a = lp[0], b = lp[1], ra = railOf(a), rb = railOf(b);
		/* 屏幕坐标:地轨脚在信号脚下方(较大 y)，电源轨脚在信号脚上方(较小 y)。 */
		if (rb && !ra) { const ok = rb === 'ground' ? b.y > a.y : b.y < a.y; if (ok) { prep = pp; pSig = a; pRail = b; railCls = rb; break; } }
		if (ra && !rb) { const ok = ra === 'ground' ? a.y > b.y : a.y < b.y; if (ok) { prep = pp; pSig = b; pRail = a; railCls = ra; break; } }
	}
	if (!prep) { prep = prepComponent(comp, 90); const lp = prep.localPins; const ra = railOf(lp[0]); pRail = ra ? lp[0] : lp[1]; pSig = pRail === lp[0] ? lp[1] : lp[0]; railCls = railOf(pRail) || 'ground'; }
	/* ★电源轨件(上拉)朝上:信号网是横桩,若件体落在桩上会盖桩(NOTHRU)。正解=px=节点x(保持贴近 IC),
	 *   信号脚【抬到节点上方 PULL_STUB 一个竖直短桩】→ 件体在横桩之上、竖直 tap 下连节点(横桩从一侧入节点=junction 非穿体)。
	 *   各上拉 tap 到各自同网 cap 的真实信号脚(传入 tapX/tapY),cap 不同 x 自动错开,不再同 x 冲突。
	 *   地轨件(滤波/下拉)朝下=base DECAP_FIRST(越过锚件自身电源/地符号)、信号脚同 tapY。slot 同侧错开 42。 */
	const base = railCls === 'power' ? 0 : DECAP_FIRST;
	const px = r10(tapX + sgn * (base + slot * 42));
	const sigTapY = railCls === 'power' ? r5(tapY + PULL_STUB) : tapY;
	let ox = px - pSig.x, oy = sigTapY - pSig.y;   /* 信号脚落 (px, sigTapY);电源件抬高→竖直 tap */
	if (prep.pin0) { ox = r5(ox + prep.pin0.lx) - prep.pin0.lx; oy = r5(oy + prep.pin0.ly) - prep.pin0.ly; }
	const body = prep.body;
	const sigX = ox + pSig.x, sigYp = oy + pSig.y, railX = ox + pRail.x, railYp = oy + pRail.y;
	const wires = [], netflags = [];
	const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
	const grow = b => { if (!b) return; bbox.minX = Math.min(bbox.minX, b.minX); bbox.minY = Math.min(bbox.minY, b.minY); bbox.maxX = Math.max(bbox.maxX, b.maxX); bbox.maxY = Math.max(bbox.maxY, b.maxY); };
	/* foot=件【自身占位】(本体+符号+标注,排除 tap 线)→ 碰撞检测用(tap 线必然经过锚件节点区,不算碰撞) */
	const foot = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
	const footGrow = b => { if (!b) return; foot.minX = Math.min(foot.minX, b.minX); foot.minY = Math.min(foot.minY, b.minY); foot.maxX = Math.max(foot.maxX, b.maxX); foot.maxY = Math.max(foot.maxY, b.maxY); };
	/* 信号脚 → 锚件 sig 节点【直连 tap】(水平单段,同 wire 分量);px=nodeX 时信号脚即落节点→退化跳过(脚已在节点上) */
	if (Math.abs(tapX - sigX) > 2 || Math.abs(tapY - sigYp) > 2) {
		wires.push({ line: [tapX, tapY, sigX, sigYp], net: m[pSig.num] });
		grow({ minX: Math.min(tapX, sigX), minY: Math.min(tapY, sigYp), maxX: Math.max(tapX, sigX), maxY: Math.max(tapY, sigYp) });
	}
	/* 轨脚 → 外侧电源/地符号 */
	const railSymY = r5(railYp + (railCls === 'ground' ? PWR_STUB : -PWR_STUB));
	wires.push({ line: [railX, railYp, railX, railSymY], net: m[pRail.num] });
	const rfb = flagBox(railCls, railX, railSymY); netflags.push({ kind: railCls, net: m[pRail.num], x: railX, y: railSymY, textX: railX, textY: railSymY, nameSide: 'left', bbox: rfb }); grow(flagExtent(railCls, railX, railSymY)); footGrow(rfb);
	/* 标号/阻值贴体右侧竖叠(左上角锚,与 twin/live 一致) */
	const bcy = oy + (body.minY + body.maxY) / 2;
	const annH = prep.annots.reduce((s, a) => s + a.h, 0) + ROW_GAP * Math.max(0, prep.annots.length - 1);
	const axi = ox + body.maxX + SIDE_GAP;
	let ay = bcy - annH / 2;
	const attrs = [];
	for (const a of prep.annots) {
		attrs.push({ key: a.key, value: a.value, valueVisible: true, keyVisible: false, x: axi, y: ay });
		grow({ minX: axi, minY: ay, maxX: axi + a.w, maxY: ay + a.h }); footGrow({ minX: axi, minY: ay, maxX: axi + a.w, maxY: ay + a.h });
		ay += a.h + ROW_GAP;
	}
	const bodyBox = { minX: ox + body.minX, minY: oy + body.minY, maxX: ox + body.maxX, maxY: oy + body.maxY };
	grow(bodyBox); footGrow(bodyBox);
	return { component: { designator: comp.designator, x: ox, y: oy, rotation: prep.rotation || 0, mirror: false, attrs }, wires, netflags, bbox, foot, bodyBox, sigPin: { x: sigX, y: sigYp }, railCls };
}

/* 信号-轨无源件按【信号网】归属同簇【稀疏】锚件(脚≤SPARSE_ANCHOR)→ 贴脚直连(避撞风险低,增量先落地);
 *   密集锚(IC 多脚如 U5)→ leftover(退 sigPassiveRow 带标签),待避撞几何做完再贴脚。无同簇锚者也 leftover。 */
const SPARSE_ANCHOR = 7;
function assignSigPassives(sigPassives, anchors, nets) {
	const owned = new Map(anchors.map(a => [a.designator, []]));
	const leftover = [];
	for (const p of sigPassives) {
		const m = nets[p.designator] || {};
		const sigNet = (p.pins || []).map(pin => m[pin.num]).find(n => classifyNet(n) === 'sig');
		const anchor = sigNet ? anchors.find(a => (a.pins || []).length <= SPARSE_ANCHOR && Object.values(nets[a.designator] || {}).includes(sigNet)) : null;
		if (anchor) owned.get(anchor.designator).push(p); else leftover.push(p);
	}
	return { owned, leftover };
}

function stackBelow(mod, sub) {
	if (!sub || !sub.components.length) return mod;
	const t = translateModule(sub, r10(mod.bbox.minX - sub.bbox.minX), r10(mod.bbox.maxY + PB_GAP - sub.bbox.minY));
	return mergeModules(mod, t);
}
/* 子模块紧贴 mod 右侧 → 去耦排放 IC 侧旁空白区,竖桩不穿 IC 扇出(无交叉) */
function stackRight(mod, sub) {
	if (!sub || !sub.components.length) return mod;
	const t = translateModule(sub, r10(mod.bbox.maxX + CELL_GAP - sub.bbox.minX), r10(mod.bbox.minY - sub.bbox.minY));
	return mergeModules(mod, t);
}

/* IC + 其归属无源件:IC 扇出居中;归属去耦电容【竖向、顶电源底地符号】放 IC 右侧旁;其余无源 bank 贴下方。 */
function icWithPassives(ic, owned, nets) {
	let mod = icModule(ic, nets[ic.designator] || {});
	const list = owned || [];
	const decaps = list.filter(c => isDecoupling(c, nets));
	const regular = list.filter(c => !isDecoupling(c, nets));
	if (decaps.length) mod = stackRight(mod, decouplingRow(decaps, nets));
	if (regular.length) mod = stackBelow(mod, passiveBank(regular, nets));   /* ≥1 件走 bank(栅格对齐);勿用 icModule(脚不对齐→脱格) */
	return mod;
}

/* 放一个竖向去耦电容【贴脚直连版】(T-WIRE-DIRECT,照 RK3576 直放直连):
 *   电源脚落 (powX, powY)(= 横向电源轨上,调用方用单段直线接到 IC 电源轨)、地脚在【正下方】、地符号在地脚正下(单段直线)
 *   → IC脚→cap、cap→地符号 都最少段、对齐成直线;标注在【外侧 sgn 方向】竖叠(同侧 → T-ANNOT-PLACE ✓,让开电源符号)。
 * 返回 { component, wires, netflags, powerPin:[powX,powY], bbox }。 */
function placeDecapStraight(cap, nets, powX, powY, sgn) {
	const m = nets[cap.designator] || {};
	let prep = null, pPow = null, pGnd = null;
	for (const r of [0, 90, 180, 270]) {
		const pp = prepComponent(cap, r), lp = pp.localPins;
		if (lp.length !== 2 || Math.abs(lp[0].y - lp[1].y) <= Math.abs(lp[0].x - lp[1].x)) continue;   /* 仅竖置 */
		const a = lp[0], b = lp[1], ca = classifyNet(m[a.num] || ''), cb = classifyNet(m[b.num] || '');
		if (ca === 'power' && cb === 'ground' && a.y > b.y) { prep = pp; pPow = a; pGnd = b; break; }
		if (cb === 'power' && ca === 'ground' && b.y > a.y) { prep = pp; pPow = b; pGnd = a; break; }
	}
	if (!prep) {   /* 兜底:取竖置朝向，并保证电源脚在较小 y。 */
		for (const r of [90, 270, 0, 180]) {
			const pp = prepComponent(cap, r), lp = pp.localPins;
			if (lp.length !== 2 || Math.abs(lp[0].y - lp[1].y) <= Math.abs(lp[0].x - lp[1].x)) continue;
			const a = lp[0], b = lp[1], ca = classifyNet(m[a.num] || ''), cb = classifyNet(m[b.num] || '');
			const pw = ca === 'power' ? a : (cb === 'power' ? b : a), gn = pw === a ? b : a;
			if (pw.y > gn.y) { prep = pp; pPow = pw; pGnd = gn; break; }
		}
		if (!prep) { prep = prepComponent(cap, 90); const lp = prep.localPins; pPow = lp[0].y >= lp[1].y ? lp[0] : lp[1]; pGnd = pPow === lp[0] ? lp[1] : lp[0]; }
	}
	const ox = powX - pPow.x, oy = powY - pPow.y;                 /* 电源脚精确落 (powX,powY) */
	const gndX = ox + pGnd.x, gndY = oy + pGnd.y;                 /* 地脚(正下方,gndX≈powX) */
	const body = prep.body;
	const wires = [], netflags = [];
	const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
	const grow = b => { if (!b) return; bbox.minX = Math.min(bbox.minX, b.minX); bbox.minY = Math.min(bbox.minY, b.minY); bbox.maxX = Math.max(bbox.maxX, b.maxX); bbox.maxY = Math.max(bbox.maxY, b.maxY); };
	/* 地脚 → 地符号(正下方,单段直线) */
	const gSymY = r5(gndY - DECAP_GND_STUB);
	wires.push({ line: [gndX, gndY, gndX, gSymY], net: m[pGnd.num] });
	netflags.push({ kind: 'ground', net: m[pGnd.num], x: gndX, y: gSymY, textX: gndX, textY: gSymY, nameSide: sgn > 0 ? 'left' : 'right', bbox: flagBox('ground', gndX, gSymY) });
	grow(flagExtent('ground', gndX, gSymY));
	/* 标注(标号+阻值)竖叠在外侧(sgn);同侧 → T-ANNOT-PLACE ✓;让开内侧电源符号 */
	const bcy = oy + (body.minY + body.maxY) / 2;
	const annH = prep.annots.reduce((s, a) => s + a.h, 0) + ROW_GAP * Math.max(0, prep.annots.length - 1);
	let ay = bcy - annH / 2;
	const attrs = [];
	/* ★每行【各自贴体】:右侧 sgn>0 左对齐(左缘贴 body.maxX);左侧 sgn<0 右对齐(各行右缘贴 body.minX)——
	 *   治"短位号左对齐离体远"(C3 位号离体 35);位号+值同侧紧贴叠放(RK 式)。
	 * ★attr 文字水平渲染(rotation0/align默认)→ live 把字框【左上角】锚在 attr x/y;电容旋成竖向后 prepComponent
	 *   的 rx/ry 是【旋转后】偏移(对水平文字无效,宽值如 22uF 会被推右下偏离体)→ 直接取 box 左上角(axi,ay)做
	 *   anchor(不减 rx/ry):twin 平移快照 bbox 与 live 渲染都落 box 左上角 → 两边一致、值宽无关恒贴体。 */
	for (const a of prep.annots) {
		const axi = sgn > 0 ? (ox + body.maxX + SIDE_GAP) : (ox + body.minX - SIDE_GAP - a.w);
		attrs.push({ key: a.key, value: a.value, valueVisible: true, keyVisible: false, x: axi, y: ay });
		grow({ minX: axi, minY: ay, maxX: axi + a.w, maxY: ay + a.h });
		ay += a.h + ROW_GAP;
	}
	grow({ minX: ox + body.minX, minY: oy + body.minY, maxX: ox + body.maxX, maxY: oy + body.maxY });
	const component = { designator: cap.designator, x: ox, y: oy, rotation: prep.rotation || 0, mirror: false, attrs };
	return { component, wires, netflags, powerPin: [powX, powY], bbox };
}

/* 块内去耦电容 → 归属锚件(IC/连接器):候选 = 有【该电容电源网】电源脚的锚件;在候选中取【原图距离最近】者
 * (设计者把去耦电容放在它服务的 IC 旁 → 原图最近 = 真正服务对象 → 布局后该 IC 脚仍是几何最近 → judge "最近脚"对得上、
 * 不被同网另一 IC 抢成 not-direct)。无候选者 leftover(退 decouplingRow,如实仍远连)。 */
function assignDecaps(decaps, anchors, nets) {
	const powerNetsOf = new Map();
	for (const a of anchors) {
		const m = nets[a.designator] || {};
		powerNetsOf.set(a.designator, new Set((a.pins || []).map(p => m[p.num]).filter(n => classifyNet(n) === 'power')));
	}
	const owned = new Map(anchors.map(a => [a.designator, []]));
	const load = new Map(anchors.map(a => [a.designator, 0]));
	const leftover = [];
	const CAP_PER = 2;   /* 每锚件最多托管 2 个去耦(再多则贴脚列堆太深 → 第 3 档距 IC 脚 >阈值) */
	for (const cap of decaps) {
		const m = nets[cap.designator] || {};
		const pwrNet = (cap.pins || []).map(p => m[p.num]).find(n => classifyNet(n) === 'power');
		const cands = pwrNet ? anchors.filter(a => powerNetsOf.get(a.designator).has(pwrNet)) : [];
		if (!cands.length) { leftover.push(cap); continue; }
		const byDist = [...cands].sort((x, y) => Math.hypot((cap.x ?? 0) - (x.x ?? 0), (cap.y ?? 0) - (x.y ?? 0)) - Math.hypot((cap.x ?? 0) - (y.x ?? 0), (cap.y ?? 0) - (y.y ?? 0)));
		const pick = byDist.find(a => load.get(a.designator) < CAP_PER) || byDist[0];   /* 最近的未满锚件;全满则就近 */
		owned.get(pick.designator).push(cap); load.set(pick.designator, load.get(pick.designator) + 1);
	}
	return { owned, leftover };
}

/* IC + 其【贴脚直连】去耦电容:IC 正常扇出(电源脚→电源符号=电源轨锚点);归属去耦电容挂到同网电源符号节点:
 *   一条 wire 从 rail 节点(电源符号脚)接到电容电源脚 → 二者同 wire 连通分量 = 直连(T-ADJACENCY direct ✓);
 *   电容竖置(电源脚在上接 rail、地脚在下接地符号)→ 朝向 ✓;放在电源符号列【外侧】清空区(扇出全在内侧)→ 不穿件/不交叉。
 *   同网多电容在该 IC 的多个电源脚间【轮转】分配(每脚一列、≤2 档 → 距 IC 脚 <200)。
 * 返回 { mod, unassigned }(unassigned=该 IC 无对应电源符号节点的电容,交回上层退 decouplingRow)。 */
function icWithDecaps(ic, decaps, sigPassives, nets) {
	const pinNet = nets[ic.designator] || {};
	const fo = icFanout(ic, pinNet, 0, 0);
	const mod = { components: [fo.icModel], wires: [...fo.wires], netflags: [...fo.netflags], bbox: { ...fo.bbox } };
	const grow = b => { if (!b) return; mod.bbox.minX = Math.min(mod.bbox.minX, b.minX); mod.bbox.minY = Math.min(mod.bbox.minY, b.minY); mod.bbox.maxX = Math.max(mod.bbox.maxX, b.maxX); mod.bbox.maxY = Math.max(mod.bbox.maxY, b.maxY); };
	const unassigned = [];
	const bcx = (fo.bbox.minX + fo.bbox.maxX) / 2;
	/* IC 脚位置(origin 帧,与 fo 同坐标)→ 上拉 too-far 预判:cap 节点离同网 IC 脚太远(注定 too-far)则不贴、退 bank。 */
	const icPinsByNet = new Map();
	for (const p of (placeGeom(localGeom(ic), 0, 0, 0, false).pins || [])) { const n = pinNet[p.num]; if (!n) continue; if (!icPinsByNet.has(n)) icPinsByNet.set(n, []); icPinsByNet.get(n).push(p); }
	/* ★信号-轨件【贴锚件信号脚直连】(连接驱动,无标签):tap 同网 sig 节点 → 同 wire 分量=直连。竖放、轨端符号。
	 *   同节点多件(上拉+滤波同信号)按 slot 向外错开。无同簇锚归属者(sigByNet 无该网)→ unassigned(退带标签)。 */
	const sigByNet = new Map();
	for (const f of fo.netflags) { if (f.kind === 'sig') sigByNet.set(f.net, f); }
	/* slot 按【侧×方向】分别计数:轨为地(cap/下拉)朝下、轨为电源(上拉)朝上 → 同网 cap+上拉【反向共节点】不撞,
	 *   且各方向独立错开(不会因混在一起被推太远 too-far)。 */
	const sideUse = new Map();
	const placedFoots = [];
	const ins = b => ({ minX: b.minX + 1, minY: b.minY + 1, maxX: b.maxX - 1, maxY: b.maxY - 1 });
	const ov = (a, b) => a && b && a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
	/* wire 避让:件 foot 不可被既有导线穿过(治"上拉体被别网横桩穿"=NOTHRU)。采样段内点判是否落 foot 内部。 */
	const segThru = (x1, y1, x2, y2, b) => { for (let t = 0.15; t <= 0.85; t += 0.1) { const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t; if (x > b.minX && x < b.maxX && y > b.minY && y < b.maxY) return true; } return false; };
	const wireHit = (foot) => (mod.wires || []).some(w => { const L = w.line || []; for (let i = 0; i + 3 < L.length; i += 2) { if (segThru(L[i], L[i + 1], L[i + 2], L[i + 3], foot)) return true; } return false; });
	/* 先地轨件(滤波cap,朝下挂横桩外端)→ 记录每信号网的【cap 真实信号脚节点】;再电源件(上拉)tap 到该节点、
	 *   越过 cap 朝上(横桩在 cap 端结束,不穿上拉体)。同网无 cap 的上拉退而 tap 标签节点(可能 NOTHRU → 退 bank)。 */
	const railRank = p => { const m = nets[p.designator] || {}; const c = (p.pins || []).map(pin => classifyNet(m[pin.num] || '')).find(x => x === 'power' || x === 'ground') || 'ground'; return c === 'power' ? 1 : 0; };
	const ordered = [...(sigPassives || [])].sort((a, b) => railRank(a) - railRank(b));
	const capSigNode = new Map();   /* sigNet -> {x,y} cap 真实信号脚(横桩节点) */
	for (const p of ordered) {
		const m = nets[p.designator] || {};
		const sigNet = (p.pins || []).map(pin => m[pin.num]).find(n => classifyNet(n) === 'sig');
		const node = sigNet ? sigByNet.get(sigNet) : null;
		if (!node) { unassigned.push(p); continue; }
		const railCls = (p.pins || []).map(pin => classifyNet(m[pin.num] || '')).find(c => c === 'power' || c === 'ground') || 'ground';
		const lblX = node.textX ?? node.x, lblY = node.textY ?? node.y, s = lblX >= bcx ? 1 : -1;
		/* 上拉:若同网已放 cap → tap 到 cap 真实信号脚(越过 cap 朝上,横桩不穿体);否则 tap 标签节点 */
		const cn = railCls === 'power' ? capSigNode.get(sigNet) : null;
		const nx = cn ? cn.x : lblX, ny = cn ? cn.y : r5(lblY);
		/* 上拉 too-far 预判:无同网 cap(无真节点易 NOTHRU)、或 cap 节点离同网 IC 脚 > PULL_REACH(注定 too-far)→ 退 bank。 */
		if (railCls === 'power') {
			if (!cn) { unassigned.push(p); continue; }
			const icp = icPinsByNet.get(sigNet) || [];
			const d = icp.length ? Math.min(...icp.map(ip => Math.hypot(nx - ip.x, ny - ip.y))) : Infinity;
			if (d > PULL_REACH) { unassigned.push(p); continue; }
		}
		/* slot 计数【按 net+轨向】(非按侧):不同 sig 节点的件本在不同位,不该相互 slot-offset
		 *   (旧"按侧"把同侧不同节点的 cap 越推越远:C23 被推到离脚 160 + 其横桩横跨邻列 → R11 被穿/R12 too-far)。 */
		const key = `${sigNet}_${railCls}`;
		/* 碰撞检测+重试:撞既有符号/标签(netflag bbox)或已贴件 foot 则外移一格(slot 步 42),
		 *   上拉只试 slot0(越过 cap 的位,外移更远易 too-far/交叉)→ 撞则退 bank;地轨件可重试。foot 排除 tap 线。 */
		/* 电源上拉恒 slot0(px=各自 cap 节点 x、竖直 tap,无横移)→ 不共享 sideUse(否则同侧上拉相互推移成斜 tap)。 */
		const maxTries = railCls === 'power' ? 1 : 5;
		let placed = null, slot = railCls === 'power' ? 0 : (sideUse.get(key) || 0);
		for (let t = 0; t < maxTries; t++) {
			const cand = placeSigPassiveDirect(p, nets, nx, ny, s, slot);
			const obstacles = [...mod.netflags.filter(f => f.bbox).map(f => f.bbox), ...placedFoots];
			/* wireHit 只判【件体 body】被导线穿(与 judge NOTHRU 同口径)——foot 含符号/标注,导线掠过标注区不算穿体(误退)。 */
			if (!obstacles.some(o => ov(ins(cand.foot), ins(o))) && !wireHit(ins(cand.bodyBox))) { placed = cand; break; }
			slot++;
		}
		if (!placed) { unassigned.push(p); continue; }
		sideUse.set(key, slot + 1);
		if (placed.railCls === 'ground' && sigNet && placed.sigPin) capSigNode.set(sigNet, placed.sigPin);
		mod.components.push(placed.component); mod.wires.push(...placed.wires); mod.netflags.push(...placed.netflags); grow(placed.bbox); placedFoots.push(placed.foot);
	}
	if (!decaps || !decaps.length) return { mod, unassigned };
	/* 同网电源符号节点(电源轨锚点)*/
	const railByNet = new Map();
	for (const f of fo.netflags) { if (f.kind !== 'power') continue; const n = f.net; if (!railByNet.has(n)) railByNet.set(n, []); railByNet.get(n).push(f); }
	/* 按电源网分组可归属电容 */
	const byNet = new Map();
	for (const cap of decaps) {
		const m = nets[cap.designator] || {};
		const pwrNet = (cap.pins || []).map(p => m[p.num]).find(n => classifyNet(n) === 'power');
		if (pwrNet && railByNet.has(pwrNet)) { if (!byNet.has(pwrNet)) byNet.set(pwrNet, []); byNet.get(pwrNet).push(cap); }
		else unassigned.push(cap);
	}
	const sideOff = new Map([[-1, 0], [1, 0]]);
	for (const [net, caps] of byNet) {
		const anchors = railByNet.get(net);
		const buckets = anchors.map(() => []);
		caps.forEach((c, i) => buckets[Math.min(anchors.length - 1, Math.floor(i / 2))].push(c));   /* 每锚件最多托管 2 个去耦(贪心填) */
		anchors.forEach((rail, ai) => {
			const bucket = buckets[ai]; if (!bucket.length) return;
			const rx = rail.x ?? rail.textX, ry = rail.y ?? rail.textY;
			const s = rx >= bcx ? 1 : -1;                               /* 外移方向:符号在体右→右、左→左 */
			/* 该电源节点要继续向外形成电容横轨时，原先的侧向旗标不能留在横轨起点：
			 * 横轨会穿过符号和网名。把同一个旗标移到节点上方的独立终端桩，横轨仍从
			 * 原节点出发。这样旗标只有一条入桩，符号体与文字都背离导线。 */
			const flagY=r5(ry+PWR_STUB);
			rail.y=flagY;rail.textX=rx;rail.textY=flagY;rail.rotation=0;rail.nameSide=s>0?'right':'left';
			rail.bbox=flagBox('power',rx,flagY,0);
			mod.wires.push({line:[rx,ry,rx,flagY],net});
			grow(flagExtent('power',rx,flagY,0));
			const band = sideOff.get(s);
			/* RK3576 式:横向电源轨(y=ry,从 rail 节点外伸)+ 电容并排【垂下】+ 地符号正下 → IC脚→cap、cap→地符号 单段直线,无 jog。
			 *   电容电源脚都落在轨上(y=ry)= 与 IC 电源脚同 wire 连通分量(轨分段后每脚是端点)→ 直连;标注外侧让开。 */
			const railXs = [rx];
			bucket.forEach((cap, i) => {
				const capX = r10(rx + s * (DECAP_FIRST + band + i * DECAP_DX));
				const placed = placeDecapStraight(cap, nets, capX, r5(ry), s);
				mod.components.push(placed.component); mod.wires.push(...placed.wires); mod.netflags.push(...placed.netflags); grow(placed.bbox);
				railXs.push(capX);
			});
			/* 电源轨:沿 y=ry 从 rail 节点连到各电容电源脚,按 tap 点【分段】(union-find 只并段端点 → 每脚是端点才连通) */
			const xs = [...new Set(railXs.map(r10))].sort((a, b) => (s > 0 ? a - b : b - a));
			for (let i = 0; i + 1 < xs.length; i++) mod.wires.push({ line: [xs[i], r5(ry), xs[i + 1], r5(ry)], net });
			sideOff.set(s, band + bucket.length * DECAP_DX + DECAP_FIRST);
		});
	}
	return { mod, unassigned };
}

/* 锚件按共享【信号网】聚类(通用、零特定电路;仅拓扑+度数)。破星型:连接≥HUB_DEG 个其它锚的 hub(如主控)
 * 自成一簇、不桥接,使外设按【局部连通】成组(功能块)。返回 Map(designator → clusterId)。 */
const HUB_DEG = 4;
function clusterAnchors(anchorComps, nets) {
	const ids = anchorComps.map(a => a.designator);
	const sig = new Map(ids.map(d => [d, new Set(Object.values(nets[d] || {}).filter(n => classifyNet(n) === 'sig'))]));
	const adj = new Map(ids.map(d => [d, new Set()]));
	for (let i = 0; i < ids.length; i++) {
		for (let j = i + 1; j < ids.length; j++) {
			const A = sig.get(ids[i]), B = sig.get(ids[j]);
			let sh = false; for (const n of A) { if (B.has(n)) { sh = true; break; } }
			if (sh) { adj.get(ids[i]).add(ids[j]); adj.get(ids[j]).add(ids[i]); }
		}
	}
	const hub = d => adj.get(d).size >= HUB_DEG;
	const cid = new Map(); let next = 0;
	for (const d of ids) {
		if (cid.has(d)) continue;
		if (hub(d)) { cid.set(d, next++); continue; }     /* hub 自成一簇 */
		cid.set(d, next); const q = [d];                  /* BFS 局部连通,不经过 hub */
		while (q.length) { const u = q.pop(); for (const v of adj.get(u)) { if (hub(v) || cid.has(v)) continue; cid.set(v, next); q.push(v); } }
		next++;
	}
	return { cid, next };
}

/* 簇解析:决定每个件归哪个【功能簇】+ 簇的布局先后顺序(信号流)。
 *   - opts.clusters 给定(外部功能映射:designator→簇 key 字符串,如 §8 功能块名)→ 按它分组,
 *     簇先后取 opts.clusterOrder(数组,信号流左→右);未在 order 里的 key 续到末尾;未映射件各自独立簇(不丢件)。
 *   - 否则回退 clusterAnchors 拓扑聚类(无强制顺序)。
 * 引擎【不认识】簇语义:key/顺序/标题全由调用方(文档/scratchpad 数据)传入,零特定电路。
 * 返回 { idOf:Map(designator→簇序号), order:[簇序号…按布局先后]|null, titleByIdx:Map(簇序号→key 字符串) }。 */
function resolveClusters(filled, anchors, opts) {
	const idOf = new Map();
	if (opts.clusters) {
		const keys = (opts.clusterOrder && opts.clusterOrder.length) ? [...opts.clusterOrder] : [];
		const keyIdx = new Map(keys.map((k, i) => [k, i]));
		let next = keys.length;
		const ensure = k => { if (!keyIdx.has(k)) { keyIdx.set(k, next++); keys.push(k); } return keyIdx.get(k); };
		for (const c of filled) {
			const k = opts.clusters[c.designator];
			idOf.set(c.designator, k != null ? ensure(k) : next++);
		}
		const order = [...new Set(idOf.values())].sort((a, b) => a - b);
		const titleByIdx = new Map(keys.map((k, i) => [i, k]));
		return { idOf, order, titleByIdx };
	}
	const { cid, next } = clusterAnchors(anchors, opts.nets);
	let extra = next;
	for (const c of filled) idOf.set(c.designator, cid.has(c.designator) ? cid.get(c.designator) : extra++);
	return { idOf, order: null, titleByIdx: new Map() };
}

/* 主入口:快照 → 结构化布局 model(可直接喂 eda_twin.twinPredict → judgeTokens)。
 * opts.nets 给定时(连接驱动多模块):每个锚件(IC/连接器,脚≥3)+ 其【原图最近】的无源件 合成一个模块
 *   (去耦电容紧贴它的 IC,不再全局孤立 bank);模块货架装箱铺满版面。零特定电路。
 * 无 nets:全部件 flex-wrap 网格(无线无标签)。 */
export function structuredLayout(snapshot, opts = {}) {
	const filled = fillVisibleAttrBBoxes(snapshot.components || []);

	if (opts.nets) {
		const anchors = filled.filter(c => (c.pins || []).length >= 3);   /* IC/连接器=锚 */
		const passives = filled.filter(c => (c.pins || []).length === 2);
		const singles = filled.filter(c => (c.pins || []).length <= 1);   /* 单脚件(测试点等) */

		/* 功能分区:外部映射(opts.clusters,§8 功能块)优先,否则拓扑聚类。簇序号 + 信号流顺序 + 块标题。 */
		const { idOf, order, titleByIdx } = resolveClusters(filled, anchors, opts);

		const modules = [];
		const anchorOfCluster = new Map();   /* 簇 → 主锚件 designator(块标题 ATTR 的挂载件) */
		if (opts.clusters) {
			/* 块级布局:每块的去耦电容聚成【一条紧凑排】、其余 2 脚件成 bank、锚件各自扇出 → 块内件密集(件中心 NN 小)、
			 *   去耦不再按锚件分摊被模块间距撑散(治 T-DENSITY)。块为最小空间单元 → 功能分区清晰。 */
			const blkOf = new Map();
			const ensureBlk = c => { if (!blkOf.has(c)) blkOf.set(c, { anchors: [], decaps: [], sigp: [], regular: [], singles: [] }); return blkOf.get(c); };
			for (const a of anchors) ensureBlk(idOf.get(a.designator)).anchors.push(a);
			/* 无源件分桶:去耦cap(电源+地)→贴IC电源脚;信号-轨件(滤波/上拉/下拉,一脚信号一脚轨)→贴锚件信号脚直连(竖放无标签);
			 *   串联/0Ω(两端同类)→bank 横放(用户:横放只给串联)。 */
			/* 信号-轨件贴脚直连:滤波cap朝下贴桩外端、上拉电阻朝上(节点正上方、信号脚抬竖直短桩避盖桩)贴脚直连 → 稀疏锚直连+碰撞退 bank */
			for (const p of passives) { const b = ensureBlk(idOf.get(p.designator)); (isDecoupling(p, opts.nets) ? b.decaps : isSigRailPassive(p, opts.nets) ? b.sigp : b.regular).push(p); }
			for (const s of singles) ensureBlk(idOf.get(s.designator)).singles.push(s);
			for (const [c, b] of blkOf) {
				if (b.anchors.length) anchorOfCluster.set(c, b.anchors[0].designator);   /* 块标题挂第一个锚件 */
				/* 连接驱动:去耦cap按电源网、信号-轨件按信号网【归属同簇锚件】→ 贴锚件脚【直连短线】嵌进 IC 模块(随模块移动、同连通分量) */
				const { owned, leftover } = assignDecaps(b.decaps, b.anchors, opts.nets);
				const { owned: sigOwned, leftover: sigLeft } = assignSigPassives(b.sigp, b.anchors, opts.nets);   /* 稀疏锚→贴脚;密集锚→leftover */
				const fallback = [...leftover];
				for (const ic of b.anchors) {
					/* 稀疏锚件的信号-轨件【贴脚直连】(增量落地,如 SW2 编码器);密集锚的在 sigLeft 走带标签竖放(待避撞) */
					const { mod, unassigned } = icWithDecaps(ic, owned.get(ic.designator) || [], sigOwned.get(ic.designator) || [], opts.nets);
					mod.cluster = c; modules.push(mod); fallback.push(...unassigned);
				}
				const fallbackDecaps = fallback.filter(p => isDecoupling(p, opts.nets));
				const fallbackSignals = fallback.filter(p => !isDecoupling(p, opts.nets));
				if (fallbackDecaps.length) { const m = decouplingRow(fallbackDecaps, opts.nets); m.cluster = c; modules.push(m); }
				/* 密集锚/无锚的信号-轨件 → 回 bank 横放(干净);竖放带标签的 sigPassiveRow 对多个长名上拉会标签互压,
				 *   密集块待"扇出下方清空区+L直连"避撞几何做完再竖放直连。 */
				const bankItems = [...b.regular, ...sigLeft, ...fallbackSignals];
				if (bankItems.length) { const m = passiveBank(bankItems, opts.nets); m.cluster = c; modules.push(m); }
				for (const s of b.singles) { const m = icModule(s, opts.nets[s.designator] || {}); m.cluster = c; modules.push(m); }
			}
		} else {
			/* 拓扑模式:去耦电容按【原图最近】归属锚件、贴它的 IC(连接驱动);无锚归属者按簇兜底 bank。 */
			const { map, leftover } = assignPassives(passives, anchors, null);
			for (const ic of anchors) { const m = icWithPassives(ic, map.get(ic.designator), opts.nets); m.cluster = idOf.get(ic.designator); modules.push(m); }
			const byClu = new Map();
			for (const p of leftover) { const cc = idOf.get(p.designator); if (!byClu.has(cc)) byClu.set(cc, []); byClu.get(cc).push(p); }
			for (const [cc, ps] of byClu) { const m = passiveBank(ps, opts.nets); m.cluster = cc; modules.push(m); }   /* ≥1 件走 bank(栅格对齐) */
			for (const s of singles) { const m = icModule(s, opts.nets[s.designator] || {}); m.cluster = idOf.get(s.designator); modules.push(m); }
		}

		/* 功能分区两级编排:① 同簇模块先【紧凑】打包成"超模块"(簇内聚拢=功能块);② 再 fill 把【超模块】
		 *   铺满版面 → 功能块整体可见、块间有间隔、块内紧凑。order 给定时超模块按【信号流左→右】铺(keepOrder)。 */
		const byCluster = new Map();
		for (const m of modules) { const c = m.cluster ?? 0; if (!byCluster.has(c)) byCluster.set(c, []); byCluster.get(c).push(m); }
		const clusterIds = (order || [...byCluster.keys()].sort((a, b) => a - b)).filter(c => byCluster.has(c));
		const superMods = clusterIds.map(c => {
			const members = byCluster.get(c);
			members.forEach((m, i) => { m.id = `cell-${c}-${i}`; });
			const inner = arrangeModules(members, { aspect: 1.2, gap: CELL_GAP });
			inner.cells = inner.placed.map(p => {
				const source = members.find(m => m.id === p.id);
				return { id: p.id, cluster: c, bbox: p.bbox, members: (source?.components || []).map(x => x.designator).filter(Boolean) };
			});
			inner.cluster = c; inner.title = titleByIdx.get(c) || null;
			return inner;
		});
		/* opts.grid(+sheet):均衡内容网格(块按信号流序行优先排 cols 列、格内居中、均匀页边)→ 消孤块/大空区;
		 * 否则货架装箱+绕中心放大填版(旧行为)。块内部几何均不动 → 连接/tier2 不受编排影响。 */
		const merged = (opts.grid && opts.sheet)
			? arrangeGrid(superMods, { sheet: opts.sheet, cols: opts.grid.cols, fillX: opts.grid.fillX, fillY: opts.grid.fillY, gapCap: opts.grid.gapCap })
			: arrangeModules(superMods, { aspect: opts.aspect ?? 2.8, sheet: opts.sheet, maxScale: opts.maxScale, keepOrder: !!order, gap: MODULE_GAP });
		/* 裁判证据与实际构造同源：模块=超模块，cell=簇内实际子模块。
		 * contentBox 是真实已放置几何，box 只加固定内边距；cell 只有共享
		 * 信号网才算直接相关，共地/共电源或仅同簇不自动缩短间距。 */
		const moduleRegions = (merged.placed || []).map((p, i) => ({
			id: `module-${p.cluster ?? i}`,
			name: p.title || `module-${p.cluster ?? i}`,
			box: padBox(p.bbox, 8), contentBox: p.bbox,
		}));
		const cellRows = merged.cells || [];
		const signalNets = c => new Set((c.members || []).flatMap(des =>
			Object.values(opts.nets?.[des] || {}).filter(net => classifyNet(net) === 'sig')));
		const signalByCell = new Map(cellRows.map(c => [c.id, signalNets(c)]));
		const directlyRelated = (a, b) => [...(signalByCell.get(a.id) || [])].some(net => signalByCell.get(b.id)?.has(net));
		const cellRegions = cellRows.map(c => ({
			id: c.id,
			module: `module-${c.cluster}`,
			box: padBox(c.bbox, 8), contentBox: c.bbox,
			members: [...(c.members || [])],
			relatedTo: cellRows.filter(x => x.cluster === c.cluster && x.id !== c.id && directlyRelated(c, x)).map(x => x.id),
		}));
		/* 功能块标题框:每超模块(=功能块)的【最终】bbox + 标题 + 主锚件 → 投递侧画虚线圆角框 + 顶部标题
		 *   (标题挂锚件的可见 ATTR,reopen 持久渲染;块名来自调用方,引擎不认语义)。 */
		const blocks = (merged.placed || []).filter(p => p.title && p.bbox && Number.isFinite(p.bbox.minX))
			.map(p => ({ title: p.title, bbox: p.bbox, anchorDes: anchorOfCluster.get(p.cluster) || null }));
		/* 图纸边框(标准尺寸,内容居中其内):投递侧画 border RECT + 标题栏框,使板【带框、内容在框内】(治"无边界")。
		 *   尺寸由调用方 opts.sheet 给定标准值(A3=2340×1654 / A4=1655×1170,从 RK3576 titleBlock 提取),引擎不硬编。 */
		const sh = opts.sheet;
		const sheet = sh ? { minX: (sh.cx ?? sh.w / 2) - sh.w / 2, minY: (sh.cy ?? sh.h / 2) - sh.h / 2, maxX: (sh.cx ?? sh.w / 2) + sh.w / 2, maxY: (sh.cy ?? sh.h / 2) + sh.h / 2, size: sh.size || null } : null;
		/* ★最终坐标定后:去冲突相邻电源/地符号【网名互压】(脚位固定者横向错开名)→ 治 5V_LED×GND 类名重叠(由构造) */
		deconflictFlagNames(merged.netflags);
		return { ...merged, blocks, sheet, moduleRegions, cellRegions, texts: [], rectangles: [] };
	}

	const preps = filled.map(prepComponent);
	const cols = Math.max(1, opts.cols || Math.round(Math.sqrt(preps.length)) || 1);
	const placed = gridPlace(preps, cols);
	return { components: gridToComponents(placed), wires: [], netflags: [], texts: [], rectangles: [] };
}
