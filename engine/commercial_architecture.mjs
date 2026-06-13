import { readFileSync, writeFileSync } from 'node:fs';
import { buildModel, rectsGap, round2 } from '../harness/model.mjs';
import { activePartToModuleMap, loadProjectModuleRegistry } from '../harness/module_registry.mjs';
import { INTERFACE_CONTRACTS, interfaceContractByNet } from './interface_contract.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const DEFAULT_OUT = DIR + 'commercial_architecture_report.json';

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function boxOf(parts, refs, margin = 12) {
	const hit = refs.map(r => parts.get(r)).filter(Boolean);
	if (!hit.length) return null;
	const boxes = hit.map(p => p.bodyBBox || p.bbox);
	return {
		minX: Math.min(...boxes.map(b => b.minX)) - margin,
		maxX: Math.max(...boxes.map(b => b.maxX)) + margin,
		minY: Math.min(...boxes.map(b => b.minY)) - margin,
		maxY: Math.max(...boxes.map(b => b.maxY)) + margin,
	};
}

function center(box) {
	return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

function union(boxes) {
	return {
		minX: Math.min(...boxes.map(b => b.minX)),
		maxX: Math.max(...boxes.map(b => b.maxX)),
		minY: Math.min(...boxes.map(b => b.minY)),
		maxY: Math.max(...boxes.map(b => b.maxY)),
	};
}

function boxArea(box) {
	return (box.maxX - box.minX) * (box.maxY - box.minY);
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'commercial-architecture', msg, where });
}

function groupModules(group, partModule) {
	const mods = new Set();
	for (const pin of group.pins || []) {
		const mod = partModule.get(pin.designator);
		if (mod) mods.add(mod);
	}
	return [...mods].sort();
}

function netModuleIslands(model, partModule) {
	const byNet = new Map();
	for (const group of model.groups || []) {
		const nets = [...new Set((group.segs || []).map(s => s.net).filter(Boolean))];
		const modules = groupModules(group, partModule);
		for (const net of nets) {
			if (!byNet.has(net)) byNet.set(net, []);
			byNet.get(net).push({
				net,
				modules,
				pins: (group.pins || []).map(p => `${p.designator}.${p.pinName}`),
				totalLen: group.totalLen,
				segments: group.segs.length,
			});
		}
	}
	return byNet;
}

function rectGapToPoint(box, x, y) {
	const dx = Math.max(box.minX - x, 0, x - box.maxX);
	const dy = Math.max(box.minY - y, 0, y - box.maxY);
	return Math.hypot(dx, dy);
}

function nearestModuleName(flag, modules) {
	let best = null;
	for (const mod of modules) {
		const gap = rectGapToPoint(mod.box, flag.x, flag.y);
		if (!best || gap < best.gap) best = { name: mod.name, gap };
	}
	return best && best.gap <= 190 ? best.name : null;
}

function flagColumns(flags, tolerance = 8) {
	const columns = [];
	for (const f of [...flags].sort((a, b) => a.x - b.x)) {
		const hit = columns.find(c => Math.abs(c.x - f.x) <= tolerance);
		if (hit) {
			hit.flags.push(f);
			hit.x = hit.flags.reduce((sum, x) => sum + x.x, 0) / hit.flags.length;
		} else {
			columns.push({ x: f.x, flags: [f] });
		}
	}
	return columns;
}

function segTouchesFlag(seg, flag, eps = 0.6) {
	return (Math.abs(seg.x1 - flag.x) <= eps && Math.abs(seg.y1 - flag.y) <= eps)
		|| (Math.abs(seg.x2 - flag.x) <= eps && Math.abs(seg.y2 - flag.y) <= eps);
}

function connectedFlagOwner(model, flag, partModule) {
	for (const group of model.groups || []) {
		if (!(group.segs || []).some(seg => seg.net === flag.net && segTouchesFlag(seg, flag))) continue;
		const owners = [...new Set((group.pins || []).map(pin => partModule.get(pin.designator)).filter(Boolean))];
		if (owners.length === 1) return owners[0];
	}
	return null;
}

function groupOwners(group, partModule) {
	return [...new Set((group.pins || []).map(pin => partModule.get(pin.designator)).filter(Boolean))];
}

function pseudoFlagFromIsland(island, owner) {
	const segs = (island.segs || []).filter(s => s.net === island.net);
	const horiz = segs.filter(s => Math.abs(s.y1 - s.y2) < 1e-6)
		.sort((a, b) => b.len - a.len)[0] || segs[0];
	if (!horiz) return null;
	let x = horiz.x1;
	let y = horiz.y1;
	const rot = horiz.x1 <= horiz.x2 ? 180 : 0;
	if (rot === 180) x = Math.min(horiz.x1, horiz.x2);
	else x = Math.max(horiz.x1, horiz.x2);
	return { net: island.net, x, y, rot, rotation: rot, owner, source: 'wire-island' };
}

function contractEndpointFlags(model, contract, modules, partModule) {
	const explicit = (model.netflags || []).filter(f => f.net === contract.net && (f.kind || 'sig') === 'sig')
		.map(f => ({ ...f, owner: flagOwner(model, f, modules, partModule), source: 'netflag' }))
		.filter(f => f.owner === contract.from || f.owner === contract.to);
	if (explicit.length) return explicit;
	const out = [];
	for (const group of model.groups || []) {
		if (!(group.segs || []).some(s => s.net === contract.net)) continue;
		const owners = groupOwners(group, partModule).filter(o => o === contract.from || o === contract.to);
		if (owners.length !== 1) continue;
		const flag = pseudoFlagFromIsland({ net: contract.net, segs: group.segs }, owners[0]);
		if (flag) out.push(flag);
	}
	return out;
}

function flagOwner(model, flag, modules, partModule) {
	return connectedFlagOwner(model, flag, partModule) || nearestModuleName(flag, modules);
}

function groupedContract(model, contract, modules, partModule) {
	if (!contract || (contract.allowed !== 'visible-or-grouped-contract' && contract.allowed !== 'paired-grouped-contract')) return null;
	const flags = contractEndpointFlags(model, contract, modules, partModule);
	const endpointFlags = flags.filter(f => f.owner === contract.from || f.owner === contract.to);
	const fromFlags = endpointFlags.filter(f => f.owner === contract.from);
	const toFlags = endpointFlags.filter(f => f.owner === contract.to);
	if (!fromFlags.length || !toFlags.length) return null;
	const cols = flagColumns(endpointFlags);
	if (cols.length > 2) return null;
	return {
		net: contract.net,
		from: contract.from,
		to: contract.to,
		mode: contract.mode,
		flags: endpointFlags.map(f => ({ net: f.net, x: f.x, y: f.y, rot: f.rotation ?? f.rot ?? 0, owner: f.owner })),
		columns: cols.map(c => ({ x: round2(c.x), count: c.flags.length })),
	};
}

function pairKey(contract) {
	return contract?.pair || null;
}

function pairedGroupedContracts(model, contracts, modules, partModule) {
	const byPair = new Map();
	for (const contract of contracts.values()) {
		if (contract.allowed !== 'paired-grouped-contract' || !pairKey(contract)) continue;
		if (!byPair.has(pairKey(contract))) byPair.set(pairKey(contract), []);
		byPair.get(pairKey(contract)).push(contract);
	}
	const out = new Map();
	for (const [pair, items] of byPair) {
		const endpoints = new Set(items.flatMap(c => [c.from, c.to]));
		if (items.length < 2 || endpoints.size !== 2) continue;
		const pairFlags = [];
		let ok = true;
		for (const contract of items) {
			const grouped = groupedContract(model, contract, modules, partModule);
			if (!grouped) {
				ok = false;
				break;
			}
			pairFlags.push(...grouped.flags.map(f => ({ ...f, net: contract.net })));
		}
		if (!ok) continue;
		const owners = [...endpoints];
		const ownerGroups = owners.map(owner => pairFlags.filter(f => f.owner === owner));
		if (ownerGroups.some(g => g.length !== items.length)) continue;
		const ownerSummaries = ownerGroups.map(flags => {
			const xs = flags.map(f => f.x);
			const ys = flags.map(f => f.y);
			const rots = new Set(flags.map(f => f.rot));
			const nets = new Set(flags.map(f => f.net));
			return {
				owner: flags[0]?.owner,
				xSpread: Math.max(...xs) - Math.min(...xs),
				ySpread: Math.max(...ys) - Math.min(...ys),
				rots: [...rots],
				nets: [...nets].sort(),
				flags: flags.map(f => ({ net: f.net, x: f.x, y: f.y, rot: f.rot })),
			};
		});
		const sameDirection = ownerSummaries.every(s => s.rots.length === 1);
		const closePair = ownerSummaries.every(s => Math.min(s.xSpread, s.ySpread) <= 95 && Math.max(s.xSpread, s.ySpread) <= 140);
		if (!sameDirection || !closePair) continue;
		const result = {
			pair,
			mode: items[0].mode,
			nets: items.map(c => c.net).sort(),
			from: items[0].from,
			to: items[0].to,
			endpoints: ownerSummaries,
		};
		for (const item of items) out.set(item.net, result);
	}
	return out;
}

export function auditCommercialArchitecture(snap, opts = {}) {
	const model = buildModel(snap);
	const registry = loadProjectModuleRegistry();
	const isBundledAihwdebugger = registry.assembly?.circuitPack === 'aihwdebugger' || registry.assembly?.projectId === 'easyeda-harness-default';
	const findings = [];
	const parts = new Map(model.parts.map(p => [p.designator, p]));
	const partModule = activePartToModuleMap();
	const modules = registry.modules.map(mod => ({ ...mod, box: boxOf(parts, mod.refs) })).filter(m => m.box);
	const byName = Object.fromEntries(modules.map(m => [m.name, m]));

	const interfaceNets = opts.interfaceNets || (isBundledAihwdebugger ? INTERFACE_CONTRACTS.map(x => x.net) : []);
	const contracts = isBundledAihwdebugger ? interfaceContractByNet() : new Map();
	const pairedContracts = pairedGroupedContracts(model, contracts, modules, partModule);
	const islandsByNet = netModuleIslands(model, partModule);
	const labelOnlyInterfaces = [];
	const groupedContracts = [];
	const pairedGrouped = [];
	const visibleRequiredFailures = [];
	const contractRequiredFailures = [];
	for (const net of interfaceNets) {
		const islands = (islandsByNet.get(net) || []).filter(x => x.modules.length);
		const touchedModules = new Set(islands.flatMap(x => x.modules));
		const hasPhysicalBridge = islands.some(x => x.modules.length >= 2);
		if (touchedModules.size >= 2 && !hasPhysicalBridge) {
			const contract = contracts.get(net) || null;
			const item = { net, modules: [...touchedModules].sort(), contract, islands };
			labelOnlyInterfaces.push(item);
			if (contract?.allowed === 'visible') visibleRequiredFailures.push(item);
			else if (contract?.allowed === 'paired-grouped-contract') {
				const paired = pairedContracts.get(net);
				if (paired) {
					if (!pairedGrouped.some(x => x.pair === paired.pair)) pairedGrouped.push(paired);
				} else contractRequiredFailures.push(item);
			}
			else {
				const grouped = groupedContract(model, contract, modules, partModule);
				if (grouped) groupedContracts.push(grouped);
				else contractRequiredFailures.push(item);
			}
		}
	}
	const maxLabelOnlyInterfaces = opts.maxLabelOnlyInterfaces ?? 3;
	if (visibleRequiredFailures.length > 0) {
		hard(findings, 'A4-visible-interface-required',
			`High-signal interfaces require visible continuity: ${visibleRequiredFailures.map(x => x.net).join(', ')}`,
			{ interfaces: visibleRequiredFailures });
	}
	if (contractRequiredFailures.length > maxLabelOnlyInterfaces) {
		hard(findings, 'A1-label-only-interfaces',
			`Too many cross-module interfaces are label-only islands without a grouped contract: ${contractRequiredFailures.length} > ${maxLabelOnlyInterfaces}`,
			{ labelOnlyInterfaces: contractRequiredFailures, max: maxLabelOnlyInterfaces });
	}

	if (isBundledAihwdebugger && byName.usb && byName.ldo) {
		const usb = center(byName.usb.box);
		const ldo = center(byName.ldo.box);
		const spread = Math.abs(usb.y - ldo.y);
		const max = opts.maxInputPowerYSpread ?? 260;
		if (spread > max) {
			hard(findings, 'A2-input-power-islands',
				`USB input and LDO power cell are split into detached vertical islands: ${round2(spread)} > ${max}`,
				{ usb: byName.usb.box, ldo: byName.ldo.box, spread: round2(spread), max });
		}
	}

	const outputModules = [byName.pmos, byName.relay1, byName.relay2].filter(Boolean);
	if (isBundledAihwdebugger && outputModules.length === 3) {
		const outBox = union(outputModules.map(m => m.box));
		const width = outBox.maxX - outBox.minX;
		const height = outBox.maxY - outBox.minY;
		const area = boxArea(outBox);
		const maxArea = opts.maxOutputBandArea ?? 380000;
		const maxHeight = opts.maxOutputBandHeight ?? 650;
		if (area > maxArea || height > maxHeight) {
			hard(findings, 'A3-output-band-sprawl',
				`Output modules do not read as one compact output band: area=${round2(area)} height=${round2(height)}`,
				{ outputBand: outBox, width: round2(width), height: round2(height), area: round2(area), maxArea, maxHeight });
		}
	}

	const sortedGaps = [];
	for (let i = 0; i < modules.length; i++) {
		for (let j = i + 1; j < modules.length; j++) {
			sortedGaps.push({ a: modules[i].name, b: modules[j].name, gap: rectsGap(modules[i].box, modules[j].box) });
		}
	}
	sortedGaps.sort((a, b) => a.gap - b.gap);
	const severity = {
		hard: findings.filter(f => f.severity === 'hard').length,
		soft: 0,
		info: 0,
	};
	return {
		generatedAt: new Date().toISOString(),
		pass: severity.hard === 0 && severity.soft === 0 && severity.info === 0,
		severity,
		stats: {
			moduleRegistry: {
				source: registry.source,
				modules: registry.modules.length,
				mode: isBundledAihwdebugger ? 'aihwdebugger-rules' : 'generic-project-rules',
			},
			modules: modules.length,
			labelOnlyInterfaces: labelOnlyInterfaces.length,
			groupedContracts: groupedContracts.length,
			pairedGroupedContracts: pairedGrouped.length,
			ungroupedContractInterfaces: contractRequiredFailures.length,
			moduleGaps: sortedGaps.slice(0, 8),
		},
		metrics: {
			labelOnlyInterfaces,
			groupedContracts,
			pairedGroupedContracts: pairedGrouped,
			moduleBoxes: modules.map(m => ({ name: m.name, role: m.role, box: m.box })),
		},
		findings,
	};
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
	const snapPath = process.argv[2] || 'full_model.json';
	const outPath = process.argv[3] || DEFAULT_OUT;
	const report = auditCommercialArchitecture(readJson(snapPath));
	writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
	console.log(`commercial architecture -> ${outPath}`);
	console.log(`labelOnly=${report.stats.labelOnlyInterfaces} pass=${report.pass}`);
	if (report.findings.length) {
		for (const f of report.findings.slice(0, 12)) console.log(`  [${f.severity}] ${f.rule}: ${f.msg}`);
	}
	process.exit(report.pass ? 0 : 1);
}
