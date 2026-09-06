'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { ethiopianYearOf } from '@/lib/ethiopian-date'
import { requireSession } from '@/lib/odoo/auth'
import { toOdooError } from '@/lib/odoo/errors'
import { submitted } from '@/lib/form-values'
import { correctAcademicYear, createAcademicYear, updateAcademicYear } from '@/lib/odoo/models/school'

export interface AcademicYearFormState {
  error?: string
  fieldErrors?: Record<string, string>
  values?: Record<string, string>
}

/**
 * Create an academic year.
 *
 * The name is not collected — it is the Ethiopian year of the start date, and
 * `createAcademicYear` derives it. The date ordering is checked here only to
 * give a better message than the database constraint would; Odoo enforces it
 * either way, along with the name/start-date agreement and single-current rule.
 */
export async function createAcademicYearAction(
  _previous: AcademicYearFormState,
  form: FormData,
): Promise<AcademicYearFormState> {
  await requireSession()

  const dateStart = String(form.get('date_start') ?? '')
  const dateEnd = String(form.get('date_end') ?? '')
  const isCurrent = form.get('is_current') === 'on'
  const values = { date_start: dateStart, date_end: dateEnd }

  const fieldErrors: Record<string, string> = {}
  if (!dateStart) fieldErrors.date_start = 'A start date is required.'
  if (!dateEnd) fieldErrors.date_end = 'An end date is required.'
  if (dateStart && dateEnd && dateEnd <= dateStart) {
    fieldErrors.date_end = 'The end date must be after the start date.'
  }
  if (dateStart && ethiopianYearOf(dateStart) === null) {
    fieldErrors.date_start = 'That start date could not be read.'
  }
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors, values }

  let id: number
  try {
    id = await createAcademicYear({
      date_start: dateStart,
      date_end: dateEnd,
      is_current: isCurrent,
    })
  } catch (cause) {
    return { error: toOdooError(cause).message, values }
  }

  revalidatePath('/academic-years')
  redirect(`/academic-years/${id}`)
}

/**
 * Correct a draft or open year.
 *
 * Odoo makes closed and archived years read-only for everything but state,
 * is_current and active, so this deliberately refuses them rather than sending
 * a write it knows will bounce — the correction workflow is the way in.
 */
export async function updateAcademicYearAction(
  _previous: AcademicYearFormState,
  form: FormData,
): Promise<AcademicYearFormState> {
  await requireSession()

  const id = Number(String(form.get('id') ?? ''))
  if (!Number.isInteger(id) || id <= 0) return { error: 'That year could not be identified.' }

  const dateStart = String(form.get('date_start') ?? '')
  const dateEnd = String(form.get('date_end') ?? '')
  const isCurrent = form.get('is_current') === 'on'
  const values = { date_start: dateStart, date_end: dateEnd }

  const fieldErrors: Record<string, string> = {}
  if (!dateStart) fieldErrors.date_start = 'A start date is required.'
  if (!dateEnd) fieldErrors.date_end = 'An end date is required.'
  if (dateStart && dateEnd && dateEnd <= dateStart) {
    fieldErrors.date_end = 'The end date must be after the start date.'
  }
  if (dateStart && ethiopianYearOf(dateStart) === null) {
    fieldErrors.date_start = 'That start date could not be read.'
  }
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors, values }

  try {
    await updateAcademicYear(id, {
      date_start: dateStart,
      date_end: dateEnd,
      is_current: isCurrent,
    })
  } catch (cause) {
    // The single-current rule and the closed-year refusal both land here.
    return { error: toOdooError(cause).message, values }
  }

  revalidatePath(`/academic-years/${id}`)
  revalidatePath('/academic-years')
  redirect(`/academic-years/${id}`)
}

const CORRECTION_FIELDS = ['name', 'date_start', 'date_end', 'reason'] as const

export interface YearCorrectionState {
  error?: string
  ok?: string
  fieldErrors?: Record<string, string>
  /**
   * Echoed back so a refusal does not empty the form. The reason is written to
   * the record's chatter and cannot be recovered from anywhere else once the
   * form has been cleared.
   */
  values?: Record<(typeof CORRECTION_FIELDS)[number], string>
}

/**
 * The authorized correction for a closed or archived year.
 *
 * Odoo's wizard re-checks the director group and posts the reason to the
 * record's chatter, which is the point of routing through it.
 */
export async function correctAcademicYearAction(
  _previous: YearCorrectionState,
  form: FormData,
): Promise<YearCorrectionState> {
  await requireSession()

  const id = Number(String(form.get('id') ?? ''))
  if (!Number.isInteger(id) || id <= 0) return { error: 'That year could not be identified.' }

  const name = String(form.get('name') ?? '').trim()
  const dateStart = String(form.get('date_start') ?? '')
  const dateEnd = String(form.get('date_end') ?? '')
  const reason = String(form.get('reason') ?? '').trim()

  const fieldErrors: Record<string, string> = {}
  if (!name) fieldErrors.name = 'The year needs a name.'
  if (!dateStart) fieldErrors.date_start = 'A start date is required.'
  if (!dateEnd) fieldErrors.date_end = 'An end date is required.'
  if (dateStart && dateEnd && dateEnd <= dateStart) {
    fieldErrors.date_end = 'The end date must be after the start date.'
  }
  if (!reason) fieldErrors.reason = 'A reason is required — it is written to the record.'
  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, values: submitted(form, CORRECTION_FIELDS) }
  }

  try {
    await correctAcademicYear({
      academicYearId: id,
      name,
      dateStart,
      dateEnd,
      reason,
    })
  } catch (cause) {
    // "Only a Principal or School Administrator can correct closed years."
    // Not something the user could have known before writing the reason.
    return { error: toOdooError(cause).message, values: submitted(form, CORRECTION_FIELDS) }
  }

  revalidatePath(`/academic-years/${id}`)
  revalidatePath('/academic-years')
  return { ok: 'Correction recorded on the year.' }
}
