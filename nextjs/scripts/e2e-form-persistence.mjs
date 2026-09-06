/**
 * A refused submit must not throw away what the user typed or chose.
 *
 * React 19 calls `form.reset()` once a form action returns, including when it
 * returns a validation error. Echoing the submitted values back is not enough
 * on its own: a `<select>` ignores a changed `defaultValue` and resets to
 * whatever it was created with, so a refused save silently reverts the choice
 * to a plausible-looking old value. See `useFormResponse` in components/ui/form.
 *
 * /teachers/new is the case this is held against, because it refuses a weak
 * password inside the action, before any Odoo write. So this suite reads and
 * never writes — but it still asks the production guard first, because the
 * next person to add a case here should not have to remember to.
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

await browser.close()
console.log(failures === 0 ? '\nform persistence: ok' : `\nform persistence: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
