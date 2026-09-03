/**
 * Every state code Odoo can return, against the tones this app draws.
 *
 * A code with no entry in lib/status.ts still renders — `statusMeta` falls
 * back to prose — but it falls back to the grey `idle` tone. That is the bug
 * this exists to prevent, and it is the one that was actually shipped: a
 * *failed* report card drew in exactly the same grey as a passed one, because
 * Odoo emits `pass`/`fail` on `school.report.card.result` while the table only
 * knew `passed`/`failed`.
 *
 * So the check is not "does the code appear somewhere". It asks Odoo for the
 * selection values of the fields this application actually draws as a
 * StatusBadge, and fails if any of them would fall through to the default —
 * which means a state added to the addon is caught here rather than in
 * somebody's screenshot.
 *
 *   E2E_PASSWORD, E2E_REGISTRAR_LOGIN   any account that can read the models
 *   ODOO_BASE_URL, ODOO_DB              the Odoo behind the frontend
 *   argv[2]                             the Next.js base URL (optional; adds
 *                                       the rendered-colour checks)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = process.argv[2]
const ODOO = process.env.ODOO_BASE_URL ?? 'http://localhost:8070'
const DB = process.env.ODOO_DB ?? 'school'
const PASSWORD = process.env.E2E_PASSWORD
const LOGIN = process.env.E2E_REGISTRAR_LOGIN

if (!PASSWORD || !LOGIN) {
  console.log('status vocabulary: SKIPPED — needs E2E_PASSWORD and E2E_REGISTRAR_LOGIN')
  process.exit(0)
}

let failures = 0
const check = (label, ok, extra = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

/*
  The fields this application passes to a StatusBadge, which is what makes
  their codes tone-bearing rather than merely text. Regenerate by grepping the
  call sites:

    grep -rn 'StatusBadge' app --include=*.tsx | grep 'state='

  A field that is only ever rendered through `formatSelection` — a staff
  member's employment status, a student subject's state — is deliberately
  absent: prose is all those need, and listing them here would demand tones
  nothing draws.
*/
const BADGED_FIELDS = [
  ['school.report.card', 'result'],
  ['school.report.card', 'state'],
  ['school.teacher.assignment', 'state'],
  ['school.mark', 'mark_status'],
  ['school.staff.daily.status', 'status'],
  ['school.staff', 'state'],
  ['school.student', 'registration_status'],
  ['school.student', 'lifecycle_status'],
  ['school.assessment', 'state'],
  ['school.enrollment', 'state'],
  ['school.attendance', 'status'],
  ['school.class.schedule', 'state'],
  ['school.announcement', 'state'],
  ['school.program', 'state'],
  ['school.document', 'state'],
  ['school.academic.year', 'state'],
  ['school.promotion.batch', 'state'],
  ['school.promotion.line', 'final_outcome'],
  ['school.teacher', 'teaching_status'],
]

/* ------------------------------------------------------------------ odoo --- */

let sid = null
async function rpc(path, params) {
  const response = await fetch(`${ODOO}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(sid ? { Cookie: `session_id=${sid}` } : {}) },
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

/* --------------------------------------------------- the table as written --- */

/*
  Read as source rather than imported: lib/status.ts imports lib/format, and
  Node cannot resolve an extensionless TypeScript specifier. Changing that
  import to satisfy a test would put one file out of step with every other one
  in lib/, which is a worse trade than parsing an object literal whose shape is
  fixed by its own type.
*/
const source = readFileSync(join(HERE, '..', 'lib', 'status.ts'), 'utf8')
const generic = new Set([...source.matchAll(/^\s{2}([a-z_0-9]+):\s*\{\s*label/gm)].map((m) => m[1]))
const scoped = new Set(
  [...source.matchAll(/'([a-z._]+):([a-z_0-9]+)':\s*\{\s*label/g)].map((m) => `${m[1]}:${m[2]}`),
)

console.log(`\nlib/status.ts declares ${generic.size} codes and ${scoped.size} model-scoped overrides`)

await rpc('/web/session/authenticate', { db: DB, login: LOGIN, password: PASSWORD })

console.log('\nevery badged field Odoo offers is a code this app has a tone for')

let checked = 0
const uncovered = []
for (const [model, field] of BADGED_FIELDS) {
  let meta
  try {
    meta = await rpc('/web/dataset/call_kw', {
      model,
      method: 'fields_get',
      args: [[field], ['selection']],
      kwargs: {},
    })
  } catch {
    // A role that cannot read the model tells us nothing either way.
    continue
  }
  const values = (meta?.[field]?.selection ?? []).map(([value]) => value)
  if (values.length === 0) continue
  for (const value of values) {
    checked += 1
    if (!generic.has(value) && !scoped.has(`${model}:${value}`)) {
      uncovered.push(`${model}.${field} = ${value}`)
    }
  }
}

check(
  `all ${checked} selection values on badged fields carry a deliberate tone`,
  uncovered.length === 0,
  uncovered.length ? uncovered.join(', ') : `${BADGED_FIELDS.length} fields`,
)

/*
  The distinction that motivated the whole check. Asserted as a relationship so
  it survives a change of palette rather than pinning a hex value.
*/
const toneOf = (code) => {
  const match = new RegExp(`^\\s{2}${code}:\\s*\\{[^}]*tone:\\s*'([a-z]+)'`, 'm').exec(source)
  return match?.[1] ?? null
}
check('a pass does not read like a fail', toneOf('pass') !== toneOf('fail'),
  `pass=${toneOf('pass')} fail=${toneOf('fail')}`)
check('nor in the long spelling', toneOf('passed') !== toneOf('failed'),
  `passed=${toneOf('passed')} failed=${toneOf('failed')}`)
check('a fail is drawn as stopped, not merely different', toneOf('fail') === 'stopped')

/* ------------------------------------------------------- as rendered --- */

if (BASE) {
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1200 } })).newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#login', LOGIN)
  await page.fill('#password', PASSWORD)
  await page.click('#submit-login')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })

  const IDLE = 'rgb(107, 114, 128)'
  console.log('\nand nothing on those screens still renders in the fallback grey')

  for (const [route, label] of [
    ['/report-cards', 'result'],
    ['/marks', 'mark status'],
    ['/assignments', 'assignment state'],
  ]) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    const chips = await page.locator('main tbody span').evaluateAll((nodes) =>
      nodes
        .filter((node) => node.className && /rounded-pill|rounded-\[9999px\]/.test(node.className))
        .map((node) => ({ text: node.textContent.trim(), color: getComputedStyle(node).color })),
    )
    if (chips.length === 0) {
      console.log(`  SKIP  ${route} — nothing visible to this role`)
      continue
    }
    /*
      `idle` is a legitimate tone for a genuinely neutral state — a draft, a
      register not yet taken. What must not happen is a *decided* state landing
      on it, so only the codes that carry an outcome are asserted.
    */
    const decided = chips.filter((chip) => /^(Pass|Fail|Recorded|Ended|Active|Approved)$/.test(chip.text))
    const grey = decided.filter((chip) => chip.color === IDLE)
    check(
      `${route}: decided states are not drawn in the fallback grey (${label})`,
      grey.length === 0,
      grey.map((chip) => chip.text).join(', ') ||
        decided.map((chip) => chip.text).join(', ') ||
        'none present',
    )
  }
  await browser.close()
} else {
  console.log('\n  (pass a base URL to also check the rendered colours)')
}

console.log(`\n${failures === 0 ? 'status vocabulary: all checks passed' : `${failures} check(s) failed`}`)
process.exit(failures === 0 ? 0 : 1)
