// 设计 token 单一真源(冻结)。严标取文档 DR1-18;商用实测仅填 DR 未量化处。零特定电路内容。
// 铁律:能机械判的(geom/drc)绝不归 vision;tier3 仅整体视觉残余。值不发明、不放水。

export const TOKENS = [
	{ id: 'T-DRC',        category: '电气', desc: 'DRC 无 error/warn/info', value: { error: 0, warn: 0, info: 0 }, source: 'DR18', evidence: 'drc', tier: 1 },
	{ id: 'T-ORTHO',      category: '走线', desc: '导线全正交,零斜段',      value: { minPct: 100 }, source: 'DR1', evidence: 'geom', tier: 2 },
	{ id: 'T-NOCROSS',    category: '走线', desc: '异网/无名线不交叉不中段相接', value: { max: 0 }, source: 'DR2', evidence: 'geom', tier: 2 },
	{ id: 'T-NOTHRU',     category: '走线', desc: '线不穿件体/符号/文字/标签/flag/NC', value: { max: 0 }, source: 'DR3', evidence: 'geom', tier: 2 },
	{ id: 'T-NOOVERLAP',  category: '几何', desc: '可见对象(含标号/阻值/flag/NC)互不重叠、不压本体', value: { max: 0 }, source: 'DR4/5', evidence: 'geom', tier: 2 },
	{ id: 'T-GRID',       category: '栅格', desc: '脚坐标落统一栅格',        value: { grid: 5, minPct: 100 }, source: 'DR隐含/商用实测', evidence: 'geom', tier: 2 },
	{ id: 'T-DENSITY',    category: '紧凑', desc: '器件最近邻 pitch 达商用密度(治稀疏散布)', value: { medMax: 50, minNN: 15 }, source: '商用实测', evidence: 'geom', tier: 2 },
	{ id: 'T-ANNOT-PLACE',category: '标注', desc: '标号+阻值在件外、同侧、错开堆叠', value: { outsidePct: 100, sameSideMinPct: 70 }, source: '商用实测/CR-10', evidence: 'geom', tier: 2 },
	{ id: 'T-ANNOT-FULL', category: '标注', desc: '无源件带值标注(读属性机械判)', value: { minPct: 90 }, source: '商用实测/CR-09', evidence: 'geom', tier: 2 },
	{ id: 'T-LABEL-ALIGN', category: '标签', desc: '同侧扇出标签:左alignMode6/右8、同侧共列x、行距可读不糊', value: { xTol: 5, minPitch: 10 }, source: 'DR11/12/13/16', evidence: 'geom', tier: 2 },
	{ id: 'T-VISUAL',     category: '整体', desc: '整页视觉达商用残余 gestalt(几何量不到的整体专业度)', value: { ref: 'commercial' }, source: '商用实测+DR', evidence: 'vision', tier: 3 },
];

export function tokenById(id) {
	return TOKENS.find(t => t.id === id);
}
