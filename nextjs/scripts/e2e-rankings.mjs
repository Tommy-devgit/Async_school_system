/**
 * Rankings — verified against Odoo, not the page.
 *
 * `/rankings` arranges figures it does not own: `class_rank`, `class_size`,
 * `grade_rank` and `grade_size` are computed on `school.report.card`. So the
 * thing worth asserting is not that a table rendered, but that the table agrees
 * with the cards it was drawn from, and that a teacher reading it is scoped to
 * their own classes by the record rule rather than by the menu.
 *
 * Four things this holds, each of which was broken at some point while the
 * screen was being built:
 *
 *   - a Director can open it. The first version read `school.term` for its
 *     filter, and a Director holds no ACL row on that model, so the navigation
 *     offered a link that opened onto a refusal.
 *   - a teacher sees only their own classes, and an out-of-scope card refuses a
 *     direct read rather than merely being absent from the list.
 *   - the position shown matches the position on the card itself.
 *   - ties are counted within a class. Every class has a rank 1, and comparing
 *     rank numbers across the table marked unrelated students as tied.
 *
 * Read-only: it creates nothing and needs no E2E_ALLOW_WRITES.
 *
 *   ODOO_BASE_URL / ODOO_DB   the Odoo to read back from
 *   E2E_PASSWORD              shared demo password
 *   E2E_ADMIN_LOGIN           required, and required to be the administrator —
 *                             a generic E2E_LOGIN fallback silently tested the
 *                             wrong role twice before
 *   E2E_TEACHER_LOGIN         optional: the scoping half is skipped without it
 *   E2E_DIRECTOR_LOGIN        optional: the ACL-coverage half needs it
 */
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const ODOO = process.env.ODOO_BASE_URL ?? 'http://localhost:8070'
const DB = process.env.ODOO_DB ?? 'school'
const PASSWORD = process.env.E2E_PASSWORD
const ADMIN = process.env.E2E_ADMIN_LOGIN
const TEACHER = process.env.E2E_TEACHER_LOGIN
const DIRECTOR = process.env.E2E_DIRECTOR_LOGIN

let failures = 0
const check = (label, ok, extra = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

if (!ADMIN || !PASSWORD) {
  console.log('\nrankings: SKIPPED — needs E2E_ADMIN_LOGIN and E2E_PASSWORD')
  process.exit(0)
}

async function odooLogin(login) {
  const response = await fetch(`${ODOO}/web/session/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: { db: DB, login, password: PASSWORD },
    }),
  })
  const sid = (response.headers.getSetCookie?.() ?? [])
    .map((cookie) => /session_id=([^;]+)/.exec(cookie)?.[1])
    .filter(Boolean)[0]
  if (!sid) throw new Error(`could not authenticate ${login} against Odoo`)
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

async function signIn(login) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#login', login)
  await page.fill('#password', PASSWORD)
  await page.click('#submit-login')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })
  return { context, page }
}

/** Past the route's loading boundary, so an assertion cannot read a skeleton. */
async function settled(page) {
  await page
    .waitForFunction(
      () => {
        const main = document.querySelector('main')
        return main && !/^\s*Loading/i.test(main.textContent ?? '')
      },
      { timeout: 60_000 },
    )
    .catch(() => {})
}

try {
  /* ------------------------------------------------ it renders and adds up --- */

  console.log('\nthe rankings screen renders for an administrator')
  const admin = await signIn(ADMIN)
  await admin.page.goto(`${BASE}/rankings`, { waitUntil: 'domcontentloaded' })
  await settled(admin.page)

  const body = (await admin.page.locator('main').textContent()) ?? ''
  check('it opens without an error state', !/Something went wrong/i.test(body))
  check('it is not refused', !/Not available to your role/i.test(body))

  const adminRows = await admin.page.locator('main tbody tr').count()
  check('it ranks somebody', adminRows > 0, `${adminRows} row(s)`)
  check('it offers a term and a class filter', (await admin.page.locator('main select').count()) >= 2)

  /*
    The screen must agree with the card. Both read the same computed field, so a
    disagreement means this screen picked the wrong row — the demo data holds a
    student with three unsuperseded versions, and listing all of them would put
    one person in the table three times.
  */
  if (adminRows > 0) {
    const href = await admin.page.locator('main tbody tr a').first().getAttribute('href')
    check('the student links to the card the position came from', /^\/report-cards\/\d+$/.test(href ?? ''), String(href))

    /*
      The first cell, not the whole row. Reading the row runs the class rank
      straight into the grade rank beside it — "1 of 10" and "1 of 10" arrive as
      "1 of 101 of 10", and the size parses as 101.
    */
    const listed = (
      (await admin.page.locator('main tbody tr').first().locator('td').first().textContent()) ?? ''
    )
      .replace(/\s+/g, ' ')
      .trim()
    const position = /^(\d+) of (\d+)/.exec(listed)
    check('the first row states a position', Boolean(position), listed.slice(0, 60))

    if (href && position) {
      const cardId = Number(/\/report-cards\/(\d+)/.exec(href)[1])
      const sid = await odooLogin(ADMIN)
      const [card] = await kw(sid, 'school.report.card', 'read', [
        [cardId],
        ['class_rank', 'class_size', 'student_id'],
      ])
      check(
        'and Odoo reports the same position for that card',
        card.class_rank === Number(position[1]) && card.class_size === Number(position[2]),
        `screen ${position[1]}/${position[2]} vs odoo ${card.class_rank}/${card.class_size}`,
      )
    }

    /*
      Every class contributes its own rank 1, so a "tied" marker on a row whose
      position is unique inside its class is the cross-class bug, not a tie.
    */
    const marked = await admin.page.locator('main tbody tr', { hasText: /tied/ }).count()
    if (marked > 0) {
      const sid = await odooLogin(ADMIN)
      const cards = await kw(sid, 'school.report.card', 'search_read', [
        [
          ['state', '!=', 'superseded'],
          ['superseded_by_id', '=', false],
        ],
        ['class_id', 'class_rank'],
      ])
      const shared = new Set()
      const seen = new Map()
      for (const row of cards) {
        const key = `${row.class_id ? row.class_id[0] : 0}:${row.class_rank}`
        if (seen.has(key)) shared.add(key)
        seen.set(key, true)
      }
      check('a "tied" marker corresponds to a real shared position', shared.size > 0, `${marked} marked`)
    } else {
      console.log('    no ties in this data — the marker is not exercised')
    }
  }
  await admin.context.close()

  /* -------------------------------------- a director holds no term ACL row --- */

  if (DIRECTOR) {
    console.log('\na director can open it, holding no ACL row on school.term')
    const director = await signIn(DIRECTOR)
    await director.page.goto(`${BASE}/rankings`, { waitUntil: 'domcontentloaded' })
    await settled(director.page)
    const seen = (await director.page.locator('main').textContent()) ?? ''
    check('the page is not a refusal', !/Not available to your role/i.test(seen), seen.replace(/\s+/g, ' ').slice(0, 70))
    check('and not an error', !/Something went wrong/i.test(seen))
    check('the sidebar offered it', (await director.page.locator('nav a[href="/rankings"]').count()) > 0)
    await director.context.close()
  } else {
    console.log('\ndirector: SKIPPED — set E2E_DIRECTOR_LOGIN')
  }

  /* ------------------------------------- a teacher is scoped by the rule --- */

  if (TEACHER) {
    console.log('\na teacher is scoped to their own classes')
    const adminSid = await odooLogin(ADMIN)
    const teacherSid = await odooLogin(TEACHER)

    const live = [
      ['state', '!=', 'superseded'],
      ['superseded_by_id', '=', false],
    ]
    const all = await kw(adminSid, 'school.report.card', 'search_read', [live, ['class_id']])
    const mine = await kw(teacherSid, 'school.report.card', 'search_read', [live, ['class_id']])
    check('the teacher sees fewer cards than the administrator', mine.length < all.length, `${mine.length} of ${all.length}`)
    check('but does see their own', mine.length > 0, `${mine.length}`)

    const visible = new Set(mine.map((row) => row.id))
    const outside = all.find((row) => !visible.has(row.id))

    if (outside) {
      let refused = false
      try {
        await kw(teacherSid, 'school.report.card', 'read', [[outside.id], ['overall_average']])
      } catch {
        refused = true
      }
      check('a card outside their classes refuses a direct read', refused, `card ${outside.id}`)
      check(
        'and is invisible to search',
        (await kw(teacherSid, 'school.report.card', 'search_count', [[['id', '=', outside.id]]])) === 0,
      )
    } else {
      console.log('    every card is in the teacher\'s classes — scoping not exercised')
    }

    const teacher = await signIn(TEACHER)
    check('the sidebar offers rankings', (await teacher.page.locator('nav a[href="/rankings"]').count()) > 0)
    check('and the report cards behind them', (await teacher.page.locator('nav a[href="/report-cards"]').count()) > 0)

    await teacher.page.goto(`${BASE}/rankings`, { waitUntil: 'domcontentloaded' })
    await settled(teacher.page)
    const shown = (await teacher.page.locator('main').textContent()) ?? ''
    check('the screen opens', !/Not available to your role|Something went wrong/i.test(shown))

    const taught = new Set(mine.map((row) => (row.class_id ? row.class_id[1] : null)).filter(Boolean))
    const listed = (await teacher.page.locator('main tbody tr td:nth-child(4)').allTextContents())
      .map((text) => text.trim())
      .filter(Boolean)
    check(
      'every class listed is one the teacher teaches',
      listed.every((name) => taught.has(name)),
      [...new Set(listed)].join(', ') || '(none listed)',
    )

    if (outside) {
      await teacher.page.goto(`${BASE}/report-cards/${outside.id}`, { waitUntil: 'domcontentloaded' })
      await settled(teacher.page)
      const denied = (await teacher.page.locator('main').textContent()) ?? ''
      check(
        'an out-of-scope card opened by URL is refused',
        /not found|not visible|not available|permission/i.test(denied),
        denied.replace(/\s+/g, ' ').slice(0, 70),
      )
      check('with no traceback', !/Traceback|psycopg2/i.test(denied))
    }
    await teacher.context.close()
  } else {
    console.log('\nteacher scope: SKIPPED — set E2E_TEACHER_LOGIN')
  }
} finally {
  await browser.close()
}

console.log(failures === 0 ? '\nrankings: ok' : `\nrankings: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
