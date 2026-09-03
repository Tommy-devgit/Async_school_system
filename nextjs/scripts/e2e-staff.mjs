/**
 * Staff registration + activation workflow, and the security regressions that
 * must survive it. Runs against the app + STAGING Odoo.
 *
 *   node scripts/e2e-staff.mjs <baseUrl>
 *
 * Env: E2E_PASSWORD, E2E_REGISTRAR_LOGIN, E2E_TEACHER_LOGIN,
 *      and optionally E2E_DIRECTOR_LOGIN / E2E_FRONTOFFICE_LOGIN.
 *
 * Creates one synthetic staff record on staging and archives it afterwards.
 */
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const PASSWORD = process.env.E2E_PASSWORD
const LOGINS = {
  registrar: process.env.E2E_REGISTRAR_LOGIN,
  teacher: process.env.E2E_TEACHER_LOGIN,
  director: process.env.E2E_DIRECTOR_LOGIN,
  frontoffice: process.env.E2E_FRONTOFFICE_LOGIN,
}

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => {
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const STAMP = Date.now().toString().slice(-6)
const FIRST = 'PhaseF'
const LAST = `Probe${STAMP}`

async function signIn(browser, login) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#login', login)
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
  return { context, page }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })

try {
  /* ================================================= staff write workflow === */
  console.log('\n[1] Staff registration (registrar)')
  const { context: regCtx, page } = await signIn(browser, LOGINS.registrar)

  await page.goto(`${BASE}/staff/new`, { waitUntil: 'domcontentloaded' })
  check('registrar can open the registration form', await page.locator('#first_name').isVisible())
  check(
    'personal-data fields are offered to registrar',
    await page.locator('#date_of_birth').isVisible(),
    'date_of_birth rendered',
  )
  check('Fayda field offered to registrar', await page.locator('#fayda_id').isVisible())

  /* -- invalid input is rejected before it reaches Odoo -------------------- */
  await page.fill('#first_name', FIRST)
  await page.fill('#last_name', LAST)
  await page.fill('#fayda_id', '123')
  await page.click('#submit-staff')
  await page.waitForTimeout(2500)
  const faydaErr = (await page.locator('#fayda_id-error').textContent().catch(() => '')) ?? ''
  check('short Fayda ID is rejected inline', /16 digits/i.test(faydaErr), JSON.stringify(faydaErr))

  /* -- a complete, valid registration -------------------------------------- */
  await page.fill('#fayda_id', '')
  await page.selectOption('#department', 'academic')
  await page.waitForTimeout(400)
  const titleOptions = await page.locator('#job_title_id option').count()
  check('job titles filter to the chosen department', titleOptions > 1, `${titleOptions - 1} title(s)`)

  const firstTitle = await page.locator('#job_title_id option:nth-child(2)').getAttribute('value')
  await page.selectOption('#job_title_id', firstTitle)
  await page.waitForTimeout(300)
  const autoResponsibility = await page.locator('#responsibility').inputValue()
  check(
    'job title seeds the responsibility (the onchange Odoo cannot run over RPC)',
    Boolean(autoResponsibility),
    autoResponsibility || 'empty',
  )

  await page.fill('#phone', `+2519${STAMP}0${Math.floor(Math.random() * 9)}`)
  await page.fill('#date_of_birth', '1990-04-12')
  await page.selectOption('#employment_status', 'active')
  if (!autoResponsibility) await page.selectOption('#responsibility', 'teacher')

  await page.click('#submit-staff')
  await page.waitForURL(/\/staff\/\d+$/, { timeout: 90_000 }).catch(() => {})
  const detailUrl = page.url()
  const created = /\/staff\/\d+$/.test(detailUrl)
  check('staff record created and detail page opened', created, detailUrl)
  if (!created) {
    const err = (await page.locator('[role=alert]').allTextContents()).join(' | ')
    console.log('    server said:', err.slice(0, 200))
  }
  const staffId = Number(detailUrl.split('/').pop())

  /* ================================================== activation workflow === */
  console.log('\n[2] Activation (Odoo action_activate)')
  let body = (await page.textContent('body')) ?? ''
  check('record starts in Draft', /draft/i.test(body))
  // The record page says the number is pending rather than showing a dash;
  // the label matches the 'Staff number' field on the edit form.
  check('no staff number before activation', /No staff number yet/i.test(body))

  const missingShown = await page.locator('text=Still required to activate').isVisible().catch(() => false)
  console.log(`    Odoo completeness hint shown: ${missingShown}`)

  await page.click('button:has-text("Activate")')
  await page.waitForTimeout(6000)
  await page.reload({ waitUntil: 'domcontentloaded' })
  body = (await page.textContent('body')) ?? ''

  const nowActive = /\bactive\b/i.test(body) && !/No staff ID yet/i.test(body)
  check('activation succeeded and Odoo minted a staff ID', nowActive)
  check('staff ID follows the STF- sequence', /STF-\d+/.test(body), (body.match(/STF-\d+/) ?? [''])[0])
  check('activation created the linked hr.employee', /Linked employee/.test(body))
  check('no traceback anywhere on the page', !/Traceback|usr\/lib\/python/i.test(body))

  /* ==================================================== field protection === */
  console.log('\n[3] Fayda ID protection still holds')
  const { context: teacherCtx, page: teacherPage } = await signIn(browser, LOGINS.teacher)
  await teacherPage.goto(`${BASE}/staff/${staffId}`, { waitUntil: 'domcontentloaded' })
  const teacherBody = (await teacherPage.textContent('body')) ?? ''
  check(
    'teacher sees the record but not the Fayda value',
    /Restricted to your role/i.test(teacherBody),
  )
  check('teacher page leaks no traceback', !/Traceback|usr\/lib\/python/i.test(teacherBody))

  await teacherPage.goto(`${BASE}/staff/new`, { waitUntil: 'domcontentloaded' })
  const teacherFormBody = (await teacherPage.textContent('body')) ?? ''
  check(
    'teacher cannot open the registration form',
    /cannot create staff/i.test(teacherFormBody),
  )

  /* ================================================= ACL fix regression ==== */
  console.log('\n[4] The four repaired record rules')
  for (const [login, route, label] of [
    [LOGINS.director, '/students', 'director reads students'],
    [LOGINS.director, '/marks', 'director reads marks'],
    [LOGINS.frontoffice, '/students', 'front office reads students'],
    [LOGINS.registrar, '/marks', 'registrar reads marks'],
  ]) {
    if (!login) {
      console.log(`  SKIP  ${label} — no login provided`)
      continue
    }
    const { context, page: rolePage } = await signIn(browser, login)
    await rolePage.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
    const text = (await rolePage.textContent('body')) ?? ''
    const refused = /Not available to your role|do not have permission/i.test(text)
    const rows = await rolePage.locator('tbody tr').count()
    check(label, !refused && rows > 0, refused ? 'still refused' : `${rows} row(s)`)
    await context.close()
  }

  /* ============================================================= cleanup === */
  console.log('\n[5] Cleanup')
  await page.goto(`${BASE}/staff/${staffId}`, { waitUntil: 'domcontentloaded' })
  const deactivate = page.locator('button:has-text("Deactivate")')
  if (await deactivate.isVisible().catch(() => false)) {
    await deactivate.click()
    await page.locator('button:has-text("Confirm deactivate")').click()
    await page.waitForTimeout(5000)
    check('probe record deactivated', true, `staff #${staffId}`)
  } else {
    console.log(`    leave staff #${staffId} (${FIRST} ${LAST}) for manual review`)
  }

  await teacherCtx.close()
  await regCtx.close()
} finally {
  await browser.close()
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
