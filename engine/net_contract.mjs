import { buildNetlist } from './netlist.mjs';

export const KEY_NET_CONTRACT = [
	{ net: 'USB_CC1', pins: ['J1.A5', 'R9.2'] },
	{ net: 'USB_CC2', pins: ['J1.B5', 'R10.2'] },
	{ net: 'USB_DN', pins: ['J1.A7', 'J1.B7', 'R11.1', 'R11.2', 'U1.13'] },
	{ net: 'USB_DP', pins: ['J1.A6', 'J1.B6', 'R12.1', 'R12.2', 'U1.14'] },
	{ net: 'SYS_5V', pins: ['J1.A4B9', 'J1.B4A9', 'C1.1', 'U2.3'] },
	{ net: 'GND', pins: ['R9.1', 'R10.1', 'C1.2'] },
	{ net: 'RLY1_COIL_A', pins: ['Q3.3', 'D2.2', 'CN3.2'] },
	{ net: 'RLY1_COIL_V', pins: ['D2.1', 'CN3.1'] },
	{ net: 'RLY2_COIL_A', pins: ['Q4.3', 'D3.2', 'CN4.2'] },
	{ net: 'RLY2_COIL_V', pins: ['D3.1', 'CN4.1'] },
	{ net: 'VIN_12_19V', pins: ['CN1.1', 'Q1.1', 'Q1.2', 'Q1.3', 'R1.2', 'D1.2'] },
	{ net: 'VOUT_SW', pins: ['CN2.1', 'Q1.5', 'Q1.6', 'Q1.7', 'Q1.8'] },
	{ net: 'PMOS_GATE', pins: ['Q1.4', 'R1.1', 'R2.2', 'D1.1'] },
	{ net: 'PGATE_PULL', pins: ['Q2.3', 'R2.1'] },
	{ net: 'Q2_GATE', pins: ['Q2.1', 'R3.2', 'R4.1'] },
	{ net: 'EXT_PWR_EN', pins: ['U1.3', 'R3.1'] },
	{ net: 'RELAY1_EN', pins: ['U1.4', 'R13.1'] },
	{ net: 'RELAY2_EN', pins: ['U1.5', 'R14.1'] },
	{ net: 'RLY1_GATE', pins: ['Q3.1', 'R13.2', 'R15.1'] },
	{ net: 'RLY2_GATE', pins: ['Q4.1', 'R14.2', 'R16.1'] },
	{ net: 'RESET_EN', pins: ['U1.2', 'SW1.6', 'R18.1', 'C3.1'] },
	{ net: 'BOOT_IO9', pins: ['U1.8', 'SW2.5', 'R17.1'] },
	{ net: 'SYS_3V3', pins: ['U1.1', 'U2.2', 'U2.4', 'C2.1', 'C4.1', 'R17.2', 'R18.2'] },
	{ net: 'GND', pins: ['R9.1', 'R10.1', 'C1.2', 'U2.1', 'C2.2', 'C4.2', 'SW1.1', 'SW1.2', 'C3.2', 'SW2.1', 'SW2.2', 'CN1.2', 'CN2.2', 'Q2.2', 'R4.2', 'Q3.2', 'R15.2', 'Q4.2', 'R16.2'] },
];

export function buildPinNetMap(model) {
	const nets = buildNetlist(model);
	const pinNet = new Map();
	for (const n of nets) {
		for (const p of n.pins || []) pinNet.set(p.ref, n.name);
	}
	return { nets, pinNet };
}

export function netContractReport(model, contract = KEY_NET_CONTRACT) {
	const { nets, pinNet } = buildPinNetMap(model);
	const findings = [];
	const checks = contract.map(req => {
		const actualByPin = req.pins.map(pin => ({ pin, actual: pinNet.get(pin) || null }));
		const missing = actualByPin.filter(p => !p.actual).map(p => p.pin);
		const actualNames = [...new Set(actualByPin.map(p => p.actual).filter(Boolean))];
		const connected = missing.length === 0 && actualNames.length === 1;
		const named = connected && (actualNames[0] === req.net || actualNames[0].includes(req.net));
		const pass = connected && named;
		if (!pass) {
			findings.push({
				rule: 'NET-CONTRACT-KEY-NET',
				severity: 'hard',
				category: 'electrical',
				msg: `${req.net} key net contract failed`,
				where: { net: req.net, pins: actualByPin, missing, actualNames },
			});
		}
		return { net: req.net, expectedPins: req.pins, actualByPin, actualNames, pass };
	});
	return {
		pass: findings.length === 0,
		severity: { hard: findings.length, soft: 0, info: 0 },
		findings,
		stats: { nets: nets.length, checkedNets: checks.length },
		checks,
	};
}
