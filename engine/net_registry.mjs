// 规范网名表（规则书 §1 / §7 + 本工程单元命名约定）
import { existsSync, readFileSync } from 'node:fs';
import { buildNetlist } from './netlist.mjs';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const SNAP = process.env.EASYEDA_PART_LIB || DIR + 'snap2.json';
const PROJECT_NETLIST = process.env.EASYEDA_PROJECT_NETLIST || DIR + 'project_netlist.json';

/* 活动项目声明的网名（来自 project_netlist.json），用于让规范表/必需轨道按项目泛化。
 * 无项目网表时返回空集合，netNameQC 退回到硬编码的 AIHWDEBUGER 行为。 */
function projectDeclaredNets() {
	if (!existsSync(PROJECT_NETLIST)) return new Set();
	try {
		const netlist = JSON.parse(readFileSync(PROJECT_NETLIST, 'utf8').replace(/^﻿/, ''));
		return new Set((netlist.nets || []).map(n => n?.name).filter(Boolean));
	} catch {
		return new Set();
	}
}

/** 跨单元/对外网名（必须与原始电气网表语义一致或可规范化替代） */
export const EXTERNAL_NETS = [
	'GND', 'SYS_5V', 'SYS_3V3',
	'USB_CC1', 'USB_CC2', 'USB_DN', 'USB_DP',
	'RESET_EN', 'BOOT_IO9', 'EXT_PWR_EN',
	'RELAY1_EN', 'RELAY2_EN',
	'VIN_12_19V', 'VOUT_SW',
];

/** 单元内部网名（允许存在，不计为匿名网） */
export const INTERNAL_NETS = [
	'RLY1_GATE', 'RLY2_GATE', 'RLY1_COIL_A', 'RLY1_COIL_V', 'RLY2_COIL_A', 'RLY2_COIL_V',
	'Q2_GATE', 'Q1_GATE', 'PMOS_GATE', 'PGATE_PULL',
];

export const CANONICAL_NETS = new Set([...EXTERNAL_NETS, ...INTERNAL_NETS]);

export function isCanonicalNetName(name) {
	return CANONICAL_NETS.has(name) || /^NC_[A-Z0-9_]+$/.test(name);
}

export function loadNetRegistry() {
	const snap = JSON.parse(readFileSync(SNAP, 'utf8').replace(/^\uFEFF/, ''));
	const orig = buildNetlist(snap);
	const byName = new Map();
	for (const n of orig) {
		if (!n.name || /^N\$/.test(n.name)) continue;
		byName.set(n.name, n.pins.map(p => p.ref).sort());
	}
	return { names: [...byName.keys()].sort(), byName, canonical: CANONICAL_NETS };
}

export function netNameQC(model) {
	const issues = [];
	const projNets = projectDeclaredNets();
	const hasProject = projNets.size > 0;
	const used = new Set();
	for (const w of model.wires || []) {
		if (!w.net) continue;
		used.add(w.net);
	}
	for (const f of model.netflags || []) {
		if (f.net) used.add(f.net);
	}
	for (const name of used) {
		if (/^N\$/.test(name))
			issues.push({ rule: 'N1-anonymous-wire', severity: 'hard', net: name, msg: `导线使用匿名网 ${name}` });
		/* 规范网名 = 硬编码规范表 ∪ 活动项目声明的网名 */
		if (!isCanonicalNetName(name) && !projNets.has(name) && !/^N\$/.test(name))
			issues.push({ rule: 'N2-noncanonical', severity: 'hard', net: name, msg: `网名 ${name} 不在规范表，请改用 CANONICAL_NETS 或在 project_netlist.json 声明` });
		if (/[a-z]/.test(name) && name !== name.toUpperCase())
			issues.push({ rule: 'N3-case', severity: 'hard', net: name, msg: `网名 ${name} 应全大写+下划线` });
		if (/_CONN$/.test(name))
			issues.push({ rule: 'N4-conn-suffix', severity: 'hard', net: name, msg: `避免 ${name}，串阻两侧用同一信号网名 USB_DN/USB_DP` });
	}
	/* 必需轨道：无项目上下文时沿用硬编码 EXTERNAL_NETS（AIHWDEBUGER）；
	 * 有项目上下文时，只要求该项目实际声明的外部网名存在，避免把
	 * AIHWDEBUGER 专属轨道强加给其它项目。 */
	for (const req of EXTERNAL_NETS) {
		if (hasProject && !projNets.has(req)) continue;
		if (!used.has(req))
			issues.push({ rule: 'N5-missing-rail', severity: 'hard', net: req, msg: `缺少规范网名 ${req}` });
	}
	return issues;
}
