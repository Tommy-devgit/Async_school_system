/**
 * The student roll, grouped by grade — verified against Odoo, not the page.
 *
 * The list used to be one flat run ordered by name, which is not how a school
 * reads its own roll. Grouping it is only useful if three things hold, and each
 * of them has an obvious way to be wrong:
 *
 *   - the grades are in numeric order. Sorted as text, "Grade 10" falls between
 *     "Grade 1" and "Grade 2", and a demo with nine grades never shows it. The
 *     ordering comes from `school.student.grade_id`, which follows
 *     school.grade's `sequence, name` — 10, 20 … 120 — so nothing here parses a
 *     label to find out where a grade belongs.
 *   - the heading over a row is that row's actual grade. Asserted by comparing
 *     each heading against the Grade cell of every row beneath it, and against
 *     what Odoo returns for the same student.
 *   - grouping shows no student the reader could not already see. A grade
 *     heading is a summary, and a summary is a way to leak the shape of records
 *     somebody is not allowed to read.
 *
 * Read-only: it creates nothing and needs no E2E_ALLOW_WRITES.
 *
 *   ODOO_BASE_URL / ODOO_DB   the Odoo to read back from
 *   E2E_PASSWORD              shared demo password
 *   E2E_ADMIN_LOGIN           required, and required to be the administrator
 *   E2E_TEACHER_LOGIN         optional: the scope half is skipped without it
 */
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const ODOO = process.env.ODOO_BASE_URL ?? 'http://localhost:8070'
const DB = process.env.ODOO_DB ?? 'school'
const PASSWORD = process.env.E2E_PASSWORD
const ADMIN = process.env.E2E_ADMIN_LOGIN
const TEACHER = process.env.E2E_TEACHER_LOGIN

let failures = 0
const check = (label, ok, extra = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

if (!ADMIN || !PASSWORD) {
  console.log('\nstudent grouping: SKIPPED — needs E2E_ADMIN_LOGIN and E2E_PASSWORD')
  process.exit(0)
}

async function odooLogin(login) {
  const response = await fetch(`${ODOO}/web/session/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { db: DB, login, password: PASSWORD } }),
  })
  const sid = (response.headers.getSetCookie?.() ?? [])
    .map((cookie) => /session_id=([^;]+)/.exec(cookie)?.[1])
    .filter(Boolean)[0]
  if (!sid) throw new Error(`could not authenticate ${login}`)
  return sid
}

async function kw(sid, model, method, args = [], kwargs = {}) {
  const response = await fetch(`${ODOO}/web/dataset/call_kw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `session_id=${sid}` },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { model, method, args, kwargs } }),
  })
  const body = await response.json()
  if (body.error) throw new Error(body.error.data?.message ?? 'refused')
  return body.result
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })

async function signIn(login, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#login', login)
  await page.fill('#password', PASSWORD)
  await page.click('#submit-login')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })
  return { context, page }
}

const settled = (page) =>
  page
    .waitForFunction(
      () => {
        const main = document.querySelector('main')
        return main && !/^\s*Loading/i.test(main.textContent ?? '')
      },
      { timeout: 60_000 },
    )
    .catch(() => {})

/**
 * The table as rendered: each heading and the rows under it, in document order.
 *
 * The heading's own text node, not its textContent — the count sits in a span
 * beside the label, and reading both together turns "Grade 3" and "23 students"
 * into "Grade 323 students", where a greedy match for the count eats the grade.
 */
const readGroups = (page) =>
  page.evaluate(() => {
    const headers = [...document.querySelectorAll('main table thead th')].map((th) =>
      th.textContent.trim().toLowerCase(),
    )
    const gradeColumn = headers.indexOf('grade')
    const groups = []
    let current = null
    let rows = 0

    for (const tr of document.querySelectorAll('main table tbody tr')) {
      const heading = tr.querySelector('th[scope="colgroup"]')
      if (heading) {
        current = { label: (heading.childNodes[0]?.textContent ?? '').trim(), rows: [] }
        groups.push(current)
        continue
      }
      rows += 1
      const cells = [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())
      current?.rows.push({ name: cells.find(Boolean) ?? '', grade: cells[gradeColumn] ?? null })
    }
    return { groups, rows }
  })

try {
  const sid = await odooLogin(ADMIN)
  const admin = await signIn(ADMIN)

  /* ------------------------------------------------ grouped, in order --- */

  console.log('\nthe roll is grouped by grade, in numeric order')
  await admin.page.goto(`${BASE}/students`, { waitUntil: 'domcontentloaded' })
  await settled(admin.page)

  const first = await readGroups(admin.page)
  check('the list is grouped', first.groups.length > 0, `${first.groups.length} group(s)`)
  check('every row sits under a heading',
    first.groups.reduce((n, group) => n + group.rows.length, 0) === first.rows,
    `${first.rows} rows`)
  check('no heading is drawn for an empty grade', first.groups.every((group) => group.rows.length > 0))
  check('no grade is headed twice',
    new Set(first.groups.map((group) => group.label)).size === first.groups.length)

  /*
    Every page of the roll, so the assertion covers the double-digit grades
    rather than whichever grades happen to fit on the first page. The order has
    to hold across the whole run: pages are windows onto one ordered result set.
  */
  const seen = []
  for (let page = 1; page <= 6; page += 1) {
    await admin.page.goto(`${BASE}/students?page=${page}`, { waitUntil: 'domcontentloaded' })
    /*
      A page past the end redirects to the last real one, which destroys the
      evaluation context mid-read. Settle after the redirect, then stop if the
      page we landed on is not the one asked for — that is the end of the roll.
    */
    await admin.page.waitForLoadState('domcontentloaded').catch(() => {})
    await settled(admin.page)
    const landed = Number(new URL(admin.page.url()).searchParams.get('page') ?? '1')
    if (landed !== page) break
    const read = await readGroups(admin.page)
    if (read.rows === 0) break
    for (const group of read.groups) {
      if (seen[seen.length - 1] !== group.label) seen.push(group.label)
    }
    // Each row's Grade cell must equal the heading it was filed under.
    const wrong = read.groups.flatMap((group) =>
      group.rows.filter((row) => row.grade && row.grade !== group.label)
        .map((row) => `${row.name}: ${row.grade} under ${group.label}`),
    )
    check(`page ${page}: every row's grade matches its heading`, wrong.length === 0, wrong.slice(0, 2).join(' ; '))
  }

  const levels = seen.map((label) => Number(/(\d+)/.exec(label)?.[1] ?? NaN)).filter(Number.isFinite)
  console.log(`    grades across every page: ${seen.join(' → ')}`)
  check('grades ascend numerically across the whole roll',
    levels.every((level, index) => index === 0 || levels[index - 1] <= level), levels.join(', '))

  /*
    The trap, named so a failure explains itself. These only assert when the
    data actually spans the boundary; a database with no Grade 10 cannot show
    the bug and should not claim to have ruled it out.
  */
  const before = (a, b) => !(levels.includes(a) && levels.includes(b)) || levels.indexOf(a) < levels.indexOf(b)
  check('Grade 9 comes before Grade 10, so this is not a text sort', before(9, 10))
  check('Grade 2 comes before Grade 10', before(2, 10))
  check('Grade 2 comes before Grade 11', before(2, 11))
  if (!levels.includes(10) && !levels.includes(11)) {
    console.log('    note: no double-digit grade in this database, so the text-sort trap is not exercised')
  }

  /* --------------------------------------------- alphabetical within one --- */

  console.log('\nstudents are alphabetical inside a grade')
  await admin.page.goto(`${BASE}/students`, { waitUntil: 'domcontentloaded' })
  await settled(admin.page)
  const groups = (await readGroups(admin.page)).groups
  const biggest = [...groups].sort((a, b) => b.rows.length - a.rows.length)[0]
  if (biggest && biggest.rows.length > 1) {
    const names = biggest.rows.map((row) => row.name)
    check(`${biggest.label} is in name order`,
      JSON.stringify(names) === JSON.stringify([...names].sort((a, b) => a.localeCompare(b))),
      names.slice(0, 3).join(', '))
  } else {
    console.log('    only one student per grade on this page — ordering not observable')
  }

  /* ------------------------------------------------- against Odoo itself --- */

  console.log('\nthe grade shown is the grade Odoo holds')
  const sample = biggest?.rows[0]
  if (sample) {
    const [record] = await kw(sid, 'school.student', 'search_read', [
      [['name', '=', sample.name]], ['name', 'grade_id', 'class_id'],
    ], { limit: 1 })
    check('the heading matches the record, not the label on screen',
      record && record.grade_id && record.grade_id[1] === biggest.label,
      record ? `${record.name} → ${record.grade_id && record.grade_id[1]}` : 'not found')
    check('and the class, which carries the section, is still shown',
      Boolean(record?.class_id), record?.class_id ? record.class_id[1] : 'none')
  }

  /* -------------------------------------------- search and filters narrow --- */

  console.log('\nsearch and filters leave no empty groups')
  const [probe] = await kw(sid, 'school.student', 'search_read', [[], ['name']], { limit: 1 })
  if (probe) {
    await admin.page.goto(`${BASE}/students?q=${encodeURIComponent(probe.name)}`, { waitUntil: 'domcontentloaded' })
    await settled(admin.page)
    const found = await readGroups(admin.page)
    check('a search shows only the grades it matched', found.groups.length > 0 && found.groups.length <= 2,
      found.groups.map((group) => group.label).join(' | '))
    check('with nobody\'s heading left empty', found.groups.every((group) => group.rows.length > 0))
  }

  /* -------------------------------------- grouping follows the sort, only --- */

  console.log('\nsorting by name puts the headings away')
  await admin.page.goto(`${BASE}/students?sort=name:asc`, { waitUntil: 'domcontentloaded' })
  await settled(admin.page)
  const byName = await readGroups(admin.page)
  check('no grade headings while the list is sorted by name', byName.groups.length === 0,
    `${byName.groups.length} heading(s)`)
  check('and the rows are still there', byName.rows > 0, `${byName.rows} rows`)

  await admin.context.close()

  /* --------------------------------------------------- and it leaks nothing --- */

  if (TEACHER) {
    console.log('\ngrouping shows a teacher only their own students')
    const teacherSid = await odooLogin(TEACHER)
    const mine = await kw(teacherSid, 'school.student', 'search_read', [[], ['name']], { limit: 500 })
    const all = await kw(sid, 'school.student', 'search_read', [[], ['name']], { limit: 500 })
    check('the teacher sees fewer students than the administrator', mine.length < all.length,
      `${mine.length} of ${all.length}`)

    const teacher = await signIn(TEACHER)
    await teacher.page.goto(`${BASE}/students`, { waitUntil: 'domcontentloaded' })
    await settled(teacher.page)
    const shown = await readGroups(teacher.page)
    const visible = new Set(mine.map((row) => row.name))
    const leaked = shown.groups.flatMap((group) => group.rows)
      .filter((row) => row.name && !visible.has(row.name))
    check('no student outside their scope appears under any heading', leaked.length === 0,
      leaked.slice(0, 3).map((row) => row.name).join(', '))
    check('and the headings cover only the grades they can see',
      shown.groups.every((group) => group.rows.length > 0),
      shown.groups.map((group) => group.label).join(' | '))
    await teacher.context.close()
  } else {
    console.log('\nscope: SKIPPED — set E2E_TEACHER_LOGIN')
  }

  /* ------------------------------------------------------------- mobile --- */

  console.log('\nthe grouped list works on a phone')
  const phone = await signIn(ADMIN, { width: 390, height: 844 })
  await phone.page.goto(`${BASE}/students`, { waitUntil: 'domcontentloaded' })
  await settled(phone.page)
  const overflow = await phone.page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  check('the page does not scroll sideways at 390px', overflow <= 0, `${overflow}px`)
  const heading = phone.page.locator('main table tbody th[scope="colgroup"]').first()
  check('the grade heading is visible', await heading.isVisible().catch(() => false))
  const box = await heading.boundingBox().catch(() => null)
  check('and does not eat the screen', !box || box.height < 48, box ? `${Math.round(box.height)}px tall` : 'n/a')
  await phone.context.close()
} finally {
  await browser.close()
}

console.log(failures === 0 ? '\nstudent grouping: ok' : `\nstudent grouping: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
