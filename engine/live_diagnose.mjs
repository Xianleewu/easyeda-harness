import { writeFileSync } from 'node:fs';
import { executeCode } from './bridge_client.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const REPORT = process.env.EASYEDA_LIVE_DIAG_REPORT || DIR + 'live_diagnose_report.json';
const WINDOW_ID = process.env.EASYEDA_WINDOW_ID || '';

const code = `
const doc = await eda.dmt_SelectControl.getCurrentDocumentInfo().catch(() => null);
const tabId = doc && doc.tabId ? doc.tabId : undefined;
if (tabId) await eda.dmt_EditorControl.activateDocument(tabId).catch(() => false);
async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function sha256Bytes(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function blobSummary(label, blob) {
  if (!blob) return { label, missing: true };
  const buf = await blob.arrayBuffer();
  return { label, type: blob.type || '', size: buf.byteLength, sha256: await sha256Bytes(buf) };
}
function canvasSummary() {
  return Array.from(document.querySelectorAll('canvas')).map((c, i) => {
    const r = c.getBoundingClientRect();
    let dataUrlLength = 0;
    let dataUrlError = '';
    try { dataUrlLength = c.toDataURL('image/png').length; } catch (e) { dataUrlError = e.message; }
    return {
      index: i,
      id: c.id || '',
      className: String(c.className || ''),
      width: c.width,
      height: c.height,
      clientWidth: c.clientWidth,
      clientHeight: c.clientHeight,
      rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
      dataUrlLength,
      dataUrlError,
    };
  }).filter(c => c.width || c.height || c.clientWidth || c.clientHeight);
}
async function captureSummary() {
  const out = [];
  out.push(await blobSummary('rendered-with-tabId', await eda.dmt_EditorControl.getCurrentRenderedAreaImage(tabId).catch(() => undefined)));
  out.push(await blobSummary('rendered-without-tabId', await eda.dmt_EditorControl.getCurrentRenderedAreaImage().catch(() => undefined)));
  const canvas = Array.from(document.querySelectorAll('canvas')).filter(c => c.width >= 1000 && c.height >= 500).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (canvas) {
    const data = canvas.toDataURL('image/png');
    out.push({ label: 'largest-dom-canvas', length: data.length, sha256: await sha256(data) });
  } else {
    out.push({ label: 'largest-dom-canvas', missing: true });
  }
  return out;
}
const splitScreenId = tabId ? await eda.dmt_EditorControl.getSplitScreenIdByTabId(tabId).catch(() => undefined) : undefined;
const splitScreenTree = await eda.dmt_EditorControl.getSplitScreenTree().catch(e => ({ error: e.message }));
const tabsInSplitScreen = splitScreenId ? await eda.dmt_EditorControl.getTabsBySplitScreenId(splitScreenId).catch(e => ({ error: e.message })) : undefined;
const schematicPage = await eda.dmt_Schematic.getCurrentSchematicPageInfo().catch(() => null);
const schematic = await eda.dmt_Schematic.getCurrentSchematicInfo().catch(() => null);
const before = await captureSummary();
const zoomChecks = [];
for (const t of [
  { name: 'all', method: 'zoomToAllPrimitives', args: [] },
  { name: 'usb', method: 'zoomToRegion', args: [0, 700, 1200, 700] },
  { name: 'relay', method: 'zoomToRegion', args: [1200, 1900, 900, 250] },
  { name: 'center-zoom-150', method: 'zoomTo', args: [900, 700, 150] },
]) {
  let ret = null;
  let err = '';
  try {
    if (tabId) await eda.dmt_EditorControl.activateDocument(tabId).catch(() => false);
    if (t.method === 'zoomToRegion') ret = await eda.dmt_EditorControl.zoomToRegion(t.args[0], t.args[1], t.args[2], t.args[3], tabId);
    else if (t.method === 'zoomTo') ret = await eda.dmt_EditorControl.zoomTo(t.args[0], t.args[1], t.args[2], tabId);
    else ret = await eda.dmt_EditorControl.zoomToAllPrimitives(tabId);
  }
  catch (e) { err = e.message; }
  await new Promise(r => setTimeout(r, 900));
  const canvas = Array.from(document.querySelectorAll('canvas')).filter(c => c.width >= 1000 && c.height >= 500).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  let len = 0;
  let prefix = '';
  let hash = '';
  if (canvas) {
    const data = canvas.toDataURL('image/png');
    len = data.length;
    prefix = data.slice(0, 64);
    hash = await sha256(data);
  }
  zoomChecks.push({ name: t.name, method: t.method, args: t.args, ret, err, canvasDataUrlLength: len, canvasDataUrlPrefix: prefix, canvasDataUrlSha256: hash, renderedArea: await captureSummary() });
}
return {
  doc,
  schematic,
  schematicPage,
  splitScreenId,
  splitScreenTree,
  tabsInSplitScreen,
  location: location.href,
  viewport: { innerWidth, innerHeight, devicePixelRatio },
  canvases: canvasSummary(),
  before,
  zoomChecks,
};
`;

const { result } = await executeCode(code, { windowId: WINDOW_ID, timeoutMs: 120000 });
writeFileSync(REPORT, JSON.stringify(result, null, 2), 'utf8');
console.log(`live diagnose -> ${REPORT}`);
