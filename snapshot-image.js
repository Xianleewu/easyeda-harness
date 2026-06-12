const partIds = await eda.sch_PrimitiveComponent.getAllPrimitiveId();
const wireRaw = await eda.sch_PrimitiveWire.getAll().catch(() => []) || [];
const textIds = await eda.sch_PrimitiveText.getAllPrimitiveId().catch(() => []) || [];
const rectIds = await eda.sch_PrimitiveRectangle.getAllPrimitiveId().catch(() => []) || [];
const doc = await eda.dmt_SelectControl.getCurrentDocumentInfo().catch(() => null);
const tabId = doc && doc.tabId ? doc.tabId : undefined;
const boxes = [];

function pushBox(b) {
	if (!b) return;
	const minX = b.minX != null ? b.minX : b.x;
	const minY = b.minY != null ? b.minY : b.y;
	const maxX = b.maxX != null ? b.maxX : b.x + b.width;
	const maxY = b.maxY != null ? b.maxY : b.y + b.height;
	if ([minX, minY, maxX, maxY].every(v => typeof v === 'number' && Number.isFinite(v))) {
		boxes.push({ minX, minY, maxX, maxY });
	}
}

for (const id of partIds || []) {
	pushBox(await eda.sch_Primitive.getPrimitivesBBox([id]).catch(() => null));
}
for (const id of textIds || []) {
	pushBox(await eda.sch_Primitive.getPrimitivesBBox([id]).catch(() => null));
}
for (const id of rectIds || []) {
	const r0 = await eda.sch_PrimitiveRectangle.get(id).catch(() => null);
	const width = r0 && (r0.width || (r0.getState_Width && r0.getState_Width()));
	const height = r0 && (r0.height || (r0.getState_Height && r0.getState_Height()));
	if (width >= 450 || height >= 300) continue;
	pushBox(await eda.sch_Primitive.getPrimitivesBBox([id]).catch(() => null));
}
for (const w of wireRaw) {
	const line = w.line || (w.getState_Line && w.getState_Line()) || [];
	const xs = [];
	const ys = [];
	for (let i = 0; i + 1 < line.length; i += 2) {
		xs.push(line[i]);
		ys.push(line[i + 1]);
	}
	if (xs.length) boxes.push({ minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) });
}

if (boxes.length) {
	const pad = 160;
	const aspect = 2030 / 980;
	const minX = Math.min(...boxes.map(b => b.minX));
	const maxX = Math.max(...boxes.map(b => b.maxX));
	const minY = Math.min(...boxes.map(b => b.minY));
	const maxY = Math.max(...boxes.map(b => b.maxY));
	const cx = (minX + maxX) / 2;
	const cy = (minY + maxY) / 2;
	let width = (maxX - minX) + 2 * pad;
	let height = (maxY - minY) + 2 * pad;
	if (width / height > aspect) height = width / aspect;
	else width = height * aspect;
	const left = cx - width / 2;
	const right = cx + width / 2;
	const bottom = cy - height / 2;
	const top = cy + height / 2;
	const ok = await eda.dmt_EditorControl.zoomToRegion(left, right, top, bottom, tabId);
	if (!ok) return { error: 'zoomToRegion failed' };
	await new Promise(r => setTimeout(r, 900));
}

const blob = await eda.dmt_EditorControl.getCurrentRenderedAreaImage(tabId);
if (!blob) return { error: 'no blob returned' };
const buf = await blob.arrayBuffer();
const bytes = new Uint8Array(buf);
let bin = '';
const chunk = 0x8000;
for (let i = 0; i < bytes.length; i += chunk) {
	bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
}
return { type: blob.type, size: bytes.length, b64: btoa(bin) };
