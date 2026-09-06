/**
 * Where each role lands after signing in, verified through a real browser
 * session rather than by calling landingPath directly.
 *
 *   node scripts/e2e-role-landing.mjs <baseUrl>
 *
 * Env: E2E_LOGIN, E2E_PASSWORD (an administrator), plus the ODOO_* pair
 * scripts/rpc.mjs reads.
 *
 * MUTATES SHARED STATE and restores it: creates one throwaway res.users per
 * role, signs in as each, then deletes them. It never changes an existing
 * user's password or groups.
 */
import { chromium } from 'playwright-core'
import { login, call } from './rpc.mjs'

const BASE = process.argv[2] ?? 'http://localhost:3101'
/*
  The administrator needs its own variable.

  This read E2E_LOGIN — the generic login every other suite uses — so running
  them together, with E2E_LOGIN set to a registrar, checked that registrar
  against the *administrator's* landing page and reported one failure. The same
  trap was in e2e-navigation-access; this was the other copy of it.
*/
const ADMIN = process.env.E2E_ADMIN_LOGIN
const ADMIN_PASSWORD = process.env.E2E_PASSWORD
if (!ADMIN || !ADMIN_PASSWORD) {
  console.error('Set E2E_ADMIN_LOGIN and E2E_PASSWORD before running this script.')
  process.exit(2)
}

let passed = 0, failed = 0
const check = (name, ok, detail = '') => {
  if (ok) passed++; else failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const STAMP = Date.now().toString().slice(-6)
// Odoo enforces upper, lower, digit, symbol and a minimum length on new users.
const PROBE_PASSWORD = `Pb-${STAMP}-${Math.random().toString(36).slice(2)}A1!`

/** group suffix → the path lib/navigation.landingPath promises for it. */
const EXPECTED = [
  ['registrar', '/students?status=submitted'],
  ['exam_officer', '/assessments?status=submitted'],
  ['hr', '/staff'],
  ['frontoffice', '/students'],
  ['teacher', '/assessments?status=open'],
  ['director', '/dashboard'],
]

await login()
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const created = []

async function landingFor(loginName, password) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#login', loginName)
  await page.fill('#password', password)
  await page.click('#submit-login')
  // Any of the landing targets is a valid destination; wait for movement.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.waitForTimeout(700)
  const url = new URL(page.url())
  const path = url.pathname + url.search
  const heading = await page.locator('h1').first().innerText().catch(() => '')
  await context.close()
  return { path, heading }
}

try {
  /* An administrator holds every group, so precedence must give the overview. */
  const asAdmin = await landingFor(ADMIN, ADMIN_PASSWORD)
  check(
    `administrator (${ADMIN}) lands on the dashboard`,
    asAdmin.path === '/dashboard',
    asAdmin.path,
  )

  for (const [group, expected] of EXPECTED) {
    const [gid] = await call('ir.model.data', 'search_read',
      [[['module', '=', 'school_management'], ['name', '=', `group_school_${group}`]], ['res_id']])
    if (!gid) { check(`${group}: group exists`, false, 'not found'); continue }

    const [baseUser] = await call('ir.model.data', 'search_read',
      [[['module', '=', 'base'], ['name', '=', 'group_user']], ['res_id']])

    const loginName = `probe.${group}.${STAMP}@example.invalid`
    const uid = await call('res.users', 'create', [{
      name: `Probe ${group} ${STAMP}`,
      login: loginName,
      password: PROBE_PASSWORD,
      group_ids: [[6, 0, [baseUser.res_id, gid.res_id]]],
    }])
    created.push(uid)

    const seen = await landingFor(loginName, PROBE_PASSWORD)
    check(`${group} lands on ${expected}`, seen.path === expected,
      `${seen.path}${seen.heading ? ` (${seen.heading})` : ''}`)
  }

  /* The precedence itself: holding two roles must follow the shell's label. */
  const [teacherG] = await call('ir.model.data', 'search_read',
    [[['module', '=', 'school_management'], ['name', '=', 'group_school_teacher']], ['res_id']])
  const [examG] = await call('ir.model.data', 'search_read',
    [[['module', '=', 'school_management'], ['name', '=', 'group_school_exam_officer']], ['res_id']])
  const [baseUser] = await call('ir.model.data', 'search_read',
    [[['module', '=', 'base'], ['name', '=', 'group_user']], ['res_id']])

  const bothLogin = `probe.both.${STAMP}@example.invalid`
  const bothUid = await call('res.users', 'create', [{
    name: `Probe both ${STAMP}`,
    login: bothLogin,
    password: PROBE_PASSWORD,
    group_ids: [[6, 0, [baseUser.res_id, teacherG.res_id, examG.res_id]]],
  }])
  created.push(bothUid)

  const both = await landingFor(bothLogin, PROBE_PASSWORD)
  check('a teacher who is also an exam officer lands on approvals',
    both.path === '/assessments?status=submitted', both.path)

  /* Signing in again while already signed in must not contradict the first. */
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#login', bothLogin)
  await page.fill('#password', PROBE_PASSWORD)
  await page.click('#submit-login')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500)
  const rootUrl = new URL(page.url())
  check('the root route agrees with the login redirect',
    rootUrl.pathname + rootUrl.search === '/assessments?status=submitted',
    rootUrl.pathname + rootUrl.search)

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500)
  const bounced = new URL(page.url())
  check('an already signed-in visitor is bounced to the same place',
    bounced.pathname + bounced.search === '/assessments?status=submitted',
    bounced.pathname + bounced.search)

  check('the dashboard stays reachable for a non-admin',
    (await (async () => {
      await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(400)
      return new URL(page.url()).pathname
    })()) === '/dashboard')
  await context.close()
} catch (error) {
  failed++
  console.log(`  FAIL  threw — ${error.message.split('\n')[0]}`)
} finally {
  if (created.length) {
    await call('res.users', 'unlink', [created])
      .then(() => console.log(`  cleanup: ${created.length} probe users deleted`))
      .catch((e) => console.log(`  WARN  cleanup failed — ${e.message.slice(0, 90)}`))
  }
  await browser.close()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
