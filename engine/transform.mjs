// EDA 器件变换约定（2026-06-22 实测全 8 帧标定:R1 在 rot{0,90,180,270}×mirror{0,1},getAllPinsByPrimitiveId 读真值）
//   无镜像:world = origin + Rccw(rot) * (lx,ly)
//   镜像  :world = origin + Rccw(360-rot) * (-lx, ly)   ← 镜像翻 X 后【CW 旋转】(镜像反转旋转方向,几何正确)
// 早先只按非镜像实例标定 → 镜像件脚位算错(CCW 而非 CW)→ deliver 后镜像件连线全错位丢连。与 eda_transform.mjs 一致。
const R = {
	0: (x, y) => [x, y],
	90: (x, y) => [-y, x],
	270: (x, y) => [y, -x],
	180: (x, y) => [-x, -y],
};
const Rinv = { 0: R[0], 90: R[270], 270: R[90], 180: R[180] };
const norm = r => ((Math.round((r || 0) / 90) * 90) % 360 + 360) % 360;   // r||0 防御:缺/NaN rotation→0(无旋转即0,免 Rinv[NaN] 崩)

// 镜像时有效旋转 = 360-rot(CW),否则 = rot(CCW)。实测标定。
const effRot = (rot, mirror) => mirror ? norm(360 - norm(rot)) : norm(rot);
// 由当前 world 引脚反推本地偏移(toWorld 的逆:先去旋转 effRot 再去翻 X)
export function toLocal(world, origin, rot, mirror) {
	const dx = world[0] - origin[0], dy = world[1] - origin[1];
	const [lx, ly] = Rinv[effRot(rot, mirror)](dx, dy);
	return mirror ? [-lx, ly] : [lx, ly];
}
// 给定本地偏移 + 新朝向 -> 新 world(先翻 X 再按 effRot 旋转)
export function toWorld(local, origin, rot, mirror) {
	const [mx, my] = mirror ? [-local[0], local[1]] : [local[0], local[1]];
	const [rx, ry] = R[effRot(rot, mirror)](mx, my);
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
	// localBox 必须包络引脚:有些器件符号的引脚端点伸出体框外(声明 bbox 不含脚)。仅用 bbox 角点会
	// 漏掉伸出脚 → 按 localBox 留间隙的堆叠/对齐(multipart)算少真实占位,邻件脚穿入本件体
	// (wireThruComp)。把引脚本地坐标并入包络,任意输入都鲁棒;真实 bbox⊇脚的器件不受影响。
	for (const p of pins) {
		lminx = Math.min(lminx, p.local[0]); lmaxx = Math.max(lmaxx, p.local[0]);
		lminy = Math.min(lminy, p.local[1]); lmaxy = Math.max(lmaxy, p.local[1]);
	}
	return { ...c, pins, localBox: { minX: lminx, minY: lminy, maxX: lmaxx, maxY: lmaxy } };
}
