/**
 * Classes, subjects, academic years, assessments, announcements and the
 * timetable grid, verified against Odoo rather than against the page.
 *
 *   node scripts/e2e-crud-and-grid.mjs <baseUrl>
 *
 * Env: E2E_LOGIN, E2E_PASSWORD, plus the ODOO_* pair scripts/rpc.mjs reads.
 *
 * E2E_LOGIN must hold Administrator or Teacher. `school.class.schedule`
 * carries ACL rows for those two groups only, so a registrar reaches the
 * timetable section and is refused — which reads as a suite failure and is
 * really the backend answering correctly.
 *
 * MUTATES SHARED STATE and restores it: creates one class and one subject and
 * deletes them; renames one assessment and one announcement and puts both
 * back.
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
  /*
    Signing in no longer lands everyone on the dashboard: `landingPath` sends a
    registrar to their submitted registrations and a teacher to their open mark
    lists. Waiting for a specific route therefore tests navigation policy rather
    than sign-in, and times out for most roles. Waiting to leave /login is the
    thing this actually needs.
  */
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })
  check('signed in', true)

  /* ========================================================= subjects === */
  const SUBJECT = `Verify Subject ${STAMP}`
  await page.goto(`${BASE}/subjects/new`, { waitUntil: 'domcontentloaded' })
  await page.fill('#name', SUBJECT)
  await page.fill('#code', `VS${STAMP}`)
  await page.fill('#credit_hours', '2')
  await page.locator('form:has(#name) button[type=submit]').click()
  await page.waitForURL('**/subjects', { timeout: 60_000 })

  const madeSubject = await call('school.subject', 'search_read',
    [[['name', '=', SUBJECT]], ['id', 'code', 'credit_hours', 'sequence_code', 'subject_type']])
  check('subject created', madeSubject.length === 1, `${madeSubject.length} found`)
  const subjectId = madeSubject[0]?.id
  if (subjectId) cleanup.push(() => call('school.subject', 'unlink', [[subjectId]]))
  check('ir.sequence assigned the subject id, not the form',
    Boolean(madeSubject[0]?.sequence_code), String(madeSubject[0]?.sequence_code))
  check('credit hours written', madeSubject[0]?.credit_hours === 2)

  // Odoo's unique-name constraint must surface, not 500.
  await page.goto(`${BASE}/subjects/new`, { waitUntil: 'domcontentloaded' })
  await page.fill('#name', SUBJECT)
  await page.locator('form:has(#name) button[type=submit]').click()
  await page.waitForTimeout(3000)
  const dupText = await page.locator('form:has(#name)').innerText()
  check('duplicate subject name refused and explained', /already exists/i.test(dupText),
    dupText.split('\n').find((l) => /exist/i.test(l)) ?? 'no message')

  // Edit it.
  await page.goto(`${BASE}/subjects/${subjectId}/edit`, { waitUntil: 'domcontentloaded' })
  check('edit form opens on the stored values',
    (await page.inputValue('#code')) === `VS${STAMP}`)
  await page.fill('#short_name', 'VSX')
  await page.locator('form:has(#name) button[type=submit]').click()
  await page.waitForURL('**/subjects', { timeout: 60_000 })
  const editedSubject = (await call('school.subject', 'read', [[subjectId], ['short_name']]))[0]
  check('subject edit written', editedSubject.short_name === 'VSX', String(editedSubject.short_name))

  /* ========================================================== classes === */
  const [yearId] = await call('school.academic.year', 'search', [[]], { limit: 1 })
  const [sectionId] = await call('school.section', 'search', [[]], { limit: 1 })
  const CLASS = `Verify Class ${STAMP}`
  await page.goto(`${BASE}/classes/new`, { waitUntil: 'domcontentloaded' })
  await page.fill('#name', CLASS)
  await page.selectOption('#academic_year_id', String(yearId))
  // A section is set deliberately: the unique constraint is on
  // (name, section_id, academic_year_id), and Postgres treats NULL sections as
  // distinct, so an unsectioned class never trips it.
  if (sectionId) await page.selectOption('#section_id', String(sectionId))
  await page.fill('#capacity', '30')
  await page.locator('form:has(#name) button[type=submit]').click()
  await page.waitForURL(/\/classes\/\d+$/, { timeout: 60_000 })

  const madeClass = await call('school.class', 'search_read',
    [[['name', '=', CLASS]], ['id', 'capacity', 'academic_year_id']])
  check('class created', madeClass.length === 1, `${madeClass.length} found`)
  const classId = madeClass[0]?.id
  if (classId) cleanup.push(() => call('school.class', 'unlink', [[classId]]))
  check('capacity written', madeClass[0]?.capacity === 30)
  check('academic year written', madeClass[0]?.academic_year_id?.[0] === yearId)
  check('landed on the class detail page', page.url().includes(`/classes/${classId}`))

  // The unique (name, section, year) constraint must reach the user.
  if (sectionId) {
    await page.goto(`${BASE}/classes/new`, { waitUntil: 'domcontentloaded' })
    await page.fill('#name', CLASS)
    await page.selectOption('#academic_year_id', String(yearId))
    await page.selectOption('#section_id', String(sectionId))
    await page.locator('form:has(#name) button[type=submit]').click()
    await page.waitForTimeout(3000)
    const stillOnForm = page.url().includes('/classes/new')
    const dupClass = stillOnForm
      ? await page.locator('form:has(#name)').innerText()
      : ''
    check('duplicate class refused and explained', /already exists/i.test(dupClass),
      stillOnForm
        ? (dupClass.split('\n').find((l) => /exist/i.test(l)) ?? 'no message')
        : 'the duplicate was accepted')
    // Whatever happened, do not leave a second row behind.
    const strays = await call('school.class', 'search',
      [[['name', '=', CLASS], ['id', '!=', classId]]])
    if (strays.length) await call('school.class', 'unlink', [strays])
  }

  await page.goto(`${BASE}/classes/${classId}/edit`, { waitUntil: 'domcontentloaded' })
  await page.fill('#capacity', '35')
  await page.locator('form:has(#name) button[type=submit]').click()
  await page.waitForURL(`**/classes/${classId}`, { timeout: 60_000 })
  check('class edit written',
    (await call('school.class', 'read', [[classId], ['capacity']]))[0].capacity === 35)

  // The stream picker must appear only on grades Odoo accepts one for.
  const grades = await call('school.grade', 'search_read', [[], ['id', 'level']])
  const low = grades.find((g) => !['11', '12'].includes(String(g.level)))
  const high = grades.find((g) => ['11', '12'].includes(String(g.level)))
  if (low && high) {
    await page.goto(`${BASE}/classes/new`, { waitUntil: 'domcontentloaded' })
    await page.selectOption('#grade_id', String(low.id))
    await page.waitForTimeout(400)
    const hiddenForLow = !(await page.locator('#stream_id').isVisible().catch(() => false))
    await page.selectOption('#grade_id', String(high.id))
    await page.waitForTimeout(400)
    const shownForHigh = await page.locator('#stream_id').isVisible().catch(() => false)
    check('stream picker follows _check_stream_grade', hiddenForLow && shownForHigh,
      `grade ${low.level} hidden=${hiddenForLow}, grade ${high.level} shown=${shownForHigh}`)
  }

  /* ==================================================== academic year === */
  const year = (await call('school.academic.year', 'read',
    [[yearId], ['name', 'state', 'date_start', 'date_end']]))[0]
  await page.goto(`${BASE}/academic-years/${yearId}`, { waitUntil: 'domcontentloaded' })
  const yearBody = await page.locator('body').innerText()
  const locked = ['closed', 'archived'].includes(String(year.state))
  check(`year in state '${year.state}' offers the right control`,
    locked ? /Correct this year/.test(yearBody) : /Edit dates/.test(yearBody),
    locked ? 'expects correction form' : 'expects edit link')

  /* ======================================================= assessment === */
  const [assessmentId] = await call('school.assessment', 'search', [[]], { limit: 1 })
  if (assessmentId) {
    const before = (await call('school.assessment', 'read',
      [[assessmentId], ['name', 'state', 'max_mark']]))[0]
    await page.goto(`${BASE}/assessments/${assessmentId}/edit`, { waitUntil: 'domcontentloaded' })

    const frozen = String(before.state) !== 'draft'
    const maxVisible = await page.locator('#max_mark').isVisible().catch(() => false)
    check(`assessment in '${before.state}': setup inputs match Odoo's freeze`,
      frozen ? !maxVisible : maxVisible,
      frozen ? 'frozen, so no max_mark input' : 'draft, so max_mark editable')

    const NEWNAME = `${before.name} v${STAMP}`
    await page.fill('#name', NEWNAME)
    await page.locator('form:has(#name) button[type=submit]').click()
    await page.waitForURL(`**/assessments/${assessmentId}`, { timeout: 60_000 })
    const after = (await call('school.assessment', 'read',
      [[assessmentId], ['name', 'max_mark']]))[0]
    check('assessment name written even when setup is frozen', after.name === NEWNAME, after.name)
    check('max_mark untouched', after.max_mark === before.max_mark)
    cleanup.push(() => call('school.assessment', 'write', [[assessmentId], { name: before.name }]))
  }

  /* ===================================================== announcement === */
  const [annId] = await call('school.announcement', 'search', [[]], { limit: 1 })
  if (annId) {
    const before = (await call('school.announcement', 'read',
      [[annId], ['name', 'state', 'audience_type']]))[0]
    await page.goto(`${BASE}/announcements/${annId}/edit`, { waitUntil: 'domcontentloaded' })

    const published = String(before.state) !== 'draft'
    const audienceEditable = await page.locator('#audience_type').isVisible().catch(() => false)
    check(`announcement in '${before.state}': audience matches publication state`,
      published ? !audienceEditable : audienceEditable,
      published ? 'published, so audience is fixed' : 'draft, so audience editable')

    const NEWTITLE = `${before.name} v${STAMP}`
    await page.fill('#name', NEWTITLE)
    await page.locator('form:has(#name) button[type=submit]').click()
    await page.waitForURL(`**/announcements/${annId}`, { timeout: 60_000 })
    const after = (await call('school.announcement', 'read',
      [[annId], ['name', 'audience_type']]))[0]
    check('announcement title written', after.name === NEWTITLE, after.name)
    check('audience unchanged by a content edit',
      after.audience_type === before.audience_type, String(after.audience_type))
    cleanup.push(() => call('school.announcement', 'write', [[annId], { name: before.name }]))
  }

  /* ============================================================ grid === */
  const scheduled = await call('school.class.schedule', 'search_read',
    [[['state', '!=', 'cancelled']], ['class_id']], { limit: 1 })
  const gridClass = scheduled[0]?.class_id?.[0]
  await page.goto(`${BASE}/schedule/grid`, { waitUntil: 'domcontentloaded' })
  check('grid asks for a class before showing anything',
    /Choose a class/.test(await page.locator('body').innerText()))

  if (gridClass) {
    await page.goto(`${BASE}/schedule/grid?class=${gridClass}`, { waitUntil: 'domcontentloaded' })
    const rowCount = await page.locator('table tbody tr').count()
    const odooCount = await call('school.class.schedule', 'search_count',
      [[['class_id', '=', gridClass], ['state', '!=', 'cancelled']]])
    const distinctPeriods = new Set(
      (await call('school.class.schedule', 'search_read',
        [[['class_id', '=', gridClass], ['state', '!=', 'cancelled']],
         ['start_time', 'end_time']], { limit: 400 }))
        .map((r) => `${r.start_time}-${r.end_time}`),
    ).size
    check('grid renders one row per distinct period', rowCount === distinctPeriods,
      `${rowCount} rows vs ${distinctPeriods} periods (${odooCount} slots)`)
  }

  /* ======================================================== mobile === */
  await page.setViewportSize({ width: 390, height: 844 })
  const routes = [
    '/classes', '/classes/new', `/classes/${classId}`, `/classes/${classId}/edit`,
    '/subjects', '/subjects/new', `/subjects/${subjectId}/edit`,
    `/academic-years/${yearId}`, '/schedule/grid',
    ...(gridClass ? [`/schedule/grid?class=${gridClass}`] : []),
    ...(assessmentId ? [`/assessments/${assessmentId}/edit`] : []),
    ...(annId ? [`/announcements/${annId}/edit`] : []),
  ]
  let overflowing = []
  for (const route of routes) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(500)
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (overflow > 0) overflowing.push(`${route} (${overflow}px)`)
  }
  check(`no horizontal overflow at 390px on ${routes.length} routes`,
    overflowing.length === 0, overflowing.join(', '))

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (error) {
  failed++
  console.log(`  FAIL  threw — ${error.message.split('\n')[0]}`)
} finally {
  for (const undo of cleanup.reverse()) {
    await undo().catch((e) => console.log(`  WARN  cleanup failed — ${e.message.slice(0, 90)}`))
  }
  console.log(`  cleanup: ${cleanup.length} change${cleanup.length === 1 ? '' : 's'} reverted`)
  await browser.close()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
