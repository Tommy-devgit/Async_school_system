/**
 * Route state — the answers a screen gives before, instead of, and around its
 * data: the skeleton while Odoo is being asked, the page for a record that is
 * not there, a page past the end of a list, and the two refusals a server
 * action owes a submission the browser did not build.
 *
 * These are the states a happy-path suite never reaches, which is why they
 * were all missing at once.
 *
 * Read-only. Both refusal checks assert that nothing was created.
 */
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const LOGIN = process.env.E2E_REGISTRAR_LOGIN
const PASSWORD = process.env.E2E_PASSWORD
const SHOTS = process.env.SHOTS

if (!LOGIN || !PASSWORD) {
  console.error('E2E_REGISTRAR_LOGIN and E2E_PASSWORD must be set.')
  process.exit(1)
}

let failures = 0
const consoleErrors = []
/*
  One navigation in this suite is *supposed* to 404, and the browser logs a
  console error for the failed document request when it does. Collection is
  paused across that step rather than filtered afterwards, so a genuine error
  raised on the same page is still caught.
*/
let collecting = true
const check = (label, ok, extra = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}
/** Screenshots help a human read a failure; never required for the verdict. */
const shot = (target, name) => (SHOTS ? target.screenshot({ path: `${SHOTS}/${name}.png` }) : null)

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
page.on('console', (m) => { if (collecting && m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('input[name="login"]', LOGIN)
await page.fill('input[name="password"]', PASSWORD)
await Promise.all([
  page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60000 }),
  page.click('button[type="submit"]'),
])

/*
  The loading boundary.

  A healthy Odoo answers in a few hundred milliseconds, which is too brief to
  catch and is not the case the boundary exists for. Delaying the RSC response
  reproduces the cold backend that lib/odoo/errors.ts already apologises for.
*/
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
await page.route(
  (url) => url.pathname === '/students',
  async (route) => {
    if (route.request().headers().rsc) await new Promise((resolve) => setTimeout(resolve, 2500))
    await route.continue()
  },
)
await page.locator('a[href="/students"]').first().click({ noWaitAfter: true })
let announced = null
for (let i = 0; i < 30 && announced === null; i++) {
  if (await page.locator('[role="status"]').count()) {
    announced = (await page.locator('[role="status"] .sr-only').first().textContent())?.trim()
    await shot(page, '01-loading')
  } else {
    await page.waitForTimeout(100)
  }
}
check('a slow navigation draws a skeleton, announced to a screen reader',
  announced !== null, announced ? `"${announced}"` : '')
await page.unroute((url) => url.pathname === '/students')

// A record id that cannot exist, and an address that matches no route at all.
await page.goto(`${BASE}/students/99999999`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
check('a missing record says so', /Not found/i.test((await page.textContent('body')) ?? ''))
check('and keeps the navigation, so there is a way back',
  (await page.locator('nav').count()) > 0)
await shot(page, '02-not-found')

collecting = false
const unmatched = await page.goto(`${BASE}/no-such-route`, { waitUntil: 'networkidle' })
check('an unmatched address says so', /Page not found/i.test((await page.textContent('body')) ?? ''))
check('and answers 404 rather than a soft 200', unmatched?.status() === 404, String(unmatched?.status()))
await shot(page, '03-root-404')
collecting = true

/*
  A page past the end of the list.

  Pagination hides itself at one page or fewer, so without the redirect this is
  an empty table, a message about filters the reader never set, and no offered
  way back.
*/
await page.goto(`${BASE}/students?page=99999`, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
/*
  The landing page is the last real one, which is only page 1 when the list
  fits on a single page. This asserted the `page` parameter was gone, so it
  passed on a small database and failed the moment there were twenty-six
  students — reporting the redirect as broken while it was working exactly as
  intended. What matters is that the reader ends up somewhere with rows on it.
*/
const landedOn = Number(new URL(page.url()).searchParams.get('page') ?? '1')
check('a page past the end lands on a real one', landedOn < 99999, page.url())
check('and shows rows once it gets there', (await page.locator('main tbody tr').count()) > 0)

await page.goto(`${BASE}/students`, { waitUntil: 'networkidle' })
check('the list itself still renders', (await page.locator('main tbody tr').count()) > 0)
await shot(page, '04-students')

/*
  Both refusals, on the staff form.

  novalidate lifts the browser's own gate so the submission actually reaches
  the server action, which is the layer under test. It is scoped to this one
  form: the sidebar's sign-out is also a <form> with a submit button, and it
  comes first in the DOM.
*/
await page.goto(`${BASE}/staff/new`, { waitUntil: 'networkidle' })
await page.evaluate(() => {
  document.querySelector('input[name="first_name"]')?.closest('form')?.setAttribute('novalidate', '')
})
const form = page.locator('form:has(input[name="first_name"])')
const submit = form.locator('button[type="submit"]').first()
await form.locator('input[name="first_name"]').fill('E2E')
await form.locator('input[name="last_name"]').fill('RouteStates')

await form.locator('input[name="email"]').fill('not-an-email')
await submit.click({ noWaitAfter: true })
await page.waitForTimeout(2500)
check('a malformed email is refused by the server, not only the browser',
  /valid email address/i.test((await page.textContent('body')) ?? ''))
check('and nothing was created', new URL(page.url()).pathname === '/staff/new')
await shot(page, '05-email-refused')

await form.locator('input[name="email"]').fill('e2e@example.et')
await page.evaluate(() => {
  // A value no <select> would ever post. Number() would make it NaN, which has
  // no JSON form and reaches Odoo as null — read there as "clear the field".
  const select = document.querySelector('select[name="job_title_id"]')
  const option = document.createElement('option')
  option.value = 'abc'
  select.appendChild(option)
  select.value = 'abc'
  select.dispatchEvent(new Event('change', { bubbles: true }))
})
await submit.click({ noWaitAfter: true })
await page.waitForTimeout(2500)
check('a relational id that is not a number is refused, not sent as null',
  /Choose a job title|valid option/i.test((await page.textContent('body')) ?? ''))
check('and nothing was created', new URL(page.url()).pathname === '/staff/new')
await shot(page, '06-relational-refused')

// The narrowest phone width the project designs for.
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })
await mobile.addCookies(await context.cookies())
const mobilePage = await mobile.newPage()
mobilePage.on('pageerror', (e) => consoleErrors.push(`mobile pageerror: ${e.message}`))
await mobilePage.goto(`${BASE}/students`, { waitUntil: 'networkidle' })
const overflow = await mobilePage.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
)
check('the list does not scroll sideways at 390px', overflow === 0, `${overflow}px`)
await shot(mobilePage, '07-students-mobile')
await mobilePage.goto(`${BASE}/students/99999999`, { waitUntil: 'networkidle' })
await shot(mobilePage, '08-not-found-mobile')
await mobile.close()

check('no console errors along the way', consoleErrors.length === 0,
  consoleErrors.slice(0, 3).join(' | '))

await browser.close()
process.exit(failures === 0 ? 0 : 1)
