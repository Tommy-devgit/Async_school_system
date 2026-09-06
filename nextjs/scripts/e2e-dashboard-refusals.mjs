/**
 * A dashboard shows what a role can do, not a list of what it cannot.
 *
 * The shared dashboard — used by the Exam Officer, the HR Officer and anyone
 * else without one of their own — rendered every tile and every panel and let
 * each one say "Not available to your role" when Odoo refused the model. An
 * exam officer got that for staff; an HR officer got it four times over, for
 * marks and report cards. Most of a screen spent saying no.
 *
 * A refusal is still shown where it is news — opening a screen you may not
 * read — and omitted where it is only the shape of the job.
 *
 *   E2E_PASSWORD              shared demo password
 *   E2E_EXAM_LOGIN            an exam officer: no staff access
 *   E2E_HR_LOGIN              an HR officer: no marks or report cards
 *   E2E_ADMIN_LOGIN           reads everything — the control case
 *
 * Read-only.
 */
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const PASSWORD = process.env.E2E_PASSWORD

let failures = 0
const check = (label, ok, extra = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

if (!PASSWORD) {
  console.log('\ndashboard refusals: SKIPPED — needs E2E_PASSWORD')
  process.exit(0)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })

async function dashboard(login) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login', login)
  await page.fill('#password', PASSWORD)
  await page.click('#submit-login')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
  await page.locator('main').first().waitFor({ timeout: 30_000 })
  const text = (await page.locator('main').textContent()) ?? ''
  await context.close()
  return text
}

const ROLES = {
  exam: process.env.E2E_EXAM_LOGIN,
  hr: process.env.E2E_HR_LOGIN,
  admin: process.env.E2E_ADMIN_LOGIN,
}

for (const [role, login] of Object.entries(ROLES)) {
  if (!login) {
    console.log(`\n${role}: SKIPPED — no login configured`)
    continue
  }

  console.log(`\n${role}`)
  const text = await dashboard(login)
  const refusals = (text.match(/Not available to your role/g) ?? []).length

  check('the dashboard rendered', text.length > 200 && !/Something went wrong/i.test(text))
  check('nothing it cannot read is advertised', refusals === 0, `${refusals} refusal panel(s)`)

  /*
    Non-vacuous: an empty dashboard would also have no refusals. Each role must
    still be shown the thing its job is about.
  */
  if (role === 'exam') {
    check('but the assessment work is still there', /Mark lists/i.test(text))
    check('and staff, which it cannot read, is gone', !/\bStaff\b/.test(text))
  }
  if (role === 'hr') {
    check('but the staff figures are still there', /\bStaff\b/.test(text))
    check('and marks, which it cannot read, are gone', !/Mean mark/i.test(text))
    check('as are report cards', !/Report cards/i.test(text))
  }
  if (role === 'admin') {
    // The control: a role that reads everything must lose nothing.
    check('staff is present', /\bStaff\b/.test(text))
    check('mean mark is present', /Mean mark/i.test(text))
    check('report cards are present', /Report cards/i.test(text))
  }
}

await browser.close()
console.log(failures === 0 ? '\ndashboard refusals: ok' : `\ndashboard refusals: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
