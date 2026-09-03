/**
 * Student edit and the grading scheme UI, verified against Odoo rather than
 * against the page.
 *
 *   node scripts/e2e-student-edit-grading.mjs <baseUrl>
 *
 * Env: E2E_LOGIN, E2E_PASSWORD, plus the ODOO_* pair that scripts/rpc.mjs reads.
 *
 * MUTATES SHARED STATE and restores it: writes a FAN and a middle name to one
 * approved student, and briefly makes a probe scheme the company's active one.
 * Both are put back before the script exits, and the probe scheme is deleted.
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

await login()
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext()
const page = await context.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

const STAMP = Date.now().toString().slice(-6)

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

  /* =================================================== student edit === */
  const [STUDENT] = await call('school.student', 'search',
    [[['registration_status', '=', 'approved']]], { limit: 1 })
  if (!STUDENT) throw new Error('no approved student to edit')
  const before = (await call('school.student', 'read',
    [[STUDENT], ['name', 'first_name', 'middle_name', 'last_name']]))[0]
  console.log(`\n  student ${STUDENT} before: name=${JSON.stringify(before.name)} parts=${JSON.stringify([before.first_name, before.middle_name, before.last_name])}`)

  await page.goto(`${BASE}/students/${STUDENT}`, { waitUntil: 'domcontentloaded' })
  const editLink = page.locator('a[href$="/edit"]').first()
  check('Edit link on the student page', await editLink.isVisible().catch(() => false))

  await page.goto(`${BASE}/students/${STUDENT}/edit`, { waitUntil: 'domcontentloaded' })
  const seeded = {
    first: await page.inputValue('#first_name'),
    middle: await page.inputValue('#middle_name'),
    last: await page.inputValue('#last_name'),
  }
  console.log(`  form seeded with: ${JSON.stringify(seeded)}`)
  check('name parts seeded losslessly',
    [seeded.first, seeded.middle, seeded.last].filter(Boolean).join(' ') === before.name,
    `${[seeded.first, seeded.middle, seeded.last].filter(Boolean).join(' ')} vs ${before.name}`)

  check('registrar-only FAN input rendered for admin',
    await page.locator('#fan_number').isVisible().catch(() => false))
  check('placement fields absent',
    !(await page.locator('#class_id').isVisible().catch(() => false)))

  // Every student in this database is missing a FAN, and _check_required_fields_for_submission
  // re-fires on any write that touches `name`. An approved student therefore cannot have a
  // typo corrected until the FAN is supplied — the form has to say so, not fail silently.
  const NEWMIDDLE = `Verify${STAMP}`
  await page.fill('#middle_name', NEWMIDDLE)
  await page.locator('form:has(#middle_name) button[type=submit]').click()
  await page.waitForTimeout(5000)

  const refusal = await page.locator('form:has(#middle_name)').innerText()
  check('incomplete approved student: refusal shown, not swallowed',
    /Cannot mark the student as Approved/.test(refusal),
    refusal.split('\n').find((l) => /Cannot mark/.test(l)) ?? 'no message')
  check('refusal names the missing field', /FAN/.test(refusal))
  check('nothing written on refusal',
    (await call('school.student', 'read', [[STUDENT], ['name']]))[0].name === before.name)
  check('typed value kept after refusal',
    (await page.inputValue('#middle_name')) === NEWMIDDLE)

  // Supplying what Odoo asked for, in the same form, must let the edit through.
  const FAN = `9${STAMP}${'0'.repeat(15 - STAMP.length)}`
  await page.fill('#fan_number', FAN)
  await page.locator('form:has(#middle_name) button[type=submit]').click()
  await page.waitForURL(`**/students/${STUDENT}`, { timeout: 60_000 })

  const after = (await call('school.student', 'read',
    [[STUDENT], ['name', 'first_name', 'middle_name', 'last_name', 'fan_number']]))[0]
  console.log(`  student ${STUDENT} after:  name=${JSON.stringify(after.name)} fan=${after.fan_number}`)
  check('middle name written to Odoo', after.middle_name === NEWMIDDLE, String(after.middle_name))
  check('FAN written in the same save', after.fan_number === FAN, String(after.fan_number))
  check('computed name rebuilt from the parts',
    after.name === [after.first_name, after.middle_name, after.last_name].filter(Boolean).join(' '),
    after.name)
  check('first and last untouched',
    after.first_name === before.first_name && after.last_name === before.last_name)
  check('detail page shows the new name',
    (await page.locator('h1').innerText()).includes(NEWMIDDLE))

  // Restore: parts first (while the FAN still satisfies the constraint), then clear the FAN.
  await call('school.student', 'write', [[STUDENT], {
    first_name: before.first_name || false,
    middle_name: before.middle_name || false,
    last_name: before.last_name || false,
  }])
  await call('school.student', 'write', [[STUDENT], { name: before.name }])
  // fan_number is not in the constraint's field list, so clearing it alone does not re-fire it.
  await call('school.student', 'write', [[STUDENT], { fan_number: false }])
  const restored = (await call('school.student', 'read',
    [[STUDENT], ['name', 'fan_number']]))[0]
  check('student restored', restored.name === before.name && restored.fan_number === false,
    `${restored.name} / ${restored.fan_number}`)

  /* ====================================================== grading === */
  const ORIGINAL_SCHEME = (await call('res.company', 'read',
    [[1], ['school_grading_scheme_id']]))[0].school_grading_scheme_id[0]

  await page.goto(`${BASE}/configuration/grading`, { waitUntil: 'domcontentloaded' })
  check('grading list renders', (await page.locator('h1').innerText()).includes('Grading'))
  const originalName = (await call('school.grading.scheme', 'read',
    [[ORIGINAL_SCHEME], ['name']]))[0].name
  check('active scheme named in the hint',
    (await page.locator('body').innerText()).includes(originalName), originalName)
  check('coverage reads as satisfied by default',
    (await page.locator('body').innerText()).includes('cover 0 through 100'))

  const SCHEME = `Verify Scale ${STAMP}`
  await page.fill('#name', SCHEME)
  await page.locator('form:has(#name) button[type=submit]').click()
  await page.waitForURL('**/configuration/grading/*', { timeout: 60_000 })

  const created = await call('school.grading.scheme', 'search_read',
    [[['name', '=', SCHEME]], ['id', 'pass_percentage', 'band_ids', 'is_company_scheme']])
  check('scheme created with all six bands', created.length === 1 && created[0].band_ids.length === 6,
    created.length ? `${created[0].band_ids.length} bands` : 'not created')
  const schemeId = created[0].id
  check('created scheme is not yet in use', created[0].is_company_scheme === false)

  const bandNames = await call('school.grading.band', 'search_read',
    [[['scheme_id', '=', schemeId]], ['name', 'minimum_percentage', 'maximum_percentage']],
    { order: 'minimum_percentage desc' })
  console.log(`  bands: ${bandNames.map((b) => `${b.name} ${b.minimum_percentage}-${b.maximum_percentage}`).join(', ')}`)

  // Add a band that overlaps — Odoo must refuse and the page must say so.
  await page.fill('input[name=band_name]', 'X')
  await page.fill('input[name=band_min]', '85')
  await page.fill('input[name=band_max]', '95')
  await page.locator('form:has(input[name=band_name]) button[type=submit]').click()
  await page.waitForTimeout(3000)
  // Scoped to the add-band form's alert: the section hint also mentions overlap,
  // and matching that instead would pass without any error ever being shown.
  const alert = page.locator('form:has(input[name=band_name]) [role=alert]')
  const alertText = (await alert.innerText().catch(() => '')).trim()
  check('overlapping band refused and explained', /overlap/i.test(alertText),
    alertText || 'no alert rendered')
  check('overlapping band not written',
    (await call('school.grading.band', 'search_count', [[['scheme_id', '=', schemeId]]])) === 6)

  // Put it into use, then check the company actually moved.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('button:has-text("Use for report cards")').click()
  await page.waitForTimeout(4000)
  const company = (await call('res.company', 'read',
    [[1], ['school_grading_scheme_id', 'school_grading_configured']]))[0]
  check('company now grades by the new scheme', company.school_grading_scheme_id[0] === schemeId,
    JSON.stringify(company.school_grading_scheme_id))
  check('school_grading_configured set', company.school_grading_configured === true)

  // Remove a band so coverage breaks, and confirm the page names the gap.
  await call('school.grading.band', 'unlink', [[bandNames.find((b) => b.name === 'C').id]])
  await page.goto(`${BASE}/configuration/grading/${schemeId}`, { waitUntil: 'domcontentloaded' })
  const gapText = await page.locator('body').innerText()
  check('gap in coverage is named', /Nothing covers the range between/.test(gapText),
    gapText.split('\n').find((l) => /Nothing covers/.test(l)) ?? 'no message')

  /* ================================================= mobile widths === */
  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of [`/students/${STUDENT}/edit`, '/configuration/grading', `/configuration/grading/${schemeId}`]) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`no horizontal overflow at 390px on ${path}`, overflow <= 0, `${overflow}px`)
  }

  /* ================================================== restore ======= */
  await call('school.grading.scheme', 'action_use_for_report_cards', [[ORIGINAL_SCHEME]])
  const back = (await call('res.company', 'read', [[1], ['school_grading_scheme_id']]))[0]
  check('original scheme restored', back.school_grading_scheme_id[0] === ORIGINAL_SCHEME,
    JSON.stringify(back.school_grading_scheme_id))
  await call('school.grading.band', 'unlink', [[...(await call('school.grading.band', 'search', [[['scheme_id', '=', schemeId]]]))]])
  await call('school.grading.scheme', 'unlink', [[schemeId]])
  check('probe scheme deleted',
    (await call('school.grading.scheme', 'search_count', [[['name', '=', SCHEME]]])) === 0)

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (error) {
  failed++
  console.log(`  FAIL  threw — ${error.message}`)
} finally {
  await browser.close()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
