import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { normalizeLiveWires } from './validate.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const ASSEMBLY = process.env.EASYEDA_PROJECT_ASSEMBLY || DIR + 'project_assembly.json';
const CONTRACT = process.env.EASYEDA_PROJECT_CONTRACT || DIR + 'project_contract.json';
const MODEL = process.env.EASYEDA_PROJECT_MODEL || DIR + 'full_model.json';
const LIVE = process.env.EASYEDA_LIVE_MODEL || DIR + 'live.json';
const REPORT = process.env.EASYEDA_PROJECT_LABEL_LAYOUT_REPORT || DIR + 'project_label_layout_report.json';
const RUN_LIVE = process.argv.includes('--live') || process.env.EASYEDA_LABEL_LAYOUT_LIVE === '1';
const SOURCE = RUN_LIVE ? LIVE : MODEL;
const SOURCE_LABEL = RUN_LIVE ? 'live.json' : 'full_model.json';
const EPS = 2;
const DEFAULT_COLUMN_TOL = 4;
const DEFAULT_LABEL_ROW_PITCH = 10;
const POWER_NETS = new Set(['GND', 'SYS_5V', 'SYS_3V3', 'VIN_12_19V', 'VOUT_SW', 'VBUS']);

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function finite(value) {
	return typeof value === 'number' && Number.isFinite(value);
}

function normBox(box) {
	if (!box || ![box.minX, box.minY, box.maxX, box.maxY].every(finite)) return null;
	return {
		minX: Math.min(box.minX, box.maxX),
		minY: Math.min(box.minY, box.maxY),
		maxX: Math.max(box.minX, box.maxX),
		maxY: Math.max(box.minY, box.maxY),
	};
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'label-layout', msg, where });
}

/* 为每条 label finding 附建议编辑目标 + 修复提示，让 finding 自带可操作下一步 */
function suggestForLabelRule(rule, pack) {
	const cell = `circuit_packs/${pack}/pack.mjs`;
	if (/^LL0/.test(rule)) {
		return { editFiles: ['project_spec.json'], hint: 'Generate the model first (node bin/easyeda-plexus.mjs generate) so label evidence exists before the audit.' };
	}
	if (/^LL16/.test(rule)) {
		return { editFiles: ['project_assembly.json', cell], hint: 'Either declare the net in layoutPolicy.labelColumns (if the interface is required) or stop emitting the visible label in the deterministic cell.' };
	}
	if (/^LL22/.test(rule)) {
		return { editFiles: [cell, 'project_assembly.json'], hint: 'Use the LL22 expected column/net: generate a real same-net endpoint label at the declared side/x/module/routeEnd, or remove the stale layoutPolicy.labelColumns budget.' };
	}
	return {
		editFiles: ['project_assembly.json', cell],
		hint: 'Make the label geometry-driven: declare layoutPolicy.labelColumns, attach each label origin to a same-net wire endpoint, use alignMode=6 (left-bottom) or alignMode=8 (right-bottom); engine/cell_helpers.mjs attachLabelColumn enforces this by construction.',
	};
}

function attachLabelSuggest(findings, pack) {
	for (const f of asArray(findings)) {
		if (!f.where || Array.isArray(f.where) || f.where.suggest != null) continue;
		f.where.suggest = suggestForLabelRule(f.rule || '', pack);
	}
	return findings;
}

/* net -> 拥有该 net 的模块集合（来自 project_assembly.json 各模块 nets） */
function netModulesFrom(assembly) {
	const map = {};
	for (const mod of asArray(assembly?.modules)) {
		for (const net of asArray(mod.nets)) {
			if (!net) continue;
			(map[net] = map[net] || []).push(mod.id);
		}
	}
	return map;
}

/* 把 label finding 归属到拥有其 net 的模块（"owning module if known"） */
function attributeLabelModules(findings, netModules = {}) {
	for (const f of asArray(findings)) {
		if (!f.where || Array.isArray(f.where) || f.where.module != null || f.where.modules != null) continue;
		const nets = [];
		if (typeof f.where.net === 'string') nets.push(f.where.net);
		if (Array.isArray(f.where.nets)) nets.push(...f.where.nets.filter(v => typeof v === 'string'));
		const mods = [...new Set(nets.flatMap(n => netModules[n] || []))];
		if (mods.length === 1) f.where.module = mods[0];
		else if (mods.length > 1) f.where.modules = mods;
	}
	return findings;
}

function wireSegments(wires) {
	const out = [];
	for (const w of asArray(wires)) {
		const l = asArray(w.line);
		for (let i = 0; i + 3 < l.length; i += 2) {
			const line = [Number(l[i]), Number(l[i + 1]), Number(l[i + 2]), Number(l[i + 3])];
			if (!line.every(finite)) continue;
			if (Math.abs(line[0] - line[2]) <= 1e-9 && Math.abs(line[1] - line[3]) <= 1e-9) continue;
			out.push({ id: w.id || '', net: String(w.net || ''), line });
		}
	}
	return out;
}

function endpointsForNet(wires, net) {
	const pts = [];
	for (const s of wireSegments(wires)) {
		if (s.net !== net) continue;
		pts.push({ x: s.line[0], y: s.line[1], wireId: s.id, line: s.line });
		pts.push({ x: s.line[2], y: s.line[3], wireId: s.id, line: s.line });
	}
	return pts;
}

function samePoint(a, b, tol = EPS) {
	return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
}

function pointAtOwnWireEndpoint(label, wires) {
	if (label.wireLine) {
		const [x1, y1, x2, y2] = label.wireLine;
		return samePoint(label, { x: x1, y: y1 }) || samePoint(label, { x: x2, y: y2 });
	}
	return endpointsForNet(wires, label.net).some(pt => samePoint(label, pt));
}

function signalNet(net) {
	return !!net && !POWER_NETS.has(net) && !String(net).startsWith('NC_');
}

function visibleWireNameLabels(live) {
	const labels = [];
	for (const w of asArray(live.wires)) {
		for (const attr of asArray(w.attrs)) {
			if (!['Name', 'NET'].includes(String(attr.key || ''))) continue;
			if (attr.valueVisible === false) continue;
			const net = String(attr.value || w.net || '').trim();
			if (!signalNet(net)) continue;
			if (!finite(attr.x) || !finite(attr.y)) {
				labels.push({ source: 'wire-name', net, wireId: w.id || '', missingPoint: true });
				continue;
			}
			labels.push({
				source: 'wire-name',
				net,
				x: Number(attr.x),
				y: Number(attr.y),
				alignMode: attr.alignMode == null ? null : Number(attr.alignMode),
				rotation: attr.rotation ?? 0,
				bbox: normBox(attr.bbox),
				estimatedBBox: !attr.bbox,
				wireId: w.id || '',
			});
		}
	}
	return labels;
}

function visibleNetPortLabels(snap, liveMode) {
	return asArray(snap.netflags)
		.filter(flag => flag?.type === 'netport' || flag?.kind === 'netport' || (!liveMode && flag?.kind === 'sig' && flag?.type === 'netport'))
		.filter(flag => signalNet(flag.net))
		.map(flag => ({
			source: 'net-port',
			net: String(flag.net || '').trim(),
			x: Number(flag.textX ?? flag.x),
			y: Number(flag.textY ?? flag.y),
			alignMode: flag.alignMode == null ? null : Number(flag.alignMode),
			bbox: normBox(flag.bbox),
			type: flag.type || null,
			kind: flag.kind || null,
		}));
}

function modelNetflagLabels(model) {
	return asArray(model.netflags)
		.filter(f => f.kind === 'sig' && signalNet(f.net))
		.map(f => ({
			source: 'model-netflag',
			net: String(f.net),
			x: Number(f.textX ?? f.x),
			y: Number(f.textY ?? f.y),
			anchorX: Number(f.x),
			anchorY: Number(f.y),
			alignMode: f.alignMode == null ? null : Number(f.alignMode),
			rotation: f.rotation ?? f.rot ?? 0,
			bbox: normBox(f.bbox),
			textX: f.textX,
			textY: f.textY,
		}));
}

function fakeTextLabels(snap) {
	const nets = new Set([
		...asArray(snap.wires).map(w => w.net).filter(signalNet),
		...asArray(snap.netflags).map(f => f.net).filter(signalNet),
	]);
	return asArray(snap.texts)
		.map(t => ({ content: String(t.content || '').trim(), x: t.x, y: t.y, bbox: normBox(t.bbox) }))
		.filter(t => nets.has(t.content));
}

function labelsFromSource(snap, liveMode) {
	if (liveMode) return visibleWireNameLabels(snap);
	return modelNetflagLabels(snap);
}

function median(values) {
	const nums = values.filter(finite).sort((a, b) => a - b);
	if (!nums.length) return 0;
	const mid = Math.floor(nums.length / 2);
	return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function liveTransformFromModel(live, model) {
	if (!live || !model) return { dx: 0, dy: 0, samples: 0 };
	const byRef = new Map(asArray(model.components).map(c => [c.designator, c]));
	const dx = [];
	const dy = [];
	for (const c of asArray(live.components)) {
		const m = byRef.get(c.designator);
		if (!m || !finite(c.x) || !finite(c.y) || !finite(m.x) || !finite(m.y)) continue;
		dx.push(c.x - m.x);
		dy.push(c.y - m.y);
	}
	return { dx: Number(median(dx).toFixed(3)), dy: Number(median(dy).toFixed(3)), samples: dx.length };
}

function labelSide(label) {
	const mode = Number(label.alignMode);
	if (mode === 6) return 'left';
	if (mode === 8) return 'right';
	return 'unknown';
}

function declaredColumns(assembly, transform) {
	const cols = asArray(assembly?.layoutPolicy?.labelColumns);
	return cols.map((col, index) => ({
		index,
		id: col.id || `label_column_${index + 1}`,
		role: col.role || '',
		module: col.module || '',
		routeEnd: col.routeEnd || '',
		side: col.side || '',
		x: finite(col.x) ? Number(col.x) + (transform?.dx || 0) : null,
		rawX: col.x,
		tolerance: Number(col.tolerance ?? DEFAULT_COLUMN_TOL),
		nets: new Set(asArray(col.nets).map(String)),
	}));
}

function columnMatches(label, col) {
	if (!col.nets.has(label.net)) return false;
	if (col.side && col.side !== labelSide(label)) return false;
	if (!finite(col.x) || !finite(label.x)) return false;
	return Math.abs(label.x - col.x) <= col.tolerance;
}

function labelColumnKey(label, col) {
	return col?.id || `${col?.module || 'module'}:${col?.routeEnd || 'route'}:${col?.side || labelSide(label)}:${col?.rawX ?? col?.x ?? 'x'}`;
}

function expectedCorner(label) {
	const box = normBox(label.bbox);
	if (!box) return null;
	const side = labelSide(label);
	if (side === 'left') return { side, x: box.minX, y: box.minY, box };
	if (side === 'right') return { side, x: box.maxX, y: box.minY, box };
	return { side, x: null, y: null, box };
}

export function validateLabelLayout({ assembly, contract = null, snap, modelForTransform = null, liveMode = false } = {}) {
	const findings = [];
	const labels = labelsFromSource(snap || {}, liveMode);
	const transform = liveMode ? liveTransformFromModel(snap, modelForTransform) : { dx: 0, dy: 0, samples: 0 };
	const columns = declaredColumns(assembly || {}, transform);
	const wires = liveMode ? normalizeLiveWires(snap || {}) : asArray(snap?.wires);
	const policy = assembly?.layoutPolicy || {};
	const quality = contract?.qualityPolicy || {};
	const netPortsForbidden = quality.singleSheetNoNetPortsByDefault !== false;
	const requiredCols = asArray(policy.labelColumns);
	const modules = new Set(asArray(assembly?.modules).map(mod => mod.id).filter(Boolean));
	const labelBudget = new Map();
	const labelColumnNetKeys = new Set();
	const columnNetExpectations = new Map();
	const matchedColumnNetKeys = new Set();
	const matchedLabels = [];
	const minLabelRowPitch = Number(policy.minLabelRowPitch ?? quality.ruleProfile?.minLabelRowPitch ?? DEFAULT_LABEL_ROW_PITCH);

	if (labels.length && !requiredCols.length) {
		hard(findings, 'LL1-label-columns-declared', 'layoutPolicy.labelColumns must explain every visible signal label column', {
			labels: labels.map(l => ({ net: l.net, x: l.x, y: l.y, source: l.source })),
		});
	}
	for (const [index, col] of requiredCols.entries()) {
		if (!col.id) hard(findings, 'LL2-label-column-id', 'each label column needs a stable id', { index, column: col });
		if (!['left', 'right'].includes(col.side)) hard(findings, 'LL3-label-column-side', 'each label column must declare side left or right', { index, column: col });
		if (!finite(col.x)) hard(findings, 'LL4-label-column-x', 'each label column must declare finite x', { index, column: col });
		if (!asArray(col.nets).length) hard(findings, 'LL5-label-column-nets', 'each label column must declare the nets it is allowed to display', { index, column: col });
		if (!col.role || typeof col.role !== 'string') hard(findings, 'LL6-label-column-role', 'each label column must explain its reading-flow role', { index, column: col });
		if (!col.module || typeof col.module !== 'string') {
			hard(findings, 'LL18-label-column-module', 'each label column must declare the owning module so visible labels are tied to a module interface instead of a free-floating sheet column', { index, column: col });
		} else if (modules.size && !modules.has(col.module)) {
			hard(findings, 'LL18-label-column-module', 'label column module must exist in project_assembly.json modules', { index, column: col, knownModules: [...modules] });
		}
		if (!['from', 'to', 'local'].includes(col.routeEnd)) {
			hard(findings, 'LL19-label-column-route-end', 'each label column must declare routeEnd as from, to, or local so the reading-flow interface end is explicit', { index, column: col });
		}
		for (const net of asArray(col.nets)) {
			const netName = String(net);
			labelBudget.set(netName, (labelBudget.get(netName) || 0) + 1);
			const key = `${col.module || ''}:${col.routeEnd || ''}:${col.side || ''}:${col.x ?? ''}:${netName}`;
			if (labelColumnNetKeys.has(key)) {
				hard(findings, 'LL20-label-column-budget-unique', 'a module-side label column must not duplicate the same net budget at the same module, routeEnd, side, and x', {
					index,
					key,
					column: col,
				});
			}
			labelColumnNetKeys.add(key);
			columnNetExpectations.set(key, {
				columnId: col.id || `label_column_${index + 1}`,
				module: col.module || null,
				routeEnd: col.routeEnd || null,
				side: col.side || null,
				x: col.x ?? null,
				tolerance: col.tolerance ?? DEFAULT_COLUMN_TOL,
				net: netName,
			});
		}
	}

	for (const t of fakeTextLabels(snap || {})) {
		hard(findings, 'LL7-no-fake-text-net-labels', 'signal net names must be real net labels or visible wire Name attributes, not free text', {
			net: t.content,
			x: t.x,
			y: t.y,
			bbox: t.bbox,
		});
	}
	const netPorts = visibleNetPortLabels(snap || {}, liveMode);
	if (netPortsForbidden && netPorts.length) {
		hard(findings, 'LL17-no-unnecessary-net-ports', 'single-sheet schematics must not use EasyEDA NET PORT symbols for visible signal labels; use wire Name attributes or generated signal netflags attached to wire endpoints', {
			count: netPorts.length,
			policy: { singleSheetNoNetPortsByDefault: quality.singleSheetNoNetPortsByDefault ?? true },
			samples: netPorts.slice(0, 20),
		});
	}

	for (const label of labels) {
		if (label.missingPoint || !finite(label.x) || !finite(label.y)) {
			hard(findings, 'LL8-label-point', 'visible signal label must expose finite x/y coordinates', { label });
			continue;
		}
		const side = labelSide(label);
		if (side === 'unknown') {
			hard(findings, 'LL9-label-origin-mode', 'signal label must use EasyEDA bottom-origin alignMode 6 on left columns or 8 on right columns', {
				net: label.net,
				x: label.x,
				y: label.y,
				alignMode: label.alignMode,
				source: label.source,
			});
		}
		const corner = expectedCorner(label);
		if (!corner?.box) {
			hard(findings, 'LL10-label-bbox', 'signal label must expose actual bbox geometry so the origin can be audited', {
				net: label.net,
				x: label.x,
				y: label.y,
				source: label.source,
			});
		} else if (corner.side !== 'unknown' && (Math.abs(label.x - corner.x) > EPS || Math.abs(label.y - corner.y) > EPS)) {
			hard(findings, 'LL11-label-origin-corner', 'signal label origin must coincide with the exported left-bottom or right-bottom bbox corner', {
				net: label.net,
				side,
				x: label.x,
				y: label.y,
				expected: { x: corner.x, y: corner.y },
				bbox: corner.box,
				source: label.source,
			});
		}
		if (label.source === 'model-netflag' && ((label.textX != null && Math.abs(Number(label.textX) - label.x) > EPS) || (label.textY != null && Math.abs(Number(label.textY) - label.y) > EPS))) {
			hard(findings, 'LL12-label-text-anchor', 'model signal label textX/textY must equal the electrical anchor point', {
				net: label.net,
				x: label.x,
				y: label.y,
				textX: label.textX,
				textY: label.textY,
			});
		}
		if (!pointAtOwnWireEndpoint({ ...label, x: label.anchorX ?? label.x, y: label.anchorY ?? label.y }, wires)) {
			hard(findings, 'LL13-label-attached-endpoint', 'signal label origin must land exactly on a same-net wire endpoint; floating labels and mid-wire labels are forbidden', {
				net: label.net,
				x: label.anchorX ?? label.x,
				y: label.anchorY ?? label.y,
				source: label.source,
				nearestEndpoints: endpointsForNet(wires, label.net).slice(0, 8),
			});
		}
		const matchedColumns = columns.filter(col => columnMatches(label, col));
		if (matchedColumns.length) {
			const column = matchedColumns[0];
			matchedLabels.push({ label, column });
			matchedColumnNetKeys.add(`${column.module || ''}:${column.routeEnd || ''}:${column.side || ''}:${column.rawX ?? ''}:${label.net}`);
		}
		if (columns.length && !matchedColumns.length) {
			const sameNetColumns = columns.filter(col => col.nets.has(label.net));
			hard(findings, 'LL14-label-column-match', 'signal label must fit one declared layoutPolicy.labelColumns entry for its net, side, and x', {
				net: label.net,
				x: label.x,
				y: label.y,
				side,
				source: label.source,
				transform: liveMode ? transform : undefined,
				allowedColumns: sameNetColumns.map(col => ({ id: col.id, side: col.side, x: col.x, rawX: col.rawX, tolerance: col.tolerance })),
				xDeltas: sameNetColumns.map(col => ({
					column: col.id,
					expectedX: col.x,
					actualX: label.x,
					dx: finite(label.x) && finite(col.x) ? Number((label.x - col.x).toFixed(3)) : null,
					tolerance: col.tolerance,
					sideMismatch: col.side !== side,
					withinTolerance: finite(label.x) && finite(col.x) && Math.abs(label.x - col.x) <= (col.tolerance ?? DEFAULT_COLUMN_TOL),
				})),
			});
		}
	}

	for (const [key, expected] of columnNetExpectations) {
		if (!matchedColumnNetKeys.has(key)) {
			hard(findings, 'LL22-label-column-realized', 'each declared label column net budget must be realized by an actual visible signal label attached to a same-net endpoint', {
				key,
				expected,
				matchingLabels: labels
					.filter(label => label.net === expected.net)
					.map(label => ({ net: label.net, x: label.x, y: label.y, side: labelSide(label), source: label.source, alignMode: label.alignMode, bbox: label.bbox || null })),
			});
		}
	}

	if (Number.isFinite(minLabelRowPitch) && minLabelRowPitch > 0) {
		const byColumn = new Map();
		for (const item of matchedLabels) {
			const key = labelColumnKey(item.label, item.column);
			if (!byColumn.has(key)) byColumn.set(key, []);
			byColumn.get(key).push(item);
		}
		for (const [key, items] of byColumn) {
			const sorted = items
				.filter(item => finite(item.label.y))
				.sort((a, b) => a.label.y - b.label.y);
			for (let i = 0; i + 1 < sorted.length; i++) {
				const a = sorted[i];
				const b = sorted[i + 1];
				const pitch = Math.abs(b.label.y - a.label.y);
				if (pitch < minLabelRowPitch - EPS) {
					hard(findings, 'LL21-label-column-row-pitch', 'labels in the same declared column must keep a readable row pitch instead of visually merging into a clump', {
						column: key,
						minLabelRowPitch,
						pitch,
						a: { net: a.label.net, x: a.label.x, y: a.label.y, bbox: a.label.bbox || null },
						b: { net: b.label.net, x: b.label.x, y: b.label.y, bbox: b.label.bbox || null },
					});
				}
			}
		}
	}

	const actualBudget = new Map();
	for (const label of labels) actualBudget.set(label.net, (actualBudget.get(label.net) || 0) + 1);
	for (const [net, count] of actualBudget) {
		const allowed = labelBudget.get(net) || 0;
		if (allowed && count > allowed) {
			hard(findings, 'LL15-label-endpoint-budget', 'a net has more visible labels than its declared label column budget', { net, count, allowed });
		}
		if (!allowed) {
			hard(findings, 'LL16-unbudgeted-visible-label', 'visible signal labels are forbidden unless the net is listed in layoutPolicy.labelColumns', { net, count });
		}
	}

	attributeLabelModules(findings, netModulesFrom(assembly));
	attachLabelSuggest(findings, assembly?.circuitPack || 'aihwdebugger');
	return {
		findings,
		stats: {
			source: liveMode ? 'live' : 'model',
			labels: labels.length,
			fakeTextLabels: fakeTextLabels(snap || {}).length,
			netPorts: netPorts.length,
			labelColumns: columns.length,
			liveTransform: liveMode ? transform : null,
			minLabelRowPitch,
		},
		labels: labels.map(l => ({ source: l.source, net: l.net, x: l.x, y: l.y, alignMode: l.alignMode, bbox: l.bbox || null, estimatedBBox: !!l.estimatedBBox })),
		columns: columns.map(c => ({ id: c.id, role: c.role, module: c.module || null, routeEnd: c.routeEnd || null, side: c.side, x: c.x, rawX: c.rawX, tolerance: c.tolerance, nets: [...c.nets] })),
	};
}

export function runProjectLabelLayoutGate({
	assemblyPath = ASSEMBLY,
	contractPath = CONTRACT,
	sourcePath = SOURCE,
	reportPath = REPORT,
	liveMode = RUN_LIVE,
	modelPath = MODEL,
} = {}) {
	const findings = [];
	let assembly = null;
	let contract = null;
	let snap = null;
	let modelForTransform = null;
	if (!existsSync(assemblyPath)) hard(findings, 'LL0-assembly-file', 'project_assembly.json is required before label layout audit', { path: assemblyPath });
	if (!existsSync(contractPath)) hard(findings, 'LL0-contract-file', 'project_contract.json is required before label layout audit', { path: contractPath });
	if (!existsSync(sourcePath)) hard(findings, 'LL0-source-file', `${liveMode ? 'live.json' : 'full_model.json'} is required before label layout audit`, { path: sourcePath });
	if (liveMode && existsSync(modelPath)) {
		try { modelForTransform = readJson(modelPath); } catch {}
	}
	if (!findings.length) {
		try { assembly = readJson(assemblyPath); } catch (e) { hard(findings, 'LL0-assembly-parse', 'project_assembly.json must parse as JSON', { error: e.message }); }
		try { contract = readJson(contractPath); } catch (e) { hard(findings, 'LL0-contract-parse', 'project_contract.json must parse as JSON', { error: e.message }); }
		try { snap = readJson(sourcePath); } catch (e) { hard(findings, 'LL0-source-parse', `${SOURCE_LABEL} must parse as JSON`, { error: e.message }); }
	}
	let audit = { findings: [], stats: null, labels: [], columns: [] };
	if (assembly && snap) {
		audit = validateLabelLayout({ assembly, contract, snap, modelForTransform, liveMode });
		findings.push(...audit.findings);
	}
	attributeLabelModules(findings, netModulesFrom(assembly));
	attachLabelSuggest(findings, assembly?.circuitPack || 'aihwdebugger');
	const report = {
		generatedAt: new Date().toISOString(),
		pass: findings.length === 0,
		severity: { hard: findings.length, soft: 0, info: 0 },
		projectId: assembly?.projectId || null,
		source: liveMode ? 'live.json' : 'full_model.json',
		stats: audit.stats,
		labels: audit.labels,
		columns: audit.columns,
		findings,
	};
	writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
	return report;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
	const report = runProjectLabelLayoutGate();
	console.log(`project label layout ${report.pass ? 'PASS' : 'FAIL'} source=${report.source} hard=${report.severity.hard}`);
	console.log(`report -> ${REPORT}`);
	process.exit(report.pass ? 0 : 1);
}
