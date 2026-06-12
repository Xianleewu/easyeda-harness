import { auditDocumentStyle } from '../document_style.mjs';

export function c20DocumentStyle(m) {
	if (!m.rectangles?.length && m.project) return [];
	return auditDocumentStyle(m, { requireModuleFrames: m.writeModuleFrames === true }).findings;
}
