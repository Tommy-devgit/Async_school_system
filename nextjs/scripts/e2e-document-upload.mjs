/**
 * Filing a document — verified against Odoo, not the page.
 *
 * `/documents` could list, open, verify and reject documents and never take
 * one in. An approval queue with no intake is half a workflow: every row in it
 * had to be created in Odoo's own back office.
 *
 * What this holds is the two-step write. `school.document.attachment_id` is
 * required and cannot be created inline, so the attachment goes first and the
 * document points at it — and a refused document must not leave the attachment
 * stranded.
 *
 *   ODOO_BASE_URL / ODOO_DB   the Odoo to read back from
 *   E2E_PASSWORD              shared demo password
 *   E2E_REGISTRAR_LOGIN       holds create on school.document and the
 *                             group that owns attachment_id
 *   E2E_TEACHER_LOGIN         optional: a role that cannot file one
 *   E2E_ALLOW_WRITES=yes      required: this suite creates a document
 */
import { chromium } from 'playwright-core'
import { assertWritable, isMutatingMethod } from './production-guard.mjs'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const ODOO = process.env.ODOO_BASE_URL ?? 'http://localhost:8070'
const DB = process.env.ODOO_DB ?? 'school'
const PASSWORD = process.env.E2E_PASSWORD
const LOGIN = process.env.E2E_REGISTRAR_LOGIN
const TEACHER = process.env.E2E_TEACHER_LOGIN

let failures = 0
const check = (label, ok, extra = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

async function odoo(sid, model, method, args = [], kwargs = {}) {
  if (isMutatingMethod(method)) assertWritable(ODOO, `${model}.${method}()`)
  const response = await fetch(`${ODOO}/web/dataset/call_kw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `session_id=${sid}` },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { model, method, args, kwargs } }),
  })
  const body = await response.json()
  if (body.error) throw new Error(`${body.error.data?.name}: ${body.error.data?.message}`)
  return body.result
}

async function odooLogin(login) {
  const response = await fetch(`${ODOO}/web/session/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { db: DB, login, password: PASSWORD } }),
  })
  const sid = (response.headers.getSetCookie?.() ?? [])
    .map((c) => /session_id=([^;]+)/.exec(c)?.[1])
    .filter(Boolean)[0]
  if (!sid) throw new Error('could not authenticate against Odoo')
  return sid
}

if (!LOGIN || process.env.E2E_ALLOW_WRITES !== 'yes') {
  console.log('\ndocument upload: SKIPPED — needs E2E_REGISTRAR_LOGIN and E2E_ALLOW_WRITES=yes')
  process.exit(0)
}

assertWritable(ODOO, 'the document upload suite')

const sid = await odooLogin(LOGIN)
const NAME = `E2E document probe ${Date.now()}`
let documentId = null
let attachmentId = null

/** A tiny but genuinely valid PDF, so Odoo stores something real. */
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 99 99]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
)

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()

const attach = async () =>
  page.locator('#file').setInputFiles({
    name: 'probe.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
  })

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login', LOGIN)
  await page.fill('#password', PASSWORD)
  await page.click('#submit-login')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })

  /* --------------------------------------------------- the way in exists --- */

  console.log('\nthe documents screen offers a way to file one')
  await page.goto(`${BASE}/documents`, { waitUntil: 'networkidle' })
  await page.locator('main h1').first().waitFor({ timeout: 30_000 })
  check('the list offers "File a document"', (await page.locator('a[href="/documents/new"]').count()) > 0)

  /* -------------------------------------------- a refusal writes nothing --- */

  /*
    Submitted with no owner chosen. The attachment is written first, so a
    refusal here is the case that could strand one.
  */
  console.log('\na refused upload leaves no attachment behind')
  await page.goto(`${BASE}/documents/new`, { waitUntil: 'networkidle' })
  await page.locator('#name').waitFor({ timeout: 30_000 })

  const attachmentsBefore = await odoo(sid, 'ir.attachment', 'search_count', [
    [['name', '=', 'probe.pdf']],
  ])

  await page.fill('#name', NAME)
  await attach()
  await page.selectOption('#ownerKind', 'student')
  // No student chosen, and no document type: refused before Odoo is touched.
  await page.locator('main form button[type="submit"]').first().click()
  await page.waitForTimeout(2500)

  check('it did not navigate away', page.url().includes('/documents/new'), page.url())
  check(
    'the name survived the refusal',
    (await page.inputValue('#name')) === NAME,
    await page.inputValue('#name'),
  )
  check(
    'no attachment was written',
    (await odoo(sid, 'ir.attachment', 'search_count', [[['name', '=', 'probe.pdf']]])) ===
      attachmentsBefore,
  )

  /* ------------------------------------------ a complete upload persists --- */

  console.log('\na complete upload reaches Odoo with its attachment')
  const typeValue = await page.locator('#documentTypeId option').nth(1).getAttribute('value')
  const studentValue = await page.locator('#studentId option').nth(1).getAttribute('value')
  check('there is a document type to file under', Boolean(typeValue))
  check('there is a student to file against', Boolean(studentValue))

  if (typeValue && studentValue) {
    await page.selectOption('#documentTypeId', typeValue)
    await page.selectOption('#studentId', studentValue)
    await attach()
    await page.locator('main form button[type="submit"]').first().click()
    await page.waitForURL(/\/documents\/\d+$/, { timeout: 60_000 })

    documentId = Number(/\/documents\/(\d+)/.exec(page.url())?.[1])
    check('it landed on the new document', Number.isInteger(documentId), page.url())

    const [stored] = await odoo(sid, 'school.document', 'read', [
      [documentId],
      ['name', 'document_type_id', 'student_id', 'staff_id', 'state', 'attachment_id', 'checksum'],
    ])
    attachmentId = stored.attachment_id ? stored.attachment_id[0] : null

    check('the name persisted', stored.name === NAME, String(stored.name))
    check('the type persisted', stored.document_type_id[0] === Number(typeValue))
    check('it is filed against the student', stored.student_id[0] === Number(studentValue))
    check('and against no staff member', stored.staff_id === false, JSON.stringify(stored.staff_id))
    check('the attachment is linked', Boolean(attachmentId), String(attachmentId))
    check('Odoo computed a checksum', Boolean(stored.checksum), String(stored.checksum))

    // Verifying is a separate transition; filing must not skip it.
    check('it was filed as uploaded, not verified', stored.state !== 'verified', String(stored.state))
  }

  /* ---------------------------------------- a role without create cannot --- */

  if (TEACHER) {
    console.log('\na role that cannot file one is offered no way to')
    const readerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const reader = await readerContext.newPage()
    await reader.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await reader.fill('#login', TEACHER)
    await reader.fill('#password', PASSWORD)
    await reader.click('#submit-login')
    await reader.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })

    await reader.goto(`${BASE}/documents/new`, { waitUntil: 'networkidle' })
    await reader.locator('main').first().waitFor({ timeout: 30_000 })
    const denied = (await reader.locator('main').textContent()) ?? ''
    check('the direct URL is refused in words', /cannot file|not permitted|role/i.test(denied))
    check('no form is rendered', (await reader.locator('#file').count()) === 0)
    check('with no traceback', !/Traceback|psycopg2/i.test(denied))
    await readerContext.close()
  } else {
    console.log('\nrole without create: SKIPPED — set E2E_TEACHER_LOGIN')
  }
} finally {
  console.log('\ncleaning up')
  /*
    school.document refuses unlink outright — "Document history cannot be
    deleted" — and that is the model working as designed, not an obstacle to
    route around. So this suite leaves its probe behind, named
    `E2E document probe <timestamp>`, and says so rather than failing quietly.
    Repeated runs accumulate them; clearing them is a database job, not a
    thing the application should be able to do.
  */
  if (documentId) {
    try {
      await odoo(sid, 'school.document', 'unlink', [[documentId]])
      check('the probe document was removed', true, `#${documentId}`)
    } catch {
      console.log(
        `  note: document ${documentId} stays — school.document refuses unlink by design`,
      )
    }
  }
  await browser.close()
}

console.log(failures === 0 ? '\ndocument upload: ok' : `\ndocument upload: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
