import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { renderSheetOutput } from './sheet_renderer.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const OUT = process.env.EASYEDA_VISUAL_CROPS_OUT || DIR + 'visual_crops/';
mkdirSync(OUT, { recursive: true });

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function cropSvgFromPngLike(snapshot, region, outPng) {
	const tmpPng = OUT + '_full_tmp.png';
	const { svg } = renderSheetOutput(snapshot, tmpPng);
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

const snap = readJson(DIR + 'live.json');
const regions = [
	{ name: '00_global_sheet', box: [120, 260, 1940, 1300], width: 1600, height: 920 },
	{ name: '01_usb', box: [260, 900, 740, 1150] },
	{ name: '02_ldo', box: [320, 680, 780, 930] },
	{ name: '03_reset', box: [600, 430, 930, 660] },
	{ name: '04_boot', box: [880, 430, 1120, 660] },
	{ name: '05_mcu_left', box: [650, 700, 940, 930] },
	{ name: '06_mcu_right', box: [920, 700, 1050, 930] },
	{ name: '07_pmos', box: [1080, 560, 1485, 1000] },
	{ name: '08_relay1', box: [1520, 650, 1850, 860] },
	{ name: '09_relay2', box: [1520, 380, 1850, 590] },
	{ name: '10_title_block', box: [1360, 270, 1920, 410] },
];
for (const r of regions) {
	const out = OUT + r.name + '.png';
	cropSvgFromPngLike(snap, r, out);
	console.log(out);
}
