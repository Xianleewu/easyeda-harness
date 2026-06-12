export function edaNetFlagRot(logicalRot) {
	return ((logicalRot % 360) + 360) % 360;
}

export function logicalNetFlagRot(edaRot) {
	return ((edaRot % 360) + 360) % 360;
}
