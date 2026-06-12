export const MODULES = [
	{ name: 'usb', refs: ['J1', 'R9', 'R10', 'R11', 'R12', 'C1'], role: 'input' },
	{ name: 'ldo', refs: ['U2', 'C2', 'C4'], role: 'power' },
	{ name: 'btn1', refs: ['SW1', 'R18', 'C3'], role: 'support', repeatedGroup: 'buttons' },
	{ name: 'btn2', refs: ['SW2', 'R17'], role: 'support', repeatedGroup: 'buttons' },
	{ name: 'mcu', refs: ['U1'], role: 'controller' },
	{ name: 'pmos', refs: ['Q1', 'Q2', 'D1', 'R1', 'R2', 'R3', 'R4', 'CN1', 'CN2'], role: 'output' },
	{ name: 'relay1', refs: ['Q3', 'R13', 'R15', 'D2', 'CN3'], role: 'output', repeatedGroup: 'relays' },
	{ name: 'relay2', refs: ['Q4', 'R14', 'R16', 'D3', 'CN4'], role: 'output', repeatedGroup: 'relays' },
];

export const REQUIRED_PARTS = [
	'C1', 'C2', 'C3', 'C4',
	'CN1', 'CN2', 'CN3', 'CN4',
	'D1', 'D2', 'D3',
	'J1',
	'Q1', 'Q2', 'Q3', 'Q4',
	'R1', 'R2', 'R3', 'R4',
	'R9', 'R10', 'R11', 'R12', 'R13', 'R14', 'R15', 'R16', 'R17', 'R18',
	'SW1', 'SW2',
	'U1', 'U2',
];

export const REPEATED_GROUPS = [
	{
		name: 'relays',
		modules: ['relay1', 'relay2'],
		roleMap: [
			['Q3', 'Q4'],
			['R13', 'R14'],
			['R15', 'R16'],
			['D2', 'D3'],
			['CN3', 'CN4'],
		],
		maxRelativeError: 8,
		maxSizeDelta: 10,
	},
	{
		name: 'buttons',
		modules: ['btn1', 'btn2'],
		anchorRoleMap: [
			{ anchors: ['SW1', 'SW2'], refs: ['R18', 'R17'], role: 'pullup' },
		],
		maxRelativeError: 8,
	},
];

export function moduleByName() {
	return new Map(MODULES.map(m => [m.name, m]));
}

export function partToModuleMap() {
	const out = new Map();
	for (const mod of MODULES) for (const ref of mod.refs) out.set(ref, mod.name);
	return out;
}
