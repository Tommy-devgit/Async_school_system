'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireSession } from '@/lib/odoo/auth'
import { toOdooError } from '@/lib/odoo/errors'
// Aliased: this module already has its own `submitted` over the question fields.
import { submitted as submittedFields } from '@/lib/form-values'
import {
  addOption,
  createQuestion,
  removeOption,
  updateQuestion,
} from '@/lib/odoo/models/registration'

export interface QuestionFormState {
  error?: string
  ok?: string
  fieldErrors?: Record<string, string>
  values?: Record<string, string>
}

const FIELDS = [
  'name', 'code', 'sequence', 'answer_type', 'grade_from', 'grade_to',
  'admission_type', 'stream_id', 'support_need_only', 'required', 'active',
] as const

const BOOLEANS = new Set<string>(['support_need_only', 'required', 'active'])

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim()
}

function checked(form: FormData, key: string): boolean {
  return String(form.getAll(key).at(-1) ?? '') === 'true'
}

// Checkbox-aware: see the note in classes/actions.ts.
function submitted(form: FormData): Record<string, string> {
  return Object.fromEntries(
    FIELDS.map((f) => [f, BOOLEANS.has(f) ? String(checked(form, f)) : String(form.get(f) ?? '')]),
  )
}

/**
 * Odoo owns the unique code and the grade-range check
 * (`CHECK(grade_from >= 1 AND grade_to <= 12 AND grade_from <= grade_to)`).
 * These checks only answer sooner and name the field.
 */
function collect(form: FormData): {
  values?: Record<string, unknown>
  fieldErrors?: Record<string, string>
} {
  const fieldErrors: Record<string, string> = {}

  const name = text(form, 'name')
  const code = text(form, 'code')
  if (!name) fieldErrors.name = 'The question needs wording.'
  if (!code) fieldErrors.code = 'A code is required, and must be unique.'

  const gradeFrom = Number(text(form, 'grade_from') || '1')
  const gradeTo = Number(text(form, 'grade_to') || '12')
  if (!Number.isInteger(gradeFrom) || gradeFrom < 1 || gradeFrom > 12) {
    fieldErrors.grade_from = 'Between 1 and 12.'
  }
  if (!Number.isInteger(gradeTo) || gradeTo < 1 || gradeTo > 12) {
    fieldErrors.grade_to = 'Between 1 and 12.'
  }
  if (!fieldErrors.grade_from && !fieldErrors.grade_to && gradeFrom > gradeTo) {
    fieldErrors.grade_to = 'The last grade cannot be below the first.'
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }

  const streamId = Number(text(form, 'stream_id'))
  return {
    values: {
      name,
      code,
      sequence: Number(text(form, 'sequence') || '10'),
      answer_type: text(form, 'answer_type') || 'text',
      grade_from: gradeFrom,
      grade_to: gradeTo,
      admission_type: text(form, 'admission_type') || 'all',
      stream_id: Number.isInteger(streamId) && streamId > 0 ? streamId : false,
      support_need_only: checked(form, 'support_need_only'),
      required: checked(form, 'required'),
      ...(form.has('active') ? { active: checked(form, 'active') } : {}),
    },
  }
}

export async function createQuestionAction(
  _previous: QuestionFormState,
  form: FormData,
): Promise<QuestionFormState> {
  await requireSession()

  const { values, fieldErrors } = collect(form)
  if (fieldErrors) return { fieldErrors, values: submitted(form) }

  let id: number
  try {
    id = await createQuestion(values ?? {})
  } catch (cause) {
    // "Question codes must be unique." and the grade-range check.
    return { error: toOdooError(cause).message, values: submitted(form) }
  }

  revalidatePath('/configuration/questionnaire')
  redirect(`/configuration/questionnaire/${id}`)
}

export async function updateQuestionAction(
  _previous: QuestionFormState,
  form: FormData,
): Promise<QuestionFormState> {
  await requireSession()

  const id = Number(text(form, 'id'))
  if (!Number.isInteger(id) || id <= 0) return { error: 'That question could not be identified.' }

  const { values, fieldErrors } = collect(form)
  if (fieldErrors) return { fieldErrors, values: submitted(form) }

  try {
    await updateQuestion(id, values ?? {})
  } catch (cause) {
    return { error: toOdooError(cause).message, values: submitted(form) }
  }

  revalidatePath(`/configuration/questionnaire/${id}`)
  revalidatePath('/configuration/questionnaire')
  redirect(`/configuration/questionnaire/${id}`)
}

const OPTION_FIELDS = ['name', 'value', 'sequence'] as const

const submittedOption = (form: FormData) => submittedFields(form, OPTION_FIELDS)

export async function addOptionAction(
  _previous: QuestionFormState,
  form: FormData,
): Promise<QuestionFormState> {
  await requireSession()

  const questionId = Number(text(form, 'questionId'))
  if (!Number.isInteger(questionId) || questionId <= 0) {
    return { error: 'That question could not be identified.' }
  }

  // Echoed on every refusal below, so a rejected option keeps its label,
  // stored value and order rather than starting again.
  const option = submittedOption(form)

  const name = text(form, 'name')
  const value = text(form, 'value')
  if (!name) return { fieldErrors: { name: 'The option needs a label.' }, values: option }
  // Odoo requires it, and it is what an answer stores — not the label, which
  // is translatable and may change.
  if (!value) return { fieldErrors: { value: 'A stored value is required.' }, values: option }

  try {
    await addOption(questionId, { name, value, sequence: Number(text(form, 'sequence') || '10') })
  } catch (cause) {
    return { error: toOdooError(cause).message, values: option }
  }

  revalidatePath(`/configuration/questionnaire/${questionId}`)
  return { ok: 'Option added.' }
}

export async function removeOptionAction(
  _previous: QuestionFormState,
  form: FormData,
): Promise<QuestionFormState> {
  await requireSession()

  const id = Number(text(form, 'id'))
  const questionId = Number(text(form, 'questionId'))
  if (!Number.isInteger(id) || id <= 0) return { error: 'That option could not be identified.' }

  try {
    await removeOption(id)
  } catch (cause) {
    // An option an answer already points at cannot be removed — ondelete is
    // restrict, and that refusal is correct.
    return { error: toOdooError(cause).message }
  }

  revalidatePath(`/configuration/questionnaire/${questionId}`)
  return { ok: 'Option removed.' }
}
