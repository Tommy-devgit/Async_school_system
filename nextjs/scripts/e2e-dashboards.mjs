/**
 * The role dashboards, checked against real Odoo data.
 *
 * The point of these assertions is that each role lands on a screen shaped by
 * its own job, and that every number shown is one Odoo actually returned. A
 * dash is a refusal and must never be rendered as a zero — a dashboard that
 * told a Director "0 students" when it simply could not read students would be
 * worse than one that said nothing.
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

/** Panels each role's dashboard must offer, by heading. */
const EXPECTED = {
  teacher: [
    "Today's lessons",
    'Waiting on you',
    'Mark lists open to you',
    'Attendance today',
    'My assignments',
    'My classes and subjects',
  ],
  registrar: [
    'Waiting on you',
    'Registration pipeline',
    'Students by grade',
    'Latest registrations',
    'School structure',
  ],
  director: ['Waiting on a decision', 'Average by grade', 'Report cards'],
  frontoffice: ['Find a student', 'Live announcements'],
}

/*
  Panels a role must NOT see, because the screen belongs to somebody else.

  This is the point of having separate dashboards rather than one screen with
  things hidden: a teacher is not shown the school's registration funnel, and a
  director is not shown a timetable they have no part in.
*/
const FORBIDDEN = {
  teacher: ['Registration pipeline', 'School structure', 'Staff by department'],
  registrar: ["Today's lessons", 'My assignments'],
  director: ["Today's lessons", 'Find a student', 'My assignments'],
  frontoffice: ['Registration pipeline', "Today's lessons", 'My assignments'],
}

/*
  Bands each role's page is divided into, as an h2. Matched on the DOM text,
  not what is painted: the band titles are upper-cased in CSS, so asserting on
  "TODAY" would pass or fail on a stylesheet rather than on the markup.
*/
const BANDS = {
  teacher: ['Today', 'My classes', 'My work'],
  registrar: ['Your queue', 'The roll', 'The school'],
  director: ['Outcomes', 'Approvals'],
}

/*
  Read the rendered page, not `body`: React's flight payload sits in a script
  tag and legitimately contains `$undefined` markers, which is not a leak.
*/
const LEAK = /Traceback|\/usr\/lib\/python|psycopg2|odoo\.exceptions|session_id=/i
const PLACEHOLDER = /NaN|undefined|\[object Object\]/

let failures = 0
const check = (label, ok, extra = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })

for (const [role, login] of Object.entries(ROLES)) {
  if (!login) continue
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
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

  console.log(`\n${role} (${login})`)
  const visible = (await page.locator('main').innerText()) ?? ''

  check('renders without leaking', !LEAK.test(visible), LEAK.exec(visible)?.[0] ?? '')
  check('renders no placeholder values', !PLACEHOLDER.test(visible), PLACEHOLDER.exec(visible)?.[0] ?? '')
  check(
    'greets by name',
    /Good (morning|afternoon|evening),/.test(visible),
    visible.match(/Good \w+, [^\n]{0,24}/)?.[0] ?? '',
  )

  for (const panel of EXPECTED[role] ?? []) {
    check(`shows "${panel}"`, (await page.locator(`main h3:text-is("${panel}")`).count()) > 0)
  }
  for (const panel of FORBIDDEN[role] ?? []) {
    check(`does not show "${panel}"`, (await page.locator(`main h3:text-is("${panel}")`).count()) === 0)
  }
  for (const band of BANDS[role] ?? []) {
    check(`is divided into "${band}"`, (await page.locator(`main h2:text-is("${band}")`).count()) > 0)
  }

  /*
    Headings have to nest: the page is one h1, each band an h2, each panel an
    h3. A dashboard of thirty equal headings is navigable by sight and by
    nothing else.
  */
  const levels = await page.evaluate(() =>
    [...document.querySelectorAll('main h1, main h2, main h3')].map((node) =>
      Number(node.tagName[1]),
    ),
  )
  check('there is exactly one h1', levels.filter((level) => level === 1).length === 1)
  check(
    'no heading level is skipped',
    levels.every((level, index) => index === 0 || level <= levels[index - 1] + 1),
    levels.join(''),
  )

  // Every tile is a real figure or an explicit dash, never a zero standing in
  // for a refusal.
  const tiles = await page.locator('main .tabular').allTextContents()
  const dashes = tiles.filter((t) => t.trim() === '—').length
  const restrictedNotes = await page.locator('main :text("Not available to your role")').count()
  check(
    'every dashed tile says why',
    dashes === 0 || restrictedNotes >= dashes,
    `dashes=${dashes} notes=${restrictedNotes}`,
  )
  check('no tile reads NaN or undefined', !tiles.some((t) => /NaN|undefined/.test(t)))

  // A dashboard that cannot be acted on is a poster. Every one of these has at
  // least one panel that leads into the list it summarises.
  const onward = await page.locator('main a[href^="/"]').count()
  check('panels lead somewhere', onward >= 3, `${onward} links`)

  // A dashboard is the landing page, so it must survive a narrow viewport.
  await page.setViewportSize({ width: 390, height: 780 })
  await page.waitForTimeout(200)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  )
  check('no horizontal overflow at 390px', overflow)

  await context.close()
}

await browser.close()
console.log(`\n${failures === 0 ? 'dashboards: all checks passed' : `${failures} check(s) failed`}`)
process.exit(failures === 0 ? 0 : 1)
