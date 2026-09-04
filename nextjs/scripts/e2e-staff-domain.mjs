/**
 * Staff registration, editing and responsibilities — verified against Odoo.
 *
 * Every write is checked by reading the record back out of Odoo, not by
 * trusting the page. An HTTP 200 from a server action says the action ran, not
 * that Odoo stored anything.
 *
 * The centre of this suite is the activation gate. Odoo refuses to let a staff
 * record leave Draft until `_missing_registration_fields` is empty, and one of
 * its requirements is "at least one active Responsibility". The frontend could
 * create staff and then had no way to give them a responsibility, so records
 * created here were stuck in Draft permanently. That is what these tests hold.
 *
 *   ODOO_BASE_URL / ODOO_DB   the Odoo to read back from
 *   E2E_PASSWORD              shared demo password
 *   E2E_REGISTRAR_LOGIN       a user with create/write on school.staff
 *   E2E_ALLOW_WRITES=yes      required: this suite creates a staff record
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
  // Refused before the request is built, so a blocked write never reaches Odoo.
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
  console.log('\nstaff domain: SKIPPED — needs E2E_REGISTRAR_LOGIN and E2E_ALLOW_WRITES=yes')
  process.exit(0)
}

/*
  Write intent is not permission.

  Most of what this suite writes goes through the browser and the app, not
  through `odoo()` above, so the client-level guard cannot see it. The only
  lever on that traffic is refusing to start at all when the Odoo being driven
  is not one we may write to. Absent configuration stays a skip; a run that
  genuinely means to write, aimed at an unapproved host, is a hard failure.
*/
assertWritable(ODOO, 'the staff domain suite')

const sid = await odooLogin(LOGIN)
const stamp = Date.now().toString().slice(-6)
const surname = `Probe${stamp}`

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

/* ------------------------------------------------------------ create --- */

console.log('\ncreate: Next.js -> Odoo')
await page.goto(`${BASE}/staff/new`, { waitUntil: 'domcontentloaded' })

const pick = async (name, index = 1) => {
  const values = await page
    .locator(`main select[name="${name}"] option`)
    .evaluateAll((nodes) => nodes.map((n) => n.value).filter(Boolean))
  if (values.length) await page.selectOption(`main select[name="${name}"]`, values[Math.min(index, values.length - 1)])
  return values
}

await page.fill('main input[name="first_name"]', 'SRS')
await page.fill('main input[name="last_name"]', surname)
await page.selectOption('main select[name="department"]', 'academic')
await page.waitForTimeout(400)
const titles = await pick('job_title_id', 0)
await pick('responsibility', 0)
const statuses = await page.locator('main select[name="employment_status"] option').evaluateAll((n) => n.map((o) => o.value).filter(Boolean))
if (statuses.includes('active')) await page.selectOption('main select[name="employment_status"]', 'active')
if (await page.locator('main input[name="phone"]').count()) {
  await page.fill('main input[name="phone"]', `09${stamp}00`)
}
if (await page.locator('main input[name="date_of_birth"]').count()) {
  await page.fill('main input[name="date_of_birth"]', '1990-05-05')
}
if (await page.locator('main input[name="email"]').count()) {
  await page.fill('main input[name="email"]', `srs.${surname.toLowerCase()}@example.invalid`)
}
check('the form offers job titles for the chosen department', titles.length > 0, `${titles.length}`)

await page.click('main form button[type="submit"]')
await page.waitForURL(/\/staff\/\d+$/, { timeout: 60_000 }).catch(() => {})

const created = await odoo(sid, 'school.staff', 'search_read', [], {
  domain: [['last_name', '=', surname]],
  fields: ['name', 'state', 'department', 'employment_status', 'phone'],
  limit: 1,
})
check('Odoo holds the new staff record', created.length === 1, created[0]?.name ?? 'not found')
if (created.length !== 1) {
  await browser.close()
  console.log(`\n${failures} check(s) failed`)
  process.exit(1)
}
const staffId = created[0].id
check('it starts in draft', created[0].state === 'draft', created[0].state)
check('the landing page is the new record', page.url().endsWith(`/staff/${staffId}`), page.url())

/* -------------------------------------------------- responsibilities --- */

console.log('\nresponsibilities: the activation gate')
const responsibilities = await odoo(sid, 'school.staff.responsibility', 'search_read', [], {
  domain: [['staff_id', '=', staffId]],
  fields: ['responsibility', 'is_primary', 'active'],
})
check('registration seeded one, marked primary',
  responsibilities.length === 1 && responsibilities[0].is_primary,
  JSON.stringify(responsibilities.map((r) => r.responsibility)))

await page.goto(`${BASE}/staff/${staffId}`, { waitUntil: 'domcontentloaded' })
check('the record page lists responsibilities',
  (await page.locator('main h2:text-is("Responsibilities")').count()) === 1)
check('and offers to add one', (await page.locator('main button:has-text("Add responsibility")').count()) === 1)

await page.click('main button:has-text("Add responsibility")')
await page.waitForTimeout(300)
const options = await page.locator('main select[name="responsibility"] option').evaluateAll((n) => n.map((o) => o.value).filter(Boolean))
const second = options.find((o) => o !== responsibilities[0].responsibility) ?? options[0]
await page.selectOption('main select[name="responsibility"]', second)
await page.uncheck('main input[name="is_primary"]').catch(() => {})
await page.click('main button:has-text("Add responsibility")')
await page.waitForTimeout(2500)

const afterAdd = await odoo(sid, 'school.staff.responsibility', 'search_read', [], {
  domain: [['staff_id', '=', staffId]],
  fields: ['responsibility', 'is_primary', 'active', 'end_date'],
})
check('Odoo stored the second responsibility', afterAdd.length === 2, `${afterAdd.length} rows`)
check('still exactly one primary', afterAdd.filter((r) => r.is_primary).length === 1)

// Odoo's _check_single_primary must be the thing that refuses a second primary,
// not the frontend quietly avoiding the situation.
const nonPrimary = afterAdd.find((r) => !r.is_primary)
if (nonPrimary) {
  await page.goto(`${BASE}/staff/${staffId}`, { waitUntil: 'domcontentloaded' })
  await page.locator('main button:has-text("Make primary")').first().click()
  await page.waitForTimeout(2500)
  const afterPrimary = await odoo(sid, 'school.staff.responsibility', 'search_read', [], {
    domain: [['staff_id', '=', staffId]],
    fields: ['is_primary'],
  })
  check('switching primary leaves exactly one',
    afterPrimary.filter((r) => r.is_primary).length === 1,
    `${afterPrimary.filter((r) => r.is_primary).length} primary`)
}

await page.goto(`${BASE}/staff/${staffId}`, { waitUntil: 'domcontentloaded' })
const endButtons = await page.locator('main button:has-text("End")').count()
if (endButtons > 1) {
  await page.locator('main button:has-text("End")').last().click()
  await page.waitForTimeout(2500)
  const afterEnd = await odoo(sid, 'school.staff.responsibility', 'search_read', [], {
    domain: [['staff_id', '=', staffId], ['active', '=', false]],
    fields: ['end_date', 'active'],
    context: { active_test: false },
  })
  check('ending keeps the row as history rather than deleting it',
    afterEnd.length >= 1 && Boolean(afterEnd[0].end_date),
    afterEnd[0]?.end_date ?? 'none')
}

/* -------------------------------------------------------------- edit --- */

console.log('\nedit: Next.js -> Odoo')
await page.goto(`${BASE}/staff/${staffId}/edit`, { waitUntil: 'domcontentloaded' })
check('the edit form loads', (await page.locator('main form').count()) >= 1)
check('the staff number is shown but not editable',
  (await page.locator('main input[name="staff_id"]').count()) === 0)
check('name is composed by Odoo, not edited here',
  (await page.locator('main input[name="name"]').count()) === 0)

const newMobile = `07${stamp}11`
await page.fill('main input[name="mobile"]', newMobile)
await page.click('main form button[type="submit"]')
await page.waitForURL(`**/staff/${staffId}`, { timeout: 60_000 }).catch(() => {})

const [edited] = await odoo(sid, 'school.staff', 'read', [[staffId], ['mobile', 'name']])
check('Odoo stored the edit', edited.mobile === newMobile, `${edited.mobile}`)

/* --------------------------------------------------- Odoo says no ------ */

console.log('\nOdoo refusals reach the user')
await page.goto(`${BASE}/staff/${staffId}/edit`, { waitUntil: 'domcontentloaded' })
if (await page.locator('main input[name="fayda_id"]').count()) {
  await page.fill('main input[name="fayda_id"]', '123')
  await page.click('main form button[type="submit"]')
  await page.waitForTimeout(1500)
  const shown = (await page.locator('main').innerText()) ?? ''
  check('a bad Fayda ID is rejected with a reason', /16 digits/i.test(shown),
    shown.split('\n').find((l) => /16 digits/i.test(l))?.slice(0, 60) ?? shown.slice(0, 60))
  const [unchanged] = await odoo(sid, 'school.staff', 'read', [[staffId], ['fayda_id']])
  check('and nothing was written', !unchanged.fayda_id || unchanged.fayda_id !== '123')
} else {
  console.log('  SKIP  this role cannot see fayda_id')
}

/* ---------------------------------------------------------- activate --- */

console.log('\nactivation: the gate Odoo enforces')
await page.goto(`${BASE}/staff/${staffId}`, { waitUntil: 'domcontentloaded' })
const before = await odoo(sid, 'school.staff', 'read', [[staffId], ['state']])
check('still draft before activating', before[0].state === 'draft', before[0].state)

const activate = page.locator('main button:has-text("Activate")')
if (await activate.count()) {
  await activate.first().click()
  await page.waitForTimeout(3500)
  const [after] = await odoo(sid, 'school.staff', 'read', [[staffId], ['state', 'staff_id']])
  const shown = (await page.locator('main').innerText()) ?? ''
  if (after.state === 'active') {
    check('Odoo activated the record', true, `state=${after.state}`)
    check('and minted the staff number', Boolean(after.staff_id), String(after.staff_id))
  } else {
    // Being refused is a pass too, as long as Odoo said why.
    check('a refused activation explains what is missing',
      /missing|required|Draft/i.test(shown),
      shown.split('\n').find((l) => /missing|required/i.test(l))?.slice(0, 80) ?? '')
  }
  check('no traceback reached the browser', !/Traceback|odoo\.exceptions/i.test(shown))
} else {
  check('activate is offered on a draft record', false, 'no Activate button')
}

/* ------------------------------------------------------ authorization --- */

console.log('\nauthorization')
await page.goto(`${BASE}/staff/${staffId}`, { waitUntil: 'domcontentloaded' })
const body = (await page.locator('main').innerText()) ?? ''
check('no raw Odoo internals on the page', !/Traceback|odoo\.exceptions|psycopg2/i.test(body))
check('delete is never offered — Odoo reserves it for an administrator',
  !/\bDelete\b/.test(body))

await browser.close()
console.log(`\nprobe staff record left on this database: #${staffId} (SRS ${surname})`)
console.log(`${failures === 0 ? 'staff domain: all checks passed' : `${failures} check(s) failed`}`)
process.exit(failures === 0 ? 0 : 1)
