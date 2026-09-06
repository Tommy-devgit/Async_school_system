/**
 * Browser verification for the five route-state and validation fixes.
 * Run: node scripts/qa-verify.mjs   (needs the dev server and Odoo up)
 */
import { chromium } from 'playwright-core'

const SHOTS = process.env.SHOTS ?? '/tmp'
const errors = []
const results = []
const check = (name, pass, note = '') => { results.push([name, pass, note]); }

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium' })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' })
await page.fill('input[name="login"]', 'admin')
await page.fill('input[name="password"]', 'admin')
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }),
  page.click('button[type="submit"]'),
])

// #1 — loading boundary. Odoo answers locally in ~250ms, so the RSC response
// is delayed to reproduce the cold backend the fix is actually for.
await page.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded' })
await page.route((url) => url.pathname === '/students', async (route) => {
  if (route.request().headers().rsc) await new Promise((r) => setTimeout(r, 2500))
  await route.continue()
})
await page.locator('a[href="/students"]').first().click({ noWaitAfter: true })
let announced = null
for (let i = 0; i < 30 && announced === null; i++) {
  if (await page.locator('[role="status"]').count()) {
    announced = (await page.locator('[role="status"] .sr-only').first().textContent())?.trim()
    await page.screenshot({ path: `${SHOTS}/01-loading.png` })
  } else await page.waitForTimeout(100)
}
check('#1 loading skeleton renders mid-navigation', announced !== null, `announced "${announced}"`)
await page.unroute((url) => url.pathname === '/students')

// #2 — not-found, inside the shell
await page.goto('http://localhost:3000/students/99999999', { waitUntil: 'domcontentloaded' })
check('#2 missing record shows Not found', /Not found/i.test(await page.textContent('body')))
check('#2 not-found keeps the app navigation', (await page.locator('nav').count()) > 0)
await page.screenshot({ path: `${SHOTS}/02-not-found.png`, fullPage: true })
await page.goto('http://localhost:3000/no-such-route', { waitUntil: 'domcontentloaded' })
check('#2 unmatched URL shows Page not found', /Page not found/i.test(await page.textContent('body')))
await page.screenshot({ path: `${SHOTS}/03-root-404.png` })

// golden path
await page.goto('http://localhost:3000/students', { waitUntil: 'domcontentloaded' })
const rows = await page.locator('tbody tr').count()
check('golden path: students list renders rows', rows > 0, `${rows} rows`)
await page.screenshot({ path: `${SHOTS}/04-students.png`, fullPage: true })

// #5 and #4 — server-side refusals on the staff form
await page.goto('http://localhost:3000/staff/new', { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  // Scope to the staff form: the sidebar's logout form is also a <form> with a
  // submit button, and it comes first in the DOM.
  document.querySelector('input[name="first_name"]')?.closest('form')?.setAttribute('novalidate', '')
})
const form = page.locator('form:has(input[name="first_name"])')
const submit = form.locator('button[type="submit"]').first()
await form.locator('input[name="first_name"]').fill('QA')
await form.locator('input[name="last_name"]').fill('Check')

await form.locator('input[name="email"]').fill('not-an-email')
await submit.click({ noWaitAfter: true })
await page.waitForTimeout(2500)
check('#5 malformed email refused by the server action',
  /valid email address/i.test(await page.textContent('body')))
check('#5 nothing was created', new URL(page.url()).pathname === '/staff/new')
await page.screenshot({ path: `${SHOTS}/05-email-refused.png`, fullPage: true })

await form.locator('input[name="email"]').fill('qa@example.et')
await page.evaluate(() => {
  const sel = document.querySelector('select[name="job_title_id"]')
  const opt = document.createElement('option')
  opt.value = 'abc'
  sel.appendChild(opt)
  sel.value = 'abc'
  sel.dispatchEvent(new Event('change', { bubbles: true }))
})
await submit.click({ noWaitAfter: true })
await page.waitForTimeout(2500)
const relBody = await page.textContent('body')
check('#4 non-numeric relational id refused, not sent as null',
  /Choose a job title|valid option/i.test(relBody))
check('#4 nothing was created', new URL(page.url()).pathname === '/staff/new')
await page.screenshot({ path: `${SHOTS}/06-relational-refused.png`, fullPage: true })

// mobile
const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })
await mob.addCookies(await ctx.cookies())
const mp = await mob.newPage()
mp.on('pageerror', (e) => errors.push(`mobile pageerror: ${e.message}`))
await mp.goto('http://localhost:3000/students', { waitUntil: 'domcontentloaded' })
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
check('mobile 390px: no horizontal overflow', overflow === 0, `${overflow}px`)
await mp.screenshot({ path: `${SHOTS}/07-students-mobile.png`, fullPage: true })
await mp.goto('http://localhost:3000/students/99999999', { waitUntil: 'domcontentloaded' })
await mp.screenshot({ path: `${SHOTS}/08-not-found-mobile.png`, fullPage: true })
await mob.close()

console.log()
for (const [name, pass, note] of results) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${note ? `  (${note})` : ''}`)
console.log(`\nconsole errors: ${errors.length}`)
for (const e of errors.slice(0, 5)) console.log('  ', e)
await browser.close()
process.exit(results.every(([, p]) => p) && errors.length === 0 ? 0 : 1)
