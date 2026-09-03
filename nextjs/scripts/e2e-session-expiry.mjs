/**
 * Reproduces the dead end a user hits when the Odoo session expires while this
 * app's own cookie is still valid, and proves the way out.
 *
 *   node scripts/e2e-session-expiry.mjs <baseUrl>
 *
 * Forges a correctly-signed app session containing an Odoo session id that no
 * longer exists — which is exactly what an expired Odoo session looks like
 * from here. Reads SESSION_SECRET from .env.local.
 */
import { chromium } from 'playwright-core'
import { SignJWT } from 'jose'
import { readFileSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:3100'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.includes('='))
    .map((line) => {
      const index = line.indexOf('=')
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()]
    }),
)

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => {
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const secret = new TextEncoder().encode(env.SESSION_SECRET)
const token = await new SignJWT({
  odooSessionId: 'this-odoo-session-no-longer-exists',
  uid: 999,
  login: 'ghost@example.invalid',
  name: 'Ghost Session',
  user: { id: 999, name: 'Ghost Session', login: 'ghost@example.invalid', roles: {} },
})
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt()
  .setExpirationTime('8h')
  .sign(secret)

const browser = await chromium.launch({ channel: 'chrome', headless: true })

try {
  const context = await browser.newContext()
  await context.addCookies([
    {
      name: 'school_session',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ])
  const page = await context.newPage()

  console.log('\n[1] A dead Odoo session must not strand the user')
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  const body = (await page.textContent('body')) ?? ''

  check('lands on the login page', page.url().includes('/login'), page.url())
  check('explains that the session expired', /session expired/i.test(body))
  check('offers the sign-in form', await page.locator('#submit-login').isVisible().catch(() => false))
  check('no raw error page', !/Runtime OdooError|normaliseOdooError|lib\\odoo/i.test(body))
  check('no traceback', !/Traceback|usr\/lib\/python/i.test(body))

  const cookies = await context.cookies()
  const stale = cookies.find((c) => c.name === 'school_session')
  check('the stale cookie is cleared', !stale || !stale.value, stale ? 'still set' : 'cleared')

  console.log('\n[2] Signing in again works from that state')
  await page.fill('#login', process.env.E2E_REGISTRAR_LOGIN ?? '')
  await page.fill('#password', process.env.E2E_PASSWORD ?? '')
  await page.click('#submit-login')
  /*
    What this suite is proving is that a fresh sign-in works after the session
    was destroyed — not where the sign-in lands. `landingPath` sends each role
    somewhere different, so asserting on /dashboard tested the wrong thing and
    failed for every role except admin and director.
  */
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })
  check('signs back in and leaves the login page', !page.url().includes('/login'), page.url())

  await context.close()
} finally {
  await browser.close()
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
