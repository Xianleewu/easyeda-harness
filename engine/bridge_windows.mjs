// 可复用多窗口桥工具:窗口枚举/定向/激活/截图/读几何 + 区域计算。
// 操作配方见记忆 eda-api-capability-map。零特定电路内容。
import { findBridge, listEdaWindows, executeCode } from './bridge_client.mjs';

// 纯函数:由 parts 的 bbox 算紧窗(已排除大图框——调用方只传 parts)。
export function regionFromParts(parts, { aspect = 2017 / 1081, pad = 160 } = {}) {
	const bx = (parts || []).map(p => p.bbox).filter(Boolean);
	if (!bx.length) return null;
	const minX = Math.min(...bx.map(b => b.minX)), maxX = Math.max(...bx.map(b => b.maxX));
	const minY = Math.min(...bx.map(b => b.minY)), maxY = Math.max(...bx.map(b => b.maxY));
	const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
	let w = (maxX - minX) + 2 * pad, h = (maxY - minY) + 2 * pad;
	if (w / h > aspect) h = w / aspect; else w = h * aspect;
	return { left: cx - w / 2, right: cx + w / 2, top: cy + h / 2, bottom: cy - h / 2 };
}
