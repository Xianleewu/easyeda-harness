// EasyEDA 几何变换(实测精确,通用,零特定电路内容)。
// 这是【模型=EDA 数字孪生】的地基:给定器件放置 (x,y,rotation,mirror),引脚连接点【精确】落在哪。
// 严禁猜测——以下公式由实测推导(2026-06-22,R1 在 0/90/180/270/mirror 各帧读 getAllPinsByPrimitiveId):
//   旋转 = 逆时针(CCW),镜像 = 翻 X(绕原点的竖直轴)。引脚的【局部偏移】(相对器件原点、rot0/mir false)
//   经【先镜像后旋转】映射到全局。模型用本模块算脚位 → 与 EDA modify 后真实脚位 1:1 一致 → 投递不丢连。
//
//   import { placePin, localOffset, rotOffset } from './eda_transform.mjs';
//   const [gx, gy] = placePin(ldx, ldy, ox, oy, rotation, mirror);   // 局部偏移 → 全局连接点
//   const [ldx, ldy] = localOffset(gx, gy, ox, oy, rotation, mirror); // 全局连接点 → 局部偏移(逆)

// 偏移 (dx,dy) 绕原点 CCW 旋转 rot 度(实测:90→(-dy,dx),180→(-dx,-dy),270→(dy,-dx))。
export function rotOffset(dx, dy, rot) {
	const r = ((Math.round(rot / 90) * 90) % 360 + 360) % 360;
	const z = v => v + 0;   // 归一 -0 → 0(取负产生 -0,JS deepEqual/Object.is 视为不等)
	if (r === 90) return [z(-dy), z(dx)];
	if (r === 180) return [z(-dx), z(-dy)];
	if (r === 270) return [z(dy), z(-dx)];
	return [z(dx), z(dy)];
}

// 局部偏移 → 全局连接点(实测全 8 帧推导):
//   无镜像:绕原点 CCW 旋转 rot。
//   镜像  :先翻 X,再【CW】旋转 rot(= CCW 旋转 360-rot)——镜像反转旋转方向(几何上正确)。
// 统一:dx=镜像?-ldx:ldx;effRot=镜像?(360-rot):rot;result=CCW(dx,dy,effRot)。
export function placePin(ldx, ldy, ox, oy, rotation = 0, mirror = false) {
	const dx = mirror ? -ldx : ldx, dy = ldy;
	const effRot = mirror ? (360 - (rotation || 0)) : (rotation || 0);
	const [rx, ry] = rotOffset(dx, dy, effRot);
	return [ox + rx, oy + ry];
}

// 全局连接点 → 局部偏移(placePin 的逆):去 CCW(effRot)旋转,再去翻 X。
export function localOffset(gx, gy, ox, oy, rotation = 0, mirror = false) {
	const r = ((Math.round((rotation || 0) / 90) * 90) % 360 + 360) % 360;
	const effRot = mirror ? (360 - r) % 360 : r;
	const [ux, uy] = rotOffset(gx - ox, gy - oy, (360 - effRot) % 360);
	return mirror ? [-ux, uy] : [ux, uy];
}

// 把器件的【当前快照脚】解析成局部偏移(rot0/mir false 基准),供重排时按新放置精确重算脚位。
// 返回 [{ num, ldx, ldy }];器件 c 含 x,y,rotation,mirror,pins[{num,x,y}]。
export function pinLocalOffsets(c) {
	const ox = c.x, oy = c.y, rot = c.rotation || 0, mir = !!c.mirror;
	return (c.pins || []).filter(p => p.x != null).map(p => {
		const [ldx, ldy] = localOffset(p.x, p.y, ox, oy, rot, mir);
		return { num: p.num, ldx, ldy };
	});
}

/* 本地 bbox(rot0/mirror-false、相对原点)→ 全局 AABB。正交旋转+镜像保矩形轴对齐,
 * 故变换对角两角再取 min/max 即得 AABB(DR4/DR5 重叠按真实占位判的地基)。 */
export function placeBBox(localBBox, ox, oy, rotation = 0, mirror = false) {
	const a = placePin(localBBox.minX, localBBox.minY, ox, oy, rotation, mirror);
	const b = placePin(localBBox.maxX, localBBox.maxY, ox, oy, rotation, mirror);
	return { minX: Math.min(a[0], b[0]), minY: Math.min(a[1], b[1]), maxX: Math.max(a[0], b[0]), maxY: Math.max(a[1], b[1]) };
}

/* 全局 AABB → 本地 bbox(placeBBox 的逆;用 localOffset 反解对角两角)。 */
export function inverseBBox(globalBBox, ox, oy, rotation = 0, mirror = false) {
	const a = localOffset(globalBBox.minX, globalBBox.minY, ox, oy, rotation, mirror);
	const b = localOffset(globalBBox.maxX, globalBBox.maxY, ox, oy, rotation, mirror);
	return { minX: Math.min(a[0], b[0]), minY: Math.min(a[1], b[1]), maxX: Math.max(a[0], b[0]), maxY: Math.max(a[1], b[1]) };
}
