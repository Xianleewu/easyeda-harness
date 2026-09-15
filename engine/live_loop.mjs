/* 薄真闭环:preflight 守门→备份→deliver→观测(judge)→可还原。安全第一(记忆 never-deliver-demo-to-user-board)。
	deps 注入(便于测/换实现):{ readSnapshot, deliver, observe, writeBackup, restore }。*/

export function preflightGuard(opts = {}) {
	if (!opts.confirmOverwrite) throw new Error('live_loop: 拒绝投递——需 confirmOverwrite(防误投毁板)');
}

function restoreFingerprint(snapshot = {}) {
	const pick = (items, map) => (items || []).map(map).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
	return JSON.stringify({
		components:pick(snapshot.components,c=>[c.id||'',c.designator||'',c.x??null,c.y??null,c.rotation??0,!!c.mirror]),
		wires:pick(snapshot.wires,w=>[w.net||'',w.line||[]]),
		netflags:pick(snapshot.netflags,f=>[f.id||'',f.net||'',f.x??null,f.y??null,f.rotation??0]),
	});
}

export async function runLoop(model, deps, opts = {}) {
	preflightGuard(opts);
	const snap = await deps.readSnapshot();               /* 投递前完整快照 */
	const backupPath = deps.writeBackup(snap);            /* 必在 deliver 之前 */
	await deps.deliver(model);
	const observed = await deps.observe();                /* runLiveJudge:真几何+DRC+截图 */
	const rejected = observed?.conform !== true || observed?.coverage?.complete === false || !observed?.shots?.length;
	if ((rejected || opts.restore) && deps.restore) {
		await deps.restore(snap);
		const after = await deps.readSnapshot();
		const ok = deps.verifyRestore ? await deps.verifyRestore(snap,after) : restoreFingerprint(after)===restoreFingerprint(snap);
		if (!ok) throw new Error(`live_loop: 还原校验不过!板可能被改,备份在 ${backupPath}`);
	}
	if (rejected) {
		if (!deps.restore) throw new Error(`live_loop: 商业化门禁未通过且没有可用还原器,备份在 ${backupPath}`);
		throw new Error(`live_loop: 商业化门禁未通过,已自动还原,备份在 ${backupPath}`);
	}
	return { backupPath, observed };
}
