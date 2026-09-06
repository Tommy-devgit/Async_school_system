/**
 * The removal allowlist has to agree with the ACL it claims to follow.
 *
 * `lib/odoo/removals.ts` decides whether a screen offers **Delete** or
 * **Archive**, and that decision is only meaningful if it matches
 * `ir.model.access.csv`. Two ways it could go wrong, both silent:
 *
 *   - An entry marked `delete` for a model nobody may unlink. The control
 *     appears for nobody, or worse appears and always fails.
 *   - An entry marked `archive` for a model that *can* be deleted. The screen
 *     then quietly does something other than what the user asked for.
 *
 * Read as text rather than imported, because removals.ts is `server-only`.
 *
 * Run: node scripts/test-removals.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../lib/odoo/removals.ts', import.meta.url), 'utf8')
const csv = readFileSync(
  new URL('../../addons/school_management/security/ir.model.access.csv', import.meta.url),
  'utf8',
)

/* --------------------------------- who may unlink each model, per the ACL --- */

const [header, ...lines] = csv.trim().split(/\r?\n/)
const columns = header.split(',')
const modelColumn = columns.indexOf('model_id:id')
const unlinkColumn = columns.indexOf('perm_unlink')
assert.ok(modelColumn >= 0 && unlinkColumn >= 0, 'the ACL csv is not shaped as expected')

const mayUnlink = new Map()
for (const line of lines) {
  const cells = line.split(',')
  const model = cells[modelColumn].replace(/^model_/, '').replace(/_/g, '.')
  const granted = cells[unlinkColumn].trim() === '1'
  mayUnlink.set(model, (mayUnlink.get(model) ?? false) || granted)
}

/* ------------------------------------------- what removals.ts declares --- */

const entries = [...source.matchAll(
  /(\w+):\s*\{\s*model:\s*'([^']+)',\s*mode:\s*'(delete|archive)'/g,
)].map(([, key, model, mode]) => ({ key, model, mode }))

assert.ok(entries.length >= 15, `only found ${entries.length} entries — did the shape change?`)

let deletes = 0
let archives = 0

for (const { key, model, mode } of entries) {
  assert.ok(
    mayUnlink.has(model),
    `${key} names ${model}, which has no ACL row at all — a typo, or a model that does not exist`,
  )

  if (mode === 'delete') {
    deletes += 1
    assert.equal(
      mayUnlink.get(model),
      true,
      `${key} offers Delete but no group holds unlink on ${model} — it would always fail`,
    )
  } else {
    archives += 1
    assert.equal(
      mayUnlink.get(model),
      false,
      `${key} offers Archive but ${model} can be deleted — say what is happening, or delete it`,
    )
  }
}

console.log(`  ok — ${deletes} delete and ${archives} archive entries all match the ACL`)

/* ----------------------------------------------- the keys are the surface --- */

// Every list screen naming a key must name one that exists.
const screens = [...source.matchAll(/^  (\w+): \{$/gm)].map(([, key]) => key)
assert.deepEqual(
  [...new Set(screens)].sort(),
  [...new Set(entries.map((e) => e.key))].sort(),
  'a key is declared without a model and a mode',
)

// And no two keys may point at the same model with different modes.
const byModel = new Map()
for (const { key, model, mode } of entries) {
  const seen = byModel.get(model)
  assert.ok(
    !seen || seen.mode === mode,
    `${key} and ${seen?.key} both target ${model} but disagree on what removal means`,
  )
  byModel.set(model, { key, mode })
}

console.log('  ok — every key resolves, and no model is claimed twice with different meanings')
console.log('removals: ok')
