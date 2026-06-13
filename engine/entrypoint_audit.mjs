import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/') + '/';
const REPORT = process.env.EASYEDA_ENTRYPOINT_REPORT || DIR + 'entrypoint_audit_report.json';

function readText(rel) {
	return readFileSync(join(DIR, rel), 'utf8').replace(/^\uFEFF/, '');
}

function existsRel(rel) {
	return existsSync(join(DIR, rel.replace(/\\/g, '/')));
}

function collectPackageNodeEntrypoints(findings) {
	const pkg = JSON.parse(readText('package.json'));
	for (const [name, command] of Object.entries(pkg.scripts || {})) {
		const re = /\bnode\s+([^\s"'&|;]+(?:\.mjs|\.js))/g;
		let m;
		while ((m = re.exec(command))) {
			const rel = m[1].replace(/\\/g, '/');
			if (!existsRel(rel)) {
				findings.push({
					rule: 'EP1-package-script-target',
					severity: 'hard',
					msg: `package script references a missing Node entrypoint: ${name}`,
					where: { script: name, command, rel },
				});
			}
		}
	}
}

function collectSourceEntrypoints(findings) {
	const files = ['engine/apply_gated.mjs', 'engine/acceptance_run.mjs'];
	for (const file of files) {
		const text = readText(file);
		const refs = new Set();
		for (const re of [
			/['"`](node\s+)?(engine\/[^'"`\s]+(?:\.mjs|\.js))['"`]/g,
			/['"`]([^'"`]+\.js)['"`]/g,
		]) {
			let m;
			while ((m = re.exec(text))) {
				const rel = (m[2] || m[1] || '').replace(/^node\s+/, '').replace(/\\/g, '/');
				if (!rel || rel.startsWith('./') || rel.startsWith('../')) continue;
				refs.add(rel);
			}
		}
		for (const rel of refs) {
			if (!existsRel(rel)) {
				findings.push({
					rule: 'EP2-source-script-target',
					severity: 'hard',
					msg: `source references a missing script: ${rel}`,
					where: { file, rel },
				});
			}
		}
	}
}

const findings = [];
collectPackageNodeEntrypoints(findings);
collectSourceEntrypoints(findings);

const report = {
	generatedAt: new Date().toISOString(),
	pass: findings.length === 0,
	severity: { hard: findings.length, soft: 0, info: 0 },
	findings,
};

writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`entrypoint audit ${report.pass ? 'PASS' : 'FAIL'} hard=${report.severity.hard}`);
console.log(`report -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
