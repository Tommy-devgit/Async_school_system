'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireSession } from '@/lib/odoo/auth'
import { toOdooError } from '@/lib/odoo/errors'
import { relationalId } from '@/lib/form-values'
import { createClass, updateClass } from '@/lib/odoo/models/school'

export interface ClassFormState {
  error?: string
  fieldErrors?: Record<string, string>
  values?: Record<string, string>
}

/**
 * Odoo owns every rule that matters here — the (name, section, year) unique
 * constraint, the age-range and capacity checks, and `_check_stream_grade`,
 * which allows a stream only on Grades 11 and 12. These checks exist to answer
 * sooner, never to decide.
 */
const TEXT_FIELDS = ['name'] as const
const NUMBER_FIELDS = ['capacity', 'min_age', 'max_age'] as const
const RELATIONAL_FIELDS = [
  'grade_id', 'section_id', 'academic_year_id', 'room_id',
  'shift_id', 'stream_id', 'campus_id', 'homeroom_teacher_id',
] as const
const SELECTION_FIELDS = ['education_level'] as const
const BOOLEAN_FIELDS = ['is_entry_level', 'active'] as const

const ALL_FIELDS = [
  ...TEXT_FIELDS, ...NUMBER_FIELDS, ...RELATIONAL_FIELDS,
  ...SELECTION_FIELDS, ...BOOLEAN_FIELDS,
]

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim()
}

/** A cleared checkbox posts nothing; the forms pair each with a hidden input. */
function checked(form: FormData, key: string): boolean {
  return String(form.getAll(key).at(-1) ?? '') === 'true'
}

// Checkbox-aware: `active` arrives as a hidden "false" followed by the box's
// "true", so the last value wins. lib/form-values only handles scalars.
function submitted(form: FormData): Record<string, string> {
  return Object.fromEntries(
    ALL_FIELDS.map((field) => [
      field,
      (BOOLEAN_FIELDS as readonly string[]).includes(field)
        ? String(checked(form, field))
        : String(form.get(field) ?? ''),
    ]),
  )
}

function collect(form: FormData): {
  values?: Record<string, unknown>
  fieldErrors?: Record<string, string>
} {
  const fieldErrors: Record<string, string> = {}
  const values: Record<string, unknown> = {}

  for (const field of TEXT_FIELDS) {
    if (!form.has(field)) continue
    values[field] = text(form, field)
  }
  if (form.has('name') && !text(form, 'name')) fieldErrors.name = 'The class needs a name.'

  for (const field of NUMBER_FIELDS) {
    if (!form.has(field)) continue
    const raw = text(form, field)
    const parsed = raw === '' ? 0 : Number(raw)
    if (!Number.isFinite(parsed) || parsed < 0) {
      fieldErrors[field] = 'Enter a whole number of 0 or more.'
      continue
    }
    values[field] = parsed
  }

  const min = Number(values.min_age ?? 0)
  const max = Number(values.max_age ?? 0)
  if (min && max && min > max) {
    fieldErrors.max_age = 'The maximum age cannot be below the minimum.'
  }

  for (const field of RELATIONAL_FIELDS) {
    if (!form.has(field)) continue
    const id = relationalId(text(form, field))
    if (id === null) {
      fieldErrors[field] = 'Choose a valid option.'
      continue
    }
    values[field] = id
  }
  if (form.has('academic_year_id') && !text(form, 'academic_year_id')) {
    fieldErrors.academic_year_id = 'Choose the academic year this class belongs to.'
  }

  for (const field of SELECTION_FIELDS) {
    if (!form.has(field)) continue
    values[field] = text(form, field) || false
  }

  for (const field of BOOLEAN_FIELDS) {
    if (!form.has(field)) continue
    values[field] = checked(form, field)
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }
  return { values }
}

export async function createClassAction(
  _previous: ClassFormState,
  form: FormData,
): Promise<ClassFormState> {
  await requireSession()

  const { values, fieldErrors } = collect(form)
  if (fieldErrors) return { fieldErrors, values: submitted(form) }

  let id: number
  try {
    id = await createClass(values ?? {})
  } catch (cause) {
    // "This class/section already exists for this academic year." and the
    // stream rule both arrive here in Odoo's own words.
    return { error: toOdooError(cause).message, values: submitted(form) }
  }

  revalidatePath('/classes')
  redirect(`/classes/${id}`)
}

export async function updateClassAction(
  _previous: ClassFormState,
  form: FormData,
): Promise<ClassFormState> {
  await requireSession()

  const id = Number(text(form, 'id'))
  if (!Number.isInteger(id) || id <= 0) return { error: 'That class could not be identified.' }

  const { values, fieldErrors } = collect(form)
  if (fieldErrors) return { fieldErrors, values: submitted(form) }

  try {
    await updateClass(id, values ?? {})
  } catch (cause) {
    return { error: toOdooError(cause).message, values: submitted(form) }
  }

  revalidatePath(`/classes/${id}`)
  revalidatePath('/classes')
  redirect(`/classes/${id}`)
}
