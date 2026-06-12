import { c1Layout } from './rules/c1_layout.mjs';
import { c2Overlap } from './rules/c2_overlap.mjs';
import { c3Orientation } from './rules/c3_orientation.mjs';
import { c4Wiring } from './rules/c4_wiring.mjs';
import { c5FlagLabel } from './rules/c5_flag_label.mjs';
import { c6NetLabelWire } from './rules/c6_net_label_wire.mjs';
import { c7ComponentState } from './rules/c7_component_state.mjs';
import { c8ModuleBoxes } from './rules/c8_module_boxes.mjs';
import { c9ReferenceQuality } from './rules/c9_reference_quality.mjs';
import { c10RequiredParts } from './rules/c10_required_parts.mjs';
import { c11NoConnectClearance } from './rules/c11_no_connect_clearance.mjs';
import { c12ReferenceStructure } from './rules/c12_reference_structure.mjs';
import { c13LibraryBinding } from './rules/c13_library_binding.mjs';
import { c14UsbSupport } from './rules/c14_usb_support.mjs';
import { c15PmosSupport } from './rules/c15_pmos_support.mjs';
import { c16RelaySupport } from './rules/c16_relay_support.mjs';
import { c17LdoDecoupling } from './rules/c17_ldo_decoupling.mjs';
import { c18ResetBootSupport } from './rules/c18_reset_boot_support.mjs';
import { c19McuInterfaceLane } from './rules/c19_mcu_interface_lane.mjs';
import { c20DocumentStyle } from './rules/c20_document_style.mjs';
import { c21VisibleTextClearance } from './rules/c21_visible_text_clearance.mjs';

export const HARNESS_RULES = [
	{ id: 'C1', title: 'layout grid and active area', basis: 'rulebook layout topology and grid policy', gate: ['harness'], fn: c1Layout },
	{ id: 'C2', title: 'overlap and crossing geometry', basis: 'reference readability: no overlaps, no wire through symbols', gate: ['harness'], fn: c2Overlap },
	{ id: 'C3', title: 'symbol orientation sanity', basis: 'reference readability: symbols face served connections', gate: ['harness'], fn: c3Orientation },
	{ id: 'C4', title: 'local wiring directness', basis: 'rulebook wiring strategy: no redundant doglegs or wandering local routes', gate: ['harness'], fn: c4Wiring },
	{ id: 'C5', title: 'flag and signal label placement', basis: 'reference net-label spacing and power/ground symbol policy', gate: ['harness'], fn: c5FlagLabel },
	{ id: 'C6', title: 'named-wire label geometry', basis: 'reference net-label rule: no vertical named bus and no overlong visible stub', gate: ['harness'], fn: c6NetLabelWire },
	{ id: 'C7', title: 'component state and visible attributes', basis: 'EasyEDA hidden state and DRC/BOM reliability', gate: ['harness', 'structure'], fn: c7ComponentState },
	{ id: 'C8', title: 'independent module boxes', basis: 'reference functional block boundaries and whitespace', gate: ['harness', 'structure'], fn: c8ModuleBoxes },
	{ id: 'C9', title: 'system-level reference quality', basis: 'reference signal flow, module columns, crossings, repeated blocks', gate: ['harness', 'structure'], fn: c9ReferenceQuality },
	{ id: 'C10', title: 'required project parts', basis: 'AIHWDEBUGER project contract', gate: ['harness', 'structure'], fn: c10RequiredParts },
	{ id: 'C11', title: 'NoConnected keepout', basis: 'EasyEDA visible NC marker geometry and user overlap failures', gate: ['harness', 'structure'], fn: c11NoConnectClearance },
	{ id: 'C12', title: 'repeated-cell structure', basis: 'reference repeated-channel isomorphism', gate: ['harness', 'structure'], fn: c12ReferenceStructure },
	{ id: 'C13', title: 'library binding integrity', basis: 'D3/D2 binding failure and EasyEDA hidden device state', gate: ['harness', 'structure'], fn: c13LibraryBinding },
	{ id: 'C14', title: 'USB-C support topology', basis: 'USB-C CC and D+/D- electrical/readability contract', gate: ['harness', 'structure'], fn: c14UsbSupport },
	{ id: 'C15', title: 'PMOS support topology', basis: 'high-side switch local support roles', gate: ['harness', 'structure'], fn: c15PmosSupport },
	{ id: 'C16', title: 'relay support topology', basis: 'relay low-side driver local role grammar', gate: ['harness', 'structure'], fn: c16RelaySupport },
	{ id: 'C17', title: 'LDO decoupling topology', basis: 'power-cell local decoupling and return path readability', gate: ['harness', 'structure'], fn: c17LdoDecoupling },
	{ id: 'C18', title: 'reset and boot support topology', basis: 'MCU support-cell pull-up/reset-cap grammar', gate: ['harness', 'structure'], fn: c18ResetBootSupport },
	{ id: 'C19', title: 'MCU interface lane', basis: 'reference MCU pin contract and aligned label lanes', gate: ['harness', 'structure'], fn: c19McuInterfaceLane },
	{ id: 'C20', title: 'document layer and functional titles', basis: 'reference PDFs use sheet frames, title blocks, module titles, and non-electrical document layers', gate: ['harness', 'structure'], fn: c20DocumentStyle },
	{ id: 'C21', title: 'visible text clearance', basis: 'EasyEDA rendered text, attributes, and wire names must not cover other readable elements', gate: ['harness', 'structure'], fn: c21VisibleTextClearance },
];

export const STRUCTURE_RULES = HARNESS_RULES.filter(rule => rule.gate.includes('structure'));

function assertRegisteredFindings(rule, findings, ids) {
	for (const f of findings || []) {
		const code = String(f.rule || '').match(/^C\d+/)?.[0];
		if (!code) continue;
		if (code !== rule.id || !ids.has(code)) {
			throw new Error(`Unregistered harness finding rule ${f.rule} emitted by ${rule.id}`);
		}
	}
}

export function runRules(model, rules = HARNESS_RULES) {
	const ids = new Set(rules.map(rule => rule.id));
	return rules.flatMap(rule => {
		const findings = rule.fn(model);
		assertRegisteredFindings(rule, findings, ids);
		return findings;
	});
}

export function ruleSummary(rules = HARNESS_RULES) {
	return rules.map(({ id, title, basis, gate }) => ({ id, title, basis, gate: [...gate] }));
}
