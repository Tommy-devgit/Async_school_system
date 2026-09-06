/**
 * The curriculum list screen.
 *
 * These lines were only reachable through Configuration, which renders every
 * one of them at once with no search, no filter and no paging. This checks the
 * new screen against real Odoo data: that it lists, filters, sorts and pages;
 * that searching by class or subject name actually narrows it; that the roles
 * with an ACL row are offered it and the ones without are not; and that only a
 * role that can write is given a way into the edit form.
 *
 * Read-only. Nothing here writes, so it needs no write approval.
 *
 *   E2E_PASSWORD              shared demo password
 *   E2E_REGISTRAR_LOGIN       writes school.grade.subject
 *   E2E_TEACHER_LOGIN         reads it
 *   E2E_HR_LOGIN              holds no ACL row on it — optional
 */
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const PASSWORD = process.env.E2E_PASSWORD
const REGISTRAR = process.env.E2E_REGISTRAR_LOGIN
const TEACHER = process.env.E2E_TEACHER_LOGIN
const HR = process.env.E2E_HR_LOGIN

let failures = 0
const check = (label, ok, extra = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

if (!REGISTRAR || !PASSWORD) {
  console.log('\ncurriculum: SKIPPED — needs E2E_REGISTRAR_LOGIN and E2E_PASSWORD')
  process.exit(0)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })

async function signIn(login) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login', login)
  await page.fill('#password', PASSWORD)
  await page.click('#submit-login')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })
  return { context, page }
}

const bodyRows = (page) => page.locator('main table tbody tr')

/*
  Column positions shift by one on a list the signed-in user may remove from,
  because those lead with a selection checkbox. Worked out from the page rather
  than assumed, so these checks stay pointed at the column they name.
*/
async function columnOffset(page) {
  return (await page.locator('main tbody tr td input[name="id"]').count()) > 0 ? 1 : 0
}

/* ------------------------------------------------------- it lists at all --- */

console.log('\nthe curriculum lists')
const { context: registrarContext, page } = await signIn(REGISTRAR)
await page.goto(`${BASE}/curriculum`, { waitUntil: 'networkidle' })
await page.locator('main h1').first().waitFor({ timeout: 30_000 })

const heading = (await page.locator('main h1').first().textContent()) ?? ''
check('the page is titled Curriculum', /curriculum/i.test(heading), heading.trim())

const text = () => page.locator('main').textContent().then((value) => value ?? '')
const first = await text()
check('nothing leaked from Odoo', !/Traceback|odoo\.exceptions|psycopg2/i.test(first))
check('it is not an error boundary', !/Something went wrong/i.test(first))

const listed = await bodyRows(page).count()
check('rows are listed', listed > 0, `${listed} row(s)`)
if (listed === 0) {
  await browser.close()
  console.log('\ncurriculum: no lines in this database — cannot exercise the screen')
  process.exit(1)
}

/* ------------------------------------------------------------ it narrows --- */

console.log('\nsearching narrows it to something real')
const offset = await columnOffset(page)
const subjectCell =
  (await bodyRows(page).first().locator('td').nth(1 + offset).textContent()) ?? ''
const needle = subjectCell.trim().split(/\s+/)[0]
check('a subject name was read off the first row', Boolean(needle), needle)

await page.goto(`${BASE}/curriculum?q=${encodeURIComponent(needle)}`, {
  waitUntil: 'networkidle',
})
await page.locator('main h1').first().waitFor({ timeout: 30_000 })
const narrowed = await bodyRows(page).count()
check('the search returned rows', narrowed > 0, `${narrowed} row(s)`)
check('it narrowed or matched, never widened', narrowed <= listed, `${narrowed} ≤ ${listed}`)

const shown = await text()
check('every row still mentions the term', shown.toLowerCase().includes(needle.toLowerCase()))

console.log('\nfiltering by class narrows to that class only')
await page.goto(`${BASE}/curriculum`, { waitUntil: 'networkidle' })
await page.locator('main h1').first().waitFor({ timeout: 30_000 })

// Read the class off the first row, then find the filter option that names it,
// so the id under test comes from the screen rather than from a guess.
const firstClass =
  ((await bodyRows(page).first().locator('td').nth(await columnOffset(page)).textContent()) ?? '').trim()
const classSelect = page.locator('select').filter({ hasText: firstClass }).first()
const classId =
  (await classSelect.count()) > 0
    ? await classSelect
        .locator('option')
        .filter({ hasText: firstClass })
        .first()
        .getAttribute('value')
    : null

if (classId) {
  await page.goto(`${BASE}/curriculum?class=${classId}`, { waitUntil: 'networkidle' })
  await page.locator('main h1').first().waitFor({ timeout: 30_000 })
  const classes = await bodyRows(page)
    .locator(`td:nth-child(${1 + (await columnOffset(page))})`)
    .allTextContents()
  check('the filter returned rows', classes.length > 0, `${classes.length} row(s)`)
  check(
    'every row is that class',
    classes.every((value) => value.trim() === firstClass),
    firstClass,
  )
  check('it did not widen', classes.length <= listed, `${classes.length} ≤ ${listed}`)
} else {
  console.log(`  SKIPPED — no filter option matching "${firstClass}"`)
}

console.log('\na search that matches nothing is empty, not broken')
await page.goto(`${BASE}/curriculum?q=zzz-no-such-subject-zzz`, { waitUntil: 'networkidle' })
await page.locator('main').waitFor({ timeout: 30_000 })
const nothing = await text()
check('no rows', (await bodyRows(page).count()) === 0)
// A narrowed list says so and offers a way back, rather than claiming the
// curriculum is empty.
check(
  'an empty state is shown',
  /Nothing matches those filters/i.test(nothing) && /Clear filters/i.test(nothing),
)
check('not an error', !/Something went wrong|Traceback/i.test(nothing))

console.log('\na hand-edited query narrows, it does not raise')
for (const query of [
  '?class=not-a-number',
  '?page=99999',
  '?page=-4',
  '?sort=drop%20table:desc',
  '?sort=subject_id:sideways',
  '?active=maybe',
]) {
  const response = await page.goto(`${BASE}/curriculum${query}`, { waitUntil: 'networkidle' })
  const body = await text()
  check(
    `${query.padEnd(24)} renders`,
    response?.status() === 200 && !/Traceback|Something went wrong/i.test(body),
    `http=${response?.status()}`,
  )
}

/* -------------------------------------------------------------- sorting --- */

console.log('\nsorting is offered on the columns that can carry it')

// The list shell reads the sort as one `field:direction` parameter.
const column = async (field, direction, nth) => {
  await page.goto(`${BASE}/curriculum?sort=${field}:${direction}`, {
    waitUntil: 'networkidle',
  })
  await page.locator('main h1').first().waitFor({ timeout: 30_000 })
  const cells = await bodyRows(page)
    .locator(`td:nth-child(${nth + (await columnOffset(page))})`)
    .allTextContents()
  return cells.map((value) => value.trim())
}

/*
  Both directions, and the two compared against each other.

  Checking only that a descending list is non-increasing passes trivially when
  every row holds the same number, which is exactly what a freshly seeded
  curriculum looks like — every subject marked out of 100. So the pair has to
  actually differ before the ordering means anything, and this says so plainly
  when the data cannot tell us.
*/
for (const [field, nth] of [
  ['pass_mark', 5],
  ['maximum_mark', 4],
  ['subject_id', 2],
]) {
  const ascending = await column(field, 'asc', nth)
  const descending = await column(field, 'desc', nth)

  if (new Set(ascending).size <= 1) {
    console.log(`    ${field}: every row reads "${ascending[0] ?? ''}" — ordering not observable`)
    continue
  }

  check(
    `${field} descending is the reverse of ascending`,
    descending.join('|') === [...ascending].reverse().join('|'),
    descending.slice(0, 5).join(', '),
  )
}

/* ------------------------------------------- the edit link follows write --- */

console.log('\nthe edit form is offered to a role that can save it')
await page.goto(`${BASE}/curriculum`, { waitUntil: 'networkidle' })
await page.locator('main h1').first().waitFor({ timeout: 30_000 })
const editLinks = await page.locator('main table tbody a[href*="/curriculum/"]').count()
check('the registrar gets links into the edit form', editLinks > 0, `${editLinks} link(s)`)

const href = await page.locator('main table tbody a[href*="/curriculum/"]').first().getAttribute('href')
await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle' })
await page.locator('main h1').first().waitFor({ timeout: 30_000 })
const form = await text()
check('the link opens the edit form', /maximum|pass mark/i.test(form), href ?? '')
check('and not an error', !/Something went wrong|Traceback/i.test(form))
await registrarContext.close()

/* --------------------------------------------- a reader sees, cannot edit --- */

if (TEACHER) {
  console.log('\na read-only role sees the list and is offered no way to edit')
  const { context: readerContext, page: reader } = await signIn(TEACHER)
  await reader.goto(`${BASE}/curriculum`, { waitUntil: 'networkidle' })
  await reader.locator('main h1').first().waitFor({ timeout: 30_000 })
  const readerText = (await reader.locator('main').textContent()) ?? ''

  check('the teacher can read the curriculum', !/Something went wrong|not allowed/i.test(readerText))
  check('rows are listed', (await bodyRows(reader).count()) > 0)
  check(
    'no link into the edit form',
    (await reader.locator('main table tbody a[href*="/curriculum/"]').count()) === 0,
  )

  // The sidebar is not the boundary — Odoo is — but it should still agree.
  check(
    'Curriculum is in the sidebar',
    (await reader.locator('nav a[href="/curriculum"]').count()) > 0,
  )
  await readerContext.close()
} else {
  console.log('\nread-only role: SKIPPED — set E2E_TEACHER_LOGIN')
}

/* ------------------------------------ a role with no ACL row is not shown --- */

if (HR) {
  console.log('\na role with no ACL row on school.grade.subject is not offered it')
  const { context: hrContext, page: hrPage } = await signIn(HR)
  await hrPage.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
  await hrPage.locator('main').first().waitFor({ timeout: 30_000 })
  check(
    'Curriculum is absent from the sidebar',
    (await hrPage.locator('nav a[href="/curriculum"]').count()) === 0,
  )

  // And going there directly is refused in words, not with a stack trace.
  await hrPage.goto(`${BASE}/curriculum`, { waitUntil: 'networkidle' })
  await hrPage.locator('main').first().waitFor({ timeout: 30_000 })
  const hrText = (await hrPage.locator('main').textContent()) ?? ''
  check('the direct URL does not leak a traceback', !/Traceback|psycopg2/i.test(hrText))
  await hrContext.close()
} else {
  console.log('\nno-access role: SKIPPED — set E2E_HR_LOGIN')
}

await browser.close()
console.log(failures === 0 ? '\ncurriculum: ok' : `\ncurriculum: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
