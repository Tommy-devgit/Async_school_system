/**
 * Every `test-*.mjs` in one run.
 *
 * These are the pure ones — date arithmetic, diffing, query parsing — with no
 * browser and no Odoo, so they are the set that can run anywhere, including in
 * a hook or on a machine with no credentials. `npm run e2e` is the other half.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(here).filter((f) => f.startsWith('test-') && f.endsWith('.mjs')).sort()

let failed = 0
for (const file of files) {
  const run = spawnSync(process.execPath, [join(here, file)], { encoding: 'utf8' })
  const ok = run.status === 0
  if (!ok) failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${file}`)
  if (!ok) console.log((run.stdout + run.stderr).split('\n').slice(-20).join('\n'))
}
console.log(`\n${files.length - failed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
