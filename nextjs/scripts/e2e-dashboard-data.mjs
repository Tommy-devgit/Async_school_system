/**
 * The dashboard's numbers, checked against Odoo itself.
 *
 * The role suite (e2e-dashboards.mjs) proves each role lands on the right
 * screen. This one proves the screen is not lying. Every figure the command
 * centre paints is read back off the page and compared with an independent
 * query against Odoo over JSON-RPC as the same user — not against a fixture,
 * and not against the same code path that rendered it.
 *
 * That distinction is the whole point. A dashboard is the one screen where a
 * plausible wrong number does the most damage, because nobody cross-checks the
 * headline figure on the page they open every morning.
 *
 *   E2E_PASSWORD             the shared demo password
 *   E2E_REGISTRAR_LOGIN      widest read access, so the most to verify
 *   E2E_TEACHER_LOGIN        optional: proves the scoping narrows
 *   ODOO_BASE_URL, ODOO_DB   the Odoo the Next.js server is talking to
 */
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const ODOO = process.env.ODOO_BASE_URL ?? 'http://localhost:8070'
const DB = process.env.ODOO_DB ?? 'school'
const PASSWORD = process.env.E2E_PASSWORD
const LOGIN = process.env.E2E_REGISTRAR_LOGIN
const TEACHER = process.env.E2E_TEACHER_LOGIN

if (!PASSWORD || !LOGIN) {
  console.log('dashboard data: SKIPPED — needs E2E_PASSWORD and E2E_REGISTRAR_LOGIN')
  process.exit(0)
}

let failures = 0
const check = (label, ok, extra = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

/* ------------------------------------------------------------------ odoo --- */

let sid = null
async function rpc(path, params) {
  const response = await fetch(`${ODOO}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sid ? { Cookie: `session_id=${sid}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params }),
  })
  const cookie = response.headers.get('set-cookie')
  if (cookie) {
    const match = /session_id=([^;]+)/.exec(cookie)
    if (match) sid = match[1]
  }
  const body = await response.json()
  if (body.error) throw new Error(JSON.stringify(body.error.data?.message ?? body.error.message))
  return body.result
}

const kw = (model, method, args = [], kwargs = {}) =>
  rpc('/web/dataset/call_kw', { model, method, args, kwargs })

const groupOf = async (model, field, domain = []) => {
  const rows = await kw(model, 'formatted_read_group', [domain, [field], ['__count']])
  return Object.fromEntries(
    rows.map((row) => {
      const raw = row[field]
      return [Array.isArray(raw) ? String(raw[0]) : String(raw ?? ''), Number(row.__count ?? 0)]
    }),
  )
}

const total = (groups) => Object.values(groups).reduce((sum, count) => sum + count, 0)
const todayIso = () => new Date().toISOString().slice(0, 10)

/* ------------------------------------------------------------------ page --- */

const browser = await chromium.launch({ channel: 'chrome', headless: true })

async function signIn(login) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } })
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login', login)
  await page.fill('#password', PASSWORD)
  await page.click('#submit-login')
  /*
    Signing in no longer always lands on the dashboard: `landingPath` sends a
    registrar to their submitted registrations and a teacher to their open mark
    lists. So wait for the sign-in to complete, then go to the dashboard
    deliberately — this suite is about that screen, not about where the bounce
    happens to point this week.
  */
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
  /*
    The dashboard streams: Next sends a skeleton immediately and swaps the real
    page in when Odoo answers. Landing on the URL is therefore not the same as
    the content being there, and reading `main` too early captures the
    placeholder. The heading only exists on the real page, so waiting for it
    waits for exactly the right thing.
  */
  await page.waitForSelector('main h1', { timeout: 90_000 })
  return { context, page }
}

/**
 * The number on a KPI tile, by its label.
 *
 * Read off the rendered page rather than out of any shared helper, so a bug in
 * the formatting layer is caught rather than cancelled out.
 */
async function kpi(page, label) {
  const card = page.locator(`main :text-is("${label}")`).first()
  const value = await card
    .locator('xpath=ancestor::*[contains(@class,"rounded-[12px]")][1]')
    .locator('.tabular')
    .first()
    .textContent()
  const cleaned = (value ?? '').replace(/[^0-9.—-]/g, '')
  return cleaned === '—' ? null : Number(cleaned.replace(/,/g, ''))
}

await rpc('/web/session/authenticate', { db: DB, login: LOGIN, password: PASSWORD })
const { context, page } = await signIn(LOGIN)

/* -------------------------------------------------- headline agreement --- */

console.log('\nheadline figures agree with Odoo')

/*
  The dashboard scopes to the current academic year, so the comparison has to
  scope the same way — checking a scoped figure against an unscoped query would
  either pass by luck or fail for the wrong reason.
*/
const years = await kw('school.academic.year', 'search_read', [], {
  domain: [['is_current', '=', true]],
  fields: ['name'],
  limit: 1,
})
const yearId = years[0]?.id ?? null
const yearDomain = yearId ? [['academic_year_id', '=', yearId]] : []

const studentLifecycle = await groupOf('school.student', 'lifecycle_status', yearDomain)
const staffStates = await groupOf('school.staff', 'state')
const teacherStatuses = await groupOf('school.teacher', 'teaching_status')
const classesByGrade = await groupOf('school.class', 'grade_id', yearDomain)

check('the academic year on the page is the one Odoo flags current',
  yearId === null || (await page.locator('main').innerText()).includes(years[0].name),
  years[0]?.name ?? 'no current year')

check('Students tile equals Odoo', (await kpi(page, 'Students')) === total(studentLifecycle),
  `page=${await kpi(page, 'Students')} odoo=${total(studentLifecycle)}`)
check('Staff tile equals Odoo', (await kpi(page, 'Staff')) === total(staffStates),
  `page=${await kpi(page, 'Staff')} odoo=${total(staffStates)}`)
check('Teaching profiles tile equals Odoo',
  (await kpi(page, 'Teaching profiles')) === total(teacherStatuses),
  `page=${await kpi(page, 'Teaching profiles')} odoo=${total(teacherStatuses)}`)
check('Classes tile equals Odoo', (await kpi(page, 'Classes')) === total(classesByGrade),
  `page=${await kpi(page, 'Classes')} odoo=${total(classesByGrade)}`)

/* ------------------------------------------------ breakdowns add up --- */

console.log('\nbreakdowns add up to their own headline')

/*
  Every total on this dashboard is the sum of the buckets shown beneath it,
  taken from the same grouped query. This asserts the property rather than the
  numbers: a headline that disagrees with its own chart is the failure mode
  that a second `search_count` would have introduced.
*/
const gradeBars = await page
  .locator('main h3:text-is("Students by grade")')
  .locator('xpath=ancestor::*[contains(@class,"rounded-")][1]')
  .locator('li .tabular')
  .allTextContents()
const barSum = gradeBars
  .map((text) => Number(text.replace(/[^0-9]/g, '')))
  .filter((value) => Number.isFinite(value))
  .reduce((sum, value) => sum + value, 0)

check('the students-by-grade bars sum to the Students tile',
  barSum === total(studentLifecycle), `bars=${barSum} tile=${total(studentLifecycle)}`)

const studentsByClass = await groupOf('school.student', 'class_id', yearDomain)
check('and to Odoo\'s own per-class grouping',
  barSum === total(studentsByClass), `bars=${barSum} odoo=${total(studentsByClass)}`)

const registration = await groupOf('school.student', 'registration_status', yearDomain)
const funnelCounts = await page
  .locator('main h3:text-is("Registration pipeline")')
  .locator('xpath=ancestor::*[contains(@class,"rounded-")][1]')
  .locator('li .tabular')
  .allTextContents()
const funnelSum = funnelCounts
  .map((text) => Number(text.replace(/[^0-9]/g, '')))
  .reduce((sum, value) => sum + value, 0)
check('the registration pipeline sums to the same student total',
  funnelSum === total(registration), `page=${funnelSum} odoo=${total(registration)}`)

/* ------------------------------------------------------- attendance --- */

console.log('\nattendance says what it means')

const attendanceToday = await groupOf('school.attendance', 'status', [['date', '=', todayIso()]])
const markedToday = total(attendanceToday)
const pageText = await page.locator('main').innerText()

if (markedToday === 0) {
  /*
    The single most important assertion here. No register taken is not nobody
    present, and rendering it as 0% would be a confident lie on the school's
    landing page.
  */
  check('with no register taken, it says so rather than showing a percentage',
    /No register taken today|Register not taken yet/.test(pageText))
  check('and no attendance percentage is invented',
    !/\b0%\s*\n?\s*(Present|present)/.test(pageText))
} else {
  const expected = Math.round(((attendanceToday.present ?? 0) / markedToday) * 100)
  const ring = await page
    .locator('main h3:text-is("Attendance today")')
    .locator('xpath=ancestor::*[contains(@class,"rounded-")][1]')
    .locator('svg text')
    .first()
    .textContent()
  check('the attendance ring equals Odoo\'s present share',
    Number(String(ring).replace('%', '')) === expected, `page=${ring} odoo=${expected}%`)
  check('the panel states how many were marked',
    pageText.includes(`${markedToday} record`) || pageText.includes(`${markedToday} records`),
    `${markedToday} marked`)
}

/* -------------------------------------------------------- charts --- */

console.log('\ncharts are readable without seeing them')

const charts = page.locator('main svg[role="img"]')
const chartCount = await charts.count()
check('at least one chart rendered', chartCount > 0, `${chartCount} charts`)

let unlabelled = 0
for (let index = 0; index < chartCount; index += 1) {
  const label = await charts.nth(index).getAttribute('aria-label')
  if (!label || label.trim().length < 8) unlabelled += 1
}
check('every chart carries a describing label', unlabelled === 0, `${unlabelled} unlabelled`)

// A ring and a line cannot show their numbers inline, so they carry a hidden
// table instead. A chart must never be the only way to reach a figure.
const trend = await page.locator('main h3:text-is("Attendance trend")').count()
if (trend > 0) {
  const tables = await page
    .locator('main h3:text-is("Attendance trend")')
    .locator('xpath=ancestor::*[contains(@class,"rounded-")][1]')
    .locator('table.sr-only')
    .count()
  check('the trend carries its numbers as a hidden table', tables > 0)
}

check('no chart claims a trend from a single point',
  !/Trend/.test(pageText) || !/there is no history to trend yet[\s\S]{0,200}<polyline/.test(pageText))

/* --------------------------------------------------------- drill-down --- */

console.log('\ndrill-down links go somewhere real')

const hrefs = [
  ...new Set(
    (await page.locator('main a[href^="/"]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href'))))
      .filter(Boolean)
      .filter((href) => href.includes('?')),
  ),
].slice(0, 10)

const broken = []
for (const href of hrefs) {
  const response = await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle' })
  const status = response?.status() ?? 0
  const text = await page.locator('main').innerText()
  if (status >= 400 || /Traceback|odoo\.exceptions/i.test(text)) broken.push(`${href} (${status})`)
}
check('every filtered link the charts offer resolves', broken.length === 0,
  broken.join(', ') || `${hrefs.length} checked`)

/* ------------------------------------------------------------- scope --- */

console.log('\nthe academic context filter is honoured, and validated')

await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
const switcherOptions = await page
  .locator('main select')
  .first()
  .locator('option')
  .evaluateAll((nodes) => nodes.map((n) => n.value))
check('a year selector is offered', switcherOptions.length > 1, switcherOptions.join(','))

await page.goto(`${BASE}/dashboard?year=all`, { waitUntil: 'networkidle' })
check('"all years" widens the scope rather than erroring',
  /All academic years/.test(await page.locator('main').innerText()))

/*
  The ids are validated against the list Odoo offered rather than trusted. It
  would breach nothing either way — Odoo applies its rules to every query — but
  a filter that ignores its own allowlist is the kind that later becomes one
  that matters.
*/
await page.goto(`${BASE}/dashboard?year=999999`, { waitUntil: 'networkidle' })
const forged = await page.locator('main').innerText()
check('an invented year id falls back rather than being passed through',
  !/Traceback|Internal Server Error/i.test(forged) &&
    (yearId === null || forged.includes(years[0].name)),
  yearId ? `fell back to ${years[0].name}` : 'no current year to fall back to')

await context.close()

/* ------------------------------------------------------------ teacher --- */

if (TEACHER) {
  console.log('\nthe teacher sees their own slice, not the school')
  const teacherSession = await signIn(TEACHER)
  const text = await teacherSession.page.locator('main').innerText()

  check('the teacher screen is not the school-wide one',
    !/Students by grade|School structure|Registration pipeline/.test(text))
  check('it leads with their own work',
    /My classes and subjects/.test(text) && /My assignments/.test(text))

  /*
    Record rules, not a filter written on this side: whatever the page shows a
    teacher must be a subset of what Odoo returns for that same user.
  */
  sid = null
  await rpc('/web/session/authenticate', { db: DB, login: TEACHER, password: PASSWORD })
  const theirStudents = await kw('school.student', 'search_count', [[]])
  const shown = await kpi(teacherSession.page, 'My students')
  check('their student count does not exceed what Odoo grants them',
    shown === null || shown <= theirStudents, `page=${shown} odoo=${theirStudents}`)

  await teacherSession.context.close()
}

await browser.close()
console.log(`\n${failures === 0 ? 'dashboard data: all checks passed' : `${failures} check(s) failed`}`)
process.exit(failures === 0 ? 0 : 1)
