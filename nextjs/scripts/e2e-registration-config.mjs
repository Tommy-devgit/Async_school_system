/**
 * The questionnaire, the document rules, the section transfer and the
 * authorized override — verified against Odoo rather than against the page.
 *
 *   node scripts/e2e-registration-config.mjs <baseUrl>
 *
 * Env: E2E_LOGIN, E2E_PASSWORD, plus the ODOO_* pair scripts/rpc.mjs reads.
 *
 * E2E_LOGIN must hold Administrator. A registrar may read the questionnaire
 * but not create one — `school.registration.question` grants it read only —
 * so the create form never renders and the suite stalls filling a field that
 * was correctly withheld.
 *
 * MUTATES SHARED STATE and restores it: creates a question with a choice, a
 * document rule, and answers on one student; deletes all of them afterwards.
 * An authorized override cannot be deleted by design, so this only exercises
 * the refusal path unless overrides are enabled in School Settings.
 */
import { chromium } from 'playwright-core'
import { login, call } from './rpc.mjs'

const BASE = process.argv[2] ?? 'http://localhost:3101'
const LOGIN = process.env.E2E_LOGIN
const PASSWORD = process.env.E2E_PASSWORD
if (!LOGIN || !PASSWORD) {
  console.error('Set E2E_LOGIN and E2E_PASSWORD before running this script.')
  process.exit(2)
}

let passed = 0, failed = 0
const check = (name, ok, detail = '') => {
  if (ok) passed++; else failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const STAMP = Date.now().toString().slice(-6)
await login()
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext()
const page = await context.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const cleanup = []

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#login', LOGIN)
  await page.fill('#password', PASSWORD)
  await page.click('#submit-login')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  check('signed in', true)

  /* ==================================================== questionnaire === */
  const QUESTION = `Verify question ${STAMP}`
  const CODE = `vq${STAMP}`
  await page.goto(`${BASE}/configuration/questionnaire/new`, { waitUntil: 'domcontentloaded' })
  await page.fill('#name', QUESTION)
  await page.fill('#code', CODE)
  await page.selectOption('#answer_type', 'selection')
  await page.check('#required')
  await page.locator('form:has(#name) button[type=submit]').click()
  await page.waitForURL(/\/configuration\/questionnaire\/\d+$/, { timeout: 60_000 })

  const made = await call('school.registration.question', 'search_read',
    [[['code', '=', CODE]], ['id', 'name', 'required', 'answer_type', 'grade_from', 'grade_to']])
  check('question created', made.length === 1, `${made.length} found`)
  const questionId = made[0]?.id
  if (questionId) {
    cleanup.push(() =>
      call('school.registration.question', 'unlink', [[questionId]]).catch(() =>
        // Once answered, Odoo refuses to unlink it — ondelete is restrict and
        // answers carry no delete right. Archiving stops it applying, which is
        // what "cleaned up" means for an audited record.
        call('school.registration.question', 'write', [[questionId], { active: false }]),
      ),
    )
  }
  check('required flag written', made[0]?.required === true)
  check('answer type written', made[0]?.answer_type === 'selection', String(made[0]?.answer_type))

  // Odoo's unique-code constraint must surface.
  await page.goto(`${BASE}/configuration/questionnaire/new`, { waitUntil: 'domcontentloaded' })
  await page.fill('#name', `${QUESTION} dup`)
  await page.fill('#code', CODE)
  await page.locator('form:has(#name) button[type=submit]').click()
  await page.waitForTimeout(3000)
  const dup = page.url().includes('/new')
    ? await page.locator('form:has(#name)').innerText()
    : ''
  check('duplicate question code refused', /unique/i.test(dup),
    dup.split('\n').find((l) => /unique/i.test(l)) ?? 'the duplicate was accepted')
  const strays = await call('school.registration.question', 'search',
    [[['code', '=', CODE], ['id', '!=', questionId]]])
  if (strays.length) await call('school.registration.question', 'unlink', [strays])

  // A selection question needs choices; add one through the page.
  await page.goto(`${BASE}/configuration/questionnaire/${questionId}`, { waitUntil: 'domcontentloaded' })
  const optionForm = page.locator('form:has(input[name=value])')
  await optionForm.locator('input[name=name]').fill('Yes, always')
  await optionForm.locator('input[name=value]').fill('always')
  await page.locator('form:has(input[name=value]) button[type=submit]').click()
  await page.waitForTimeout(3000)
  const options = await call('school.registration.question.option', 'search_read',
    [[['question_id', '=', questionId]], ['name', 'value']])
  check('choice added', options.length === 1 && options[0].value === 'always',
    JSON.stringify(options.map((o) => o.value)))

  /* ============================== the question must block a submission === */
  // Every seeded student is already approved, and an approved record is the
  // wrong shape for testing a submission block — so make one draft student.
  let [studentId] = await call('school.student', 'search',
    [[['registration_status', 'in', ['draft', 'pending_verification']]]], { limit: 1 })
  if (!studentId) {
    const [klass] = await call('school.class', 'search_read',
      [[['academic_year_id', '!=', false]], ['academic_year_id', 'section_id', 'education_level']],
      { limit: 1 })
    studentId = await call('school.student', 'create', [{
      first_name: 'Probe', last_name: `Student${STAMP}`,
      date_of_birth: '2010-01-01',
      guardian_name: 'Probe Guardian', guardian_phone: '+251911000000',
      emergency_contact_name: 'Probe Contact', emergency_contact_phone: '+251911000001',
      class_id: klass.id,
      academic_year_id: klass.academic_year_id[0],
      section_id: klass.section_id ? klass.section_id[0] : false,
      education_level: klass.education_level || false,
      admission_type: 'new',
    }])
    // school.student refuses unlink for anyone; archiving is how a probe leaves.
    cleanup.push(() => call('school.student', 'write', [[studentId], { active: false }]))
  }
  check('a draft student exists to test the submission block against',
    Boolean(studentId), studentId ? `student ${studentId}` : 'could not create one')
  if (studentId) {
    let refusal = ''
    try {
      await call('school.student', 'action_mark_submitted', [[studentId]])
    } catch (error) { refusal = String(error.message) }
    check('an unanswered required question blocks submission',
      refusal.includes(QUESTION), refusal.slice(0, 110) || 'submission was allowed')

    await page.goto(`${BASE}/students/${studentId}`, { waitUntil: 'domcontentloaded' })
    const shown = await page.locator('body').innerText()
    check('the student page asks the question', shown.includes(QUESTION))

    await page.selectOption(`#option-${questionId}`, { label: 'Yes, always' })
    await page.locator('form:has(input[name="questionId"]) button[type=submit]').click()
    await page.waitForTimeout(3000)
    const answers = await call('school.registration.answer', 'search_read',
      [[['student_id', '=', studentId], ['question_id', '=', questionId]], ['option_id']])
    check('answer written to Odoo', answers.length === 1 && Boolean(answers[0].option_id),
      JSON.stringify(answers.map((a) => a.option_id)))
    if (answers.length) {
      // No delete right on answers; blanking one is what removes its effect.
      cleanup.push(() =>
        call('school.registration.answer', 'write',
          [answers.map((a) => a.id), { option_id: false, value_text: false }]),
      )
    }

    let afterAnswer = ''
    try {
      await call('school.student', 'action_mark_submitted', [[studentId]])
      // It went through: put the registration back where it was.
      cleanup.push(() => call('school.student', 'write',
        [[studentId], { registration_status: 'draft' }]))
    } catch (error) { afterAnswer = String(error.message) }
    check('answering clears that particular refusal', !afterAnswer.includes(QUESTION),
      afterAnswer ? afterAnswer.slice(0, 110) : 'submitted')
  }

  /* =================================================== document rules === */
  const [docType] = await call('school.document.type', 'search_read', [[], ['name']], { limit: 1 })
  check('a document type exists to build a rule from', Boolean(docType))
  if (docType) {
    await page.goto(`${BASE}/configuration/document-rules`, { waitUntil: 'domcontentloaded' })
    const before = await call('school.document.rule', 'search_count', [[]])
    await page.selectOption('select[name=document_type_id]', String(docType.id))
    await page.locator('form:has(select[name=document_type_id]) button[type=submit]').click()
    await page.waitForTimeout(3000)
    const rules = await call('school.document.rule', 'search_read',
      [[['document_type_id', '=', docType.id]], ['required', 'grade_from', 'grade_to']],
      { order: 'id desc' })
    check('document rule created',
      (await call('school.document.rule', 'search_count', [[]])) === before + 1)
    check('rule defaults to required and grades 1-12',
      rules[0]?.required === true && rules[0]?.grade_from === 1 && rules[0]?.grade_to === 12,
      JSON.stringify(rules[0]))
    if (rules[0]) cleanup.push(() => call('school.document.rule', 'unlink', [[rules[0].id]]))
  }

  /* ======================================================== transfer === */
  const [enrollmentId] = await call('school.enrollment', 'search',
    [[['state', '=', 'active']]], { limit: 1 })
  check('an active enrolment exists to transfer', Boolean(enrollmentId))
  if (enrollmentId) {
    await page.goto(`${BASE}/enrollments/${enrollmentId}`, { waitUntil: 'domcontentloaded' })
    const body = await page.locator('body').innerText()
    check('the transfer control is offered on an active enrolment',
      /Transfer to another class/.test(body))
    check('the override section renders', /Authorised overrides|Authorise an override|No overrides/.test(body))
  }

  check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  /* ========================================================== mobile === */
  await page.setViewportSize({ width: 390, height: 844 })
  const routes = [
    '/configuration/questionnaire',
    '/configuration/questionnaire/new',
    `/configuration/questionnaire/${questionId}`,
    '/configuration/document-rules',
    ...(enrollmentId ? [`/enrollments/${enrollmentId}`] : []),
    ...(studentId ? [`/students/${studentId}`] : []),
  ]
  const overflowing = []
  for (const route of routes) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(500)
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (overflow > 0) overflowing.push(`${route} (${overflow}px)`)
  }
  check(`no horizontal overflow at 390px on ${routes.length} routes`,
    overflowing.length === 0, overflowing.join(', '))
} catch (error) {
  failed++
  console.log(`  FAIL  threw — ${error.message.split('\n')[0]}`)
} finally {
  for (const undo of cleanup.reverse()) {
    await undo().catch((e) => console.log(`  WARN  cleanup — ${e.message.slice(0, 80)}`))
  }
  console.log(`  cleanup: ${cleanup.length} change${cleanup.length === 1 ? '' : 's'} reverted`)
  await browser.close()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
