'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/odoo/auth'
import { toOdooError } from '@/lib/odoo/errors'
import {
  applyAssignmentTransition,
  createAssignment,
  getAssignment,
  updateAssignment,
  ASSIGNMENT_EDITABLE,
  ASSIGNMENT_TRANSITIONS,
  type AssignmentTransitionKey,
} from '@/lib/odoo/models/assignment'

/**
 * Assignment mutations.
 *
 * Odoo carries eight constraints on this model and each one produces a message
 * written for the person doing the work — "Grade 8A already has X teaching
 * Mathematics for 2018 Term 1", "is not on the curriculum of", "brings X to 24
 * weekly periods, exceeding their maximum of 20". Those are surfaced as-is;
 * nothing here tries to predict or restate them.
 */

export interface AssignmentFormState {
  error?: string
  fieldErrors?: Record<string, string>
  ok?: string
  values?: Record<string, string>
}

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim()

const FORM_FIELDS = [
  'teacher_id', 'class_id', 'subject_id', 'term_id',
  'responsibility', 'teaching_role', 'weekly_periods', 'start_date', 'end_date',
] as const

// Trims, unlike `submitted` in lib/form-values — kept because this form's
// validation compares against the trimmed value.
const submitted = (form: FormData) => Object.fromEntries(FORM_FIELDS.map((f) => [f, text(form, f)]))

function requiredId(form: FormData, key: string): number | null {
  const value = Number(text(form, key))
  return Number.isInteger(value) && value > 0 ? value : null
}

function validate(form: FormData): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!requiredId(form, 'teacher_id')) errors.teacher_id = 'Choose a teacher.'
  if (!requiredId(form, 'class_id')) errors.class_id = 'Choose a class.'
  if (!requiredId(form, 'subject_id')) errors.subject_id = 'Choose a subject.'
  if (!requiredId(form, 'term_id')) errors.term_id = 'Choose a term.'
  const periods = Number(text(form, 'weekly_periods') || '1')
  if (!Number.isInteger(periods) || periods < 1) {
    errors.weekly_periods = 'Periods per week must be a whole number of at least 1.'
  }
  const start = text(form, 'start_date')
  const end = text(form, 'end_date')
  // Mirrors _check_dates so the user hears sooner; Odoo decides.
  if (start && end && end < start) errors.end_date = 'The end date cannot be before the start date.'
  return errors
}

export async function createAssignmentAction(
  _previous: AssignmentFormState,
  form: FormData,
): Promise<AssignmentFormState> {
  await requireSession()

  const fieldErrors = validate(form)
  if (Object.keys(fieldErrors).length) return { fieldErrors, values: submitted(form) }

  let id: number
  try {
    id = await createAssignment({
      teacher_id: requiredId(form, 'teacher_id') as number,
      class_id: requiredId(form, 'class_id') as number,
      subject_id: requiredId(form, 'subject_id') as number,
      term_id: requiredId(form, 'term_id') as number,
      responsibility: text(form, 'responsibility') || undefined,
      teaching_role: text(form, 'teaching_role') || undefined,
      weekly_periods: Number(text(form, 'weekly_periods') || '1'),
      // Left out unless given: Odoo's create fills them from the term.
      start_date: text(form, 'start_date') || undefined,
      end_date: text(form, 'end_date') || undefined,
    })
  } catch (cause) {
    return { error: toOdooError(cause).message, values: submitted(form) }
  }

  revalidatePath('/assignments')
  revalidatePath('/teachers')
  redirect(`/assignments/${id}`)
}

export async function updateAssignmentAction(
  _previous: AssignmentFormState,
  form: FormData,
): Promise<AssignmentFormState> {
  await requireSession()
  const id = Number(text(form, 'id'))
  if (!Number.isInteger(id) || id <= 0) return { error: 'That assignment could not be identified.' }

  const fieldErrors = validate(form)
  if (Object.keys(fieldErrors).length) return { fieldErrors, values: submitted(form) }

  const values: Record<string, unknown> = {}
  for (const field of ASSIGNMENT_EDITABLE) {
    if (!form.has(field)) continue
    const raw = text(form, field)
    if (field === 'weekly_periods') values[field] = Number(raw || '1')
    else if (field.endsWith('_id')) values[field] = raw ? Number(raw) : false
    else values[field] = raw || false
  }

  try {
    await updateAssignment(id, values)
  } catch (cause) {
    return { error: toOdooError(cause).message, values: submitted(form) }
  }

  revalidatePath(`/assignments/${id}`)
  revalidatePath('/assignments')
  redirect(`/assignments/${id}`)
}

/**
 * Move an assignment between states.
 *
 * The browser posts a transition key and a record id — never a field name or a
 * value. The key is resolved against `ASSIGNMENT_TRANSITIONS` here, the record's
 * current state is re-read from Odoo rather than trusted from the form, and the
 * guard is checked before anything is written. Odoo's constraints then run on
 * the write regardless.
 */
export async function assignmentTransitionAction(
  _previous: AssignmentFormState,
  form: FormData,
): Promise<AssignmentFormState> {
  await requireSession()
  const id = Number(text(form, 'id'))
  const key = text(form, 'transition') as AssignmentTransitionKey

  if (!Number.isInteger(id) || id <= 0) return { error: 'That assignment could not be identified.' }
  if (!Object.prototype.hasOwnProperty.call(ASSIGNMENT_TRANSITIONS, key)) {
    return { error: 'That action is not available.' }
  }

  try {
    // Read the state back rather than trusting what the page was rendered with:
    // the record may have moved since, and the guard has to run against now.
    const current = await getAssignment(id)
    if (!current) return { error: 'That assignment no longer exists.' }
    await applyAssignmentTransition(id, key, String(current.state || ''))
  } catch (cause) {
    return { error: toOdooError(cause).message }
  }

  revalidatePath(`/assignments/${id}`)
  revalidatePath('/assignments')
  revalidatePath('/teachers')
  return { ok: `${ASSIGNMENT_TRANSITIONS[key].label} completed.` }
}
