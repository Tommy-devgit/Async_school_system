'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/odoo/auth'
import { toOdooError } from '@/lib/odoo/errors'
import { changedRows, type MarkValues } from '@/lib/mark-diff'
import {
  createAssessment,
  listAssessmentMarks,
  saveMark,
  unlockAssessment,
  updateAssessment,
} from '@/lib/odoo/models/assessment'

/** What Odoo holds for one row after a save. */
export interface SavedMarkRow {
  id: number
  score: number
  status: string
  percentage: number
  grade: string | false
  note: string
}

export interface MarkListState {
  error?: string
  ok?: string
  /** Odoo's refusal for one row, keyed by mark id. */
  rowErrors?: Record<number, string>
  /**
   * The rows as Odoo now holds them, read back after the write.
   *
   * The grid reconciles against these rather than assuming its own optimism
   * was right. It is also how the percentage and the grade appear without a
   * reload: both are computed and stored by Odoo, and a client that guessed
   * them would eventually guess differently from the grading scheme.
   */
  rows?: SavedMarkRow[]
  /** Bumped per response so the client can tell two answers apart. */
  savedAt?: number
}

/**
 * Save every changed row of a mark list in one pass.
 *
 * Odoo owns every rule here: it refuses the write once the assessment leaves
 * `open`, rejects any attempt to change a row's scope, and promotes a pending
 * row to `recorded` when a score first arrives. This validates shape, then
 * hands over — and reports each refusal against the row it came from rather
 * than failing the whole roster, because one out-of-range score should not
 * discard thirty good ones.
 */
export async function saveMarksAction(
  _previous: MarkListState,
  form: FormData,
): Promise<MarkListState> {
  await requireSession()

  const assessmentId = Number(form.get('assessmentId'))
  if (!Number.isInteger(assessmentId) || assessmentId <= 0) {
    return { error: 'That mark list could not be identified.' }
  }

  /*
    The grid posts its current values and the ones Odoo last confirmed, as
    JSON. It used to post every field twice — the control and a hidden
    companion holding the rendered value — and diff those. React 19 resets a
    form once its action returns, which desynchronised the two halves and let
    the next save write stale values back over a teacher's entry.
  */
  let current: Record<number, MarkValues> = {}
  let baseline: Record<number, MarkValues> = {}
  try {
    current = JSON.parse(String(form.get('current') ?? '{}'))
    baseline = JSON.parse(String(form.get('baseline') ?? '{}'))
  } catch {
    return { error: 'That change could not be read. Reload and try again.' }
  }

  /*
    The maximum each row is marked out of comes from Odoo, not from the
    browser: a hand-posted maximum would otherwise widen its own bound. Odoo
    checks the score against `max_score` again regardless.
  */
  const roster = await listAssessmentMarks(assessmentId)
  const allowed = new Map(roster.rows.map((row) => [row.id, row]))

  const rowErrors: Record<number, string> = {}
  const changes = changedRows(current, baseline).filter(({ markId, values }) => {
    const row = allowed.get(markId)
    if (!row) {
      // Not on this assessment's roster — refuse rather than write it.
      rowErrors[markId] = 'That row is not part of this mark list.'
      return false
    }
    if (values.score === undefined) return true
    if (!Number.isFinite(values.score) || values.score < 0) {
      rowErrors[markId] = 'Enter a score of zero or more.'
      return false
    }
    if (values.score > row.max_score) {
      rowErrors[markId] = `Score cannot be greater than ${row.max_score}.`
      return false
    }
    return true
  })

  if (changes.length === 0) {
    return Object.keys(rowErrors).length > 0
      ? { rowErrors, error: 'Nothing saved — fix the rows above.', savedAt: Date.now() }
      : { ok: 'No changes to save.', savedAt: Date.now() }
  }

  const results = await Promise.allSettled(
    changes.map(({ markId, values }) => saveMark(markId, values)),
  )

  let refused = 0
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      // "Marks can only be edited while their assessment is open" and the like
      // — Odoo's wording, kept, against the row that caused it.
      rowErrors[changes[index].markId] = toOdooError(result.reason).message
      refused += 1
    }
  })

  // Rows rejected before the write are already out of `changes`, so only the
  // refusals from Odoo come off the count.
  const saved = changes.length - refused

  /*
    Read the roster back. This is the only honest way to show a percentage or
    a grade: both are computed and stored by Odoo from the grading scheme, and
    a status like `absent` clears them deliberately. Returning what Odoo holds
    also lets the grid reconcile instead of trusting its own optimism.
  */
  const after = await listAssessmentMarks(assessmentId)
  const rows: SavedMarkRow[] = after.rows.map((row) => ({
    id: row.id,
    score: row.score,
    status: String(row.mark_status || ''),
    percentage: row.percentage,
    grade: row.grade,
    note: row.note === false ? '' : String(row.note ?? ''),
  }))

  revalidatePath(`/assessments/${assessmentId}`)

  if (Object.keys(rowErrors).length > 0) {
    return {
      rowErrors,
      rows,
      savedAt: Date.now(),
      error: saved > 0 ? `Saved ${saved}. The rows above were refused.` : undefined,
    }
  }

  return { ok: `Saved ${saved} ${saved === 1 ? 'mark' : 'marks'}.`, rows, savedAt: Date.now() }
}

export interface AssessmentFormState {
  error?: string
  fieldErrors?: Record<string, string>
  values?: Record<string, string>
}

/**
 * Create an assessment in draft.
 *
 * Odoo owns the hard rules — the date must fall inside the term, the term must
 * belong to the class's academic year, the assignment must be the exact
 * applicable one, and the assessment weights for a subject in a term may not
 * exceed 100. Those messages are written for the person filling this in, so
 * they are surfaced unchanged rather than pre-empted here.
 */
export async function createAssessmentAction(
  _previous: AssessmentFormState,
  form: FormData,
): Promise<AssessmentFormState> {
  await requireSession()

  const text = (key: string) => String(form.get(key) ?? '').trim()
  const assignmentId = Number(form.get('assignmentId'))
  const name = text('name')
  const assessmentType = text('assessment_type')
  const date = text('date')
  const maxMark = Number(text('max_mark'))
  const weight = Number(text('weight'))

  const values = {
    name,
    assessment_type: assessmentType,
    date,
    max_mark: text('max_mark'),
    weight: text('weight'),
    assignmentId: text('assignmentId'),
  }

  const fieldErrors: Record<string, string> = {}
  if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
    fieldErrors.assignmentId = 'Choose the teaching assignment this assessment belongs to.'
  }
  if (!name) fieldErrors.name = 'A name is required.'
  if (!assessmentType) fieldErrors.assessment_type = 'Choose a type.'
  if (!date) fieldErrors.date = 'An assessment date is required.'
  if (!Number.isFinite(maxMark) || maxMark <= 0) {
    fieldErrors.max_mark = 'The maximum mark must be greater than zero.'
  }
  if (!Number.isFinite(weight) || weight < 0) {
    fieldErrors.weight = 'The weight cannot be negative.'
  }
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors, values }

  let id: number
  try {
    id = await createAssessment({
      assignmentId,
      name,
      assessment_type: assessmentType,
      date,
      max_mark: maxMark,
      weight,
    })
  } catch (cause) {
    return { error: toOdooError(cause).message, values }
  }

  revalidatePath('/assessments')
  redirect(`/assessments/${id}`)
}

export interface UnlockState {
  error?: string
  ok?: string
}

/**
 * Reopen a locked assessment for correction.
 *
 * The reason is required because Odoo requires it — it lands on the audit
 * trail as an `unlocked` event, which is the whole point of BR-11/AC-13. The
 * Exam Officer check is Odoo's and is re-run on the call.
 */
export async function unlockAssessmentAction(
  _previous: UnlockState,
  form: FormData,
): Promise<UnlockState> {
  await requireSession()

  const assessmentId = Number(form.get('assessmentId'))
  const reason = String(form.get('reason') ?? '').trim()

  if (!Number.isInteger(assessmentId) || assessmentId <= 0) {
    return { error: 'That assessment could not be identified.' }
  }
  if (!reason) return { error: 'A reason is required — it goes on the audit trail.' }

  try {
    await unlockAssessment(assessmentId, reason)
  } catch (cause) {
    return { error: toOdooError(cause).message }
  }

  revalidatePath(`/assessments/${assessmentId}`)
  return { ok: 'Reopened for correction.' }
}

/**
 * Correct an assessment.
 *
 * Odoo splits this for us: `write` refuses `assessment_type`, `date`,
 * `max_mark` and `weight` once the record is past draft, because the mark list
 * was generated against exactly that scope. The name is not frozen, so this
 * posts only what the form offered and lets Odoo have the last word.
 *
 * The class, subject and term are never sent — they come from the teacher
 * assignment, and changing them means changing the assignment.
 */
export async function updateAssessmentAction(
  _previous: AssessmentFormState,
  form: FormData,
): Promise<AssessmentFormState> {
  await requireSession()

  const id = Number(String(form.get('id') ?? '').trim())
  if (!Number.isInteger(id) || id <= 0) {
    return { error: 'That assessment could not be identified.' }
  }

  const read = (key: string) => String(form.get(key) ?? '').trim()
  const values: Record<string, unknown> = {}
  const fieldErrors: Record<string, string> = {}

  const name = read('name')
  if (!name) fieldErrors.name = 'The assessment needs a name.'
  else values.name = name

  if (form.has('assessment_type')) {
    const type = read('assessment_type')
    if (!type) fieldErrors.assessment_type = 'Choose an assessment type.'
    else values.assessment_type = type
  }

  if (form.has('date')) {
    const date = read('date')
    if (!date) fieldErrors.date = 'An assessment date is required.'
    else values.date = date
  }

  for (const [field, label] of [
    ['max_mark', 'The maximum mark'],
    ['weight', 'The weight'],
  ] as const) {
    if (!form.has(field)) continue
    const parsed = Number(read(field))
    if (!Number.isFinite(parsed) || parsed <= 0) {
      fieldErrors[field] = `${label} must be greater than zero.`
      continue
    }
    values[field] = parsed
  }

  const echo = Object.fromEntries(
    ['name', 'assessment_type', 'date', 'max_mark', 'weight'].map((f) => [f, read(f)]),
  )
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors, values: echo }

  try {
    await updateAssessment(id, values)
  } catch (cause) {
    // "Assessment setup is frozen once the mark list is generated.", the
    // date-outside-term rule, and the total-weight-per-subject cap.
    return { error: toOdooError(cause).message, values: echo }
  }

  revalidatePath(`/assessments/${id}`)
  revalidatePath('/assessments')
  redirect(`/assessments/${id}`)
}
