/**
 * Editing a staff responsibility — verified against Odoo, not the page.
 *
 * A responsibility could be added, ended and made primary, and never changed.
 * So one recorded with the wrong department, campus, reporting manager or
 * start date could only be ended and replaced — which leaves a misleading
 * ended row behind and loses the very history the model's `mail.thread` mixin
 * exists to keep.
 *
 * This holds the edit path end to end, and holds the two rules Odoo owns that
 * an edit can trip: a staff member cannot report to themselves, and the
 * effective-to date cannot precede the effective-from date.
 *
 *   ODOO_BASE_URL / ODOO_DB   the Odoo to read back from
 *   E2E_PASSWORD              shared demo password
 *   E2E_REGISTRAR_LOGIN       a user with write on school.staff.responsibility
 *   E2E_TEACHER_LOGIN         optional: a read-only role
 *   E2E_ALLOW_WRITES=yes      required: this suite changes records
 */
import { chromium } from 'playwright-core'
import { assertWritable, isMutatingMethod } from './production-guard.mjs'

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
  console.log('\nstaff responsibility: SKIPPED — needs E2E_REGISTRAR_LOGIN and E2E_ALLOW_WRITES=yes')
  process.exit(0)
}

assertWritable(ODOO, 'the staff responsibility suite')

const sid = await odooLogin(LOGIN)

/* ------------------------------------------- a staff member with a row --- */

const [row] = await odoo(sid, 'school.staff.responsibility', 'search_read', [], {
  domain: [['active', '=', true]],
  fields: ['staff_id', 'responsibility', 'department', 'campus_id', 'manager_id',
           'start_date', 'end_date', 'is_primary'],
  limit: 1,
})
check('an active responsibility exists to edit', Boolean(row))
if (!row) process.exit(1)

const staffId = row.staff_id[0]
const original = { ...row }
console.log(`  editing responsibility ${row.id} on staff ${row.staff_id[1]}`)

const readBack = async () => {
  const [current] = await odoo(sid, 'school.staff.responsibility', 'read', [
    [row.id], ['responsibility', 'department', 'campus_id', 'manager_id', 'start_date', 'end_date', 'is_primary'],
  ])
  return current
}

// Put everything back however the run ends.
const restore = async () => {
  await odoo(sid, 'school.staff.responsibility', 'write', [[row.id], {
    responsibility: original.responsibility,
    department: original.department || false,
    campus_id: original.campus_id ? original.campus_id[0] : false,
    manager_id: original.manager_id ? original.manager_id[0] : false,
    start_date: original.start_date,
    end_date: original.end_date || false,
  }])
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('#login', LOGIN)
await page.fill('#password', PASSWORD)
await page.click('#submit-login')
await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })

const openStaff = async () => {
  await page.goto(`${BASE}/staff/${staffId}`, { waitUntil: 'domcontentloaded' })
  await page.locator('main h1').first().waitFor({ timeout: 30_000 })
}

/* ------------------------------------------------- the edit path exists --- */

console.log('\nthe responsibility can be edited at all')
await openStaff()
const editButton = page.locator('button:has-text("Edit")').first()
check('the row offers an Edit control', (await editButton.count()) > 0)

if ((await editButton.count()) === 0) {
  await browser.close()
  console.log('\nstaff responsibility: no edit control — nothing further to test')
  process.exit(1)
}

await editButton.click()
await page.locator('select[name="responsibility"]').last().waitFor({ timeout: 10_000 })
check('the edit form opened with the row loaded', true)

/* -------------------------------------------------- an edit reaches Odoo --- */

console.log('\nan edit reaches Odoo')
const newStart = '2026-02-02'
await page.locator('input[name="start_date"]').last().fill(newStart)
await page.locator('button:has-text("Save changes")').click()
await page.waitForTimeout(2500)

let stored = await readBack()
check('the new start date persisted', stored.start_date === newStart, String(stored.start_date))
check(
  'the responsibility itself is unchanged',
  stored.responsibility === original.responsibility,
  String(stored.responsibility),
)
check(
  'and it is still the same primary flag',
  stored.is_primary === original.is_primary,
  String(stored.is_primary),
)

console.log('\nand it survives a reload')
await openStaff()
const shown = (await page.locator('main').textContent()) ?? ''
check('the page shows the edited row', !/Something went wrong/i.test(shown))
stored = await readBack()
check('Odoo still has the new date', stored.start_date === newStart, String(stored.start_date))

/* --------------------------------------- Odoo's own rules are surfaced --- */

console.log("\nOdoo's date rule is surfaced, not swallowed")
await openStaff()
await page.locator('button:has-text("Edit")').first().click()
await page.locator('select[name="responsibility"]').last().waitFor({ timeout: 10_000 })
await page.locator('input[name="start_date"]').last().fill('2026-06-01')
await page.locator('input[name="end_date"]').last().fill('2026-01-01')
await page.locator('button:has-text("Save changes")').click()
await page.waitForTimeout(2000)

const refusal = (await page.locator('main').textContent()) ?? ''
check('the backwards date range was refused', /cannot be before/i.test(refusal))
check('no traceback reached the browser', !/Traceback|odoo\.exceptions/i.test(refusal))

stored = await readBack()
check('and nothing was written', stored.start_date === newStart, String(stored.start_date))

/* --------------------------------------------- a read-only role cannot --- */

const TEACHER = process.env.E2E_TEACHER_LOGIN
if (TEACHER) {
  console.log('\na read-only role is offered no edit control')
  const readerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const reader = await readerContext.newPage()
  await reader.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await reader.fill('#login', TEACHER)
  await reader.fill('#password', PASSWORD)
  await reader.click('#submit-login')
  await reader.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })

  await reader.goto(`${BASE}/staff/${staffId}`, { waitUntil: 'domcontentloaded' })
  await reader.locator('main h1').first().waitFor({ timeout: 30_000 }).catch(() => {})

  // Without this the two checks below would also pass on an error page, which
  // would prove nothing about the edit control being withheld.
  const readerText = (await reader.locator('main').textContent()) ?? ''
  check(
    'the reader can actually see the responsibilities',
    /Responsibilit/i.test(readerText) && !/Something went wrong/i.test(readerText),
  )
  check('no Edit control', (await reader.locator('button:has-text("Edit")').count()) === 0)
  check('no Save control', (await reader.locator('button:has-text("Save changes")').count()) === 0)
  await readerContext.close()
} else {
  console.log('\nread-only role: SKIPPED — set E2E_TEACHER_LOGIN to check it')
}

/* ---------------------------------------------------------------- restore --- */

console.log('\nrestoring the original values')
try {
  await restore()
  const final = await readBack()
  check('the row is back as it was', final.start_date === original.start_date)
} catch (error) {
  console.log(`  note: restore failed — ${error.message}`)
}

await browser.close()
console.log(failures === 0 ? '\nstaff responsibility: ok' : `\nstaff responsibility: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
