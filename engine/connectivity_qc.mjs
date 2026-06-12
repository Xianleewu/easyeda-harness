import { buildNetlist } from './netlist.mjs';

const REQUIRED_NETS = [
	{ net: 'USB_CC1', pins: ['J1.A5', 'R9.2'] },
	{ net: 'USB_CC2', pins: ['J1.B5', 'R10.2'] },
	{ net: 'USB_DN', pins: ['J1.A7', 'J1.B7', 'R11.1', 'R11.2', 'U1.13'] },
	{ net: 'USB_DP', pins: ['J1.A6', 'J1.B6', 'R12.1', 'R12.2', 'U1.14'] },
	{ net: 'SYS_5V', pins: ['J1.A4B9', 'J1.B4A9', 'C1.1', 'U2.3'] },
	{ net: 'GND', pins: ['R9.1', 'R10.1', 'C1.2'] },
];

const REQUIRED_PIN_NETS = [
	{ ref: 'D2.2', net: 'RLY1_COIL_A', msg: 'D2 anode must connect to relay 1 switched coil node' },
	{ ref: 'D2.1', net: 'RLY1_COIL_V', msg: 'D2 cathode must connect to relay 1 coil supply' },
	{ ref: 'D3.2', net: 'RLY2_COIL_A', msg: 'D3 anode must connect to relay 2 switched coil node' },
	{ ref: 'D3.1', net: 'RLY2_COIL_V', msg: 'D3 cathode must connect to relay 2 coil supply' },
];

export function connectivityQC(model) {
	const findings = [];
	const nets = buildNetlist(model);
	const pinNet = new Map();
	for (const n of nets) {
		for (const p of n.pins) pinNet.set(p.ref, n.name);
	}

	for (const req of REQUIRED_NETS) {
		const groups = new Map();
		for (const ref of req.pins) {
			const nm = pinNet.get(ref);
			if (!nm) {
				findings.push({ rule: 'E2-pin-missing', severity: 'hard', category: 'electrical',
					msg: `Pin ${ref} is not connected to any net`, where: { net: req.net, pin: ref } });
				continue;
			}
			if (!groups.has(nm)) groups.set(nm, []);
			groups.get(nm).push(ref);
		}
		if (groups.size > 1) {
			const detail = [...groups.entries()].map(([k, v]) => `${k}:[${v.join(',')}]`).join(' | ');
			findings.push({ rule: 'E2-net-split', severity: 'hard', category: 'electrical',
				msg: `Net ${req.net} is split into multiple groups: ${detail}`, where: { expect: req.net, groups: detail } });
		} else if (groups.size === 1) {
			const [nm] = [...groups.keys()];
			if (nm.startsWith('N$') || (nm !== req.net && !nm.includes(req.net)))
				findings.push({ rule: 'E2-net-island', severity: 'hard', category: 'electrical',
					msg: `Expected ${req.net}, actual isolated net ${nm}`, where: { expect: req.net, actual: nm } });
		}
	}

	for (const req of REQUIRED_PIN_NETS) {
		const actual = pinNet.get(req.ref);
		if (!actual) {
			findings.push({ rule: 'E2-pin-missing', severity: 'hard', category: 'electrical',
				msg: `${req.ref} is not connected: ${req.msg}`, where: { pin: req.ref, expect: req.net } });
			continue;
		}
		if (actual !== req.net) {
			findings.push({ rule: 'E2-pin-net-mismatch', severity: 'hard', category: 'electrical',
				msg: `${req.ref} is on ${actual}, expected ${req.net}: ${req.msg}`,
				where: { pin: req.ref, expect: req.net, actual } });
		}
	}

	const anon = nets.filter(n => n.name?.startsWith('N$') && n.pins.length >= 2);
	for (const n of anon) {
		const refs = n.pins.map(p => p.ref).join(',');
		if (/R9|R10|R11|R12/.test(refs))
			findings.push({ rule: 'E2-anon-island', severity: 'hard', category: 'electrical',
				msg: `USB passives are on anonymous net ${n.name}: ${refs}`, where: { net: n.name, pins: refs } });
	}

	return findings;
}
