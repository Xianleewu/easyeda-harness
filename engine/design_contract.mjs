// 合成词汇层(纯函数):inferRoles 审计模型 → 通用合成契约 token + 自洽校验。
// 坐标抽象为无量纲网格(列号/行号/格数);绝对坐标留给日后 realizer。

const COLUMN_ORDER = { left: 0, center: 1, right: 2 };
const COLUMN_META = {
	left: { id: 'input', role: 'external input and power' },
	center: { id: 'control', role: 'controller and support' },
	right: { id: 'output', role: 'loads and outputs' },
};
const ROW_GAP = 1;
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function sizeOf(role, partCount) {
	const n = Math.max(1, partCount);
	if (role === 'controller') return { wCells: 6, hCells: 4 + Math.ceil(n / 2) };
	if (role === 'regulator') return { wCells: 4, hCells: 3 + n };
	return { wCells: 3, hCells: 2 + n };
}

function buildColumns(modules) {
	const present = [...new Set(modules.map(m => m.column))]
		.sort((a, b) => COLUMN_ORDER[a] - COLUMN_ORDER[b]);
	return present.map((origin, order) => ({
		id: COLUMN_META[origin].id,
		role: COLUMN_META[origin].role,
		order,
		modules: modules.filter(m => m.column === origin).map(m => m.id).sort(),
	}));
}

function placeModules(modules, columns) {
	const out = [];
	for (const col of columns) {
		const inCol = modules
			.filter(m => COLUMN_META[m.column].id === col.id)
			.sort(byId);
		let cursor = 0;
		for (const m of inCol) {
			const { wCells, hCells } = sizeOf(m.role, m.parts.length);
			out.push({
				id: m.id, role: m.role, column: col.id, parts: m.parts.slice(),
				region: { col: col.order, row: cursor, wCells, hCells },
				gap: { left: 1, right: 1, top: 1, bottom: 1 },
			});
			cursor += hCells + ROW_GAP;
		}
	}
	return out.sort(byId);
}

export function synthesizeContract(roles, logical, opts = {}) {
	if (!roles || !Array.isArray(roles.modules)) {
		throw new TypeError('synthesizeContract: roles.modules required');
	}
	const grid = { colPitch: opts.colPitch ?? 10, rowPitch: opts.rowPitch ?? 10 };
	const columns = buildColumns(roles.modules);
	const modules = placeModules(roles.modules, columns);
	return {
		schemaVersion: 1,
		grid,
		columns: columns.map(c => ({ id: c.id, role: c.role, order: c.order, modules: c.modules })),
		modules,
		labelColumns: [],
		routingChannels: [],
		meta: {
			controller: roles.controller ?? null,
			moduleCount: roles.modules.length,
			columnCount: columns.length,
		},
	};
}

export function contractQC(contract) {
	return [];
}
