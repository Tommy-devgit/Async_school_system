/**
 * Grouping a page of rows under headings.
 *
 * The bug worth guarding against here is the one that only appears once a
 * school has more than nine grades: sorted as text, "Grade 10" falls between
 * "Grade 1" and "Grade 2", so a list that looks perfect in a small demo goes
 * wrong the moment Grade 10 exists. Every dataset below therefore spans single
 * and double digits.
 *
 * `groupRows` deliberately does not sort — Odoo does, on `grade_id`, which
 * follows school.grade's `sequence, name` where the sequence runs 10, 20 … 120.
 * So these assert two separate things: that the ordering the caller was given
 * survives grouping intact, and that nothing here tries to re-derive it from a
 * label. A function that sorted "Grade 10" by its text would pass a
 * round-trip test and still be wrong.
 *
 * Run: node scripts/test-group-rows.mjs
 */
import assert from 'node:assert/strict'
import { groupRows } from '../lib/group-rows.ts'

/** How Odoo returns them: ordered by grade sequence, then by name. */
const roll = [
  { id: 1, name: 'Abel', grade: [1, 'Grade 1'] },
  { id: 2, name: 'Hana', grade: [1, 'Grade 1'] },
  { id: 3, name: 'Bekele', grade: [2, 'Grade 2'] },
  { id: 4, name: 'Sara', grade: [9, 'Grade 9'] },
  { id: 5, name: 'Daniel', grade: [10, 'Grade 10'] },
  { id: 6, name: 'Yonas', grade: [11, 'Grade 11'] },
  { id: 7, name: 'Meron', grade: [12, 'Grade 12'] },
]

const byGrade = (row) =>
  row.grade ? { key: String(row.grade[0]), label: row.grade[1] } : null

/* ------------------------------------------------------------ grouping --- */

const groups = groupRows(roll, byGrade)

assert.deepEqual(
  groups.map((group) => group.label),
  ['Grade 1', 'Grade 2', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'],
  'the order Odoo returned must survive grouping — and 10 comes after 9',
)

// The single-digit/double-digit trap, stated on its own so a failure names it.
const labels = groups.map((group) => group.label)
assert.ok(
  labels.indexOf('Grade 9') < labels.indexOf('Grade 10'),
  'Grade 10 sorted before Grade 9 — something is ordering these as text',
)
assert.ok(labels.indexOf('Grade 2') < labels.indexOf('Grade 10'))
assert.ok(labels.indexOf('Grade 1') < labels.indexOf('Grade 2'))

/* --------------------------------------------- every student, exactly once --- */

const grouped = groups.flatMap((group) => group.rows)
assert.equal(grouped.length, roll.length, 'a student was dropped or duplicated')
assert.deepEqual(
  grouped.map((row) => row.id).sort((a, b) => a - b),
  roll.map((row) => row.id).sort((a, b) => a - b),
)

// Each student under their own grade, not merely under some heading.
for (const group of groups) {
  for (const row of group.rows) {
    assert.equal(String(row.grade[0]), group.key, `${row.name} is under the wrong grade`)
  }
}

// Grade 1 holds both of its students, in the order they arrived.
assert.deepEqual(
  groups.find((group) => group.label === 'Grade 1').rows.map((row) => row.name),
  ['Abel', 'Hana'],
)

/* ------------------------------------------------------- no empty groups --- */

assert.ok(
  !groups.some((group) => group.rows.length === 0),
  'a heading was drawn for a grade with nobody in it',
)
// Grades nobody is in simply do not appear.
assert.equal(labels.includes('Grade 3'), false)
assert.equal(labels.length, 6)

/* -------------------------------------------- a filtered or searched page --- */

/*
  Searching narrows the rows before they arrive, so the groups are whatever the
  matches happen to span — never the full 1–12 with empties between them.
*/
const matches = roll.filter((row) => [2, 11].includes(row.grade[0]))
assert.deepEqual(
  groupRows(matches, byGrade).map((group) => group.label),
  ['Grade 2', 'Grade 11'],
)

/* --------------------------------------------------- students with no grade --- */

/*
  A class can exist without a grade — the KG classes do — so a student can have
  none. They get one heading of their own, and it goes last: "not placed yet" is
  a footnote, not the first thing anybody should read.
*/
const withUnplaced = [
  { id: 8, name: 'Selam', grade: false },
  ...roll.slice(0, 3),
  { id: 9, name: 'Tigist', grade: false },
]
const mixed = groupRows(withUnplaced, byGrade)
assert.equal(mixed[mixed.length - 1].label, 'No grade')
assert.deepEqual(mixed[mixed.length - 1].rows.map((row) => row.name), ['Selam', 'Tigist'])
assert.equal(mixed.length, 3, 'ungrouped rows must collapse into one heading, not one each')

/* ------------------------------------------------- one page, not the set --- */

/*
  A grade running across a page boundary appears on both pages, under its own
  heading each time. That is correct: the heading describes the rows beneath it,
  and this only ever sees one page.
*/
const pageOne = groupRows(roll.slice(0, 3), byGrade)
const pageTwo = groupRows(roll.slice(3), byGrade)
assert.deepEqual(pageOne.map((g) => g.label), ['Grade 1', 'Grade 2'])
assert.deepEqual(pageTwo.map((g) => g.label), ['Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'])

/* ------------------------------------ non-contiguous input keeps one heading --- */

/*
  Keyed rather than compared against the previous row, so a set that is not
  perfectly ordered still yields one group per grade instead of repeating a
  heading further down.
*/
const scrambled = [roll[0], roll[3], roll[1]]
const scrambledGroups = groupRows(scrambled, byGrade)
assert.deepEqual(scrambledGroups.map((g) => g.label), ['Grade 1', 'Grade 9'])
assert.deepEqual(scrambledGroups[0].rows.map((r) => r.name), ['Abel', 'Hana'])

/* ------------------------------------------------------------- nothing --- */

assert.deepEqual(groupRows([], byGrade), [])

console.log('group-rows: ok')
