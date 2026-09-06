/**
 * Creating and correcting a program — verified against Odoo, not the page.
 *
 * A program could be listed, opened, published and cancelled, and never
 * entered. Every program in the system had to be created in Odoo's own back
 * office, which is not something a registrar has.
 *
 * The part worth holding is the audience. `school.program` stores it as one
 * field per type, and clears the others in an `@api.onchange('audience_type')`
 * — which never fires over JSON-RPC. So switching a program from one audience
 * to another has to clear the old field explicitly, or the record quietly
 * carries two audiences with one of them invisible on screen. That is checked
 * here by reading the record back.
 *
 *   ODOO_BASE_URL / ODOO_DB   the Odoo to read back from
 *   E2E_PASSWORD              shared demo password
 *   E2E_REGISTRAR_LOGIN       creates and writes school.program
 *   E2E_TEACHER_LOGIN         optional: reads it only
 *   E2E_ALLOW_WRITES=yes      required: this suite creates a program
 */
import { chromium } from 'playwright-core'
import { assertWritable, isMutatingMethod } from './production-guard.mjs'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const ODOO = process.env.ODOO_BASE_URL ?? 'http://localhost:8070'
const DB = process.env.ODOO_DB ?? 'school'
const PASSWORD = process.env.E2E_PASSWORD
const LOGIN = process.env.E2E_REGISTRAR_LOGIN
const TEACHER = process.env.E2E_TEACHER_LOGIN

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
  console.log('\nprograms: SKIPPED — needs E2E_REGISTRAR_LOGIN and E2E_ALLOW_WRITES=yes')
  process.exit(0)
}

assertWritable(ODOO, 'the programs suite')

const sid = await odooLogin(LOGIN)
const TITLE = `E2E program probe ${Date.now()}`
let programId = null

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.fill('#login', LOGIN)
await page.fill('#password', PASSWORD)
await page.click('#submit-login')
await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })

const read = async (fields) =>
  programId
    ? (await odoo(sid, 'school.program', 'read', [[programId], fields]))[0]
    : null

try {
  /* ------------------------------------------------ the way in exists --- */

  console.log('\nthere is a way to create a program at all')
  await page.goto(`${BASE}/programs`, { waitUntil: 'networkidle' })
  await page.locator('main h1').first().waitFor({ timeout: 30_000 })
  check('the list offers New program', (await page.locator('a[href="/programs/new"]').count()) > 0)

  /* --------------------------------------------------------- create --- */

  console.log('\na program can be created and reaches Odoo')
  await page.goto(`${BASE}/programs/new`, { waitUntil: 'networkidle' })
  await page.locator('#name').waitFor({ timeout: 30_000 })

  await page.fill('#name', TITLE)
  await page.selectOption('#program_type', 'training')
  await page.fill('#start_date', '2026-05-04')
  await page.fill('input[name="start_time"]', '09:00')
  await page.fill('#end_date', '2026-05-04')
  await page.fill('input[name="end_time"]', '16:30')
  await page.fill('input[name="location"]', 'Main hall')
  await page.selectOption('#audience_type', 'department')
  await page.locator('#audience_code').waitFor({ timeout: 10_000 })
  const department = await page
    .locator('#audience_code option')
    .nth(1)
    .getAttribute('value')
  await page.selectOption('#audience_code', department)

  await page.locator('button:has-text("Create program")').click()
  await page.waitForURL(/\/programs\/\d+$/, { timeout: 60_000 })
  programId = Number(/\/programs\/(\d+)/.exec(page.url())?.[1])
  check('it landed on the new program', Number.isInteger(programId), page.url())

  const created = await read([
    'name', 'program_type', 'audience_type', 'department', 'location',
    'start_datetime', 'end_datetime', 'state',
  ])
  check('the title persisted', created.name === TITLE, created.name)
  check('the kind persisted', created.program_type === 'training', String(created.program_type))
  check('the audience persisted', created.audience_type === 'department', String(created.audience_type))
  check('the department persisted', created.department === department, String(created.department))
  check('the location persisted', created.location === 'Main hall', String(created.location))
  check(
    'the start datetime persisted',
    String(created.start_datetime).startsWith('2026-05-04 09:00'),
    String(created.start_datetime),
  )
  check(
    'the end datetime persisted',
    String(created.end_datetime).startsWith('2026-05-04 16:30'),
    String(created.end_datetime),
  )
  // Publishing is a transition; creating must never skip it.
  check('it was created in draft', created.state === 'draft', String(created.state))

  /* ------------------------------------- switching audience clears the old --- */

  /*
    The whole point of this suite. Odoo's `_check_audience_values` only looks at
    the field matching the *new* type, so it accepts a record that still holds
    the previous audience — the onchange that would have cleared it never fires
    over RPC.
  */
  console.log('\nchanging the audience clears the one it replaces')
  await page.goto(`${BASE}/programs/${programId}/edit`, { waitUntil: 'networkidle' })
  await page.locator('#audience_type').waitFor({ timeout: 30_000 })
  check('the edit form opened on the stored department', (await page.inputValue('#audience_code')) === department)

  await page.selectOption('#audience_type', 'class_section')
  await page.locator('#audience_ids').waitFor({ timeout: 10_000 })
  const classValue = await page.locator('#audience_ids option').first().getAttribute('value')
  await page.selectOption('#audience_ids', classValue)
  await page.locator('button:has-text("Save changes")').click()
  await page.waitForURL(/\/programs\/\d+$/, { timeout: 60_000 })

  const switched = await read(['audience_type', 'department', 'class_ids', 'responsibility'])
  check('the new audience is stored', switched.audience_type === 'class_section', String(switched.audience_type))
  check('the class is stored', switched.class_ids.includes(Number(classValue)), JSON.stringify(switched.class_ids))
  check(
    'the department it replaced was cleared',
    switched.department === false,
    `department=${JSON.stringify(switched.department)}`,
  )

  /* ------------------------------------------------- an edit persists --- */

  console.log('\nan ordinary edit persists and survives a reload')
  await page.goto(`${BASE}/programs/${programId}/edit`, { waitUntil: 'networkidle' })
  await page.locator('#name').waitFor({ timeout: 30_000 })
  await page.fill('input[name="location"]', 'Science block')
  await page.locator('button:has-text("Save changes")').click()
  await page.waitForURL(/\/programs\/\d+$/, { timeout: 60_000 })

  check('the location was changed', (await read(['location'])).location === 'Science block')
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('main h1').first().waitFor({ timeout: 30_000 })
  const shown = (await page.locator('main').textContent()) ?? ''
  check('the page shows it after a reload', shown.includes('Science block'))

  /* ------------------------------------------- Odoo's rules are surfaced --- */

  console.log("\nOdoo's own rules are surfaced, not swallowed")
  await page.goto(`${BASE}/programs/${programId}/edit`, { waitUntil: 'networkidle' })
  await page.locator('#end_date').waitFor({ timeout: 30_000 })
  await page.fill('#start_date', '2026-05-10')
  await page.fill('#end_date', '2026-05-01')
  await page.locator('button:has-text("Save changes")').click()
  await page.waitForTimeout(2500)

  const refusal = (await page.locator('main').textContent()) ?? ''
  check('the backwards date range was refused', /must end after it starts/i.test(refusal))
  check('no traceback reached the browser', !/Traceback|odoo\.exceptions/i.test(refusal))
  check('and nothing was written', (await read(['location'])).location === 'Science block')

  // The refusal must not have cost the rest of the form either.
  check('the title survived the refusal', (await page.inputValue('#name')) === TITLE)
  check('the location survived the refusal', (await page.inputValue('input[name="location"]')) === 'Science block')

  /* ----------------------------------------- a reader is offered nothing --- */

  if (TEACHER) {
    console.log('\na read-only role is offered no way in')
    const readerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const reader = await readerContext.newPage()
    await reader.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await reader.fill('#login', TEACHER)
    await reader.fill('#password', PASSWORD)
    await reader.click('#submit-login')
    await reader.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })

    await reader.goto(`${BASE}/programs`, { waitUntil: 'networkidle' })
    await reader.locator('main h1').first().waitFor({ timeout: 30_000 })
    const readerText = (await reader.locator('main').textContent()) ?? ''
    check('the teacher can read the list', !/Something went wrong/i.test(readerText))
    check('no New program button', (await reader.locator('a[href="/programs/new"]').count()) === 0)

    // And the direct URL refuses in words rather than crashing.
    await reader.goto(`${BASE}/programs/new`, { waitUntil: 'networkidle' })
    await reader.locator('main').first().waitFor({ timeout: 30_000 })
    const denied = (await reader.locator('main').textContent()) ?? ''
    check('the direct URL is refused in words', /cannot create|not available|role/i.test(denied))
    check('with no traceback', !/Traceback|psycopg2/i.test(denied))
    await readerContext.close()
  } else {
    console.log('\nread-only role: SKIPPED — set E2E_TEACHER_LOGIN')
  }
} finally {
  console.log('\ncleaning up')
  if (programId) {
    try {
      await odoo(sid, 'school.program', 'unlink', [[programId]])
      check('the probe program was removed', true, `#${programId}`)
    } catch (error) {
      console.log(`  note: could not remove program ${programId} — ${error.message}`)
    }
  }
  await browser.close()
}

console.log(failures === 0 ? '\nprograms: ok' : `\nprograms: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
