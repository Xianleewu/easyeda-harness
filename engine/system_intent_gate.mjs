import { readFileSync, writeFileSync } from 'node:fs';
import { buildModel, round2 } from '../harness/model.mjs';
import { loadProjectModuleRegistry } from '../harness/module_registry.mjs';
import { INTERFACE_CONTRACTS } from './interface_contract.mjs';
import { KEY_NET_CONTRACT, netContractReport } from './net_contract.mjs';
import { isBundledAihwdebuggerRegistry } from './project_mode.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const DEFAULT_OUT = DIR + 'system_intent_gate.json';

const EXTERNAL_CONNECTORS = ['J1', 'CN1', 'CN2', 'CN3', 'CN4'];
const POWER_TREE = [
	{ from: 'SYS_5V', to: 'SYS_3V3', evidence: ['U2', 'C2', 'C4'] },
	{ from: 'VIN_12_19V', to: 'VOUT_SW', evidence: ['Q1', 'Q2', 'D1'] },
];
const BRINGUP_NETS = ['RESET_EN', 'BOOT_IO9', 'USB_DN', 'USB_DP'];
const OUTPUT_NETS = ['EXT_PWR_EN', 'RELAY1_EN', 'RELAY2_EN', 'VIN_12_19V', 'VOUT_SW', 'RLY1_COIL_A', 'RLY2_COIL_A'];

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'system-intent', msg, where });
}

function center(box) {
	return box && { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

function union(boxes) {
	const hit = boxes.filter(Boolean);
	if (!hit.length) return null;
	return {
		minX: Math.min(...hit.map(b => b.minX)),
		minY: Math.min(...hit.map(b => b.minY)),
		maxX: Math.max(...hit.map(b => b.maxX)),
		maxY: Math.max(...hit.map(b => b.maxY)),
	};
}

function boxOf(parts, refs, margin = 12) {
	const hit = refs.map(ref => parts.get(ref)).filter(Boolean);
	if (!hit.length) return null;
	return union(hit.map(p => p.bodyBBox || p.bbox).filter(Boolean).map(b => ({
		minX: b.minX - margin,
		minY: b.minY - margin,
		maxX: b.maxX + margin,
		maxY: b.maxY + margin,
	})));
}

function netNames(snap) {
	return new Set([
		...(snap.wires || []).map(w => w.net).filter(Boolean),
		...(snap.netflags || []).map(f => f.net).filter(Boolean),
		...(snap.netports || []).map(f => f.net).filter(Boolean),
		...(snap.netlabels || []).map(f => f.net).filter(Boolean),
	]);
}

function moduleMap(model) {
	const registry = loadProjectModuleRegistry();
	const parts = new Map(model.parts.map(p => [p.designator, p]));
	const modules = registry.modules.map(mod => ({ ...mod, box: boxOf(parts, mod.refs) })).filter(m => m.box);
	return {
		parts,
		modules,
		byName: Object.fromEntries(modules.map(m => [m.name, m])),
		registry,
	};
}

function textRoles(snap) {
	const roles = new Set();
	for (const t of snap.texts || []) {
		if (t.role) roles.add(t.role);
		const content = String(t.content || '');
		if (/AIHWDEBUGER|CONTROL|POWER/i.test(content)) roles.add('sheet-title');
		if (/DETAIL SCHEMATIC/i.test(content)) roles.add('title-block');
		if ((t.role === 'reading-flow' || /USB\/power\s*->\s*ESP32-C3\s*->\s*switched and relay outputs/i.test(content)) &&
			/->|USB\/power|ESP32|relay outputs/i.test(content)) roles.add('reading-flow');
		if (/DRC:\s*0 ERR\s*\/\s*0 WARN\s*\/\s*0 INFO/i.test(content)) roles.add('acceptance-note');
	}
	return roles;
}

function flagKind(flag) {
	if (flag.kind) return flag.kind;
	if (flag.type === 'netport' || flag.type === 'netlabel') return 'sig';
	const symbol = String(flag.symbol || '').toLowerCase();
	if (symbol.includes('ground') || flag.net === 'GND') return 'gnd';
	if (symbol.includes('power')) return 'power';
	return 'sig';
}

function netFlagLikeItems(snap) {
	return [
		...(snap.netflags || []),
		...(snap.netports || []),
		...(snap.netlabels || []),
	];
}

function countNetFlags(snap, kind, nets) {
	const set = new Set(nets);
	return netFlagLikeItems(snap).filter(f => (!kind || flagKind(f) === kind) && set.has(f.net)).length;
}

function missingNetFlags(snap, kind, nets) {
	const flags = new Set(netFlagLikeItems(snap).filter(f => !kind || flagKind(f) === kind).map(f => f.net));
	return nets.filter(net => !flags.has(net));
}

function namedWireCount(snap, net) {
	return (snap.wires || []).filter(w => w.net === net && Array.isArray(w.line) && w.line.length >= 4).length;
}

function namedWireStubCount(snap, net) {
	return (snap.wires || []).filter(w => {
		if (w.net !== net || !Array.isArray(w.line) || w.line.length < 4) return false;
		const xs = [];
		const ys = [];
		for (let i = 0; i + 1 < w.line.length; i += 2) {
			xs.push(w.line[i]);
			ys.push(w.line[i + 1]);
		}
		const width = Math.max(...xs) - Math.min(...xs);
		const height = Math.max(...ys) - Math.min(...ys);
		return Math.max(width, height) <= 160 && Math.min(width, height) <= 25;
	}).length;
}

function netExpressionCount(snap, net) {
	return netFlagLikeItems(snap).filter(f => flagKind(f) === 'sig' && f.net === net).length + namedWireCount(snap, net);
}

function missingNetExpressions(snap, nets) {
	return nets.filter(net => netExpressionCount(snap, net) === 0);
}

function bringupEntryCount(snap, net) {
	return netFlagLikeItems(snap).filter(f => flagKind(f) === 'sig' && f.net === net).length + namedWireStubCount(snap, net);
}

function moduleTitleCoverage(snap) {
	const registry = loadProjectModuleRegistry();
	const titleMap = new Map([
		['USB-C INPUT', 'usb'],
		['5V TO 3V3 POWER', 'ldo'],
		['RESET SUPPORT', 'btn1'],
		['BOOT SUPPORT', 'btn2'],
		['ESP32-C3 MCU', 'mcu'],
		['HIGH-SIDE POWER SWITCH', 'pmos'],
		['RELAY OUTPUT 1', 'relay1'],
		['RELAY OUTPUT 2', 'relay2'],
	]);
	const titles = new Set();
	for (const t of snap.texts || []) {
		if (t.role === 'module-title' && t.module) titles.add(t.module);
		const content = String(t.content || '').trim().toUpperCase();
		if (titleMap.has(content)) titles.add(titleMap.get(content));
	}
	return {
		count: titles.size,
		missing: registry.modules.map(m => m.name).filter(name => !titles.has(name)),
	};
}

function contractFlagCoverage(snap) {
	return INTERFACE_CONTRACTS.map(contract => {
		const flagCount = netExpressionCount(snap, contract.net);
		return {
			net: contract.net,
			from: contract.from,
			to: contract.to,
			mode: contract.mode,
			flagCount,
			pass: flagCount >= 1,
		};
	});
}

function netContractPinsByCategory() {
	const byNet = new Map(KEY_NET_CONTRACT.map(req => [req.net, req.pins]));
	return {
		power: ['SYS_5V', 'SYS_3V3', 'VIN_12_19V', 'VOUT_SW'].map(net => ({ net, pins: byNet.get(net) || [] })),
		bringup: BRINGUP_NETS.map(net => ({ net, pins: byNet.get(net) || [] })),
		output: OUTPUT_NETS.map(net => ({ net, pins: byNet.get(net) || [] })),
	};
}

export function auditSystemIntent(snap, opts = {}) {
	const model = buildModel(snap);
	const findings = [];
	const nets = netNames(snap);
	const { parts, modules, byName, registry } = moduleMap(model);
	const isBundledAihwdebugger = isBundledAihwdebuggerRegistry(registry);
	const contractChecks = isBundledAihwdebugger ? contractFlagCoverage(snap) : [];
	const netContract = isBundledAihwdebugger ? (opts.netContract || netContractReport(snap)) : { checks: [] };

	const titles = moduleTitleCoverage(snap);
	if (titles.missing.length) {
		hard(findings, 'SI2-module-title-coverage', 'every functional module needs a visible engineering title', { missingModules: titles.missing });
	}

	const missingExternal = isBundledAihwdebugger ? EXTERNAL_CONNECTORS.filter(ref => !parts.has(ref)) : [];
	if (isBundledAihwdebugger && missingExternal.length) {
		hard(findings, 'SI3-external-interface-coverage', 'external board interfaces must be explicit and auditable', { missingExternal });
	}

	for (const tree of isBundledAihwdebugger ? POWER_TREE : []) {
		const missingNets = [tree.from, tree.to].filter(net => !nets.has(net));
		const missingEvidence = tree.evidence.filter(ref => !parts.has(ref));
		if (missingNets.length || missingEvidence.length) {
			hard(findings, 'SI4-power-tree-expression', 'power tree must be visible as named rails plus local conversion/switch evidence', {
				tree,
				missingNets,
				missingEvidence,
			});
		}
	}

	const bringupFlags = isBundledAihwdebugger ? BRINGUP_NETS.reduce((sum, net) => sum + bringupEntryCount(snap, net), 0) : 0;
	const missingBringupFlags = isBundledAihwdebugger ? BRINGUP_NETS.filter(net => bringupEntryCount(snap, net) === 0) : [];
	if (isBundledAihwdebugger && missingBringupFlags.length) {
		hard(findings, 'SI5-bringup-entry-points', 'reset, boot, and USB bring-up nets must be one-glance auditable with signal labels', {
			bringupNets: BRINGUP_NETS,
			missingBringupFlags,
			signalFlags: bringupFlags,
			namedWireExpressions: BRINGUP_NETS.reduce((sum, net) => sum + namedWireCount(snap, net), 0),
			required: BRINGUP_NETS.length,
		});
	}

	const weakContracts = contractChecks.filter(x => !x.pass);
	if (weakContracts.length) {
		hard(findings, 'SI6-interface-contract-expression', 'cross-module interface contracts must be visually expressed with endpoint labels or visible continuity', {
			weakContracts,
		});
	}

	const cats = isBundledAihwdebugger ? netContractPinsByCategory() : {};
	const contractPass = new Map((netContract.checks || []).map(x => [x.net, x.pass]));
	for (const [category, entries] of Object.entries(cats)) {
		const failed = entries.filter(entry => contractPass.get(entry.net) !== true);
		if (failed.length) {
			hard(findings, 'SI7-key-net-contract-category', `key ${category} nets are not proven by the net contract gate`, { category, failed });
		}
	}

	const inputBox = union([byName.usb?.box, byName.ldo?.box]);
	const outputBox = union([byName.pmos?.box, byName.relay1?.box, byName.relay2?.box]);
	const flow = {
		input: center(inputBox),
		mcu: center(byName.mcu?.box),
		output: center(outputBox),
	};
	if (isBundledAihwdebugger && flow.input && flow.mcu && flow.output && !(flow.input.x < flow.mcu.x && flow.mcu.x < flow.output.x)) {
		hard(findings, 'SI8-system-reading-flow', 'system intent must read left-to-right from input/power to controller to switched outputs', flow);
	}

	const severity = { hard: findings.length, soft: 0, info: 0 };
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
			moduleTitles: titles.count,
			externalConnectors: isBundledAihwdebugger ? EXTERNAL_CONNECTORS.filter(ref => parts.has(ref)).length : null,
			contractChecks: contractChecks.length,
			contractEndpointFlags: contractChecks.reduce((sum, x) => sum + x.flagCount, 0),
			bringupFlags,
			flow: {
				inputX: flow.input ? round2(flow.input.x) : null,
				mcuX: flow.mcu ? round2(flow.mcu.x) : null,
				outputX: flow.output ? round2(flow.output.x) : null,
			},
		},
		checks: {
			moduleTitles: { missing: titles.missing },
			externalConnectors: isBundledAihwdebugger ? EXTERNAL_CONNECTORS.map(ref => ({ ref, pass: parts.has(ref) })) : [],
			powerTree: isBundledAihwdebugger ? POWER_TREE : [],
			interfaceContracts: contractChecks,
			netContractCategories: cats,
		},
		findings,
	};
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
	const snapPath = process.argv[2] || 'full_model.json';
	const outPath = process.argv[3] || DEFAULT_OUT;
	const report = auditSystemIntent(readJson(snapPath));
	writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
	console.log(`system intent ${report.pass ? 'OK' : 'FAIL'} hard=${report.severity.hard}`);
	process.exit(report.pass ? 0 : 1);
}
