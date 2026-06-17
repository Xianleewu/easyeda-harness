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

const refOfPin = p => p.slice(0, p.lastIndexOf('.'));

function buildLabelColumns(modules, columns, nets) {
	const moduleByRef = new Map();
	for (const m of modules) for (const r of m.parts) moduleByRef.set(r, m);
	const orderOf = m => columns.find(c => c.id === COLUMN_META[m.column].id).order;
	const labels = [];
	for (const net of nets) {
		if (net.class !== 'signal') continue;
		const mods = [...new Set(net.pins.map(refOfPin).map(r => moduleByRef.get(r)).filter(Boolean))];
		if (mods.length < 2) continue;
		const source = mods.slice().sort((a, b) => orderOf(a) - orderOf(b) || byId(a, b))[0];
		for (const m of mods) {
			const others = mods.filter(x => x !== m);
			const avgOther = others.reduce((s, x) => s + orderOf(x), 0) / others.length;
			labels.push({
				id: `${net.name}@${m.id}`,
				net: net.name,
				module: m.id,
				side: orderOf(m) <= avgOther ? 'right' : 'left',
				routeEnd: m === source ? 'from' : 'to',
				class: 'signal',
			});
		}
	}
	return labels.sort(byId);
}

function buildChannels(columns) {
	const out = [];
	for (let i = 0; i + 1 < columns.length; i++) {
		out.push({
			id: `${columns[i].id}->${columns[i + 1].id}`,
			betweenColumns: [columns[i].id, columns[i + 1].id],
			widthCells: 2,
		});
	}
	return out;
}

export function synthesizeContract(roles, logical, opts = {}) {
	if (!roles || !Array.isArray(roles.modules)) {
		throw new TypeError('synthesizeContract: roles.modules required');
	}
	const grid = { colPitch: opts.colPitch ?? 10, rowPitch: opts.rowPitch ?? 10 };
	const columns = buildColumns(roles.modules);
	const modules = placeModules(roles.modules, columns);
	const labelColumns = buildLabelColumns(roles.modules, columns, (logical && logical.nets) || []);
	const routingChannels = buildChannels(columns);
	return {
		schemaVersion: 1,
		grid,
		columns: columns.map(c => ({ id: c.id, role: c.role, order: c.order, modules: c.modules })),
		modules,
		labelColumns,
		routingChannels,
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
