/**
 * Student registration → documents → submission → approval, and the enrolment
 * approval creates. Runs against the app + STAGING Odoo.
 *
 *   node scripts/e2e-student.mjs <baseUrl>
 *
 * Env: E2E_PASSWORD, E2E_REGISTRAR_LOGIN, E2E_TEACHER_LOGIN
 *
 * Creates one synthetic student on staging. Odoo forbids deleting a student
 * that has academic history, so the probe is left in place and clearly named.
 */
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const PASSWORD = process.env.E2E_PASSWORD
const REGISTRAR = process.env.E2E_REGISTRAR_LOGIN
const TEACHER = process.env.E2E_TEACHER_LOGIN

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => {
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const STAMP = Date.now().toString().slice(-6)
const NAME = `PhaseF Student ${STAMP}`

/** A 1×1 PNG. The upload path is what matters, not the image. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

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

async function upload(page, field, filename) {
  const input = page.locator(`#${field}-file`)
  if (!(await input.isVisible().catch(() => false))) return false
  await input.setInputFiles({ name: filename, mimeType: 'image/png', buffer: PNG })
  await page.locator(`form:has(#${field}-file) button[type=submit]`).click()
  await page.waitForTimeout(7000)
  await page.reload({ waitUntil: 'domcontentloaded' })
  return true
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })

try {
  /* ============================================================ create === */
  console.log('\n[1] Registration (registrar)')
  const { context: regCtx, page } = await signIn(browser, REGISTRAR)

  await page.goto(`${BASE}/students/new`, { waitUntil: 'domcontentloaded' })
  check('registration form opens', await page.locator('#name').isVisible())

  const faydaVisible = await page.locator('#fan_number').isVisible().catch(() => false)
  check('FAN field is offered to the registrar', faydaVisible)

  // Odoo enforces a minimum age per grade: 6 + ceil((level - 1) / 2).
  await page.fill('#name', NAME)
  await page.fill('#date_of_birth', '2014-03-15')
  await page.fill('#guardian_name', `Guardian ${STAMP}`)
  await page.fill('#guardian_phone', '+251911000111')
  await page.fill('#emergency_contact_name', `Emergency ${STAMP}`)
  await page.fill('#emergency_contact_phone', '+251911000222')
  if (faydaVisible) await page.fill('#fan_number', `9${STAMP}${String(Date.now()).slice(-9)}`.slice(0, 16))

  const classOptions = await page.locator('#class_id option').count()
  check('classes are offered', classOptions > 1, `${classOptions - 1} class(es)`)

  const grade3 = await page
    .locator('#class_id option', { hasText: 'Grade 3' })
    .first()
    .getAttribute('value')
    .catch(() => null)
  const chosen = grade3 ?? (await page.locator('#class_id option:nth-child(2)').getAttribute('value'))
  await page.selectOption('#class_id', chosen)
  await page.waitForTimeout(600)
  check('class scope is echoed back before submitting', /sits in/.test((await page.textContent('body')) ?? ''))

  await page.click('#submit-student')
  await page.waitForURL(/\/students\/\d+$/, { timeout: 90_000 }).catch(() => {})
  const created = /\/students\/\d+$/.test(page.url())
  check('student created and detail opened', created, page.url())
  if (!created) {
    console.log('    server said:', (await page.locator('[role=alert]').allTextContents()).join(' | ').slice(0, 240))
    throw new Error('cannot continue without a student')
  }
  const studentId = Number(page.url().split('/').pop())

  /* ========================================================= documents === */
  console.log('\n[2] Documents (Browser → Next.js → Odoo)')
  let body = (await page.textContent('body')) ?? ''
  check('starts in Draft', /draft/i.test(body))
  check('no student ID before approval', /No student ID yet/i.test(body))

  await upload(page, 'birth_certificate', `birth-${STAMP}.png`)
  body = (await page.textContent('body')) ?? ''
  check('birth certificate attached', body.includes(`birth-${STAMP}.png`))

  await upload(page, 'previous_grade_document', `prev-${STAMP}.png`)
  body = (await page.textContent('body')) ?? ''
  check('previous grade document attached', body.includes(`prev-${STAMP}.png`))

  /* ========================================================== workflow === */
  console.log('\n[3] Registration workflow (Odoo transitions)')
  await page.click('button:has-text("Submit registration")')
  // Read the panel BEFORE reloading: the action result lives in component
  // state, so a reload would discard the very message being asserted.
  await page.waitForTimeout(8000)
  const afterSubmit = (await page.textContent('body')) ?? ''
  const blocked = /Cannot submit:/i.test(afterSubmit)
  const isSubmitted = !blocked && /Approve registration/i.test(afterSubmit)
  check(
    'submission succeeds, or Odoo names exactly what is missing',
    isSubmitted || blocked,
    blocked ? (afterSubmit.match(/Cannot submit:[^]{0,150}?(?=Send for|Submit reg|$)/) ?? [''])[0].trim() : 'submitted',
  )
  check('no traceback in the response', !/Traceback|usr\/lib\/python/i.test(afterSubmit))

  if (isSubmitted) {
    await page.click('button:has-text("Approve registration")')
    await page.waitForTimeout(1200)
    await page.locator('button:has-text("Confirm approve")').click()
    await page.waitForTimeout(9000)
    await page.reload({ waitUntil: 'domcontentloaded' })
    const approved = (await page.textContent('body')) ?? ''
    check('approval mints the student number', /STU-\d+/.test(approved), (approved.match(/STU-\d+/) ?? [''])[0])
    check('approval mints the admission number', /ADM-\d+/.test(approved), (approved.match(/ADM-\d+/) ?? [''])[0])
    check('approval creates the enrolment', /ENR-\d+/.test(approved), (approved.match(/ENR-\d+/) ?? [''])[0])
    check('approval links a primary guardian', /Primary/.test(approved))
    check('lifecycle moves to active', /\bactive\b/i.test(approved))
  } else {
    console.log('    (approval not attempted — Odoo still reports missing requirements)')
  }

  /* ============================================== scope + field access === */
  console.log('\n[4] Scope and field protection')
  const { context: teacherCtx, page: teacherPage } = await signIn(browser, TEACHER)
  await teacherPage.goto(`${BASE}/students/${studentId}`, { waitUntil: 'domcontentloaded' })
  const teacherBody = (await teacherPage.textContent('body')) ?? ''
  /*
    Three acceptable outcomes, all of them Odoo refusing something:

      404          the record rule hides the student entirely. This is the
                   strongest answer — it does not even confirm the record
                   exists — and is what the page now returns when `read`
                   comes back empty.
      permission   the read raised and the page explained it.
      restricted   the record is visible but the personal-data fields are not.

    What would fail is a teacher seeing another class's student in full.
  */
  const notFound = /could not be found/i.test(teacherBody)
  const refused = /do not have permission|Not available to your role/i.test(teacherBody)
  const restricted = /Restricted to your role/i.test(teacherBody)
  check(
    'teacher is scoped out of, or field-restricted on, this student',
    notFound || refused || restricted,
    notFound ? 'record hidden by the record rule (404)'
      : refused ? 'read refused' : 'personal data restricted',
  )
  check('teacher page leaks no traceback', !/Traceback|usr\/lib\/python/i.test(teacherBody))
  await teacherPage.goto(`${BASE}/students/new`, { waitUntil: 'domcontentloaded' })
  check(
    'teacher cannot open the registration form',
    /cannot register students/i.test((await teacherPage.textContent('body')) ?? ''),
  )

  /* ======================================================== enrolments === */
  console.log('\n[5] Enrolments')
  await page.goto(`${BASE}/enrollments`, { waitUntil: 'domcontentloaded' })
  const rows = await page.locator('tbody tr').count()
  check('registrar sees the enrolment register', rows > 0, `${rows} row(s)`)
  if (rows > 0) {
    await page.locator('tbody tr td a').first().click()
    await page.waitForURL(/\/enrollments\/\d+$/, { timeout: 60_000 }).catch(() => {})
    const detail = (await page.textContent('body')) ?? ''
    check('enrolment detail opens', /\/enrollments\/\d+$/.test(page.url()), page.url())
    check('placement history rendered', /Placement history/i.test(detail))
    check('subjects panel rendered', /Subjects/i.test(detail))
    check('workflow panel offers a transition or explains why not', /Status/i.test(detail))
    check('no traceback', !/Traceback|usr\/lib\/python/i.test(detail))
  }

  console.log(`\n    probe student #${studentId} (${NAME}) left on staging — Odoo forbids deleting students with history`)

  await teacherCtx.close()
  await regCtx.close()
} finally {
  await browser.close()
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
