#!/usr/bin/env node

import { writeFile } from 'node:fs/promises'

const args = process.argv.slice(2)
const jsonMode = args.includes('--json')
const markdownMode = args.includes('--markdown')
const outputArgIndex = args.findIndex((arg) => arg === '--out')
const outputPath = outputArgIndex >= 0 ? args[outputArgIndex + 1] : null

const result = {
	schemaVersion: 1,
	status: 'placeholder',
	generatedAt: new Date().toISOString(),
	metrics: {
		timeToRootCauseP50Min: null,
		setupTimeMin: null,
		memoryRssP95Mb: null,
		startupLatencyP95Sec: null,
	},
	targets: {
		timeToRootCauseP50Min: 5,
		setupTimeMin: 10,
		memoryRssP95Mb: 300,
		startupLatencyP95Sec: 5,
	},
	environment: {
		cpu: null,
		ramGb: null,
		os: process.platform,
		nodeVersion: process.version,
	},
	fixtureSet: null,
	notes: 'Placeholder output. Benchmark harness not implemented yet.',
}

function formatMetric(value, unit = '') {
	if (value === null || value === undefined) {
		return 'TBD'
	}
	return `${value}${unit}`
}

function buildMarkdownReport(data) {
	return [
		'## v2 Contract Metrics',
		'',
		`- Time to root cause (p50): ${formatMetric(data.metrics.timeToRootCauseP50Min, ' min')} (target ≤ ${data.targets.timeToRootCauseP50Min} min) — TBD`,
		`- Setup time: ${formatMetric(data.metrics.setupTimeMin, ' min')} (target ≤ ${data.targets.setupTimeMin} min) — TBD`,
		`- Memory footprint RSS (p95, 1,000 traces): ${formatMetric(data.metrics.memoryRssP95Mb, ' MB')} (target ≤ ${data.targets.memoryRssP95Mb} MB) — TBD`,
		`- Startup latency (p95): ${formatMetric(data.metrics.startupLatencyP95Sec, ' s')} (target ≤ ${data.targets.startupLatencyP95Sec} s) — TBD`,
		'',
		`Benchmark env: <CPU/RAM/${data.environment.os}/${data.environment.nodeVersion}>`,
		`Fixture set: ${data.fixtureSet ?? '<name/version>'}`,
		'',
		`_Generated at: ${data.generatedAt}_`,
	].join('\n')
}

const markdownReport = buildMarkdownReport(result)

async function maybeWriteOutputFile() {
	if (!outputPath) {
		return
	}
	const content = markdownMode
		? `${markdownReport}\n`
		: `${JSON.stringify(result, null, 2)}\n`
	await writeFile(outputPath, content, 'utf8')
}

await maybeWriteOutputFile()

if (jsonMode) {
	console.log(JSON.stringify(result, null, 2))
	process.exit(0)
}

if (markdownMode) {
	console.log(markdownReport)
	process.exit(0)
}

console.log('otel-gui v2 contract benchmark scaffold')
console.log('')
console.log('Status: placeholder (no benchmark logic implemented yet).')
console.log('')
console.log('Planned checks:')
console.log('  1) Setup time (fresh clone -> first trace visible)')
console.log('  2) Startup latency (pnpm dev -> UI + OTLP ready)')
console.log('  3) Memory footprint RSS at 1,000 traces (p95)')
console.log('  4) Time to root cause (scenario-based, p50)')
console.log('')
console.log('JSON output: pnpm run benchmark:contract -- --json')
console.log('Markdown output: pnpm run benchmark:contract -- --markdown')
console.log('Write JSON to file: pnpm run benchmark:contract -- --out tmp/contract-benchmark.json')
console.log('Write Markdown to file: pnpm run benchmark:contract -- --markdown --out tmp/contract-benchmark.md')
console.log('')
console.log('Next step: implement repeatable measurement harness and output JSON/Markdown summaries.')
