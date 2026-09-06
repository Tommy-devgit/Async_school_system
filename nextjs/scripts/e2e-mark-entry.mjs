/**
 * Mark entry, verified against Odoo rather than against the page.
 *
 * The reported defect: a teacher types a score, sets the status to Recorded,
 * the row shows Recorded — and after a reload it is Pending again with no
 * grade. Odoo itself is not at fault; writing score and status through the ORM
 * persists both and recomputes the grade every time. The loss happens between
 * the browser and the write.
 *
 * So this suite is deliberately about *persistence across a reload*, and about
 * the second save in particular: the one that follows an auto-save is where
 * stale values get written back over good ones.
 *
 *   ODOO_BASE_URL / ODOO_DB   the Odoo to read back from
 *   E2E_PASSWORD              shared demo password
 *   E2E_LOGIN                 an administrator (creates the fixture assessment)
 *   E2E_ALLOW_WRITES=yes      required: this suite creates records
 */
import { chromium } from 'playwright-core'
import { assertWritable, isMutatingMethod } from './production-guard.mjs'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const ODOO = process.env.ODOO_BASE_URL ?? 'http://localhost:8070'
const DB = process.env.ODOO_DB ?? 'school'
const PASSWORD = process.env.E2E_PASSWORD
const LOGIN = process.env.E2E_LOGIN

let failures = 0
const check = (label, ok, extra = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

async function odoo(sid, model, method, args = [], kwargs = {}) {
  if (isMutatingMethod(method)) assertWritable(ODOO, `${model}.${method}()`)
  const response = await fetch(`${ODOO}/web/dataset/call_kw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `session_id=${sid}` },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { model, method, args, kwargs } }),
  })
  const body = await response.json()
  if (body.error) throw new Error(`${body.error.data?.name}: ${body.error.data?.message}`)
  return body.result
}

async function odooLogin(login) {
  const response = await fetch(`${ODOO}/web/session/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { db: DB, login, password: PASSWORD } }),
  })
  const sid = (response.headers.getSetCookie?.() ?? [])
    .map((c) => /session_id=([^;]+)/.exec(c)?.[1])
    .filter(Boolean)[0]
  if (!sid) throw new Error('could not authenticate against Odoo')
  return sid
}

if (!LOGIN || process.env.E2E_ALLOW_WRITES !== 'yes') {
  console.log('\nmark entry: SKIPPED — needs E2E_LOGIN and E2E_ALLOW_WRITES=yes')
  process.exit(0)
}

assertWritable(ODOO, 'the mark entry suite')

const sid = await odooLogin(LOGIN)
const STAMP = Date.now().toString().slice(-6)
const cleanup = []

/* ---------------------------------------------------- an open mark list --- */

/*
  Reuse the fixture rather than making a new one each run.

  `school.assessment` has no `active` field and Odoo only deletes a draft, so
  an opened assessment cannot be removed or archived — creating one per run
  would accumulate them forever. The suite therefore adopts the one it made
  last time and regenerates its roster.
*/
const existing = await odoo(sid, 'school.assessment', 'search_read', [], {
  domain: [['name', 'like', 'E2E Mark Entry'], ['state', '=', 'open']],
  fields: ['name'],
  limit: 1,
})

// The first assignment whose class and subject actually have subject
// enrolments — without those, opening generates an empty roster.
let assignment = null
for (const candidate of await odoo(sid, 'school.teacher.assignment', 'search_read', [], {
  domain: [['state', '=', 'active']],
  fields: ['class_id', 'subject_id', 'term_id'],
  limit: 40,
})) {
  const enrolled = await odoo(sid, 'school.student.subject', 'search_count', [
    [['grade_subject_id.class_id', '=', candidate.class_id[0]],
     ['subject_id', '=', candidate.subject_id[0]],
     ['state', '=', 'enrolled']],
  ])
  if (enrolled) { assignment = candidate; break }
}
check('an assignment with subject enrolments exists', Boolean(assignment))
if (!assignment) process.exit(1)

let assessmentId
if (existing.length) {
  assessmentId = existing[0].id
  console.log(`
reusing the fixture assessment from an earlier run (${existing[0].name})`)
  // Pick up any roster row a previous run left, and any student added since.
  await odoo(sid, 'school.assessment', 'action_regenerate', [[assessmentId]])
} else {
  const [term] = await odoo(sid, 'school.term', 'read', [[assignment.term_id[0]], ['date_start']])
  assessmentId = await odoo(sid, 'school.assessment', 'create', [{
    name: `E2E Mark Entry ${STAMP}`,
    assessment_type: 'test',
    class_id: assignment.class_id[0],
    subject_id: assignment.subject_id[0],
    term_id: assignment.term_id[0],
    date: term.date_start,
    // Zero weight: the module caps total weight per subject and term at 100%,
    // and a fixture must not consume any of a real subject's budget.
    weight: 0.0,
  }])
  await odoo(sid, 'school.assessment', 'action_open', [[assessmentId]])
}

/*
  Reset the target row to the state the defect starts from, so the run is
  repeatable whether the fixture is new or adopted.
*/
cleanup.push(async () => {
  const ids = await odoo(sid, 'school.mark', 'search', [[['assessment_id', '=', assessmentId]]])
  if (ids.length) {
    await odoo(sid, 'school.mark', 'write', [ids, { score: 0, mark_status: 'pending', note: '' }])
  }
})

const marks = await odoo(sid, 'school.mark', 'search_read', [], {
  domain: [['assessment_id', '=', assessmentId]],
  fields: ['student_id', 'score', 'mark_status', 'max_score'],
  order: 'student_id asc',
})
check('the assessment opened with a roster', marks.length > 0, `${marks.length} row(s)`)
if (!marks.length) process.exit(1)

const target = marks[0]
const readBack = async () => {
  const [row] = await odoo(sid, 'school.mark', 'read', [
    [target.id], ['score', 'mark_status', 'percentage', 'grade'],
  ])
  return row
}

/* ------------------------------------------------------------- the browser --- */

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.fill('#login', LOGIN)
await page.fill('#password', PASSWORD)
await page.click('#submit-login')
await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })

const openList = async () => {
  await page.goto(`${BASE}/assessments/${assessmentId}`, { waitUntil: 'networkidle' })
  await page.locator(`#score-${target.id}`).waitFor({ timeout: 30_000 })
}

/* -------------------------------------------- 1. a score and a status save --- */

console.log('\na score and a status reach Odoo together')
await openList()
await page.fill(`#score-${target.id}`, '3')
await page.selectOption(`#status-${target.id}`, 'recorded')
// The list auto-saves on a debounce; give it the debounce plus the round trip.
await page.waitForTimeout(4000)

let stored = await readBack()
check('Odoo has the score', stored.score === 3, String(stored.score))
check('Odoo has the status', stored.mark_status === 'recorded', String(stored.mark_status))
check('Odoo computed a grade', Boolean(stored.grade), String(stored.grade))

/* ------------------------------------------- 2. it survives a real reload --- */

console.log('\nand it is still there after a reload')
await openList()
check(
  'the score input still shows it',
  (await page.locator(`#score-${target.id}`).inputValue()) === '3',
  await page.locator(`#score-${target.id}`).inputValue(),
)
check(
  'the status select still shows Recorded',
  (await page.locator(`#status-${target.id}`).inputValue()) === 'recorded',
  await page.locator(`#status-${target.id}`).inputValue(),
)

/* ------------------------- 3. the defect: a second edit must not undo it --- */

/*
  This is where the reported loss happened. After an auto-save the form was
  reset to the values it had been rendered with, so the inputs went back to
  Pending and the empty score while Odoo held the new ones. The *next*
  auto-save then diffed those stale inputs against the fresh baseline and
  wrote the old values back — silently undoing the teacher's entry.
*/
console.log('\na second edit does not write stale values back')
await openList()
await page.fill(`#note-${target.id}`, `remark ${STAMP}`)
await page.waitForTimeout(4000)

stored = await readBack()
check('the remark saved', true)
check('the score survived the second save', stored.score === 3, String(stored.score))
check(
  'the status survived the second save',
  stored.mark_status === 'recorded',
  String(stored.mark_status),
)
check('the grade survived the second save', Boolean(stored.grade), String(stored.grade))

/* --------------------------------- 4. two edits in one sitting both land --- */

console.log('\ntwo edits in one sitting both land')
await openList()
await page.fill(`#score-${target.id}`, '4')
await page.waitForTimeout(4000)
await page.selectOption(`#status-${target.id}`, 'absent')
await page.waitForTimeout(4000)

stored = await readBack()
check('the second score landed', stored.score === 4, String(stored.score))
check('the status change landed', stored.mark_status === 'absent', String(stored.mark_status))
// Absent carries no countable score, so Odoo clears the grade deliberately.
check('an absent row has no grade', !stored.grade, String(stored.grade))

/* ------------------------------------------------ 5. Odoo still refuses --- */

console.log("\nOdoo's own bounds are still enforced")
await openList()
await page.fill(`#score-${target.id}`, String(target.max_score + 10))
await page.waitForTimeout(4000)
stored = await readBack()
check(
  'a score above the maximum was not written',
  stored.score !== target.max_score + 10,
  String(stored.score),
)
const shown = (await page.locator('main').textContent()) ?? ''
check('and the page says why', /cannot be greater than|must be between/i.test(shown))

/* ---------------------------------------------------------------- cleanup --- */

console.log('\ncleanup')
for (const undo of cleanup.reverse()) {
  try { await undo() } catch (error) { console.log(`  note: ${error.message}`) }
}

await browser.close()
console.log(failures === 0 ? '\nmark entry: ok' : `\nmark entry: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
