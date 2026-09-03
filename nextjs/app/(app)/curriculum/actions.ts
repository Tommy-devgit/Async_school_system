'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireSession } from '@/lib/odoo/auth'
import { toOdooError } from '@/lib/odoo/errors'
import { updateCurriculumLine } from '@/lib/odoo/models/operations'

export interface FacilityFormState {
  error?: string
  fieldErrors?: Record<string, string>
  values?: Record<string, string>
}

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim()
}

/*
  An unchecked checkbox submits nothing at all, so a hidden "false" is paired
  with every box and the last value wins. Without that, clearing "Active" would
  send no key and Odoo would leave the record as it was.
*/
function checked(form: FormData, key: string): boolean {
  return String(form.getAll(key).at(-1) ?? '') === 'true'
}

function submitted(form: FormData, fields: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    fields.map((field) => [
      field,
      field === 'active' ? String(checked(form, field)) : String(form.get(field) ?? ''),
    ]),
  )
}

const CURRICULUM_FORM = [
  'subject_type',
  'maximum_mark',
  'pass_mark',
  'optional_selection_limit',
  'active',
] as const

/**
 * How one subject is graded for one class.
 *
 * The class and the subject are not editable: the pair is unique and marks and
 * report-card snapshots already hang off it, so re-pointing a line would
 * rewrite history rather than correct it.
 *
 * Odoo owns the arithmetic — `CHECK(maximum_mark > 0 AND pass_mark >= 0 AND
 * pass_mark <= maximum_mark)`. The check below mirrors it only to save a round
 * trip and to say which field is wrong; Odoo refuses either way.
 */
export async function updateCurriculumAction(
  _previous: FacilityFormState,
  form: FormData,
): Promise<FacilityFormState> {
  await requireSession()

  const id = Number(text(form, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    return { error: 'That curriculum line could not be identified.' }
  }

  const fieldErrors: Record<string, string> = {}

  const subjectType = text(form, 'subject_type')
  if (!subjectType) fieldErrors.subject_type = 'Choose how this subject is taken.'

  const maximum = Number(text(form, 'maximum_mark'))
  if (!Number.isFinite(maximum) || maximum <= 0) {
    fieldErrors.maximum_mark = 'The maximum mark has to be greater than zero.'
  }

  const pass = Number(text(form, 'pass_mark'))
  if (!Number.isFinite(pass) || pass < 0) {
    fieldErrors.pass_mark = 'The pass mark cannot be negative.'
  } else if (Number.isFinite(maximum) && pass > maximum) {
    fieldErrors.pass_mark = `The pass mark cannot be above the maximum of ${maximum}.`
  }

  const rawLimit = text(form, 'optional_selection_limit')
  const limit = rawLimit === '' ? 0 : Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 0) {
    fieldErrors.optional_selection_limit = 'The selection limit must be a whole number, or blank.'
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, values: submitted(form, CURRICULUM_FORM) }
  }

  try {
    await updateCurriculumLine(id, {
      subject_type: subjectType,
      maximum_mark: maximum,
      pass_mark: pass,
      optional_selection_limit: limit,
      ...(form.has('active') ? { active: checked(form, 'active') } : {}),
    })
  } catch (cause) {
    return { error: toOdooError(cause).message, values: submitted(form, CURRICULUM_FORM) }
  }

  revalidatePath('/configuration')
  redirect('/configuration')
}
