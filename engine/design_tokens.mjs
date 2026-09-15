// 设计 token 单一真源(冻结)。严标取文档 DR1-18;商用实测仅填 DR 未量化处。零特定电路内容。
// 铁律:能机械判的(geom/drc)绝不归 vision;tier3 仅整体视觉残余。值不发明、不放水。

export const TOKENS = [
	{ id: 'T-DRC',        category: '电气', desc: 'DRC 无 error/warn/info', value: { error: 0, warn: 0, info: 0 }, source: 'DR18', evidence: 'drc', tier: 1 },
	{ id: 'T-ORTHO',      category: '走线', desc: '导线全正交,零斜段',      value: { minPct: 100 }, source: 'DR1', evidence: 'geom', tier: 2 },
	{ id: 'T-NOCROSS',    category: '走线', desc: '异网/无名线不交叉不中段相接', value: { max: 0 }, source: 'DR2', evidence: 'geom', tier: 2 },
	{ id: 'T-NOTHRU',     category: '走线', desc: '线不穿件体/脚(穿文字/标签/符号名见 T-NOTHRU-TEXT)', value: { max: 0 }, source: 'DR3', evidence: 'geom', tier: 2 },
	{ id: 'T-NOTHRU-TEXT', category: '走线', desc: '导线不穿过文字内部(可见标注/sig net标签/电源地符号网名);*_MIDDLE 标签被导线穿中线即报', value: { max: 0 }, source: 'DR3+标签锚点校准', evidence: 'geom', tier: 2 },
	{ id: 'T-NOOVERLAP',  category: '几何', desc: '可见对象(含标号/阻值/flag/NC)互不重叠、不压本体', value: { max: 0 }, source: 'DR4/5', evidence: 'geom', tier: 2 },
	{ id: 'T-TEXT-OVERLAP', category: '文字', desc: '电源/地符号网名文字不与别的符号名/字形/标注/net标签/器件体相交(geomQC 只查字形、漏网名→对文字瞎)', value: { max: 0 }, source: 'DR4/5+符号文字占位校准', evidence: 'geom', tier: 2 },
	{ id: 'T-LABEL-CROWD', category: '标签', desc: '信号标签文字互不重叠、同列文字保持可读间隙且不被导线穿过', value: { max: 0, minTextGap: 2, xTol: 5 }, source: 'DR4/5/16+用户规则 2026-09-15', evidence: 'geom', tier: 2 },
	{ id: 'T-GRID',       category: '栅格', desc: '脚坐标落统一栅格',        value: { grid: 5, minPct: 100 }, source: 'DR隐含/商用实测', evidence: 'geom', tier: 2 },
	{ id: 'T-DENSITY',    category: '紧凑', desc: '器件最近邻 pitch 达商用密度(治稀疏散布)', value: { medMax: 65, minNN: 15 }, source: '商用参考板实测件中心medNN=60(min40/25%47),阈值取60+余量=65(提取真值非放水)', evidence: 'geom', tier: 2 },
	{ id: 'T-BODY-CLEARANCE', category: '摆放', desc: '无声明例外的器件体保持最小可读间距', value: { minGap: 10 }, source: 'DR22/用户规则 2026-09-14', evidence: 'geom', tier: 2 },
	{ id: 'T-PAGE', category: '图页', desc: '内容位于可用图页、避开信息栏；宽松多模块图的网格占用重心落在可用区中心带', value: { clearance: 10, balance: { cols: 4, rows: 3, looseFillMax: 0.55, maxCentroidOffsetRatio: 0.08, minModules: 2, grid: 5 } }, source: 'DR19/用户规则 2026-09-15', evidence: 'geom', tier: 2 },
	{ id: 'T-MODULE-SPACING', category: '模块', desc: '模块内容框不拥挤、不孤立且框内留白明确', value: { minGap: 60, maxNearestGap: 180, minInnerPadding: 8 }, source: 'DR21/用户规则 2026-09-14', evidence: 'geom', tier: 2 },
	{ id: 'T-CELL-SPACING', category: '模块', desc: '模块内部功能子区块按关系留白，非直接关系不得拥挤', value: { minGap: 40, unrelatedGap: 60, minInnerPadding: 8 }, source: 'DR26/用户规则 2026-09-14', evidence: 'geom', tier: 2 },
	{ id: 'T-CONN-MOUNT', category: '电气', desc: '连接器屏蔽/固定焊盘逐脚接入声明地或有显式隔离例外', value: { requireGround: true }, source: 'DR24/用户规则 2026-09-14', evidence: 'geom', tier: 2 },
	{ id: 'T-PIN-SEMANTICS', category: '电气', desc: '每个连接器逐针核对符号针名、权威网表和已验证接口定义', value: { coveragePct: 100 }, source: 'DR28/商业连接器审计', evidence: 'netlist', tier: 2 },
	{ id: 'T-HIGHSPEED', category: '高速', desc: '差分网络逐对声明协议、阻抗、偏斜和两端针脚，且覆盖权威网表中的全部差分对', value: { coveragePct: 100 }, source: 'DR29/高速接口审计', evidence: 'netlist', tier: 2 },
	{ id: 'T-ANNOT-PLACE',category: '标注', desc: '标号+阻值在件外、同侧、错开堆叠', value: { outsidePct: 100, sameSideMinPct: 70 }, source: '商用实测/CR-10', evidence: 'geom', tier: 2 },
	{ id: 'T-ANNOT-SIDE', category: '标注', desc: '每个装配器件的位号与可见值/型号位于器件同一侧', value: { minPct: 100 }, source: 'DR23+用户规则 2026-09-15', evidence: 'geom', tier: 2 },
	{ id: 'T-ANNOT-FULL', category: '标注', desc: '所有装配器件同时显示位号和人类可读值/型号', value: { minPct: 100 }, source: 'DR23/用户规则 2026-09-14', evidence: 'geom', tier: 2 },
	{ id: 'T-ORPHAN', category: '模块', desc: '每个装配器件恰好归属一个模块和一个功能子区', value: { coveragePct: 100 }, source: 'DR21/26+用户规则 2026-09-15', evidence: 'geom', tier: 2 },
	{ id: 'T-LABEL-ALIGN', category: '标签', desc: '左/右扇出标签锚点=外缘下角、文字朝电路展开、坐短桩上方；左LEFT_BOTTOM、右RIGHT_BOTTOM、同侧外缘共列且行距可读', value: { xTol: 5, minPitch: 10 }, source: 'DR10/11/12/13/16+用户裁定 2026-09-15', evidence: 'geom', tier: 2 },
	{ id: 'T-FLAG-ALIGN', category: '符号', desc: '同一器件同侧的电源、地及网络端点符号共用视觉基线', value: { axisTolerance: 5 }, source: 'DR27/用户规则 2026-09-14', evidence: 'geom', tier: 2 },
	{ id: 'T-FLAG-ORIENT', category: '符号', desc: '电源/地符号朝向正确:去耦电容电源符号朝外(渲染向上/朝电源轨)、地符号朝下,不得反', value: { xTol: 10, yRange: 70 }, source: 'DR/商用实测', evidence: 'geom', tier: 2 },
	{ id: 'T-ADJACENCY', category: '摆放', desc: '无源件贴它服务的器件脚:距离≤角色阈值且【直连线】(同一wire连通分量),非仅net标签远连；live 审计缺权威网表即失败', value: { decap: 200, bulkCap: 300, pull: 110, interfaceTermination: 140 }, source: '商用参考板实测(去耦中位175/上拉中位68)+按器件角色分级', evidence: 'geom', tier: 2 },
	{ id: 'T-VISUAL',     category: '整体', desc: '整页视觉达商用残余 gestalt(几何量不到的整体专业度)', value: { ref: 'commercial' }, source: '商用实测+DR', evidence: 'vision', tier: 3 },
];

export function tokenById(id) {
	return TOKENS.find(t => t.id === id);
}
