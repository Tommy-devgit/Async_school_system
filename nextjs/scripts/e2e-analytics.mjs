/**
 * The graph, pivot, board and calendar views, checked against the same
 * read_group Odoo would run rather than against the page.
 *
 *   node scripts/e2e-analytics.mjs <baseUrl>
 *
 * Env: E2E_LOGIN, E2E_PASSWORD, plus the ODOO_* pair scripts/rpc.mjs reads.
 * Read-only: this creates and changes nothing.
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
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`)
}

await login()
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext()
const page = await context.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

const readGroup = (model, fields, groupby, domain = []) =>
  call(model, 'read_group', [domain, fields, groupby], { lazy: false })

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login', LOGIN)
  await page.fill('#password', PASSWORD)
  await page.click('#submit-login')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  check('signed in', true)

  /* ==================================================== marks analysis === */
  await page.goto(`${BASE}/marks/analysis`, { waitUntil: 'networkidle' })
  const markGroups = await readGroup('school.mark', ['percentage'], ['class_id', 'subject_id', 'term_id'])
  const distinctRows = new Set(
    markGroups.map((g) => `${g.class_id?.[1] ?? 'No class'}|${g.subject_id?.[1] ?? 'No subject'}`),
  ).size

  const hasChart = await page.locator('svg[role=img]').count()
  const pivotRows = await page.locator('table tbody tr').count()
  if (markGroups.length === 0) {
    check('marks analysis degrades to an empty state with no marks',
      /No marks recorded|No marks are visible/.test(await page.locator('body').innerText()))
  } else {
    check('marks chart rendered', hasChart > 0, `${hasChart} chart(s)`)
    // Odoo's grouping plus the "All" total row.
    check('pivot has one row per class and subject, plus a total',
      pivotRows === distinctRows + 1, `${pivotRows} rows vs ${distinctRows} groups + 1`)

    // The headline number must be the average Odoo would compute, not a sum.
    const totalPct = markGroups.reduce((s, g) => s + Number(g.percentage ?? 0), 0)
    const totalCount = markGroups.reduce((s, g) => s + g.__count, 0)
    const expected = Math.round((totalPct / totalCount) * 10) / 10
    const grand = (await page.locator('table tbody tr:last-child td:last-child').innerText()).trim()
    check('the grand total is an average, not a sum',
      grand === `${expected}%`, `page ${grand}, expected ${expected}%`)
  }

  /* =============================================== attendance analysis === */
  await page.goto(`${BASE}/attendance/analysis`, { waitUntil: 'networkidle' })
  const attGroups = await readGroup('school.attendance', [], ['class_id', 'status'])
  if (attGroups.length > 0) {
    const total = attGroups.reduce((s, g) => s + g.__count, 0)
    const grand = (await page.locator('table tbody tr:last-child td:last-child').innerText()).trim()
    check('attendance cells count records rather than averaging',
      grand === String(total), `page ${grand}, Odoo ${total}`)
    const classes = new Set(attGroups.map((g) => g.class_id?.[1] ?? 'No class')).size
    const rows = await page.locator('table tbody tr').count()
    check('one pivot row per class, plus a total', rows === classes + 1,
      `${rows} rows vs ${classes} classes + 1`)
  } else {
    check('attendance analysis degrades to an empty state',
      /No attendance/.test(await page.locator('body').innerText()))
  }

  /* ========================================================= workload === */
  await page.goto(`${BASE}/assignments/workload`, { waitUntil: 'networkidle' })
  const loads = await readGroup('school.teacher.assignment', ['weekly_periods'], ['teacher_id'])
  const withLoad = loads.filter((g) => Number(g.weekly_periods ?? 0) > 0).length
  const body = await page.locator('body').innerText()
  check('workload page renders',
    withLoad > 0
      ? (await page.locator('svg[role=img]').count()) > 0
      : /No teaching assignments/.test(body),
    `${withLoad} teacher(s) with periods`)

  /* ============================================================ board === */
  await page.goto(`${BASE}/announcements/board`, { waitUntil: 'networkidle' })
  const states = await readGroup('school.announcement', [], ['state'])
  const counts = Object.fromEntries(states.map((g) => [g.state, g.__count]))
  const boardText = await page.locator('body').innerText()
  check('board shows a column per publication state',
    ['Draft', 'Published', 'Archived'].every((label) => boardText.includes(label)))
  for (const [state, label] of [['draft', 'Draft'], ['published', 'Published']]) {
    if (counts[state]) {
      const column = page.locator('section', { has: page.locator(`h2:text-is("${label}")`) })
      const cards = await column.locator('li').count()
      check(`${label} column holds every ${state} announcement`,
        cards === counts[state], `${cards} cards vs ${counts[state]} in Odoo`)
    }
  }

  /* ========================================================= calendar === */
  await page.goto(`${BASE}/programs/calendar`, { waitUntil: 'networkidle' })
  const calText = await page.locator('body').innerText()
  check('calendar renders an Ethiopian month',
    /Meskerem|Tikimt|Hidar|Tahsas|Tir|Yekatit|Megabit|Miazia|Ginbot|Sene|Hamle|Nehase|Pagume/.test(calText),
    calText.split('\n').find((l) => /20\d\d/.test(l))?.slice(0, 60) ?? '')
  check('calendar shows the seven weekday headers',
    (await page.locator('.grid-cols-7 > div').count()) >= 7)

  // The default month is usually empty, which leaves the cell that actually
  // draws a programme untested. Navigate to a month that has one.
  const [programme] = await call('school.program', 'search_read',
    [[['start_datetime', '!=', false]], ['name', 'start_datetime']], { limit: 1 })
  check('a programme exists to place on the calendar', Boolean(programme))
  if (programme) {
    const { parseIsoDate, toEthiopian } = await import('../lib/ethiopian-date.ts')
    const ethiopian = toEthiopian(parseIsoDate(String(programme.start_datetime).slice(0, 10)))
    await page.goto(
      `${BASE}/programs/calendar?year=${ethiopian.year}&month=${ethiopian.month}`,
      { waitUntil: 'networkidle' },
    )
    const monthText = await page.locator('body').innerText()
    check('the programme appears on its start day',
      monthText.includes(programme.name), `looking for ${programme.name}`)
    // The link wraps two spans, so match it by href rather than exact text.
    const cell = page.locator('.grid-cols-7 > div', {
      has: page.locator(`a[href="/programs/${programme.id}"]`),
    })
    const cellText = (await cell.first().innerText()).trim()
    check('it sits in the cell for its Ethiopian day',
      cellText.startsWith(String(ethiopian.day)),
      `cell starts "${cellText.split('\n')[0]}", expected day ${ethiopian.day}`)
  }

  check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  /* =========================================================== mobile === */
  await page.setViewportSize({ width: 390, height: 844 })
  const routes = [
    '/marks/analysis', '/attendance/analysis', '/assignments/workload',
    '/announcements/board', '/programs/calendar',
  ]
  const overflowing = []
  for (const route of routes) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (overflow > 0) overflowing.push(`${route} (${overflow}px)`)
  }
  check(`no horizontal overflow at 390px on ${routes.length} routes`,
    overflowing.length === 0, overflowing.join(', '))
} catch (error) {
  failed++
  console.log(`  FAIL  threw - ${error.message.split('\n')[0]}`)
} finally {
  await browser.close()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
