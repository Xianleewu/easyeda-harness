import { existsSync, readFileSync } from 'node:fs';

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

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function values(obj) {
	return Object.values(obj || {}).filter(Boolean);
}

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function activeAssemblyPath() {
	const dir = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
	return process.env.EASYEDA_PROJECT_ASSEMBLY || dir + 'project_assembly.json';
}

export function modulesFromAssembly(assembly) {
	const fallbackByName = moduleByName();
	const columnByModule = new Map();
	for (const [index, column] of asArray(assembly?.layoutPolicy?.columns).entries()) {
		for (const id of asArray(column.modules)) {
			columnByModule.set(id, {
				index,
				column: column.id || `column_${index + 1}`,
				role: column.role || '',
			});
		}
	}
	const modules = asArray(assembly?.modules)
		.map(mod => {
			const name = mod.registryModule || mod.id;
			const fallback = fallbackByName.get(name) || fallbackByName.get(mod.id) || {};
			const refs = [...new Set(values(mod.refs))];
			if (!name || !refs.length) return null;
			const column = columnByModule.get(mod.id) || {};
			return {
				name,
				id: mod.id || name,
				refs,
				role: fallback.role || column.role || 'module',
				repeatedGroup: fallback.repeatedGroup || mod.repeatedGroup || null,
				column: column.column || null,
				columnIndex: Number.isFinite(column.index) ? column.index : null,
			};
		})
		.filter(Boolean);
	return modules.length ? modules : MODULES;
}

export function repeatedGroupsForModules(modules, assembly = null) {
	if (asArray(assembly?.layoutPolicy?.repeatedGroups).length) return assembly.layoutPolicy.repeatedGroups;
	const names = new Set(modules.map(mod => mod.name));
	const refs = new Set(modules.flatMap(mod => mod.refs));
	return REPEATED_GROUPS.filter(group =>
		asArray(group.modules).every(name => names.has(name)) &&
		asArray(group.roleMap).flat().every(ref => refs.has(ref)) &&
		asArray(group.anchorRoleMap).flatMap(role => [...asArray(role.anchors), ...asArray(role.refs)]).every(ref => refs.has(ref))
	);
}

export function loadProjectModuleRegistry(path = activeAssemblyPath()) {
	if (!existsSync(path)) return { modules: MODULES, repeatedGroups: REPEATED_GROUPS, source: 'fallback-static' };
	try {
		const assembly = readJson(path);
		const modules = modulesFromAssembly(assembly);
		return {
			modules,
			repeatedGroups: repeatedGroupsForModules(modules, assembly),
			assembly,
			source: path.replace(/\\/g, '/'),
		};
	} catch {
		return { modules: MODULES, repeatedGroups: REPEATED_GROUPS, source: 'fallback-static-parse-error' };
	}
}

export function activePartToModuleMap(path = activeAssemblyPath()) {
	const out = new Map();
	for (const mod of loadProjectModuleRegistry(path).modules) for (const ref of mod.refs) out.set(ref, mod.name);
	return out;
}
