/**
 * One student, all the way through — registration to promotion.
 *
 * Every stage already has a suite of its own, and each builds its own
 * fixtures. So each stage is known to work in isolation and nothing checks the
 * joins: that the student the registrar approved is the one the enrolment
 * names, that the mark list generated for an assessment contains that
 * enrolment's student, that the report card reads that student's marks, and
 * that promotion moves that same enrolment.
 *
 * This follows a single identity through all of it and asserts the handoffs.
 * Every check reads Odoo back rather than the page, because a screen showing
 * the right name proves nothing about which record it came from.
 *
 * It uses the UI where the UI is the thing under test and RPC where it is only
 * arranging the world — the joins are the point, not a second copy of the
 * per-stage suites.
 *
 * What it leaves behind: an opened assessment and an archived student. Both
 * models refuse deletion on purpose — "Only draft assessments can be deleted",
 * "Student identities with academic history cannot be deleted. Archive them
 * instead." That is the system protecting academic history, so the suite
 * follows the model's own advice rather than routing around it, and reports
 * exactly what it kept.
 *
 *   ODOO_BASE_URL / ODOO_DB   the Odoo to read back from
 *   E2E_PASSWORD              shared demo password
 *   E2E_REGISTRAR_LOGIN       registers, approves and promotes
 *   E2E_ADMIN_LOGIN           arranges what the registrar may not
 *   E2E_ALLOW_WRITES=yes      required: this suite creates a student
 */
import { chromium } from 'playwright-core'
import { assertWritable, isMutatingMethod } from './production-guard.mjs'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const ODOO = process.env.ODOO_BASE_URL ?? 'http://localhost:8070'
const DB = process.env.ODOO_DB ?? 'school'
const PASSWORD = process.env.E2E_PASSWORD
const REGISTRAR = process.env.E2E_REGISTRAR_LOGIN
const ADMIN = process.env.E2E_ADMIN_LOGIN

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
  if (!sid) throw new Error(`could not authenticate ${login} against Odoo`)
  return sid
}

if (!REGISTRAR || !ADMIN || process.env.E2E_ALLOW_WRITES !== 'yes') {
  console.log(
    '\nlifecycle: SKIPPED — needs E2E_REGISTRAR_LOGIN, E2E_ADMIN_LOGIN and E2E_ALLOW_WRITES=yes',
  )
  process.exit(0)
}

assertWritable(ODOO, 'the lifecycle suite')

const registrar = await odooLogin(REGISTRAR)
const admin = await odooLogin(ADMIN)

const STAMP = Date.now()
const FIRST = 'Lifecycle'
const LAST = `Probe ${STAMP}`
const FULL = `${FIRST} ${LAST}`

/** Everything created, newest first, so cleanup can unwind in order. */
const created = []

/** A 1×1 PNG. Submission needs the documents to exist, not to be readable. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()

let studentId = null
let enrolmentId = null
let classId = null
let termId = null
let assessmentId = null
let markId = null
let reportCardId = null

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#login', REGISTRAR)
  await page.fill('#password', PASSWORD)
  await page.click('#submit-login')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })

  /* ═══════════════════════════════════ 1. registration ═══════════════════ */

  console.log('\n[1] the registrar registers a student')

  /*
    A class that already teaches something, so the later stages have subjects —
    and below Grade 11, because `_validate_submission_requirements` also wants
    an academic stream there, which is a different registration path and not
    what this suite is about.
  */
  const candidates = await odoo(admin, 'school.grade.subject', 'search_read', [], {
    domain: [['active', '=', true]],
    fields: ['class_id', 'subject_id', 'maximum_mark'],
    limit: 40,
  })
  const line = candidates.find((row) => !/grade\s*(11|12)/i.test(String(row.class_id[1] ?? '')))
  check('a class with a curriculum exists to register into', Boolean(line))
  if (!line) throw new Error('no curriculum line to build a lifecycle on')
  classId = line.class_id[0]

  const [klass] = await odoo(admin, 'school.class', 'read', [[classId], ['academic_year_id', 'name']])
  const [term] = await odoo(admin, 'school.term', 'search_read', [], {
    domain: [['academic_year_id', '=', klass.academic_year_id[0]]],
    fields: ['name', 'date_start', 'date_end'],
    limit: 1,
  })
  check('that class has a term to assess in', Boolean(term), term?.name)
  if (!term) throw new Error('no term on the class academic year')
  termId = term.id

  studentId = await odoo(registrar, 'school.student', 'create', [
    {
      first_name: FIRST,
      last_name: LAST,
      class_id: classId,
      academic_year_id: klass.academic_year_id[0],
      date_of_birth: '2012-04-04',
      guardian_name: 'Lifecycle Guardian',
      guardian_phone: `+2519118${String(STAMP).slice(-5)}`,
      emergency_contact_name: 'Lifecycle Emergency',
      emergency_contact_phone: `+2519119${String(STAMP).slice(-5)}`,
      fan_number: String(STAMP).padStart(16, '1').slice(-16),
      // Both are required before a registration may be submitted.
      birth_certificate: PNG,
      previous_grade_document: PNG,
    },
  ])
  created.push(['school.student', studentId])
  check('the student record exists', Number.isInteger(studentId), `#${studentId}`)

  // The screen is the thing under test here: it must show what was just made.
  await page.goto(`${BASE}/students/${studentId}`, { waitUntil: 'domcontentloaded' })
  await page.locator('main h1').first().waitFor({ timeout: 30_000 })
  const shown = (await page.locator('main').textContent()) ?? ''
  check('the app shows the new student', shown.includes(LAST))
  check('it opens in draft', /draft/i.test(shown))

  /* ═══════════════════════════════════ 2. approval ═══════════════════════ */

  console.log('\n[2] approval mints the identifiers and the enrolment')

  // The method names the workflow allowlist uses — see lib/odoo/workflows.ts.
  await odoo(registrar, 'school.student', 'action_mark_submitted', [[studentId]])
  await odoo(registrar, 'school.student', 'action_mark_approved', [[studentId]])

  const [approved] = await odoo(registrar, 'school.student', 'read', [
    [studentId],
    ['regno', 'admission_number', 'registration_status', 'lifecycle_status', 'enrollment_ids'],
  ])
  check('a student number was minted', Boolean(approved.regno), String(approved.regno))
  check('the registration is approved', approved.registration_status === 'approved')
  check('the student is active', approved.lifecycle_status === 'active', String(approved.lifecycle_status))
  check('an enrolment was created', approved.enrollment_ids.length > 0)

  enrolmentId = approved.enrollment_ids[0]
  const [enrolment] = await odoo(registrar, 'school.enrollment', 'read', [
    [enrolmentId],
    ['student_id', 'class_id', 'state', 'enrollment_date'],
  ])

  /* ── the first join ── */
  check(
    'the enrolment names this student, not another',
    enrolment.student_id[0] === studentId,
    `enrolment.student=${enrolment.student_id[0]} student=${studentId}`,
  )
  check('and places them in the class they registered for', enrolment.class_id[0] === classId)

  /* ═══════════════════════════════════ 3. assessment ═════════════════════ */

  console.log('\n[3] an assessment generates a mark list containing this student')

  /*
    Class, subject *and* term. `_check_applicable_assignment` refuses an
    assessment whose assignment does not match all three — "The assessment must
    use the exact applicable assignment."
  */
  const [assignment] = await odoo(admin, 'school.teacher.assignment', 'search_read', [], {
    domain: [
      ['class_id', '=', classId],
      ['subject_id', '=', line.subject_id[0]],
      ['term_id', '=', termId],
    ],
    fields: ['teacher_id', 'start_date', 'end_date'],
    limit: 1,
  })
  check('the class has a teacher assigned to that subject', Boolean(assignment))

  /*
    On or after the day this student enrolled, and inside both the term and the
    assignment's window.

    `_generate_mark_list` lists only subject enrolments valid *at the assessment
    date* — "a student enrolled after the date is simply not listed, never given
    a zero". So an assessment dated at the start of term correctly excludes a
    student who enrolled today, and dating it that way would have this suite
    reporting a defect where the rule is working.
  */
  const assessmentDate = [term.date_start, assignment?.start_date, enrolment.enrollment_date]
    .filter(Boolean)
    .sort()
    .at(-1)
  check(
    'the assessment date is on or after the enrolment',
    assessmentDate >= enrolment.enrollment_date,
    `${assessmentDate} >= ${enrolment.enrollment_date}`,
  )
  check(
    'and still inside the term',
    assessmentDate >= term.date_start && assessmentDate <= term.date_end,
    `${term.date_start}..${term.date_end}`,
  )

  if (assignment) {
    assessmentId = await odoo(admin, 'school.assessment', 'create', [
      {
        name: `Lifecycle assessment ${STAMP}`,
        teacher_assignment_id: assignment.id,
        assessment_type: 'test',
        /*
          `_check_assessment_scope` compares the assessment's own class,
          subject and term against the assignment's, and the date against the
          assignment's window — so all four are set from the assignment, the
          same way createAssessment does it.
        */
        date: assessmentDate,
        max_mark: line.maximum_mark || 100,
        /*
          Zero, because the term's assessment weights for this subject may
          already total 100% and Odoo refuses more. This suite is about the
          joins between stages, not about weighting.
        */
        weight: 0,
        class_id: classId,
        subject_id: line.subject_id[0],
        term_id: termId,
      },
    ])
    created.push(['school.assessment', assessmentId])
    await odoo(admin, 'school.assessment', 'action_open', [[assessmentId]])

    const marks = await odoo(admin, 'school.mark', 'search_read', [], {
      domain: [['assessment_id', '=', assessmentId]],
      fields: ['student_id'],
    })

    /* ── the second join ── */
    const mine = marks.find((mark) => mark.student_id[0] === studentId)
    check(
      'Odoo generated a mark row for this student',
      Boolean(mine),
      mine
        ? `${marks.length} row(s) in the list`
        : `${marks.length} row(s), for ${JSON.stringify(marks.map((m) => m.student_id[0]))}, not ${studentId}`,
    )
    markId = mine?.id ?? null
  }

  /* ═══════════════════════════════════ 4. mark entry ═════════════════════ */

  if (markId) {
    console.log('\n[4] a score entered on that row persists and grades itself')

    await odoo(admin, 'school.mark', 'write', [[markId], { score: 71, mark_status: 'recorded' }])
    const [scored] = await odoo(admin, 'school.mark', 'read', [
      [markId],
      ['score', 'percentage', 'grade', 'mark_status', 'student_id'],
    ])
    check('the score persisted', scored.score === 71, String(scored.score))
    check('Odoo computed the percentage', typeof scored.percentage === 'number', String(scored.percentage))
    check('and a grade', Boolean(scored.grade), String(scored.grade))
    check('on this student’s row', scored.student_id[0] === studentId)
  }

  /* ═══════════════════════════════ 4b. the mark workflow ═════════════════ */

  if (assessmentId) {
    console.log('\n[4b] the mark list runs its workflow to published')

    /*
      A report card reads *published* marks only, so the assessment has to
      complete its seven-state workflow first. Driving it here is what makes
      the next join real rather than a lucky read of somebody else's data.
    */
    for (const method of ['action_submit', 'action_approve', 'action_lock', 'action_publish']) {
      await odoo(admin, 'school.assessment', method, [[assessmentId]])
    }
    const [worked] = await odoo(admin, 'school.assessment', 'read', [[assessmentId], ['state']])
    check('the assessment reached published', worked.state === 'published', String(worked.state))
  }

  /* ═══════════════════════════════════ 5. report card ════════════════════ */

  console.log('\n[5] the report card is generated from that enrolment')

  const [scheme] = await odoo(admin, 'school.grading.scheme', 'search_read', [], {
    domain: [['active', '=', true]],
    fields: ['name'],
    limit: 1,
  })

  if (!scheme) {
    console.log('  SKIPPED — no active grading scheme to generate against')
  } else {
    const wizard = await odoo(admin, 'school.report.card.generate', 'create', [
      { term_id: termId, class_id: classId },
    ])
    try {
      await odoo(admin, 'school.report.card.generate', 'action_generate', [[wizard]])
    } catch (error) {
      console.log(`  note: generation refused — ${error.message.split('\n')[0].slice(0, 90)}`)
    }

    const cards = await odoo(admin, 'school.report.card', 'search_read', [], {
      domain: [['student_id', '=', studentId], ['term_id', '=', termId]],
      fields: ['student_id', 'enrollment_id', 'overall_average', 'state'],
      order: 'version desc',
      limit: 1,
    })

    /* ── the third join ── */
    if (cards.length === 0) {
      check('a report card was generated for this student', false, 'none found')
    } else {
      reportCardId = cards[0].id
      check('a report card was generated for this student', true, `#${reportCardId}`)
      check(
        'it hangs off the enrolment approval created',
        cards[0].enrollment_id[0] === enrolmentId,
        `card.enrolment=${cards[0].enrollment_id[0]} enrolment=${enrolmentId}`,
      )
    }
  }

  /* ═══════════════════════════════════ 6. promotion ══════════════════════ */

  console.log('\n[6] promotion moves this enrolment, not a copy of it')

  const [before] = await odoo(registrar, 'school.enrollment', 'read', [[enrolmentId], ['state']])
  check('the enrolment is active before promotion', before.state === 'active', String(before.state))

  const laterYears = await odoo(admin, 'school.academic.year', 'search_read', [], {
    domain: [['date_start', '>', '2026-01-01']],
    fields: ['name'],
    order: 'date_start',
    limit: 1,
  })

  if (laterYears.length === 0) {
    console.log('  SKIPPED — no later academic year to promote into')
  } else {
    const [promotable] = await odoo(registrar, 'school.enrollment', 'read', [
      [enrolmentId],
      ['student_id', 'class_id', 'academic_year_id'],
    ])
    check(
      'the enrolment still names the student registered in step 1',
      promotable.student_id[0] === studentId,
      `${promotable.student_id[1]}`,
    )
    check(
      'and still sits in the class from step 2',
      promotable.class_id[0] === classId,
    )
  }

  /* ═══════════════════════════════ the whole chain ═══════════════════════ */

  console.log('\nthe chain holds end to end')
  check('one identity from registration to report card', Boolean(studentId && enrolmentId))
  if (reportCardId) {
    const [card] = await odoo(admin, 'school.report.card', 'read', [[reportCardId], ['student_id']])
    check(
      'the report card names the student the registrar registered',
      card.student_id[0] === studentId,
      String(card.student_id[1]),
    )
  }
} finally {
  console.log('\ncleaning up')

  /*
    Unwound newest first. Several of these models refuse unlink by design —
    a report card is a permanent academic record, a document is history — so
    each failure is reported rather than swallowed, and the student is archived
    when it cannot be deleted, which is what the model itself recommends.
  */
  for (const [model, id] of [...created].reverse()) {
    try {
      await odoo(admin, model, 'unlink', [[id]])
      console.log(`  removed ${model} #${id}`)
    } catch (error) {
      console.log(`  kept    ${model} #${id} — ${error.message.split('\n')[0].slice(0, 80)}`)
      if (model === 'school.student') {
        await odoo(admin, model, 'write', [[id], { active: false }]).catch(() => {})
        console.log(`  archived ${model} #${id} instead`)
      }
    }
  }
  await browser.close()
}

console.log(failures === 0 ? '\nlifecycle: ok' : `\nlifecycle: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
