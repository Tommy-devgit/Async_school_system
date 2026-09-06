/**
 * Changing an announcement's audience clears the one it replaces.
 *
 * `school.announcement` stores its audience as one field per type and drops
 * the ones that no longer apply in an `@api.onchange('audience_type')` — which
 * never fires over JSON-RPC. So switching a draft from "Class / Section" to
 * "Department" used to set `department` and leave `class_ids` populated.
 * `_check_audience_values` looks only at the field matching the new type, so
 * Odoo accepts it, and the record carries two audiences with one of them
 * invisible on every screen. `action_publish` then resolves recipients from
 * the matching field, so the stale one is inert — until somebody reads it,
 * reports on it, or changes the resolution.
 *
 *   ODOO_BASE_URL / ODOO_DB   the Odoo to read back from
 *   E2E_PASSWORD              shared demo password
 *   E2E_ADMIN_LOGIN           creates, edits and removes announcements — the
 *                             registrar cannot: school.announcement grants
 *                             create to the administrator and front office
 *                             only, and unlink to the administrator alone
 *   E2E_ALLOW_WRITES=yes      required: this suite creates a draft
 */
import { chromium } from 'playwright-core'
import { assertWritable, isMutatingMethod } from './production-guard.mjs'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const ODOO = process.env.ODOO_BASE_URL ?? 'http://localhost:8070'
const DB = process.env.ODOO_DB ?? 'school'
const PASSWORD = process.env.E2E_PASSWORD
const LOGIN = process.env.E2E_ADMIN_LOGIN

let failures = 0
const check = (label, ok, extra = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

async function odoo(sid, model, method, args = [], kwargs = {}) {
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
  console.log('\nannouncement audience: SKIPPED — needs E2E_ADMIN_LOGIN and E2E_ALLOW_WRITES=yes')
  process.exit(0)
}

assertWritable(ODOO, 'the announcement audience suite')

const sid = await odooLogin(LOGIN)
const TITLE = `E2E audience probe ${Date.now()}`
let id = null

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()

const AUDIENCE_FIELDS = [
  'audience_type', 'department', 'responsibility',
  'teacher_ids', 'subject_ids', 'class_ids', 'campus_ids', 'staff_ids',
]

const read = async () => (await odoo(sid, 'school.announcement', 'read', [[id], AUDIENCE_FIELDS]))[0]

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login', LOGIN)
  await page.fill('#password', PASSWORD)
  await page.click('#submit-login')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })

  /* ------------------------------------ a draft targeted at some classes --- */

  console.log('\na draft can be created with a class audience')
  await page.goto(`${BASE}/announcements/new`, { waitUntil: 'networkidle' })
  await page.locator('#name').waitFor({ timeout: 30_000 })

  await page.fill('#name', TITLE)
  await page.fill('#message', 'Audience clearing probe.')
  await page.selectOption('#audience_type', 'class_section')
  await page.locator('#audience_ids').waitFor({ timeout: 10_000 })
  const classValue = await page.locator('#audience_ids option').first().getAttribute('value')
  await page.selectOption('#audience_ids', classValue)

  await page.locator('main form button[type="submit"]').first().click()
  await page.waitForURL(/\/announcements\/\d+$/, { timeout: 60_000 })
  id = Number(/\/announcements\/(\d+)/.exec(page.url())?.[1])
  check('the draft was created', Number.isInteger(id), page.url())

  const first = await read()
  check('the class audience is stored', first.audience_type === 'class_section', String(first.audience_type))
  check('the class is on the record', first.class_ids.includes(Number(classValue)), JSON.stringify(first.class_ids))

  /* ------------------------------- switching audience clears the old one --- */

  console.log('\nchanging the audience clears the one it replaces')
  await page.goto(`${BASE}/announcements/${id}/edit`, { waitUntil: 'networkidle' })
  await page.locator('#audience_type').waitFor({ timeout: 30_000 })
  await page.selectOption('#audience_type', 'department')
  await page.locator('#audience_code').waitFor({ timeout: 10_000 })
  const department = await page.locator('#audience_code option').nth(1).getAttribute('value')
  await page.selectOption('#audience_code', department)

  await page.locator('main form button[type="submit"]').first().click()
  await page.waitForURL(/\/announcements\/\d+$/, { timeout: 60_000 })

  const after = await read()
  check('the new audience is stored', after.audience_type === 'department', String(after.audience_type))
  check('the department is stored', after.department === department, String(after.department))
  check(
    'the classes it replaced were cleared',
    after.class_ids.length === 0,
    `class_ids=${JSON.stringify(after.class_ids)}`,
  )

  // And nothing else was left holding a target either.
  for (const field of ['responsibility', 'teacher_ids', 'subject_ids', 'campus_ids', 'staff_ids']) {
    const value = after[field]
    check(
      `${field} is empty`,
      Array.isArray(value) ? value.length === 0 : !value,
      JSON.stringify(value),
    )
  }
} finally {
  console.log('\ncleaning up')
  if (id) {
    try {
      await odoo(sid, 'school.announcement', 'unlink', [[id]])
      check('the probe announcement was removed', true, `#${id}`)
    } catch (error) {
      console.log(`  note: could not remove announcement ${id} — ${error.message.split('\n')[0]}`)
    }
  }
  await browser.close()
}

console.log(failures === 0 ? '\nannouncement audience: ok' : `\nannouncement audience: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
