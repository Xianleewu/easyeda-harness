import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = (process.env.EASYEDA_WORKDIR || process.cwd()).replace(/\\/g, '/');
const DEFAULT_SCAN_DIRS = [
	join(DIR, 'engine'),
	join(DIR, 'harness/rules'),
];
const SKIP_DIRS = new Set(['node_modules']);
const SKIP_FILES = new Set(['regression_tests.mjs']);
const SEVERITY_LITERAL = /severity\s*:\s*['"](soft|info)['"]/g;

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		if (SKIP_DIRS.has(name)) continue;
		const path = join(dir, name);
		const st = statSync(path);
		if (st.isDirectory()) walk(path, out);
		else if (name.endsWith('.mjs') && !SKIP_FILES.has(name)) out.push(path);
	}
	return out;
}

function hard(findings, rule, msg, where = {}) {
	findings.push({ rule, severity: 'hard', category: 'severity-policy', msg, where });
}

export function auditSeverityLiterals(scanDirs = DEFAULT_SCAN_DIRS) {
	const findings = [];
	const files = scanDirs.flatMap(dir => walk(dir));
	for (const file of files) {
		const text = readFileSync(file, 'utf8');
		for (const match of text.matchAll(SEVERITY_LITERAL)) {
			const before = text.slice(0, match.index);
			const line = before.split(/\r?\n/).length;
			hard(findings, 'SP1-soft-info-literal', 'source code emits soft/info severity in a commercial gate path', {
				file,
				line,
				severity: match[1],
			});
		}
	}
	return {
		pass: findings.length === 0,
		severity: { hard: findings.length, soft: 0, info: 0 },
		stats: { files: files.length },
		findings,
	};
}

function visitSeverity(obj, path, out) {
	if (!obj || typeof obj !== 'object') return;
	if (obj.severity && typeof obj.severity === 'object') {
		const hardCount = obj.severity.hard || 0;
		const softCount = obj.severity.soft || 0;
		const infoCount = obj.severity.info || 0;
		if (hardCount || softCount || infoCount) out.push({ path, severity: obj.severity });
	}
	for (const [key, value] of Object.entries(obj)) {
		if (!value || typeof value !== 'object') continue;
		visitSeverity(value, `${path}.${key}`, out);
	}
}

export function auditReportSeverityZero(report) {
	const offenders = [];
	visitSeverity(report, 'report', offenders);
	const findings = [];
	for (const offender of offenders) {
		hard(findings, 'SP2-nonzero-report-severity', 'commercial report contains non-zero hard/soft/info severity', offender);
	}
	return {
		pass: findings.length === 0,
		severity: { hard: findings.length, soft: 0, info: 0 },
		stats: { checkedSeverityNodes: offenders.length + 1 },
		findings,
	};
}

export function auditSeverityPolicy({ scanDirs = DEFAULT_SCAN_DIRS, report = null } = {}) {
	const source = auditSeverityLiterals(scanDirs);
	const reportAudit = report ? auditReportSeverityZero(report) : { pass: true, severity: { hard: 0, soft: 0, info: 0 }, stats: { checkedSeverityNodes: 0 }, findings: [] };
	const findings = [...source.findings, ...reportAudit.findings];
	return {
		pass: findings.length === 0,
		severity: { hard: findings.length, soft: 0, info: 0 },
		stats: {
			scannedFiles: source.stats.files,
			checkedSeverityNodes: reportAudit.stats.checkedSeverityNodes,
		},
		findings,
	};
}

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const reportPath = process.argv[2];
	const result = auditSeverityPolicy({ report: reportPath ? readJson(reportPath) : null });
	console.log(JSON.stringify(result, null, 2));
	process.exit(result.pass ? 0 : 1);
}
