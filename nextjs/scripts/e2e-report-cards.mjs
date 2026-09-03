/**
 * The report card round trip, end to end and back to Odoo.
 *
 * This suite exists because the module was silently non-functional: the
 * allowlist described a state machine the model does not have, so `Approve`
 * was gated on a state a card can never hold and `Generate` called a method
 * that does not exist. Both looked fine on screen.
 *
 * Every assertion here checks the resulting Odoo record, not the HTTP status —
 * a 200 from a server action proves nothing about what Odoo did.
 *
 *   ODOO_BASE_URL / ODOO_DB   which Odoo to verify against (read back directly)
 *   E2E_PASSWORD              the shared demo password
 *   E2E_EXAM_LOGIN            a user in group_school_exam_officer
 *
 * Skips itself rather than failing when no exam-officer login is supplied,
 * because only that role may generate or approve.
 */
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const ODOO = process.env.ODOO_BASE_URL ?? 'http://localhost:8070'
const DB = process.env.ODOO_DB ?? 'school'
const PASSWORD = process.env.E2E_PASSWORD
const LOGIN = process.env.E2E_EXAM_LOGIN

let failures = 0
const check = (label, ok, extra = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

/** Read Odoo directly, so the assertion is about the database and not the page. */
async function odoo(sid, model, method, args = [], kwargs = {}) {
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
  const body = await response.json()
  if (!sid || body.error) throw new Error('could not authenticate against Odoo')
  return sid
}

if (!LOGIN) {
  console.log('\nreport cards: SKIPPED — set E2E_EXAM_LOGIN to an Exam Officer to run this')
  process.exit(0)
}

const sid = await odooLogin(LOGIN)

/* ------------------------------------------- the model, before the UI --- */

console.log('\nthe model this frontend is talking to')
const meta = await odoo(sid, 'school.report.card', 'fields_get', [['state']], {
  attributes: ['selection'],
})
const states = meta.state.selection.map(([value]) => value)
check('state selection read from Odoo', states.length > 0, states.join(','))
check('there is no "generated" state', !states.includes('generated'), states.join(','))
check('draft, approved and published all exist',
  ['draft', 'approved', 'published'].every((s) => states.includes(s)))

/* --------------------------------------------------- the UI it drives --- */

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('#login', LOGIN)
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

console.log('\ngeneration is offered, because nothing else creates a report card')
await page.goto(`${BASE}/report-cards`, { waitUntil: 'domcontentloaded' })
const generator = page.locator('main form:has-text("Generate")')
check('the generator is on the page', (await generator.count()) >= 1)
check('it asks for a term', (await page.locator('main select[name="termId"]').count()) === 1)
check('and a class', (await page.locator('main select[name="classId"]').count()) === 1)

/* ------------------------------------------------ round trip: approve --- */

console.log('\nOdoo → Next.js → Odoo: approving a draft card')
const drafts = await odoo(sid, 'school.report.card', 'search_read', [], {
  domain: [['state', '=', 'draft']],
  fields: ['name', 'state'],
  limit: 1,
})

if (drafts.length === 0) {
  console.log('  SKIP  no draft report card in this database to approve')
} else {
  const card = drafts[0]
  await page.goto(`${BASE}/report-cards/${card.id}`, { waitUntil: 'domcontentloaded' })
  const approve = page.locator('main button:has-text("Approve")')
  check('Approve is offered on a draft card', (await approve.count()) >= 1, card.name)

  await approve.first().click()
  const confirm = page.locator('main button:has-text("Confirm approve")')
  if (await confirm.count()) await confirm.first().click()
  await page.waitForTimeout(2500)

  const [after] = await odoo(sid, 'school.report.card', 'read', [[card.id], ['state']])
  check('Odoo really moved the record to approved', after.state === 'approved', `state=${after.state}`)

  const shown = (await page.locator('main').innerText()) ?? ''
  check('and the page shows the new state', /Approved/i.test(shown))
  check('no traceback reached the browser', !/Traceback|odoo\.exceptions/i.test(shown))
}

/* ------------------------------------------------ round trip: generate --- */

/*
  Generation writes records, so it runs only when E2E_ALLOW_WRITES is set.
  A report card cannot be deleted — Odoo refuses, calling them permanent
  academic records — so this must never be pointed at a database whose
  contents matter.
*/
if (process.env.E2E_ALLOW_WRITES === 'yes') {
  console.log('\nOdoo → Next.js → Odoo: generating for a class')
  const before = await odoo(sid, 'school.report.card', 'search_count', [[]])

  await page.goto(`${BASE}/report-cards`, { waitUntil: 'domcontentloaded' })
  const terms = await page.locator('main select[name="termId"] option').evaluateAll((nodes) =>
    nodes.map((n) => n.value).filter(Boolean),
  )
  const classes = await page.locator('main select[name="classId"] option').evaluateAll((nodes) =>
    nodes.map((n) => n.value).filter(Boolean),
  )
  check('the generator is populated from Odoo', terms.length > 0 && classes.length > 0,
    `${terms.length} terms, ${classes.length} classes`)

  if (terms.length && classes.length) {
    await page.selectOption('main select[name="termId"]', terms[0])
    await page.selectOption('main select[name="classId"]', classes[0])
    await page.click('main form button[type="submit"]')
    await page.waitForTimeout(6000)

    const after = await odoo(sid, 'school.report.card', 'search_count', [[]])
    // Read only the form's own alert/status, never the whole page: the panel's
    // explanatory hint contains words like "marks" and would match anything.
    const alert = await page.locator('main [role="alert"]').first().innerText().catch(() => '')
    const ok = await page.locator('main [role="status"]').first().innerText().catch(() => '')
    const feedback = `${alert} ${ok}`.trim()

    check('the form reported an outcome either way', feedback.length > 0, feedback.slice(0, 90))

    if (after > before) {
      check('Odoo gained report cards', true, `${before} → ${after}`)
      check('and the UI confirms it', /generated/i.test(ok), ok.slice(0, 60))
    } else {
      // Odoo declining for a stated reason is the behaviour under test: the
      // message has to reach the user instead of a traceback or a silent no-op.
      check('a refusal is explained, not swallowed', alert.length > 0, alert.slice(0, 90))
      check('the count is genuinely unchanged', after === before, `${before} → ${after}`)
    }
    check('no traceback reached the browser', !/Traceback|odoo\.exceptions/i.test(feedback))
  }
} else {
  console.log('\ngeneration round trip: SKIPPED — set E2E_ALLOW_WRITES=yes on a throwaway database')
}

/* ----------------------------------------- the old bug cannot come back --- */

console.log('\nregression guards')
await page.goto(`${BASE}/report-cards`, { waitUntil: 'domcontentloaded' })
const listText = (await page.locator('main').innerText()) ?? ''
check('the list does not offer a dead "Generate" transition', !/Generate report card v/i.test(listText))

const published = await odoo(sid, 'school.report.card', 'search_read', [], {
  domain: [['state', '=', 'published']],
  fields: ['name'],
  limit: 1,
})
if (published.length) {
  await page.goto(`${BASE}/report-cards/${published[0].id}`, { waitUntil: 'domcontentloaded' })
  const text = (await page.locator('main').innerText()) ?? ''
  check('a published card offers no further transition', /No status changes are available/i.test(text))
  check('and still renders its subject lines', /Subject results/i.test(text))
}

await browser.close()
console.log(`\n${failures === 0 ? 'report cards: all checks passed' : `${failures} check(s) failed`}`)
process.exit(failures === 0 ? 0 : 1)
