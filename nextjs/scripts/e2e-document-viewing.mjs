/**
 * Opening a stored document — verified against Odoo, not the page.
 *
 * The application could take documents in and never give one back. A student's
 * detail screen printed `birth-002213.png` and offered Replace; there was no
 * way to look at what had been uploaded short of Odoo's own back office. Staff
 * had three binaries on the model and no interface at all, and a verifier
 * approving a `school.document` could not open the thing they were approving.
 *
 * What this holds is the part that matters more than the link: the route
 * serves a file only to somebody Odoo would have served it to.
 *
 *   - a registrar gets the bytes, with the right content type and filename
 *   - a teacher, who lacks the registrar-only field group, gets a refusal and
 *     no traceback
 *   - a signed-out request gets nothing
 *   - the URL cannot name a model, a field or an attachment id that is not on
 *     the allowlist, so it cannot be walked
 *
 * Read-only: it fetches, it never uploads, and it needs no E2E_ALLOW_WRITES.
 *
 *   ODOO_BASE_URL / ODOO_DB   the Odoo to read back from
 *   E2E_PASSWORD              shared demo password
 *   E2E_REGISTRAR_LOGIN       holds the field group these binaries sit behind
 *   E2E_TEACHER_LOGIN         optional: the refusal half is skipped without it
 */
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const ODOO = process.env.ODOO_BASE_URL ?? 'http://localhost:8070'
const DB = process.env.ODOO_DB ?? 'school'
const PASSWORD = process.env.E2E_PASSWORD
const REGISTRAR = process.env.E2E_REGISTRAR_LOGIN
const TEACHER = process.env.E2E_TEACHER_LOGIN

let failures = 0
const check = (label, ok, extra = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

if (!REGISTRAR || !PASSWORD) {
  console.log('\ndocument viewing: SKIPPED — needs E2E_REGISTRAR_LOGIN and E2E_PASSWORD')
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

try {
  const admin = await odooLogin(REGISTRAR)

  const [student] = await kw(admin, 'school.student', 'search_read', [
    [['birth_certificate_filename', '!=', false]],
    ['id', 'birth_certificate_filename'],
  ], { limit: 1 })
  const [staff] = await kw(admin, 'school.staff', 'search_read', [
    [['id_document_filename', '!=', false]],
    ['id', 'id_document_filename'],
  ], { limit: 1 })
  const [document] = await kw(admin, 'school.document', 'search_read', [
    [['attachment_id', '!=', false]],
    ['id', 'name'],
  ], { limit: 1 })

  const reader = await signIn(REGISTRAR)

  /* ------------------------------------------- a student's certificate --- */

  if (student) {
    console.log('\na registrar can open a birth certificate')
    const url = `/api/files/student/${student.id}/birth_certificate`
    const response = await reader.page.request.get(`${BASE}${url}`)
    const body = await response.body()

    check('it is served', response.status() === 200, String(response.status()))
    check('with real bytes', body.length > 0, `${body.length}B`)
    check(
      'and a content type from the filename, not the fallback',
      response.headers()['content-type'] !== 'application/octet-stream',
      response.headers()['content-type'],
    )
    check(
      'the filename survives a save',
      (response.headers()['content-disposition'] ?? '').includes('filename='),
      response.headers()['content-disposition'],
    )
    /*
      A birth certificate must not sit in a shared cache, and a browser holding
      the previous file after a Replace would be worse than a slow reload.
    */
    check(
      'no cache holds it',
      /no-store/.test(response.headers()['cache-control'] ?? ''),
      response.headers()['cache-control'],
    )

    await reader.page.goto(`${BASE}/students/${student.id}`, { waitUntil: 'domcontentloaded' })
    await settled(reader.page)
    check(
      'the student screen links the filename rather than printing it',
      (await reader.page.locator(`main a[href="${url}"]`).count()) > 0,
    )
  } else {
    console.log('\nstudent certificate: SKIPPED — no student has one attached')
  }

  /* ------------------------------------------------- staff's documents --- */

  if (staff) {
    console.log('\nstaff documents are on the staff record at last')
    await reader.page.goto(`${BASE}/staff/${staff.id}`, { waitUntil: 'domcontentloaded' })
    await settled(reader.page)
    const shown = (await reader.page.locator('main').textContent()) ?? ''
    check('the screen has a documents card', /Staff documents/.test(shown))

    const url = `/api/files/staff/${staff.id}/id_document`
    check('the ID document is linked', (await reader.page.locator(`main a[href="${url}"]`).count()) > 0)
    check('and it opens', (await reader.page.request.get(`${BASE}${url}`)).status() === 200)
  } else {
    console.log('\nstaff documents: SKIPPED — no staff member has one attached')
  }

  /* ------------------------------------------ a school.document record --- */

  if (document) {
    console.log('\na filed document can be opened from its own screen')
    const url = `/api/files/document/${document.id}/file`
    const response = await reader.page.request.get(`${BASE}${url}`)
    check('the attachment is served', response.status() === 200, String(response.status()))
    check('with bytes behind it', (await response.body()).length > 0)

    await reader.page.goto(`${BASE}/documents/${document.id}`, { waitUntil: 'domcontentloaded' })
    await settled(reader.page)
    check(
      'the detail screen offers it',
      (await reader.page.locator(`main a[href="${url}"]`).count()) > 0,
    )
  } else {
    console.log('\nfiled document: SKIPPED — none in this database')
  }

  /* ----------------------------------- the allowlist is the whole surface --- */

  console.log('\nnothing outside the allowlist is addressable')
  const refused = [
    ['an unlisted field on a listed model', `/api/files/student/${student?.id ?? 1}/passport_scan`],
    ['an unlisted kind', '/api/files/guardian/1/id_document'],
    ['a raw attachment id', '/api/files/attachment/1/datas'],
    ['a document addressed by field name', '/api/files/document/1/datas'],
  ]
  for (const [label, url] of refused) {
    const response = await reader.page.request.get(`${BASE}${url}`)
    check(`${label} is 404`, response.status() === 404, String(response.status()))
  }

  await reader.context.close()

  /* ------------------------------------- the field group is Odoo's to hold --- */

  if (TEACHER && student) {
    console.log('\na role without the field group is refused')
    const teacher = await signIn(TEACHER)
    const response = await teacher.page.request.get(
      `${BASE}/api/files/student/${student.id}/birth_certificate`,
    )
    check('no bytes reach them', response.status() !== 200, `HTTP ${response.status()}`)
    const text = await response.text()
    check('the refusal is in words', /permission|not allowed|refus/i.test(text), text.slice(0, 60))
    check('with no traceback', !/Traceback|psycopg2/i.test(text))
    await teacher.context.close()
  } else {
    console.log('\nfield-group refusal: SKIPPED — set E2E_TEACHER_LOGIN')
  }

  /* ---------------------------------------------------- and signed out --- */

  console.log('\na signed-out request gets nothing')
  const anonymous = await browser.newContext()
  const anonymousPage = await anonymous.newPage()
  const response = await anonymousPage.request.get(
    `${BASE}/api/files/student/${student?.id ?? 1}/birth_certificate`,
    { maxRedirects: 0 },
  )
  check('it is not served', response.status() !== 200, `HTTP ${response.status()}`)
  await anonymous.close()
} finally {
  await browser.close()
}

console.log(failures === 0 ? '\ndocument viewing: ok' : `\ndocument viewing: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
