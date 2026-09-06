/**
 * Every end-to-end suite, in one run.
 *
 * There are three dozen `e2e-*.mjs` scripts and no way to run them together:
 * you invoked them one at a time and tallied the results yourself, which is
 * why nobody ran the whole set. Each already exits 0 or 1, so a runner is just
 * a loop that respects that contract and reports what it found.
 *
 * Sequential on purpose. They share one Odoo, several write records and clean
 * up after themselves, and two of them assert on counts that a parallel suite
 * would move underneath them.
 *
 *   node scripts/e2e-all.mjs                    # against localhost:3100
 *   node scripts/e2e-all.mjs http://localhost:3000
 *   node scripts/e2e-all.mjs --only student,staff
 *   node scripts/e2e-all.mjs --list
 */
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:3100'
const onlyArg = args.find((a) => a.startsWith('--only'))
const only = onlyArg ? (onlyArg.split('=')[1] ?? args[args.indexOf(onlyArg) + 1] ?? '') : ''
const patterns = only.split(',').map((s) => s.trim()).filter(Boolean)

const suites = readdirSync(HERE)
  .filter((f) => f.startsWith('e2e-') && f.endsWith('.mjs') && f !== 'e2e-all.mjs')
  .filter((f) => patterns.length === 0 || patterns.some((p) => f.includes(p)))
  .sort()

if (args.includes('--list')) {
  for (const s of suites) console.log(s)
  process.exit(0)
}

/*
  Fail on a missing credential rather than three dozen times on its absence.
  Only the two every suite shares are required here; a suite needing a role
  login of its own says so itself, and is reported as SKIP rather than FAIL.
*/
const missing = ['E2E_PASSWORD', 'E2E_REGISTRAR_LOGIN'].filter((k) => !process.env[k])
if (missing.length) {
  console.error(`Missing ${missing.join(', ')}. See .env.example — no credential is committed.`)
  process.exit(1)
}

const reachable = await fetch(`${base}/login`, { redirect: 'manual' })
  .then((r) => r.status < 500)
  .catch(() => false)
if (!reachable) {
  console.error(`Nothing answering at ${base}. Start the app first, or pass its URL.`)
  process.exit(1)
}

const run = (file) =>
  new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(process.execPath, [join(HERE, file), base], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (d) => { output += d })
    child.stderr.on('data', (d) => { output += d })
    child.on('close', (code) => resolve({ file, code, output, ms: Date.now() - started }))
  })

console.log(`${suites.length} suites against ${base}\n`)
const results = []
for (const file of suites) {
  process.stdout.write(`  ${file.replace(/^e2e-|\.mjs$/g, '').padEnd(28)}`)
  const result = await run(file)
  /*
    A suite that stood down for want of a role login, or for want of
    E2E_ALLOW_WRITES, is neither a pass nor a failure of the app — and most of
    them say so and then exit 0, which would otherwise be counted as a pass for
    work nobody did. That is why this reports three categories rather than two.

    The test is that the suite reached no assertion at all. Matching on the
    word SKIPPED instead would be wrong: several suites skip one check for want
    of a particular role and run every other check normally.
  */
  const ranNothing = !/\bPASS\b|\bFAIL\b/.test(result.output)
  result.status = ranNothing ? 'SKIP' : result.code === 0 ? 'PASS' : 'FAIL'
  results.push(result)
  const seconds = (result.ms / 1000).toFixed(1)
  console.log(`${result.status}  ${seconds}s`)
}

const failed = results.filter((r) => r.status === 'FAIL')
const skipped = results.filter((r) => r.status === 'SKIP')

for (const result of failed) {
  console.log(`\n${'─'.repeat(70)}\n${result.file}\n${'─'.repeat(70)}`)
  const lines = result.output.split('\n').filter((l) => /FAIL|Error|error:/i.test(l))
  console.log((lines.length ? lines : result.output.split('\n').slice(-25)).join('\n'))
}

if (skipped.length) {
  console.log(`\nskipped for want of a role login: ${skipped.map((r) => r.file).join(', ')}`)
}
console.log(
  `\n${results.length - failed.length - skipped.length} passed, ` +
  `${failed.length} failed, ${skipped.length} skipped`,
)
process.exit(failed.length === 0 ? 0 : 1)
