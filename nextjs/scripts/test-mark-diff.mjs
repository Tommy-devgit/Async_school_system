/**
 * Which mark rows the grid decides to write.
 *
 * A bug here silently drops a teacher's entry, or — worse, and what actually
 * happened — writes a stale value back over a good one. The diff is now
 * between two value maps, the ones on screen and the ones Odoo last
 * confirmed, so both halves move together and a desynchronised form cannot
 * express the old failure at all.
 *
 * Run: node scripts/test-mark-diff.mjs
 */
import assert from 'node:assert/strict'

/* Mirrors lib/mark-diff.ts, which cannot be imported from a plain node script. */
function changedRows(current, baseline) {
  const changes = []
  for (const [key, row] of Object.entries(current)) {
    const markId = Number(key)
    const was = baseline[markId]
    if (!was) continue

    const values = {}
    const score = row.score.trim()

    if (score !== '' && score !== was.score.trim()) {
      const parsed = Number(score)
      if (Number.isFinite(parsed)) values.score = parsed
    }
    if (row.status !== '' && row.status !== was.status) values.mark_status = row.status
    if (row.note !== was.note) values.note = row.note

    if (Object.keys(values).length > 0) changes.push({ markId, values })
  }
  return changes
}


const row = (score, status, note = '') => ({ score, status, note })

/** Each scenario runs immediately; a failure throws where it is written. */
const scenario = (name, run) => { try { run() } catch (error) {
  error.message = `${name}: ${error.message}`
  throw error
} }

scenario('an untouched roster costs no writes', () => {
    const state = { 1: row('3', 'recorded'), 2: row('4', 'recorded') }
    assert.deepEqual(changedRows(state, state), [], 'an untouched roster costs no writes')
})

scenario('one score moved', () => {
    const baseline = { 1: row('0', 'pending'), 2: row('0', 'pending') }
    const current = { 1: row('3', 'pending'), 2: row('0', 'pending') }
    assert.deepEqual(changedRows(current, baseline), [{ markId: 1, values: { score: 3 } }])
})

scenario('one status moved', () => {
    const baseline = { 1: row('3', 'pending') }
    const current = { 1: row('3', 'recorded') }
    assert.deepEqual(changedRows(current, baseline), [
      { markId: 1, values: { mark_status: 'recorded' } },
    ])
})

scenario('one remark moved', () => {
    const baseline = { 1: row('3', 'recorded', '') }
    const current = { 1: row('3', 'recorded', 'resit') }
    assert.deepEqual(changedRows(current, baseline), [{ markId: 1, values: { note: 'resit' } }])
})

scenario('score and status travel together', () => {
    const baseline = { 1: row('0', 'pending') }
    const current = { 1: row('3', 'recorded') }
    assert.deepEqual(changedRows(current, baseline), [
      { markId: 1, values: { score: 3, mark_status: 'recorded' } },
    ], 'both travel together, which is what a teacher actually does')
})

/*
  The regression this file exists for. Odoo has confirmed score 3 and
  Recorded; the grid must not be able to produce a write that puts either
  back. Under the old scheme a form reset made exactly that happen, because a
  visible control and its hidden companion could disagree.
*/
scenario('reconciled state writes nothing', () => {
    const confirmed = { 1: row('3', 'recorded') }
    assert.deepEqual(
      changedRows(confirmed, confirmed), [],
      'reconciled state writes nothing — no stale value can be sent back',
    )
})

scenario('a deliberate revert is still a real edit', () => {
    // And a deliberate revert is still expressible, because it is a real edit.
    const baseline = { 1: row('3', 'recorded') }
    const current = { 1: row('3', 'pending') }
    assert.deepEqual(changedRows(current, baseline), [
      { markId: 1, values: { mark_status: 'pending' } },
    ])
})

scenario('a blank score is left alone', () => {
    // A cleared box is "not entered", not "set it to nothing": school.mark has
    // no way to un-record a score once one exists.
    const baseline = { 1: row('3', 'recorded') }
    const current = { 1: row('', 'recorded') }
    assert.deepEqual(changedRows(current, baseline), [], 'a blank score is left alone')
})

scenario('a non-numeric score is never sent', () => {
    const baseline = { 1: row('0', 'pending') }
    const current = { 1: row('abc', 'pending') }
    assert.deepEqual(changedRows(current, baseline), [], 'a non-numeric score is never sent')
})

scenario('zero is a real mark', () => {
    // Zero is a real mark and must be writable.
    const baseline = { 1: row('', 'pending') }
    const current = { 1: row('0', 'pending') }
    assert.deepEqual(changedRows(current, baseline), [{ markId: 1, values: { score: 0 } }])
})

scenario('whitespace is not a change', () => {
    // Whitespace is not a change.
    const baseline = { 1: row('3', 'recorded') }
    const current = { 1: row('  3  ', 'recorded') }
    assert.deepEqual(changedRows(current, baseline), [])
})

scenario('an unknown row id is skipped', () => {
    // A row the baseline never had cannot be diffed, so it is skipped rather
    // than written blind. The server checks the roster again regardless.
    const baseline = { 1: row('0', 'pending') }
    const current = { 1: row('0', 'pending'), 999: row('5', 'recorded') }
    assert.deepEqual(changedRows(current, baseline), [])
})

scenario('one corrected score in thirty costs one write', () => {
    const baseline = {}
    const current = {}
    for (let id = 1; id <= 30; id += 1) {
      baseline[id] = row('0', 'pending')
      current[id] = row(id === 17 ? '9' : '0', 'pending')
    }
    const changes = changedRows(current, baseline)
    assert.equal(changes.length, 1, 'one corrected score in thirty costs exactly one write')
    assert.equal(changes[0].markId, 17)
})

console.log('mark-diff: ok')