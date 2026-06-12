import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { edaNetFlagRot } from './eda_rot.mjs';
import { physicalWireRoots, ptKey, pointOnSegment } from './wire_geom.mjs';

if (process.env.EASYEDA_APPLY_FULL_AUTHORIZED !== '1') {
	console.error('ABORT: apply_full.mjs is a low-level generator. Use node engine/apply_gated.mjs so the full commercial gate is enforced.');
	process.exit(1);
}

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
for (const name of readdirSync(DIR)) {
	if (/^af_(move|move_parts|delparts|del|nc|zoom|docs)\.js$/.test(name) || /^af_(move_parts|wires|flags|ports|docs)_\d+\.js$/.test(name)) unlinkSync(DIR + name);
}

const model = JSON.parse(readFileSync(DIR + 'full_model.json', 'utf8').replace(/^\uFEFF/, ''));
let compState = [];
try {
	compState = JSON.parse(readFileSync(DIR + 'comp_state.json', 'utf8').replace(/^\uFEFF/, ''));
} catch {}
const compMetaByRef = new Map(compState.map(c => [c.designator, c]));
const comps = model.components.map(c => ({
	id: c.id,
	designator: c.designator,
	x: c.x,
	y: c.y,
	rotation: c.rotation || 0,
	apiRotation: (360 - (((c.rotation || 0) % 360 + 360) % 360)) % 360,
	mirror: !!c.mirror,
	value: c.value || c.name || c.designator || '',
	component: compMetaByRef.get(c.designator)?.component || null,
	meta: compMetaByRef.get(c.designator) || null,
	otherProperty: compMetaByRef.get(c.designator)?.otherProperty || null,
}));
const deviceQueryByRef = {
	U2:'AMS1117-3.3', Q3:'AO3400A', Q4:'AO3400A', R9:'0603WAF5101T5E', R10:'0603WAF5101T5E', R11:'0603WAF220JT5E', R12:'0603WAF220JT5E',
	R1:'0603WAF1003T5E', R2:'0603WAF1001T5E', R3:'0603WAF1000T5E', R4:'0603WAF1003T5E', R13:'0603WAF1000T5E', R14:'0603WAF1000T5E',
	R15:'0603WAF1003T5E', R16:'0603WAF1003T5E', R17:'0603WAF1002T5E', R18:'0603WAF1002T5E',
	U1:'ESP32-C3-WROOM-02U-N4', C2:'CC0603KRX7R9BB104', C3:'CC0603KRX7R9BB104', J1:'TYPE-C-31-M-12',
	C1:'CL10A106MA8NRNC', C4:'CL10A106MA8NRNC', CN1:'2.54-2A-WT', CN2:'2.54-2A-WT', CN3:'2.54-2A-WT', CN4:'2.54-2A-WT',
	Q1:'AO4407A', Q2:'2N7002', D1:'BZT52C12', D2:'1N4148W', D3:'1N4148W', SW1:'DS-TS11B', SW2:'DS-TS11B',
};
const supplierByRef = {
	U2:'C6186', Q3:'C20917', Q4:'C20917', R9:'C23186', R10:'C23186', R11:'C23345', R12:'C23345',
	R1:'C25803', R2:'C21190', R3:'C22775', R4:'C25803', R13:'C22775', R14:'C22775',
	R15:'C25803', R16:'C25803', R17:'C25804', R18:'C25804',
	U1:'C2926676', C2:'C14663', C3:'C14663', J1:'C165948',
	C1:'C96446', C4:'C96446', CN1:'C722696', CN2:'C722696', CN3:'C722696', CN4:'C722696',
	Q1:'C3019374', Q2:'C8545', D1:'C9900013833', D2:'C81598', D3:'C81598', SW1:'C54301393', SW2:'C54301393',
};
for (const c of comps) c.query = deviceQueryByRef[c.designator] || c.value;
for (const c of comps) c.supplier = supplierByRef[c.designator] || '';
const designatorPlacementByRef = {
	R11: { x: 420, y: 1090 },
	C1: { x: 305, y: 1060 },
	R1: { x: 1258, y: 850 },
};
const noConnects = model.noConnects || [];
const pinFixes = [];
for (const c of model.components || []) {
	for (const p of c.pins || []) {
		if (String(c.designator) === 'U1' && String(p.num) === '1')
			pinFixes.push({ ref: `${c.designator}.${p.num}`, x: p.x, y: p.y });
	}
}
const flags = model.netflags
	.filter(f => f.kind === 'gnd' || f.kind === 'power')
	.map(f => ({ kind: f.kind, net: f.net, x: f.x, y: f.y, rot: edaNetFlagRot(f.rotation || f.rot || 0) }));
const docRectangles = (model.rectangles || []).map(r => {
	const b = r.bbox || r;
	return {
		role: r.role || '',
		module: r.module || '',
		topLeftX: b.minX,
		topLeftY: b.maxY,
		width: b.maxX - b.minX,
		height: b.maxY - b.minY,
		color: r.color || '#9a9a9a',
		fillColor: r.fillColor == null || r.fillColor === 'none' ? null : r.fillColor,
		lineWidth: r.lineWidth || 1,
		lineType: r.lineType ?? 0,
		fillStyle: r.fillStyle || 'None',
	};
});
function textWidth(t) {
	const content = String(t.content || '');
	const fontSize = Number(t.fontSize || 12);
	return Math.max(30, content.length * fontSize * 0.56);
}

const docTexts = (model.texts || []).map(t => {
	const anchor = t.anchor || 'center';
	const w = textWidth(t);
	const x = anchor === 'left' ? t.x + w / 2 : (anchor === 'right' ? t.x - w / 2 : t.x);
	return ({
	role: t.role || '',
	module: t.module || '',
	x,
	y: t.y,
	content: t.content || '',
	rotation: t.rotation || 0,
	textColor: t.textColor || '#333333',
	fontName: t.fontName || 'Arial',
	fontSize: t.fontSize || 12,
	bold: !!t.bold,
	italic: !!t.italic,
	underLine: !!t.underLine,
	alignMode: t.alignMode ?? 2,
}); });
const ports = [];
const portNets = new Set(ports.map(p => p.net));
const defaultSigAlignMode = f => {
	const rot = ((f.rotation ?? f.rot ?? 0) % 360 + 360) % 360;
	return rot === 180 ? 6 : 8;
};
const sigLabels = (model.netflags || [])
	.filter(f => f.kind === 'sig' && !portNets.has(f.net))
	.map(f => ({ net: f.net, x: f.textX ?? f.x, y: f.textY ?? f.y, anchorX: f.x, anchorY: f.y, alignMode: f.alignMode ?? defaultSigAlignMode(f), rotation: f.labelRotation ?? 0, logicalRotation: f.rotation ?? f.rot ?? 0 }));
const keepNamedWires = new Set((model.netflags || []).filter(f => f.kind === 'sig').map(f => f.net));
const applyLabelNets = new Set(ports.map(p => p.net));

function nodeKey(x, y) {
	return `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;
}

function keepNamedWire(s) {
	if (!keepNamedWires.has(s.net)) return false;
	const [x1, y1, x2, y2] = s.line;
	const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
	const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
	return minX >= 560 && maxX <= 725 && minY >= 925 && maxY <= 995;
}

function labelForSegment(s) {
	if (!s.net) return null;
	return sigLabels.find(f => f.net === s.net && pointOnSegment(f.anchorX ?? f.x, f.anchorY ?? f.y, s));
}

function segmentLength(s) {
	const [x1, y1, x2, y2] = s.line;
	return Math.hypot(x2 - x1, y2 - y1);
}

const componentKeepouts = (model.components || [])
	.map(c => c.bodyBBox || c.bbox)
	.filter(Boolean)
	.map(b => ({ minX: b.minX - 55, maxX: b.maxX + 55, minY: b.minY - 55, maxY: b.maxY + 55 }));

function labelWidth(net) {
	return Math.max(38, String(net || '').length * 6 + 16);
}

function edaAttrLabel(label) {
	return label;
}

function labelBox(label) {
	const w = labelWidth(label.net);
	const h = 8;
	const mode = label.alignMode == null ? 6 : Number(label.alignMode);
	if (mode === 2) return { minX: label.x - w / 2, maxX: label.x + w / 2, minY: label.y - h / 2, maxY: label.y + h / 2 };
	if (mode === 8 || mode === 9) return { minX: label.x - w, maxX: label.x, minY: label.y, maxY: label.y + h };
	if (mode === 6 || mode === 3) return { minX: label.x, maxX: label.x + w, minY: label.y, maxY: label.y + h };
	if (mode === 1) return { minX: label.x, maxX: label.x + w, minY: label.y - h, maxY: label.y };
	if (mode === 7) return { minX: label.x - w, maxX: label.x, minY: label.y - h, maxY: label.y };
	return { minX: label.x, maxX: label.x + w, minY: label.y, maxY: label.y + h };
}

function boxesOverlap(a, b) {
	return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

function segmentCutsBoxInterior(line, box) {
	const [x1, y1, x2, y2] = line;
	if (Math.abs(y1 - y2) < 1e-6) {
		if (y1 <= box.minY || y1 >= box.maxY) return false;
		return Math.max(Math.min(x1, x2), box.minX) < Math.min(Math.max(x1, x2), box.maxX);
	}
	if (Math.abs(x1 - x2) < 1e-6) {
		if (x1 <= box.minX || x1 >= box.maxX) return false;
		return Math.max(Math.min(y1, y2), box.minY) < Math.min(Math.max(y1, y2), box.maxY);
	}
	return false;
}

function clearAutoLabel(label, allSegments) {
	const box = labelBox(label);
	if (componentKeepouts.some(b => boxesOverlap(box, b))) return false;
	if ((allSegments || []).some(seg => segmentCutsBoxInterior(seg.line, box))) return false;
	return true;
}

function autoLabelForSegment(s, allSegments) {
	const [x1, y1, x2, y2] = s.line;
	const horizontal = Math.abs(y1 - y2) < 1e-6;
	const vertical = Math.abs(x1 - x2) < 1e-6;
	const w = labelWidth(s.net);
	const minX = Math.min(x1, x2);
	const maxX = Math.max(x1, x2);
	const minY = Math.min(y1, y2);
	const maxY = Math.max(y1, y2);
	const candidates = [];
	if (horizontal) {
		for (const x of [minX - w - 12, maxX + 12, minX - w - 32, maxX + 32, minX, maxX - w]) {
			for (const y of [y1 + 14, y1 - 22, y1 + 34, y1 - 42, y1 + 58, y1 - 66]) {
				candidates.push({ net: s.net, x, y, alignMode: 6, rotation: 0 });
			}
		}
	} else if (vertical) {
		for (const x of [x1 + 14, x1 - w - 14, x1 + 34, x1 - w - 34, x1 + 58, x1 - w - 58]) {
			for (const y of [(minY + maxY) / 2 + 6, maxY + 10, minY - 18, maxY + 34, minY - 42]) {
				candidates.push({ net: s.net, x, y, alignMode: 6, rotation: 0 });
			}
		}
	} else {
		candidates.push({ net: s.net, x: (x1 + x2) / 2 + 12, y: (y1 + y2) / 2 + 12, alignMode: 6, rotation: 0 });
	}
	for (const dx of [-180, -140, -100, 100, 140, 180, -240, 240]) {
		for (const dy of [-120, -80, -50, 50, 80, 120, -160, 160]) {
			candidates.push({ net: s.net, x: minX + dx, y: maxY + dy, alignMode: 6, rotation: 0 });
		}
	}
	return candidates.find(c => clearAutoLabel(c, allSegments)) || candidates[0] || { net: s.net, x: maxX + 12, y: maxY + 14, alignMode: 6, rotation: 0 };
}

function carrierScore(s) {
	const label = labelForSegment(s);
	const [x1, y1, x2, y2] = s.line;
	const horizontal = Math.abs(y1 - y2) < 1e-6;
	return (label ? 1_000_000 : 0) + (horizontal ? 10_000 : 0) + segmentLength(s);
}

function explodeWires(modelWires) {
	const segments = [];
	for (const w of modelWires) {
		const l = w.line || [];
		for (let i = 0; i + 3 < l.length; i += 2) {
			if (l[i] === l[i + 2] && l[i + 1] === l[i + 3]) continue;
			segments.push({ net: w.net || '', line: [l[i], l[i + 1], l[i + 2], l[i + 3]] });
		}
	}
	const namedPointNets = new Map();
	for (const s of segments) {
		if (!s.net) continue;
		for (const i of [0, 2]) {
			const k = nodeKey(s.line[i], s.line[i + 1]);
			if (!namedPointNets.has(k)) namedPointNets.set(k, new Set());
			namedPointNets.get(k).add(s.net);
		}
	}
	for (const s of segments) {
		if (s.net) continue;
		const a = namedPointNets.get(nodeKey(s.line[0], s.line[1]));
		const b = namedPointNets.get(nodeKey(s.line[2], s.line[3]));
		const nets = [...new Set([...(a || []), ...(b || [])])];
		if (nets.length === 1 && !keepNamedWires.has(nets[0])) s.net = nets[0];
	}
	const { groups } = physicalWireRoots(segments.map(s => ({ net: s.net, line: s.line })));
	const rootByLine = new Map();
	for (const [root, segs] of groups) {
		for (const s of segs) rootByLine.set(`${s.line.join(',')}`, root);
	}
	const flagNetByRoot = new Map();
	for (const f of flags) {
		for (const [root, segs] of groups) {
			if (segs.some(s => pointOnSegment(f.x, f.y, s))) {
				if (!flagNetByRoot.has(root)) flagNetByRoot.set(root, new Set());
				flagNetByRoot.get(root).add(f.net);
			}
		}
	}
	const namedByRoot = new Map();
	const carrierByRoot = new Map();
	for (const s of segments) {
		if (!s.net) continue;
		const root = rootByLine.get(`${s.line.join(',')}`) || ptKey(s.line[0], s.line[1]);
		const flagNets = flagNetByRoot.get(root);
		const hasSameFlag = flagNets && s.net && flagNets.has(s.net);
		const hasExternalLabel = applyLabelNets.has(s.net) || (portNets.has(s.net) && !keepNamedWire(s));
		if (hasSameFlag || hasExternalLabel) continue;
		const prev = carrierByRoot.get(root);
		if (!prev || carrierScore(s) > carrierScore(prev)) carrierByRoot.set(root, s);
	}
	const out = [];
	for (const s of segments) {
		const root = rootByLine.get(`${s.line.join(',')}`) || ptKey(s.line[0], s.line[1]);
		const flagNets = flagNetByRoot.get(root);
		const hasSameFlag = flagNets && s.net && flagNets.has(s.net);
		const hasExternalLabel = applyLabelNets.has(s.net) || (portNets.has(s.net) && !keepNamedWire(s));
		const net = s.net && !hasSameFlag && !hasExternalLabel && carrierByRoot.get(root) === s ? s.net : '';
		if (net) namedByRoot.set(root, net);
		const anchoredLabel = net ? labelForSegment({ ...s, net }) : null;
		out.push({ ...s, net, label: net ? (anchoredLabel || autoLabelForSegment({ ...s, net }, segments)) : null });
	}
	return out;
}

const wires = explodeWires(model.wires);
const CHUNK = 24;
const COMP_CHUNK = 1;
const W = (name, body) => writeFileSync(DIR + name, body + '\n');

W('af_delparts.js', `async function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
const oldIds = [];
for (const id of await eda.sch_PrimitiveComponent.getAllPrimitiveId()) {
  const o = await eda.sch_Primitive.getPrimitiveByPrimitiveId(id);
  if (o && o.componentType === 'part') oldIds.push(id);
}
if (oldIds.length) await eda.sch_PrimitiveComponent.delete(oldIds);
await sleep(1000);
return { deleted: oldIds.length };`);

let mi = 0;
for (let i = 0; i < comps.length; i += COMP_CHUNK) {
	const slice = comps.slice(i, i + COMP_CHUNK);
	W(`af_move_parts_${mi}.js`, `const C = ${JSON.stringify(slice)};
let moved = 0, err = 0, failed = [];
for (const c of C) { try {
  let existingId = '';
  for (const id of await eda.sch_PrimitiveComponent.getAllPrimitiveId()) {
    const o = await eda.sch_Primitive.getPrimitiveByPrimitiveId(id);
    if (o && o.componentType === 'part' && o.designator === c.designator) existingId = id;
  }
  let phase = 'search';
  const found = await eda.lib_Device.search(c.query);
  const exactDevice = Array.isArray(found) && found.length && c.supplier ? found.find(x => x.supplierId === c.supplier) : null;
  const searchDevice = Array.isArray(found) && found.length ? found[0] : null;
  const metaDevice = exactDevice || null;
  const device = exactDevice || searchDevice;
  if (!device) throw new Error('missing device metadata');
  const propDevice = metaDevice || c.meta || c.component;
  const otherProperty = { ...((metaDevice && metaDevice.otherProperty) || (c.meta && c.meta.otherProperty) || {}) };
  for (const k of [
    'Symbol','Device','Footprint','3D Model','3D Model Title','3D Model Transform',
    'Designator','Name','Add into BOM','Convert to PCB',
    'Supplier','Supplier Part','Manufacturer','Manufacturer Part',
  ]) delete otherProperty[k];
  const stdName = (propDevice && propDevice.name) || c.value;
  const stdProps = {
    designator: c.designator, name: stdName, addIntoBom: true, addIntoPcb: true, otherProperty,
    manufacturer: '',
    manufacturerId: '',
    supplier: '',
    supplierId: '',
  };
  async function syncAttrs(pid) {
    const attrs = await eda.sch_PrimitiveAttribute.getAll(pid) || [];
    const byKey = new Map(attrs.map(a => [a.key || (a.getState_Key && a.getState_Key()), a]));
    const vals = {
      Name: stdName,
      Designator: c.designator,
      Supplier: '',
      'Supplier Part': '',
      Manufacturer: '',
      'Manufacturer Part': '',
      Value: otherProperty.Value || c.value || stdName,
    };
    for (const [key, value] of Object.entries(vals)) {
      const a = byKey.get(key);
      if (a && value != null) {
        const patch = { value: String(value) };
        const dp = key === 'Designator' ? ${JSON.stringify(designatorPlacementByRef)}[c.designator] : null;
        if (dp) { patch.x = dp.x; patch.y = dp.y; patch.valueVisible = true; patch.keyVisible = false; }
        await eda.sch_PrimitiveAttribute.modify(a.primitiveId, patch);
      }
    }
  }
  if (existingId) {
    try {
      await eda.sch_PrimitiveComponent.modify(existingId, { ...stdProps, x: c.x, y: c.y, rotation: c.apiRotation, mirror: c.mirror });
      await syncAttrs(existingId);
      moved++;
      continue;
    } catch (existingError) {
      try { await eda.sch_PrimitiveComponent.delete(existingId); } catch {}
    }
  }
  phase = 'create';
  const created = await eda.sch_PrimitiveComponent.create(device, c.x, c.y, '', c.apiRotation, c.mirror, true, true);
  if (!created) throw new Error('create returned empty');
  const id = created.primitiveId || (created.getState_PrimitiveId && created.getState_PrimitiveId());
  phase = 'modify';
  await eda.sch_PrimitiveComponent.modify(id, stdProps);
  phase = 'attrs';
  await syncAttrs(id);
  moved++;
} catch (e) { err++; failed.push({ ref: c.designator, phase, error: e && e.message ? e.message : String(e) }); } }
if (err) throw new Error(JSON.stringify({ moved, err, total: C.length, failed }));
return { moved, err, total: C.length, failed };`);
	mi++;
}

W('af_nc.js', `const NC = ${JSON.stringify(noConnects)};
const PIN_FIX = new Map(${JSON.stringify(pinFixes)}.map(p => [p.ref, p]));
const want = new Map(NC.map(n => [String(n.ref || n.designator) + '.' + String(n.pin || n.num), true]));
const ids = await eda.sch_PrimitiveComponent.getAllPrimitiveId();
let touched = 0, skipped = 0, err = 0, failed = [];
for (const id of ids) {
  const c = await eda.sch_Primitive.getPrimitiveByPrimitiveId(id);
  if (!c || c.componentType !== 'part') continue;
  const pins = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(id) || [];
  for (const p of pins) {
    const key = String(c.designator) + '.' + String(p.pinNumber);
    const desired = !!want.get(key);
    try {
      const current = p.getState_NoConnected ? !!p.getState_NoConnected() : false;
      if (current !== desired) {
        const a = p.toAsync ? p.toAsync() : p;
        a.setState_NoConnected(desired);
        if (a.done) await a.done();
        touched++;
      } else skipped++;
      const fix = PIN_FIX.get(key);
      if (fix) {
        await eda.sch_PrimitivePin.modify(p.primitiveId, { x: fix.x, y: fix.y });
      }
    } catch (e) { err++; failed.push({ ref: key, error: e && e.message ? e.message : String(e) }); }
  }
}
if (err) throw new Error(JSON.stringify({ touched, err, failed: failed.slice(0, 20) }));
return { touched, skipped, err, nc: NC.length };`);

W('af_del.js', `const wids = await eda.sch_PrimitiveWire.getAllPrimitiveId();
if (wids && wids.length) await eda.sch_PrimitiveWire.delete(wids);
const tids = await eda.sch_PrimitiveText.getAllPrimitiveId();
if (tids && tids.length) await eda.sch_PrimitiveText.delete(tids);
const rids = await eda.sch_PrimitiveRectangle.getAllPrimitiveId().catch(() => []);
if (rids && rids.length) await eda.sch_PrimitiveRectangle.delete(rids);
const cids = await eda.sch_PrimitiveComponent.getAllPrimitiveId();
const kill = [];
for (const id of cids) { const o = await eda.sch_Primitive.getPrimitiveByPrimitiveId(id); if (o && o.componentType && o.componentType !== 'part') kill.push(id); }
if (kill.length) await eda.sch_PrimitiveComponent.delete(kill);
return { delWires: wids ? wids.length : 0, delTexts: tids ? tids.length : 0, delRects: rids ? rids.length : 0, delFlags: kill.length };`);

let fi = 0;
for (let i = 0; i < flags.length; i += CHUNK) {
	const slice = flags.slice(i, i + CHUNK);
	W(`af_flags_${fi}.js`, `const F = ${JSON.stringify(slice)};
let ok = 0, err = 0, failed = [];
for (const f of F) { try {
  const type = f.kind === 'power' ? 'Power' : 'Ground';
  const r = await eda.sch_PrimitiveComponent.createNetFlag(type, f.net, f.x, f.y, f.rot, false);
  if (r) {
    const a = r.toAsync ? r.toAsync() : r;
    if (a.setState_AddIntoBom) a.setState_AddIntoBom(false);
    if (a.setState_AddIntoPcb) a.setState_AddIntoPcb(false);
    if (a.setState_OtherProperty) a.setState_OtherProperty({ Value: f.net });
    if (a.done) await a.done();
  }
  if (r) ok++; else { err++; failed.push({ flag: f, error: 'create returned empty' }); }
} catch (e) { err++; failed.push({ flag: f, error: e && e.message ? e.message : String(e) }); } }
if (err) throw new Error(JSON.stringify({ ok, err, total: F.length, failed }));
return { ok, err, total: F.length, failed };`);
	fi++;
}

let pi = 0;
for (let i = 0; i < ports.length; i += CHUNK) {
	const slice = ports.slice(i, i + CHUNK);
	W(`af_ports_${pi}.js`, `const P = ${JSON.stringify(slice)};
let ok = 0, err = 0, failed = [];
for (const p of P) { try {
  const r = await eda.sch_PrimitiveComponent.createNetPort('BI', p.net, p.x, p.y, p.rot, false);
  if (r) {
    const a = r.toAsync ? r.toAsync() : r;
    if (a.setState_AddIntoBom) a.setState_AddIntoBom(false);
    if (a.setState_AddIntoPcb) a.setState_AddIntoPcb(false);
    if (a.setState_OtherProperty) a.setState_OtherProperty({ Value: p.net });
    if (a.done) await a.done();
  }
  if (r) ok++; else { err++; failed.push({ port: p, error: 'create returned empty' }); }
} catch (e) { err++; failed.push({ port: p, error: e && e.message ? e.message : String(e) }); } }
if (err) throw new Error(JSON.stringify({ ok, err, total: P.length, failed }));
return { ok, err, total: P.length, failed };`);
	pi++;
}

let wi = 0;
for (let i = 0; i < wires.length; i += CHUNK) {
	const slice = wires.slice(i, i + CHUNK);
	W(`af_wires_${wi}.js`, `const Wd = ${JSON.stringify(slice)};
let ok = 0, err = 0, attrOk = 0, attrErr = 0, failed = [];
const created = [];
for (const w of Wd) { try {
  const r = await eda.sch_PrimitiveWire.create(w.line, w.net);
  const id = r && (r.primitiveId || (r.getState_PrimitiveId && r.getState_PrimitiveId()));
  if (r) { ok++; created.push({ w, id: id || null }); } else { err++; failed.push({ wire: w, error: 'create returned empty' }); }
} catch (e) { err++; failed.push({ wire: w, error: e && e.message ? e.message : String(e) }); } }
for (const item of created) { const w = item.w; if (!w.net) continue; try {
  let target = item.id;
  if (!target) {
    const ids = await eda.sch_PrimitiveWire.getAllPrimitiveId();
    target = (await Promise.all((ids || []).map(async id => {
    const o = await eda.sch_Primitive.getPrimitiveByPrimitiveId(id).catch(() => null);
    const line = o && (o.line || (o.getState_Line && o.getState_Line())) || [];
    return JSON.stringify(line) === JSON.stringify(w.line) ? id : null;
    }))).filter(Boolean).pop();
  }
  if (!target) throw new Error('wire id not found after create');
  const attrs = await eda.sch_PrimitiveAttribute.getAll(target).catch(() => []) || [];
  const a = attrs.find(x => (x.key || (x.getState_Key && x.getState_Key())) === 'Name');
  if (!a) throw new Error('Name attr not found');
  const aid = a.primitiveId || (a.getState_PrimitiveId && a.getState_PrimitiveId());
  if (w.label) await eda.sch_PrimitiveAttribute.modify(aid, { x: w.label.x, y: w.label.y, alignMode: w.label.alignMode ?? 6, rotation: w.label.rotation ?? 0, valueVisible: true, keyVisible: false });
  else await eda.sch_PrimitiveAttribute.modify(aid, { valueVisible: false, keyVisible: false });
  attrOk++;
} catch (e) { attrErr++; failed.push({ wire: w, phase: 'net-attr', error: e && e.message ? e.message : String(e) }); } }
if (err || attrErr) throw new Error(JSON.stringify({ ok, err, attrOk, attrErr, total: Wd.length, failed }));
return { ok, err, attrOk, attrErr, total: Wd.length, failed };`);
	wi++;
}

W('af_docs.js', `const RECTANGLES = ${JSON.stringify(docRectangles)};
const TEXTS = ${JSON.stringify(docTexts)};
let rectOk = 0, rectErr = 0, textOk = 0, textErr = 0, failed = [];
for (const r of RECTANGLES) { try {
  const o = await eda.sch_PrimitiveRectangle.create(r.topLeftX, r.topLeftY, r.width, r.height, 0, 0, r.color, r.fillColor, r.lineWidth, r.lineType, r.fillStyle);
  if (o) rectOk++; else { rectErr++; failed.push({ type: 'rectangle', item: r, error: 'create returned empty' }); }
} catch (e) { rectErr++; failed.push({ type: 'rectangle', item: r, error: e && e.message ? e.message : String(e) }); } }
for (const t of TEXTS) { try {
  const o = await eda.sch_PrimitiveText.create(t.x, t.y, t.content, t.rotation, t.textColor, t.fontName, t.fontSize, t.bold, t.italic, t.underLine, t.alignMode);
  if (o) textOk++; else { textErr++; failed.push({ type: 'text', item: t, error: 'create returned empty' }); }
} catch (e) { textErr++; failed.push({ type: 'text', item: t, error: e && e.message ? e.message : String(e) }); } }
if (rectErr || textErr) throw new Error(JSON.stringify({ rectOk, rectErr, textOk, textErr, failed: failed.slice(0, 20) }));
return { rectOk, rectErr, textOk, textErr };`);

W('af_zoom.js', `await eda.dmt_EditorControl.zoomToAllPrimitives(); return { zoomed: true };`);

console.log(`gen: comps=${comps.length} flags=${flags.length}(${fi}) ports=${ports.length}(${pi}) wires=${wires.length}(${wi}) docs=${docRectangles.length + docTexts.length}`);
