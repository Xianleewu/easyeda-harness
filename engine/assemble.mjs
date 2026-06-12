// 确定性整图组装（与 AI 无关）
import { readFileSync } from 'node:fs';
import { withLocalPins } from './transform.mjs';
import { buildModel } from './buildmodel.mjs';
import { relayDriver, ldoCell, buttonCell, mcuCell, usbCell, pmosCell } from './cells.mjs';
import { buildDocumentLayer } from '../harness/document_style.mjs';

const DEFAULT_ANCHORS = {
	usb:   { x: 620,  y: 980 },
	ldo:   { x: 440,  y: 800 },
	btn1:  { x: 760,  y: 520 },
	btn2:  { x: 1000, y: 520 },
	mcu:   { x: 920,  y: 820 },
	pmos:  { x: 1340, y: 780 },
	relay1:{ x: 1720, y: 740 },
	relay2:{ x: 1720, y: 475 },
};

function cloneAnchors(anchors) {
	return Object.fromEntries(Object.entries(anchors).map(([k, v]) => [k, { ...v }]));
}

export function loadPartLib(snapPath) {
	const snap = JSON.parse(readFileSync(snapPath, 'utf8').replace(/^\uFEFF/, ''));
	for (const c of snap.components || []) {
		if (c.designator === 'Q1') {
			for (const p of c.pins || []) {
				if (['5', '6', '7', '8'].includes(String(p.num))) p.x = c.x + 25;
			}
			if (c.bbox) c.bbox.maxX = Math.min(c.bbox.maxX, c.x + 25.5);
		}
		if (c.designator === 'SW1' || c.designator === 'SW2') {
			const mk = (num, name, dx, dy, rot) => ({ num, name, x: c.x + dx, y: c.y + dy, rot, len: 10 });
			c.pins = [
				mk('1', '1', -20, 10, 180),
				mk('2', '2', -20, -10, 180),
				mk('3', '3', -20, -20, 180),
				mk('4', '4', 20, -20, 0),
				mk('5', '5', 20, 10, 0),
				mk('6', '6', 20, -10, 0),
			];
			if (c.bbox) {
				c.bbox.minX = c.x - 10.5;
				c.bbox.maxX = c.x + 10.5;
				c.bbox.minY = c.y - 20.5;
				c.bbox.maxY = c.y + 10.5;
			}
		}
	}
	const byDes = new Map(snap.components.map(c => [c.designator, withLocalPins(c)]));
	return { snap, byDes };
}

export function assemble(byDes, anchors = DEFAULT_ANCHORS) {
	const cells = [
		usbCell(byDes, { J: 'J1', Rcc1: 'R9', Rcc2: 'R10', Rdn: 'R11', Rdp: 'R12', Cv: 'C1' }, anchors.usb),
		ldoCell(byDes, { U: 'U2', Co1: 'C2', Co2: 'C4' }, anchors.ldo, { VIN: 'SYS_5V', VOUT: 'SYS_3V3' }),
		buttonCell(byDes, { SW: 'SW1', Rpu: 'R18', Cap: 'C3' }, anchors.btn1, { SIG: 'RESET_EN' }),
		buttonCell(byDes, { SW: 'SW2', Rpu: 'R17' }, anchors.btn2, { SIG: 'BOOT_IO9' }),
		mcuCell(byDes, { U: 'U1' }, anchors.mcu),
		pmosCell(byDes, { Q1: 'Q1', Q2: 'Q2', D1: 'D1', R1: 'R1', R2: 'R2', R3: 'R3', R4: 'R4', CN1: 'CN1', CN2: 'CN2' }, anchors.pmos),
		relayDriver(byDes, { Q: 'Q3', Rs: 'R13', Rpd: 'R15', D: 'D2', CN: 'CN3' }, anchors.relay1,
			{ EN: 'RELAY1_EN', GATE: 'RLY1_GATE', COILA: 'RLY1_COIL_A', COILV: 'RLY1_COIL_V' }),
		relayDriver(byDes, { Q: 'Q4', Rs: 'R14', Rpd: 'R16', D: 'D3', CN: 'CN4' }, anchors.relay2,
			{ EN: 'RELAY2_EN', GATE: 'RLY2_GATE', COILA: 'RLY2_COIL_A', COILV: 'RLY2_COIL_V' }),
	];
	const place = {}, wires = [], flags = [], noConnects = [];
	for (const c of cells) {
		Object.assign(place, c.place);
		wires.push(...c.wires);
		flags.push(...c.flags);
		if (c.noConnects) noConnects.push(...c.noConnects);
	}
	const model = buildModel(byDes, { place, wires, flags, noConnects });
	model.writeModuleFrames = true;
	const documentLayer = buildDocumentLayer(model);
	return {
		...model,
		writeModuleFrames: true,
		...documentLayer,
		layoutProfile: {
			name: 'reference_columns_v2',
			generatedAt: new Date().toISOString(),
			anchors: cloneAnchors(anchors),
		},
	};
}

export function assembleFromSnap(snapPath, anchors) {
	if (snapPath instanceof Map) return assemble(snapPath, anchors);
	const { byDes } = loadPartLib(snapPath);
	return assemble(byDes, anchors);
}
