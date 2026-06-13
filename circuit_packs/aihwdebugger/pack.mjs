import { relayDriver, ldoCell, buttonCell, mcuCell, usbCell, pmosCell } from '../../engine/cells.mjs';

export const fallbackAnchors = {
	usb: { x: 620, y: 980 },
	ldo: { x: 440, y: 800 },
	btn1: { x: 760, y: 520 },
	btn2: { x: 1000, y: 520 },
	mcu: { x: 920, y: 820 },
	pmos: { x: 1340, y: 780 },
	relay1: { x: 1720, y: 740 },
	relay2: { x: 1720, y: 475 },
};

export const cellBuilders = {
	usbCell,
	ldoCell,
	buttonCell,
	mcuCell,
	pmosCell,
	relayDriver,
};

export function normalizeLibrarySnapshot(snap) {
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
	return snap;
}

export const pack = {
	id: 'aihwdebugger',
	fallbackAnchors,
	cellBuilders,
	normalizeLibrarySnapshot,
};
