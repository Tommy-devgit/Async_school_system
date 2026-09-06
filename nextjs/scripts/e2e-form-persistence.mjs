/**
 * A refused submit must not throw away what the user typed or chose.
 *
 * React 19 calls `form.reset()` once a form action returns, including when it
 * returns a validation error. Echoing the submitted values back is not enough
 * on its own: a `<select>` ignores a changed `defaultValue` and resets to
 * whatever it was created with, so a refused save silently reverts the choice
 * to a plausible-looking old value. See `useFormResponse` in components/ui/form.
 *
 * The other half is the action's: a form can only re-seed from values the
 * action hands back, and several actions used to return an error and nothing
 * else. `submitted()` in lib/form-values is the shared echo those now use.
 *
 * Every case here is chosen so the refusal happens *before* anything is
 * written — a weak password, a sign-in with the wrong password, a second
 * primary responsibility Odoo rejects outright. So this suite reads and never
 * writes, but it still asks the production guard first, because the next
 * person to add a case here should not have to remember to.
 *
 *   ODOO_BASE_URL / ODOO_DB   the Odoo behind the app under test
 *   E2E_PASSWORD              shared demo password
 *   E2E_REGISTRAR_LOGIN       a role that may create teaching profiles
 */
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const PASSWORD = process.env.E2E_PASSWORD
const LOGIN = process.env.E2E_REGISTRAR_LOGIN

let failures = 0
const check = (label, ok, extra = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

if (!LOGIN || !PASSWORD) {
  console.log('\nform persistence: SKIPPED — needs E2E_REGISTRAR_LOGIN and E2E_PASSWORD')
  process.exit(0)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('#login', LOGIN)
await page.fill('#password', PASSWORD)
await page.click('#submit-login')
await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })

await page.goto(`${BASE}/teachers/new`, { waitUntil: 'domcontentloaded' })
await page.locator('select[name="staff_id"]').waitFor({ timeout: 30_000 })

/* --------------------------------------------------- fill the whole form --- */

const staffOptions = await page.locator('select[name="staff_id"] option').all()
let staffValue = ''
for (const option of staffOptions) {
  const value = await option.getAttribute('value')
  if (value) { staffValue = value; break }
}
check('there is an eligible staff member to choose', Boolean(staffValue))
if (!staffValue) {
  await browser.close()
  console.log('\nform persistence: no eligible staff — cannot exercise the form')
  process.exit(1)
}

await page.selectOption('select[name="staff_id"]', staffValue)

// A second select, this one uncontrolled: it must survive for its own reasons.
const statusOptions = await page.locator('select[name="teaching_status"] option').all()
const statusValues = []
for (const option of statusOptions) {
  const value = await option.getAttribute('value')
  if (value) statusValues.push(value)
}
const initialStatus = await page.inputValue('select[name="teaching_status"]')
const chosenStatus = statusValues.find((value) => value !== initialStatus)
check('teaching status offers something other than its default', Boolean(chosenStatus))
if (chosenStatus) await page.selectOption('select[name="teaching_status"]', chosenStatus)

await page.fill('input[name="qualification"]', 'MSc Applied Mathematics')
await page.fill('input[name="specialization"]', 'Mathematics, Physics')
await page.fill('input[name="years_of_experience"]', '7')

const read = async () => ({
  staff: await page.inputValue('select[name="staff_id"]'),
  status: await page.inputValue('select[name="teaching_status"]'),
  qualification: await page.inputValue('input[name="qualification"]'),
  specialization: await page.inputValue('input[name="specialization"]'),
  years: await page.inputValue('input[name="years_of_experience"]'),
})

const entered = await read()
console.log(`\nentered: ${JSON.stringify(entered)}`)

/* ------------------------------------------------------- refuse it, twice --- */

const submit = async () => {
  await page.fill('input[name="login_password"]', 'weak')
  await page.locator('button:has-text("Create teaching profile")').click()
  await page.waitForTimeout(2500)
}

const survived = async (label, before) => {
  const after = await read()
  for (const field of Object.keys(before)) {
    check(`${label}: ${field} kept`, after[field] === before[field], `${before[field]} → ${after[field]}`)
  }
}

console.log('\nthe first refusal keeps the whole form')
await submit()
check(
  'the refusal is shown',
  /uppercase letter/i.test((await page.locator('main').textContent()) ?? ''),
)
check('it did not navigate away', page.url().includes('/teachers/new'), page.url())
await survived('first refusal', entered)

/*
  The same values again. A rebuild keyed on the reply's *contents* would find
  nothing changed and skip the rebuild, so the second refusal would lose what
  the first one kept — which is exactly when a user is most likely to be
  paying attention.
*/
console.log('\nand so does a second refusal with the same values')
await submit()
await survived('second refusal', entered)

/* ------------------------------------------- nothing was created by this --- */

check(
  'no teaching profile was created',
  page.url().includes('/teachers/new'),
  'the action refuses before it writes',
)

/* ------------------------------------ a refused sign-in keeps the email --- */

/*
  The login form is the one every user meets, and mistyping a password used to
  cost the email address as well — on exactly the shared machines where school
  logins are least convenient to retype.
*/
console.log('\na refused sign-in keeps the email address')
const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const anonPage = await anon.newPage()
await anonPage.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await anonPage.fill('#login', LOGIN)
await anonPage.fill('#password', 'definitely-not-the-password')
await anonPage.click('#submit-login')
await anonPage.waitForTimeout(2500)

check('the sign-in was refused', anonPage.url().includes('/login'), anonPage.url())
check('a refusal is shown', (await anonPage.locator('[role="alert"]').count()) > 0)
check(
  'the email is still there',
  (await anonPage.inputValue('#login')) === LOGIN,
  await anonPage.inputValue('#login'),
)
check(
  'the password was not echoed back',
  (await anonPage.inputValue('#password')) === '',
  'a password must never be re-rendered into the page',
)

// The same refusal twice, which is what a half-remembered password looks like.
await anonPage.fill('#password', 'still-not-the-password')
await anonPage.click('#submit-login')
await anonPage.waitForTimeout(2500)
check(
  'after a second refusal the email is still there',
  (await anonPage.inputValue('#login')) === LOGIN,
)
await anon.close()

/* ------------------------ a refused responsibility keeps what was chosen --- */

/*
  An Odoo refusal rather than a client-side one: `_check_single_primary`
  rejects a second primary responsibility, and rejects it during create, so
  nothing is written. Before the echo this cost the department, the date and
  the tick as well as the refusal.
*/
const STAFF_ID = process.env.E2E_STAFF_ID
if (STAFF_ID) {
  console.log('\na refused responsibility keeps what was chosen')
  await page.goto(`${BASE}/staff/${STAFF_ID}`, { waitUntil: 'domcontentloaded' })
  await page.locator('main h1').first().waitFor({ timeout: 30_000 })

  const addButton = page.locator('button:has-text("Add responsibility")')
  if ((await addButton.count()) > 0) {
    await addButton.click()
    const form = page.locator('form:has(select[name="responsibility"])').last()
    await form.locator('select[name="responsibility"]').waitFor({ timeout: 10_000 })

    const firstValue = async (selector) => {
      for (const option of await form.locator(`${selector} option`).all()) {
        const value = await option.getAttribute('value')
        if (value) return value
      }
      return ''
    }

    const responsibility = await firstValue('select[name="responsibility"]')
    const department = await firstValue('select[name="department"]')
    await form.locator('select[name="responsibility"]').selectOption(responsibility)
    if (department) await form.locator('select[name="department"]').selectOption(department)
    await form.locator('input[name="start_date"]').fill('2026-03-03')

    // The refusal: this staff member already holds a primary responsibility.
    const primary = form.locator('input[name="is_primary"]')
    if (!(await primary.isChecked())) await primary.check()

    await form.locator('button:has-text("Add responsibility")').click()
    await page.waitForTimeout(2500)

    const shown = (await page.locator('main').textContent()) ?? ''
    check('Odoo refused the second primary', /primary/i.test(shown))

    const after = page.locator('form:has(select[name="responsibility"])').last()
    check(
      'the responsibility is still chosen',
      (await after.locator('select[name="responsibility"]').inputValue()) === responsibility,
    )
    if (department) {
      check(
        'the department is still chosen',
        (await after.locator('select[name="department"]').inputValue()) === department,
      )
    }
    check(
      'the start date is still there',
      (await after.locator('input[name="start_date"]').inputValue()) === '2026-03-03',
    )
    check(
      'the primary box is still ticked',
      await after.locator('input[name="is_primary"]').isChecked(),
    )
  } else {
    console.log('  SKIPPED — this role is offered no Add responsibility control')
  }
} else {
  console.log('\nresponsibility echo: SKIPPED — set E2E_STAFF_ID to a staff member with a primary')
}

/* --------------------------- a refused term keeps every field it was given --- */

/*
  A configuration form, and one refused by validation rather than by Odoo: an
  end date before the start date. Nothing is written, and before the echo the
  name, the year, both dates and the order were all thrown away with the
  refusal — on a screen where every row is its own form, so the refusal also
  had to land on the right one.
*/
console.log('\na refused term keeps every field it was given')
await page.goto(`${BASE}/configuration/terms`, { waitUntil: 'domcontentloaded' })
await page.locator('main h1').first().waitFor({ timeout: 30_000 })

const addTerm = page.locator('form:has(#new-name)')
if ((await addTerm.count()) === 0) {
  console.log('  SKIPPED — this role is offered no add-a-term form')
} else {
  const termName = 'Persistence probe term'
  await page.fill('#new-name', termName)
  await page.fill('#new-start', '2026-06-01')
  await page.fill('#new-end', '2026-01-01') // before the start: refused
  await page.fill('#new-sequence', '7')
  const yearChosen = await page.inputValue('#new-year')

  await addTerm.locator('button[type="submit"]').click()
  await page.waitForTimeout(2500)

  const refusal = (await page.locator('main').textContent()) ?? ''
  check('the backwards date range was refused', /cannot be before/i.test(refusal))
  check('no traceback reached the browser', !/Traceback|odoo\.exceptions/i.test(refusal))

  check('the name survived', (await page.inputValue('#new-name')) === termName)
  check('the start date survived', (await page.inputValue('#new-start')) === '2026-06-01')
  check('the end date survived', (await page.inputValue('#new-end')) === '2026-01-01')
  check('the order survived', (await page.inputValue('#new-sequence')) === '7')
  check('the academic year survived', (await page.inputValue('#new-year')) === yearChosen)

  // The refusal belongs to the add form, not to one of the existing rows.
  const rows = await page.locator('main table tbody input[name="name"]').all()
  const rowNames = await Promise.all(rows.map((input) => input.inputValue()))
  check(
    'no existing term row was disturbed',
    rowNames.every((value) => value !== termName),
    `${rowNames.length} row(s) checked`,
  )
}

await browser.close()
console.log(failures === 0 ? '\nform persistence: ok' : `\nform persistence: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
