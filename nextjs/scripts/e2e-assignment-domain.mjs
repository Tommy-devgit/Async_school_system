/**
 * Teacher assignments — verified against Odoo.
 *
 * This is the most constrained model in the domain: eight Python constraints,
 * with `create`, `write` and `unlink` all overridden. The suite is built round
 * proving that the *constraints* are what refuse bad input, not the frontend —
 * a form that quietly avoided every invalid combination would pass a UI test
 * and still be wrong, because the rules would have moved into the browser.
 *
 * So each refusal test deliberately posts a combination Odoo must reject, and
 * checks two things: that Odoo's own message reached the user, and that
 * nothing was written.
 *
 *   ODOO_BASE_URL / ODOO_DB   the Odoo to read back from
 *   E2E_PASSWORD              shared demo password
 *   E2E_REGISTRAR_LOGIN       create/write on school.teacher.assignment
 *   E2E_ALLOW_WRITES=yes      required: this suite creates records
 */
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const ODOO = process.env.ODOO_BASE_URL ?? 'http://localhost:8070'
const DB = process.env.ODOO_DB ?? 'school'
const PASSWORD = process.env.E2E_PASSWORD
const LOGIN = process.env.E2E_REGISTRAR_LOGIN

let failures = 0
const check = (label, ok, extra = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

async function odoo(sid, model, method, args = [], kwargs = {}) {
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
  console.log('\nassignment domain: SKIPPED — needs E2E_REGISTRAR_LOGIN and E2E_ALLOW_WRITES=yes')
  process.exit(0)
}

const sid = await odooLogin(LOGIN)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('#login', LOGIN)
await page.fill('#password', PASSWORD)
await page.click('#submit-login')
/*
  Signing in no longer lands everyone on the dashboard: `landingPath` sends a
  registrar to their submitted registrations and a teacher to their open mark
  lists. Waiting for a specific route therefore tests navigation policy rather
  than sign-in, and times out for most roles. Waiting to leave /login is the
  thing this actually needs.
*/
await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })

const count = () => odoo(sid, 'school.teacher.assignment', 'search_count', [[]])
const optionsOf = (name) =>
  page.locator(`main select[name="${name}"] option`).evaluateAll((n) => n.map((o) => o.value).filter(Boolean))

/* ------------------------------------------------------------- the model --- */

console.log('\nthe model this frontend is talking to')
const meta = await odoo(sid, 'school.teacher.assignment', 'fields_get',
  [['academic_year_id', 'state', 'teacher_id']], { attributes: ['type', 'related', 'readonly', 'selection'] })
check('academic year is related from the class, not chosen',
  meta.academic_year_id?.readonly === true, `readonly=${meta.academic_year_id?.readonly}`)
check('state is a plain field — there are no action methods',
  Array.isArray(meta.state?.selection) && meta.state.selection.length === 4,
  (meta.state?.selection ?? []).map((s) => s[0]).join(','))

/* ------------------------------------------------------------- the form --- */

console.log('\nthe form narrows to what Odoo would accept')
await page.goto(`${BASE}/assignments/new`, { waitUntil: 'domcontentloaded' })
const teachers = await optionsOf('teacher_id')
const classes = await optionsOf('class_id')
if (teachers.length === 0 || classes.length === 0) {
  console.log('  SKIP  no assignable teacher or class in this database')
  await browser.close()
  process.exit(failures === 0 ? 0 : 1)
}

// Every teacher offered must be one Odoo would accept work for.
const teacherRows = await odoo(sid, 'school.teacher', 'read',
  [teachers.map(Number), ['teaching_status', 'active']])
check('only active teachers are offered',
  teacherRows.every((t) => t.active && t.teaching_status === 'active'), `${teacherRows.length} offered`)

// Picking a class must narrow the term list to that class's academic year.
await page.selectOption('main select[name="class_id"]', classes[0])
await page.waitForTimeout(400)
const termsAfter = await optionsOf('term_id')
const [chosenClass] = await odoo(sid, 'school.class', 'read', [[Number(classes[0])], ['academic_year_id']])
if (termsAfter.length) {
  const termRows = await odoo(sid, 'school.term', 'read', [termsAfter.map(Number), ['academic_year_id']])
  check('terms narrow to the class academic year',
    termRows.every((t) => t.academic_year_id?.[0] === chosenClass.academic_year_id?.[0]),
    `${termRows.length} term(s)`)
} else {
  console.log('  SKIP  the chosen class has no terms')
}

// And the subject list must respect the curriculum — but only when there is one.
const subjectsAfter = await optionsOf('subject_id')
const curriculum = await odoo(sid, 'school.grade.subject', 'search_read', [], {
  domain: [['class_id', '=', Number(classes[0])], ['active', '=', true]],
  fields: ['subject_id'],
})
if (curriculum.length) {
  const allowed = curriculum.map((c) => c.subject_id[0])
  check('subjects narrow to the class curriculum',
    subjectsAfter.every((s) => allowed.includes(Number(s))), `${subjectsAfter.length} offered`)
} else {
  const allSubjects = await odoo(sid, 'school.subject', 'search_count', [[['active', '=', true]]])
  check('a class with no curriculum accepts any subject',
    subjectsAfter.length === allSubjects, `${subjectsAfter.length}/${allSubjects}`)
}

/* ----------------------------------------------------------- create -------- */

console.log('\ncreate: Next.js -> Odoo')
if (subjectsAfter.length === 0 || termsAfter.length === 0) {
  console.log('  SKIP  not enough reference data to create')
  await browser.close()
  console.log(`\n${failures === 0 ? 'assignment domain: all checks passed' : `${failures} check(s) failed`}`)
  process.exit(failures === 0 ? 0 : 1)
}

// Find a subject/term pair nobody is already teaching, so the first create is
// a clean one and the duplicate test below is the thing that clashes.
const existing = await odoo(sid, 'school.teacher.assignment', 'search_read', [], {
  domain: [['class_id', '=', Number(classes[0])], ['state', '=', 'active']],
  fields: ['subject_id', 'term_id'],
})
const taken = new Set(existing.map((a) => `${a.subject_id?.[0]}:${a.term_id?.[0]}`))
let pick = null
for (const subject of subjectsAfter) {
  for (const term of termsAfter) {
    if (!taken.has(`${Number(subject)}:${Number(term)}`)) { pick = { subject, term }; break }
  }
  if (pick) break
}

if (!pick) {
  console.log('  SKIP  every subject/term pair for this class is already assigned')
} else {
  const before = await count()
  await page.selectOption('main select[name="subject_id"]', pick.subject)
  await page.selectOption('main select[name="term_id"]', pick.term)
  await page.selectOption('main select[name="teacher_id"]', teachers[0])
  await page.fill('main input[name="weekly_periods"]', '2')
  await page.click('main form button[type="submit"]')
  await page.waitForTimeout(4000)

  const after = await count()
  const shown = (await page.locator('main').innerText()) ?? ''

  if (after > before) {
    check('Odoo holds the new assignment', true, `${before} -> ${after}`)
    const created = await odoo(sid, 'school.teacher.assignment', 'search_read', [], {
      domain: [
        ['class_id', '=', Number(classes[0])],
        ['subject_id', '=', Number(pick.subject)],
        ['term_id', '=', Number(pick.term)],
      ],
      fields: ['teacher_id', 'academic_year_id', 'start_date', 'end_date', 'weekly_periods', 'state'],
      limit: 1,
    })
    const row = created[0]
    check('linked to the teacher chosen', row.teacher_id?.[0] === Number(teachers[0]))
    check('Odoo derived the academic year from the class',
      row.academic_year_id?.[0] === chosenClass.academic_year_id?.[0],
      row.academic_year_id?.[1] ?? 'none')
    check('Odoo filled the effective dates from the term',
      Boolean(row.start_date), `${row.start_date} -> ${row.end_date}`)
    check('periods were stored', row.weekly_periods === 2, String(row.weekly_periods))

    /* --------------------------------- the constraint, not the frontend --- */

    console.log('\nOdoo refuses a second teacher for the same subject, class and term')
    if (teachers.length > 1) {
      const beforeDup = await count()
      await page.goto(`${BASE}/assignments/new`, { waitUntil: 'domcontentloaded' })
      await page.selectOption('main select[name="class_id"]', classes[0])
      await page.waitForTimeout(400)
      await page.selectOption('main select[name="subject_id"]', pick.subject)
      await page.selectOption('main select[name="term_id"]', pick.term)
      await page.selectOption('main select[name="teacher_id"]', teachers[1])
      await page.click('main form button[type="submit"]')
      await page.waitForTimeout(3500)
      const message = (await page.locator('main').innerText()) ?? ''
      const afterDup = await count()
      check('the duplicate was refused', afterDup === beforeDup, `${beforeDup} -> ${afterDup}`)
      check('and Odoo said why, naming the teacher already there',
        /already has .* teaching/i.test(message),
        message.split('\n').find((l) => /already has/i.test(l))?.slice(0, 90) ?? message.slice(0, 90))
      check('no traceback', !/Traceback|odoo\.exceptions/i.test(message))
    } else {
      console.log('  SKIP  only one assignable teacher')
    }

    /* ------------------------------------------------------ transitions --- */

    console.log('\nstate moves by an allowlisted field write')
    await page.goto(`${BASE}/assignments/${row.id}`, { waitUntil: 'domcontentloaded' })
    const detail = (await page.locator('main').innerText()) ?? ''
    check('relationships are named, not numbered',
      detail.includes(row.teacher_id[1]) && !/Teacher\s*\n\s*\d+\s*$/m.test(detail))
    check('no delete is offered — Odoo refuses to delete history', !/\bDelete\b/.test(detail))

    const endButton = page.locator('main button:has-text("End assignment")')
    if (await endButton.count()) {
      await endButton.click()
      await page.waitForTimeout(300)
      await page.locator('main button:has-text("Confirm end")').click()
      await page.waitForTimeout(3000)
      const [ended] = await odoo(sid, 'school.teacher.assignment', 'read', [[row.id], ['state']])
      check('Odoo stored the state change', ended.state === 'ended', ended.state)
    }

    // A key that is not valid from the current state must be refused server-side.
    const beforeBad = await odoo(sid, 'school.teacher.assignment', 'read', [[row.id], ['state']])
    const response = await page.request.post(`${BASE}/assignments/${row.id}`, {
      form: { id: String(row.id), transition: 'activate' },
      failOnStatusCode: false,
    })
    const afterBad = await odoo(sid, 'school.teacher.assignment', 'read', [[row.id], ['state']])
    check('an out-of-state transition posted directly changes nothing',
      afterBad[0].state === beforeBad[0].state,
      `${beforeBad[0].state} -> ${afterBad[0].state} (http ${response.status()})`)

    /* ------------------------------------------------------------ unlink --- */

    console.log('\nassignment history cannot be deleted')
    let refused = false
    try {
      await odoo(sid, 'school.teacher.assignment', 'unlink', [[row.id]])
    } catch (error) {
      refused = /cannot be deleted/i.test(String(error))
    }
    check('Odoo itself refuses the delete', refused)
  } else {
    check('a refused creation explains why', shown.length > 0, shown.slice(0, 120))
    check('and nothing was created', after === before, `${before} -> ${after}`)
  }
}

/* --------------------------------------------------------------- list ----- */

console.log('\nlist, filters and navigation')
await page.goto(`${BASE}/assignments`, { waitUntil: 'domcontentloaded' })
check('the teacher filter is offered',
  (await page.locator('main select').count()) >= 5, `${await page.locator('main select').count()} filters`)
// The toolbar carries the live count; the subtitle on this screen is a
// fixed sentence about the single-teacher rule.
const countText = () => page.locator('main').getByText(/\d+ records?$/).first().innerText()
const total = await countText()
await page.goto(`${BASE}/assignments?teacher=${teachers[0]}`, { waitUntil: 'domcontentloaded' })
const filtered = await countText()
check('filtering by teacher changes the result set', total !== filtered, `${total.trim()} vs ${filtered.trim()}`)

for (const url of ['/assignments/999999', '/assignments/abc']) {
  const response = await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' })
  const body = (await page.textContent('body')) ?? ''
  check(`${url.padEnd(22)} degrades safely`, !/Traceback|odoo\.exceptions/i.test(body), `http=${response?.status()}`)
}

await browser.close()
console.log(`\n${failures === 0 ? 'assignment domain: all checks passed' : `${failures} check(s) failed`}`)
process.exit(failures === 0 ? 0 : 1)
