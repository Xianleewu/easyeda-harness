/* 薄真闭环:preflight 守门→备份→deliver→观测(judge)→可还原。安全第一(记忆 never-deliver-demo-to-user-board)。
	deps 注入(便于测/换实现):{ readSnapshot, deliver, observe, writeBackup, restore }。*/

export function preflightGuard(opts = {}) {
	if (!opts.confirmOverwrite) throw new Error('live_loop: 拒绝投递——需 confirmOverwrite(防误投毁板)');
}

export async function runLoop(model, deps, opts = {}) {
	preflightGuard(opts);
	const snap = await deps.readSnapshot();               /* 投递前完整快照 */
	const backupPath = deps.writeBackup(snap);            /* 必在 deliver 之前 */
	await deps.deliver(model);
	const observed = await deps.observe();                /* runLiveJudge:真几何+DRC+截图 */
	if (opts.restore && deps.restore) {
		await deps.restore(snap);
		const after = await deps.readSnapshot();
		const ok = (after.components || []).length === (snap.components || []).length;
		if (!ok) throw new Error(`live_loop: 还原校验不过!板可能被改,备份在 ${backupPath}`);
	}
	return { backupPath, observed };
}
