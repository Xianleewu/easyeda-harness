import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { inferModuleRegions, renderSheetOutput, transformFor } from './sheet_renderer.mjs';
import { inspectPng } from './image_gate.mjs';
import { auditSheetOutput } from './sheet_output_gate.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const OUT = process.env.EASYEDA_VISUAL_CROPS_OUT || DIR + 'visual_crops/';
const SNAP = process.env.EASYEDA_VISUAL_SNAP || (existsSync(DIR + 'live.json') ? DIR + 'live.json' : DIR + 'full_model.json');
const REPORT = process.env.EASYEDA_VISUAL_REPORT || DIR + 'visual_review_report.json';
mkdirSync(OUT, { recursive: true });

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function cropSvgFromPngLike(svg, region, outPng) {
	const [minX, minY, maxX, maxY] = region.box;
	const width = maxX - minX;
	const height = maxY - minY;
	const cropSvg = [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${region.width || 1200}" height="${region.height || 760}" viewBox="${minX} ${minY} ${width} ${height}">`,
		svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, ''),
		'</svg>',
	].join('\n');
	writeFileSync(outPng.replace(/\.png$/i, '.svg'), cropSvg, 'utf8');
	writeFileSync(outPng, new Resvg(cropSvg, { background: 'white' }).render().asPng());
}

const snap = readJson(SNAP);
const fullPng = OUT + '00_full_render.png';
const { svg, report: renderReport } = renderSheetOutput(snap, fullPng);
const sheetGate = auditSheetOutput(renderReport, fullPng, { minFileBytes: 1 });
const sheetBox = renderReport.sheetBox;
const tr = transformFor(sheetBox, renderReport.width, renderReport.height, 38);
const moduleRegions = inferModuleRegions(snap, 34);
const moduleByName = new Map(moduleRegions.map(r => [r.name, r]));

function pxBoxFromModelBox(b, padPx = 26) {
	const p = tr.box(b);
	return [
		Math.max(0, p.x - padPx),
		Math.max(0, p.y - padPx),
		Math.min(renderReport.width, p.x + p.width + padPx),
		Math.min(renderReport.height, p.y + p.height + padPx),
	];
}

function regionFromModule(name, label, width = 1200, height = 760) {
	const r = moduleByName.get(name);
	if (!r) throw new Error(`module region not found: ${name}`);
	return { name: label, box: pxBoxFromModelBox(r.box), width, height };
}

const regions = [
	{ name: '00_global_sheet', box: [0, 0, renderReport.width, renderReport.height], width: 1600, height: 920 },
	regionFromModule('usb', '01_usb'),
	regionFromModule('ldo', '02_ldo'),
	regionFromModule('btn1', '03_reset'),
	regionFromModule('btn2', '04_boot'),
	regionFromModule('mcu', '05_mcu_left'),
	{ ...regionFromModule('mcu', '06_mcu_right'), name: '06_mcu_right' },
	regionFromModule('pmos', '07_pmos'),
	regionFromModule('relay1', '08_relay1'),
	regionFromModule('relay2', '09_relay2'),
	{ name: '10_title_template', box: [
		Math.max(0, renderReport.titleBlockPx.x - 28),
		Math.max(0, renderReport.titleBlockPx.y - 28),
		Math.min(renderReport.width, renderReport.titleBlockPx.x + renderReport.titleBlockPx.width + 28),
		Math.min(renderReport.height, renderReport.titleBlockPx.y + renderReport.titleBlockPx.height + 28),
	], width: 1200, height: 360 },
];
const cropReports = [];
for (const r of regions) {
	const out = OUT + r.name + '.png';
	cropSvgFromPngLike(svg, r, out);
	const image = inspectPng(out, {
		minWidth: r.width || 360,
		minHeight: r.height || 220,
		minFileBytes: 1000,
		minInkRatio: 0.0005,
		minContentWidthRatio: r.name === '00_global_sheet' ? 0.3 : 0.08,
		minContentHeightRatio: r.name === '00_global_sheet' ? 0.25 : 0.08,
		minSchematicInkRatio: 0.0003,
		minSchematicContentWidthRatio: r.name === '00_global_sheet' ? 0.25 : 0.05,
		minSchematicContentHeightRatio: r.name === '00_global_sheet' ? 0.25 : 0.05,
		minSchematicMarginPx: 0,
		minSchematicMarginRatio: 0,
		minUniqueColors: 3,
	});
	cropReports.push({ region: r.name, path: out, pass: image.pass, metrics: image.metrics, findings: image.findings });
	console.log(out);
}
const findings = [];
if (cropReports.length < 10) findings.push({ rule: 'V1-crop-count', severity: 'hard', category: 'visual', msg: 'visual review must generate at least 10 screenshots', where: { count: cropReports.length } });
for (const c of cropReports) {
	for (const f of c.findings || []) findings.push({ ...f, rule: `V2-${f.rule}`, where: { region: c.region, ...(f.where || {}) } });
}
if (!sheetGate.pass) {
	for (const f of sheetGate.findings || []) findings.push({ ...f, rule: `V3-${f.rule}`, where: f.where || {} });
}
const visualReport = {
	generatedAt: new Date().toISOString(),
	source: SNAP,
	outputDir: OUT,
	pass: findings.length === 0,
	severity: { hard: findings.length, soft: 0, info: 0 },
	screenshots: cropReports.length,
	regions: cropReports,
	sheet: {
		pass: sheetGate.pass,
		severity: sheetGate.severity,
		evidence: sheetGate.render?.evidence,
		image: sheetGate.image,
	},
	findings,
};
writeFileSync(REPORT, JSON.stringify(visualReport, null, 2), 'utf8');
console.log(`visual review ${visualReport.pass ? 'PASS' : 'FAIL'} screenshots=${visualReport.screenshots} hard=${visualReport.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(visualReport.pass ? 0 : 1);
