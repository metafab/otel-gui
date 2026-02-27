import { spawnSync } from 'node:child_process';

const mode = process.argv.includes('--write') ? 'write' : 'check';
const allowedExtensions = new Set([
	'.css',
	'.html',
	'.js',
	'.json',
	'.md',
	'.svelte',
	'.ts',
	'.yaml',
	'.yml'
]);

function run(command, args) {
	const result = spawnSync(command, args, { encoding: 'utf8' });
	if (result.status !== 0) {
		return [];
	}
	return result.stdout
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

function isFormattable(filePath) {
	const lower = filePath.toLowerCase();
	for (const extension of allowedExtensions) {
		if (lower.endsWith(extension)) {
			return true;
		}
	}
	return false;
}

const isCi = process.env.CI === 'true';
const baseRange = process.env.FORMAT_BASE ?? (isCi ? 'HEAD~1...HEAD' : null);

const changedFiles = baseRange
	? run('git', ['diff', '--name-only', '--diff-filter=ACMRTUXB', baseRange])
	: run('git', ['diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD']);

const untrackedFiles = baseRange ? [] : run('git', ['ls-files', '--others', '--exclude-standard']);
const files = [...new Set([...changedFiles, ...untrackedFiles].filter(isFormattable))];

if (files.length === 0) {
	console.log('No changed files to format.');
	process.exit(0);
}

const prettierBin = process.platform === 'win32' ? 'prettier.cmd' : 'prettier';
const result = spawnSync(prettierBin, [`--${mode}`, ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
