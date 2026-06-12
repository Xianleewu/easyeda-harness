// EDA 器件变换约定（经 R2/rot270、R4/rot90 实例标定）
// world = origin + R(rot) * (mirror ? (-lx,ly) : (lx,ly))
const R = {
	0: (x, y) => [x, y],
	90: (x, y) => [-y, x],
	270: (x, y) => [y, -x],
	180: (x, y) => [-x, -y],
};
const Rinv = { 0: R[0], 90: R[270], 270: R[90], 180: R[180] };
const norm = r => ((Math.round(r / 90) * 90) % 360 + 360) % 360;

// 由当前 world 引脚反推本地偏移
export function toLocal(world, origin, rot, mirror) {
	const dx = world[0] - origin[0], dy = world[1] - origin[1];
	const [lx, ly] = Rinv[norm(rot)](dx, dy);
	return mirror ? [-lx, ly] : [lx, ly];
}
// 给定本地偏移 + 新朝向 -> 新 world
export function toWorld(local, origin, rot, mirror) {
	const [mx, my] = mirror ? [-local[0], local[1]] : [local[0], local[1]];
	const [rx, ry] = R[norm(rot)](mx, my);
	return [origin[0] + rx, origin[1] + ry];
}
// 给器件补充本地引脚偏移（基于当前朝向）
export function withLocalPins(c) {
	const pins = (c.pins || []).map(p => ({ ...p, local: toLocal([p.x, p.y], [c.x, c.y], c.rotation, c.mirror) }));
	let lminx = Infinity, lminy = Infinity, lmaxx = -Infinity, lmaxy = -Infinity;
	if (c.bbox) {
		// bbox 角点也转本地，用于重摆后估算包络
		for (const [cx, cy] of [[c.bbox.minX, c.bbox.minY], [c.bbox.maxX, c.bbox.maxY]]) {
			const [lx, ly] = toLocal([cx, cy], [c.x, c.y], c.rotation, c.mirror);
			lminx = Math.min(lminx, lx); lmaxx = Math.max(lmaxx, lx); lminy = Math.min(lminy, ly); lmaxy = Math.max(lmaxy, ly);
		}
	}
	return { ...c, pins, localBox: { minX: lminx, minY: lminy, maxX: lmaxx, maxY: lmaxy } };
}
