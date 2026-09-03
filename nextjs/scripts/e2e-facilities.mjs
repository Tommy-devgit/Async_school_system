/**
 * Rooms, branches and the curriculum — verified against Odoo, not the page.
 *
 *   node scripts/e2e-facilities.mjs <baseUrl>
 *
 * Env: E2E_LOGIN, E2E_PASSWORD, plus the ODOO_* pair scripts/rpc.mjs reads.
 *
 * E2E_LOGIN must hold Administrator. `school.room` grants create and write to
 * `group_school_admin` alone, and `school.campus` the same, so no other role
 * can exercise the paths this checks.
 *
 * MUTATES SHARED STATE and restores it: creates one room and one branch and
 * deletes both; changes the marks on one curriculum line and puts them back.
 */
import { chromium } from 'playwright-core'
import { login, call } from './rpc.mjs'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const LOGIN = process.env.E2E_LOGIN
const PASSWORD = process.env.E2E_PASSWORD
if (!LOGIN || !PASSWORD) {
  console.error('Set E2E_LOGIN and E2E_PASSWORD before running this script.')
  process.exit(2)
}

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => {
  if (ok) passed += 1
  else failed += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

await login()
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()

const STAMP = Date.now().toString().slice(-6)
const ROOM = `Probe Room ${STAMP}`
const BRANCH = `Probe Branch ${STAMP}`
let roomId = 0
let branchId = 0
let curriculumBefore = null

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#login', LOGIN)
  await page.fill('#password', PASSWORD)
  await page.click('#submit-login')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })
  check('signed in', true)

  /* =================================================================== rooms */

  console.log('\nrooms')
  await page.goto(`${BASE}/rooms`, { waitUntil: 'domcontentloaded' })
  check('the rooms list renders', (await page.locator('main h1').innerText()).includes('Room'))

  await page.goto(`${BASE}/rooms/new`, { waitUntil: 'domcontentloaded' })
  await page.fill('#name', ROOM)
  await page.fill('#code', `PR${STAMP}`)
  await page.selectOption('#room_type', 'laboratory')
  await page.fill('#capacity', '31')
  await page.locator('main form button[type=submit]').click()
  await page.waitForURL(/\/rooms\/\d+$/, { timeout: 60_000 })

  const created = await call('school.room', 'search_read', [], {
    domain: [['name', '=', ROOM]],
    fields: ['name', 'code', 'room_type', 'capacity', 'active'],
    limit: 1,
  })
  roomId = created[0]?.id ?? 0
  check('Odoo holds the new room', Boolean(roomId), String(roomId))
  check('every field was written as typed',
    created[0]?.room_type === 'laboratory' && created[0]?.capacity === 31 &&
      created[0]?.code === `PR${STAMP}`,
    JSON.stringify(created[0] ?? {}))

  /*
    The unique name is Odoo's constraint, not this form's. Submitting the same
    name again has to surface Odoo's own words rather than a guess at them.
  */
  await page.goto(`${BASE}/rooms/new`, { waitUntil: 'domcontentloaded' })
  await page.fill('#name', ROOM)
  await page.locator('main form button[type=submit]').click()
  await page.waitForTimeout(3500)
  const refusal = await page.locator('main').innerText()
  check('a duplicate name is refused in Odoo\'s words',
    /already exists/i.test(refusal),
    refusal.split('\n').find((line) => /already exists/i.test(line)) ?? 'no message')
  check('and nothing was created by the refused submit',
    (await call('school.room', 'search_count', [[['name', '=', ROOM]]])) === 1)
  check('no traceback reached the page', !/Traceback|odoo\.exceptions/i.test(refusal))

  // The capacity CHECK constraint is Odoo's; the form only names the field.
  await page.goto(`${BASE}/rooms/${roomId}/edit`, { waitUntil: 'domcontentloaded' })
  await page.fill('#capacity', '-4')
  await page.locator('main form button[type=submit]').click()
  await page.waitForTimeout(2500)
  check('a negative capacity is refused',
    (await call('school.room', 'read', [[roomId], ['capacity']]))[0].capacity === 31,
    'capacity unchanged in Odoo')

  await page.goto(`${BASE}/rooms/${roomId}/edit`, { waitUntil: 'domcontentloaded' })
  await page.fill('#capacity', '44')
  await page.locator('main form button[type=submit]').click()
  await page.waitForURL(/\/rooms\/\d+$/, { timeout: 60_000 })
  check('an edit is written to Odoo',
    (await call('school.room', 'read', [[roomId], ['capacity']]))[0].capacity === 44)

  /*
    The usage panel is the reason the detail page exists, so it is checked
    against Odoo rather than against itself.
  */
  const classesOnRoom = await call('school.class', 'search_count', [[['room_id', '=', roomId]]])
  const shown = await page.locator('main').innerText()
  check('the usage panel agrees with Odoo',
    shown.includes(`${classesOnRoom} class`), `odoo says ${classesOnRoom}`)

  /* ================================================================ branches */

  console.log('\nbranches')
  await page.goto(`${BASE}/branches/new`, { waitUntil: 'domcontentloaded' })
  await page.fill('#name', BRANCH)
  await page.fill('#code', `PB${STAMP}`)
  await page.fill('#address', '12 Probe Street')
  await page.locator('main form button[type=submit]').click()
  await page.waitForURL(/\/branches\/\d+$/, { timeout: 60_000 })

  const branch = await call('school.campus', 'search_read', [], {
    domain: [['name', '=', BRANCH]],
    fields: ['name', 'code', 'address'],
    limit: 1,
  })
  branchId = branch[0]?.id ?? 0
  check('Odoo holds the new branch', Boolean(branchId), String(branchId))
  check('its fields were written', branch[0]?.address === '12 Probe Street')

  const detail = await page.locator('main').innerText()
  check('the detail page reports what is scoped to it',
    /Classes/.test(detail) && /Staff/.test(detail) && /Announcements/.test(detail))
  check('a brand-new branch carries nothing yet', /0 class/.test(detail), detail.slice(0, 0) || '')

  /* ============================================================== curriculum */

  console.log('\ncurriculum')
  const lines = await call('school.grade.subject', 'search_read', [], {
    fields: ['class_id', 'subject_id', 'maximum_mark', 'pass_mark', 'subject_type',
             'optional_selection_limit', 'active'],
    limit: 1,
  })
  if (lines.length === 0) {
    console.log('  SKIP  no curriculum lines in this database')
  } else {
    curriculumBefore = lines[0]
    const lineId = curriculumBefore.id
    await page.goto(`${BASE}/curriculum/${lineId}/edit`, { waitUntil: 'domcontentloaded' })
    check('the curriculum line opens', (await page.locator('#maximum_mark').count()) === 1)

    /*
      Odoo's CHECK keeps the pass mark between zero and the maximum. The form
      mirrors it to say which field is wrong, so a pass above the maximum must
      be stopped and must not reach the record.
    */
    await page.fill('#maximum_mark', '50')
    await page.fill('#pass_mark', '80')
    await page.locator('main form button[type=submit]').click()
    await page.waitForTimeout(2000)
    check('a pass mark above the maximum is refused',
      /cannot be above the maximum/i.test(await page.locator('main').innerText()))
    check('and nothing was written',
      (await call('school.grade.subject', 'read', [[lineId], ['maximum_mark']]))[0]
        .maximum_mark === curriculumBefore.maximum_mark)

    await page.fill('#maximum_mark', '120')
    await page.fill('#pass_mark', '60')
    await page.locator('main form button[type=submit]').click()
    await page.waitForTimeout(3500)
    const after = (await call('school.grade.subject', 'read',
      [[lineId], ['maximum_mark', 'pass_mark']]))[0]
    check('a valid change reaches Odoo',
      after.maximum_mark === 120 && after.pass_mark === 60,
      JSON.stringify(after))
  }

  /* ================================================================ the nav */

  console.log('\nnavigation')
  for (const route of ['/rooms', '/branches', '/configuration', '/configuration/grading']) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(300)
    const current = await page
      .locator('#primary-navigation a')
      .evaluateAll((nodes) =>
        nodes.filter((node) => /bg-ink/.test(node.className)).map((node) => node.getAttribute('href')),
      )
    /*
      A prefix match lit two entries wherever one nav href nested under
      another, so the sidebar claimed the user was in two places at once.
    */
    check(`${route}: exactly one nav entry is current`, current.length === 1, current.join(', '))
  }
} finally {
  console.log('\ncleanup')
  const undone = []
  try {
    if (roomId) await call('school.room', 'unlink', [[roomId]])
    else undone.push('room')
  } catch (error) {
    undone.push(`room (${String(error.message).slice(0, 40)})`)
  }
  try {
    if (branchId) await call('school.campus', 'unlink', [[branchId]])
    else undone.push('branch')
  } catch (error) {
    undone.push(`branch (${String(error.message).slice(0, 40)})`)
  }
  if (curriculumBefore) {
    try {
      await call('school.grade.subject', 'write', [[curriculumBefore.id], {
        maximum_mark: curriculumBefore.maximum_mark,
        pass_mark: curriculumBefore.pass_mark,
      }])
    } catch (error) {
      undone.push(`curriculum (${String(error.message).slice(0, 40)})`)
    }
  }
  console.log(`  ${undone.length === 0 ? 'everything restored' : `NOT restored: ${undone.join(', ')}`}`)
  await browser.close()
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
