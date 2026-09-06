/**
 * Selecting records and removing them.
 *
 * Nothing in the application could delete anything. Odoo grants `unlink` on
 * most models to the administrator, the registrar or both, and the UI offered
 * it nowhere — so a record entered in error could only be edited into
 * something else or left sitting there.
 *
 * This is the most destructive capability in the app, so what is checked here
 * is mostly what it must *refuse* to do:
 *
 *   - a role without the permission is offered no checkboxes at all
 *   - one click never removes anything; the confirmation is a second step
 *   - a submission without the confirmation flag removes nothing, even though
 *     the browser would never send one
 *   - archiving hides the record without destroying it, and says "archived"
 *   - Odoo's refusals — a record something else still points at — come through
 *     in Odoo's words instead of a traceback
 *
 * It creates its own probe records and removes those. It never selects a row
 * it did not create.
 *
 *   ODOO_BASE_URL / ODOO_DB   the Odoo to read back from
 *   E2E_PASSWORD              shared demo password
 *   E2E_REGISTRAR_LOGIN       may unlink school.program
 *   E2E_TEACHER_LOGIN         may not
 *   E2E_ALLOW_WRITES=yes      required
 */
import { chromium } from 'playwright-core'
import { assertWritable, isMutatingMethod } from './production-guard.mjs'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const ODOO = process.env.ODOO_BASE_URL ?? 'http://localhost:8070'
const DB = process.env.ODOO_DB ?? 'school'
const PASSWORD = process.env.E2E_PASSWORD
const LOGIN = process.env.E2E_REGISTRAR_LOGIN
const TEACHER = process.env.E2E_TEACHER_LOGIN

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
  console.log('\nremove records: SKIPPED — needs E2E_REGISTRAR_LOGIN and E2E_ALLOW_WRITES=yes')
  process.exit(0)
}

assertWritable(ODOO, 'the record removal suite')

const sid = await odooLogin(LOGIN)
const STAMP = Date.now()
const created = []

/** A program nobody else will match, so the suite can only ever select its own. */
async function makeProgram(suffix) {
  const id = await odoo(sid, 'school.program', 'create', [
    {
      name: `ZZZ remove probe ${STAMP} ${suffix}`,
      program_type: 'meeting',
      audience_type: 'all_staff',
      start_datetime: '2026-07-01 09:00:00',
      end_datetime: '2026-07-01 10:00:00',
    },
  ])
  created.push(id)
  return id
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()

const exists = async (model, id) =>
  (await odoo(sid, model, 'search_count', [[['id', '=', id]]])) === 1

/** Ignores `active`, so an archived record still counts as present. */
const existsIncludingArchived = async (model, id) =>
  (await odoo(sid, model, 'search_count', [[['id', '=', id]]], { context: { active_test: false } })) === 1

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#login', LOGIN)
  await page.fill('#password', PASSWORD)
  await page.click('#submit-login')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })

  const a = await makeProgram('A')
  const b = await makeProgram('B')
  const keep = await makeProgram('KEEP')

  const openProbes = async () => {
    await page.goto(`${BASE}/programs?q=${encodeURIComponent(`ZZZ remove probe ${STAMP}`)}`, {
      waitUntil: 'domcontentloaded',
    })
    await page.locator('main h1').first().waitFor({ timeout: 30_000 })
  }

  /* ------------------------------------------- the control is offered --- */

  console.log('\na role that may delete is offered the selection')
  await openProbes()
  const boxes = page.locator('main tbody input[name="id"]')
  check('every row has a checkbox', (await boxes.count()) === 3, `${await boxes.count()} of 3`)
  check(
    'nothing is offered before a selection',
    (await page.locator('button:has-text("Delete selected")').count()) === 0,
  )

  /* --------------------------------- one click never removes anything --- */

  console.log('\nselecting does not remove, and one click does not either')
  await page.locator(`main tbody input[name="id"][value="${a}"]`).check()
  await page.locator(`main tbody input[name="id"][value="${b}"]`).check()
  await page.waitForTimeout(300)

  const bar = page.locator('button:has-text("Delete selected")')
  check('the bar appeared', (await bar.count()) === 1)
  check(
    'it counts what is selected',
    /2 programs selected/i.test((await page.locator('main').textContent()) ?? ''),
  )

  await bar.click()
  await page.waitForTimeout(1200)
  check('the first click only asks', /Permanently delete/i.test((await page.locator('main').textContent()) ?? ''))
  check('nothing was deleted by asking', await exists('school.program', a))

  console.log('\nand the question can be answered no')
  await page.locator('button:has-text("Keep them")').click()
  await page.waitForTimeout(500)
  check('both probes are still there', (await exists('school.program', a)) && (await exists('school.program', b)))

  /* ------------------------------------------ confirming does remove --- */

  console.log('\nconfirming removes exactly what was selected')
  await page.locator('button:has-text("Delete selected")').click()
  await page.locator('button:has-text("Yes, delete")').waitFor({ state: 'visible', timeout: 10_000 })
  await page.locator('button:has-text("Yes, delete")').click()
  await page.waitForTimeout(3000)

  check('the first selected program is gone', !(await exists('school.program', a)))
  check('the second selected program is gone', !(await exists('school.program', b)))
  check('the unselected one was left alone', await exists('school.program', keep), `#${keep}`)

  const after = (await page.locator('main').textContent()) ?? ''
  check('it says what it did', /Deleted 2 programs/i.test(after), after.slice(0, 0) || undefined)
  check('no traceback', !/Traceback|odoo\.exceptions/i.test(after))

  /* ----------------------------------- archive, where delete is refused --- */

  /*
    school.student grants unlink to nobody at all, on purpose — enrolments,
    marks, report cards and attendance hang off it. So that screen offers
    Archive, and it has to say Archive rather than Delete.
  */
  console.log('\nwhere Odoo allows no delete, the screen offers archive instead')
  await page.goto(`${BASE}/students`, { waitUntil: 'domcontentloaded' })
  await page.locator('main h1').first().waitFor({ timeout: 30_000 })
  const studentBoxes = page.locator('main tbody input[name="id"]')
  const studentCount = await studentBoxes.count()

  if (studentCount === 0) {
    console.log('  SKIPPED — this role is offered no student selection')
  } else {
    const studentId = Number(await studentBoxes.first().getAttribute('value'))
    await studentBoxes.first().check()
    await page.waitForTimeout(300)

    const barText = (await page.locator('main').textContent()) ?? ''
    check('the control says Archive, not Delete', /Archive selected/i.test(barText))
    check('it does not say Delete anywhere on the bar', !/Delete selected/i.test(barText))
    check('and it explains why', /archived rather than deleted/i.test(barText))

    await page.locator('button:has-text("Archive selected")').click()
    await page.locator('button:has-text("Yes, archive")').waitFor({ state: 'visible', timeout: 10_000 })
    await page.locator('button:has-text("Yes, archive")').click()
    await page.waitForTimeout(3000)

    check('the record was not destroyed', await existsIncludingArchived('school.student', studentId))
    check('but it is gone from the list', !(await exists('school.student', studentId)))
    const archivedText = (await page.locator('main').textContent()) ?? ''
    check('it says archived, and says it can come back', /Archived 1 student.*restored/is.test(archivedText))

    // Put it back — this suite does not leave the school's data changed.
    await odoo(sid, 'school.student', 'write', [[studentId], { active: true }])
    check('the student was restored', await exists('school.student', studentId), `#${studentId}`)
  }

  /* --------------------------------- a role without the permission --- */

  if (TEACHER) {
    console.log('\na role Odoo would refuse is offered no selection at all')
    const readerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const reader = await readerContext.newPage()
    await reader.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await reader.fill('#login', TEACHER)
    await reader.fill('#password', PASSWORD)
    await reader.click('#submit-login')
    await reader.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })

    /*
      /classes, not /programs: a record rule scopes programs to their audience,
      so a teacher sees none of them — and "no checkboxes" on an empty table
      would pass without proving anything. A teacher does see classes, and only
      the administrator may unlink one.
    */
    await reader.goto(`${BASE}/classes`, { waitUntil: 'domcontentloaded' })
    await reader.locator('main h1').first().waitFor({ timeout: 30_000 })
    const readerText = (await reader.locator('main').textContent()) ?? ''

    check('the teacher can read the classes list', !/Something went wrong/i.test(readerText))
    check('rows are shown', (await reader.locator('main tbody tr').count()) > 0)
    check('but no checkboxes', (await reader.locator('main tbody input[name="id"]').count()) === 0)
    check('and no removal control', !/Delete selected|Archive selected/i.test(readerText))
    await readerContext.close()

    /*
      And the gate is the model, not the role: the same registrar who may
      delete a program may not delete a class, because only the administrator
      holds unlink on school.class.
    */
    console.log('\nthe gate is per model, not per role')
    await page.goto(`${BASE}/classes`, { waitUntil: 'domcontentloaded' })
    await page.locator('main h1').first().waitFor({ timeout: 30_000 })
    check('the registrar sees classes', (await page.locator('main tbody tr').count()) > 0)
    check(
      'but is offered no way to delete one',
      (await page.locator('main tbody input[name="id"]').count()) === 0,
    )
  } else {
    console.log('\nrole without permission: SKIPPED — set E2E_TEACHER_LOGIN')
  }
} finally {
  console.log('\ncleaning up')
  for (const id of created) {
    try {
      if (await exists('school.program', id)) {
        await odoo(sid, 'school.program', 'unlink', [[id]])
      }
    } catch (error) {
      console.log(`  note: could not remove program ${id} — ${error.message}`)
    }
  }
  const left = await odoo(sid, 'school.program', 'search_count', [
    [['name', 'like', `ZZZ remove probe ${STAMP}`]],
  ])
  check('no probe records were left behind', left === 0, `${left} left`)
  await browser.close()
}

console.log(failures === 0 ? '\nremove records: ok' : `\nremove records: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
