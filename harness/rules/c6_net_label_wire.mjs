// C6 named-wire net labels: vertical labels and overlong visible stubs.
import { wireLabelQCFromLiveSnap } from '../../engine/wire_label_qc.mjs';

export function c6NetLabelWire(m) {
	const hasSigAnchors = (m.netflags || []).some(f => f.kind === 'sig')
		|| (m.netports || []).length
		|| (m.netlabels || []).length;

	if ((m.rawWires || []).length && !hasSigAnchors) return [];

	const wires = (m.rawWires || []).map(w => ({ id: w.id, net: w.net || '', line: w.line || [] }));
	return wireLabelQCFromLiveSnap({
		wires,
		components: m.parts || m.components || [],
		netflags: [
			...(m.netflags || []),
			...(m.netports || []),
			...(m.netlabels || []),
		],
		assumeVisibleWireNetNames: false,
	});
}
