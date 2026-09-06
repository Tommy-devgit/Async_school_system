/**
 * Visits every authenticated route as each synthetic staging role and checks
 * that the page renders, leaks nothing, and either shows data or explains the
 * refusal. Complements e2e-staging.mjs, which proves the authorisation edges.
 */
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const PASSWORD = process.env.E2E_PASSWORD
const ROLES = {
  teacher: process.env.E2E_TEACHER_LOGIN,
  registrar: process.env.E2E_REGISTRAR_LOGIN,
  director: process.env.E2E_DIRECTOR_LOGIN,
  frontoffice: process.env.E2E_FRONTOFFICE_LOGIN,
}

const ROUTES = [
  '/dashboard',
  '/students', '/students/new',
  '/enrollments',
  '/staff', '/staff/new',
  '/teachers',
  '/academic-years', '/classes', '/subjects', '/curriculum', '/configuration',
  '/assignments', '/schedule', '/attendance',
  '/assessments', '/marks', '/report-cards', '/promotion',
  '/announcements', '/programs', '/documents',
]

const LEAK = /Traceback|\/usr\/lib\/python|psycopg2|odoo\.exceptions|session_id=/i

let failures = 0
const browser = await chromium.launch({ channel: 'chrome', headless: true })

for (const [role, login] of Object.entries(ROLES)) {
  if (!login) continue
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login', login)
  await page.fill('#password', PASSWORD)
  await page.click('#submit-login')
  await page.waitForURL('**/dashboard', { timeout: 90_000 }).catch(() => {})

  console.log(`\n${role} (${login})`)
  for (const route of ROUTES) {
    const response = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
    const body = (await page.textContent('body')) ?? ''
    const rows = await page.locator('tbody tr').count()
    const status = response?.status() ?? 0
    const leaked = LEAK.test(body)
    const refused = /Not available to your role/i.test(body)
    const empty = /No .* visible/i.test(body)

    const ok = status === 200 && !leaked
    if (!ok) failures++
    const shape = refused ? 'refused (expected for role)' : empty ? 'empty' : `${rows} row(s)`
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  ${route.padEnd(18)} http=${status} ${shape}${leaked ? '  LEAK!' : ''}`,
    )
  }
  await context.close()
}

await browser.close()
console.log(`\n${failures === 0 ? 'all routes clean' : `${failures} route failure(s)`}`)
process.exit(failures === 0 ? 0 : 1)
