'use server'

import { revalidatePath } from 'next/cache' 
import { redirect } from 'next/navigation' 
import { requireSession } from '@/lib/odoo/auth' 
import { toOdooError } from '@/lib/odoo/errors'
import { submitted } from '@/lib/form-values' 
import {
  authorizeOverride,
  createEnrollment,
  promoteEnrollment,
  searchApprovedStudents,
  transferEnrollment,
  type StudentSearchRow,
} from '@/lib/odoo/models/student'


export async function searchStudentsAction(query: string): Promise<StudentSearchRow[]> {
  if (query.trim().length < 2) return []
  return searchApprovedStudents(query)
}

export interface EnrollmentFormState {
  error?: string
  fieldErrors?: Record<string, string>
  values?: Record<string, string>
}

export async function createEnrollmentAction(
  _prevState: EnrollmentFormState,
  formData: FormData,
): Promise<EnrollmentFormState> {
  const raw = {
    student_id: String(formData.get('student_id') || ''),
    class_id: String(formData.get('class_id') || ''),
    admission_type: String(formData.get('admission_type') || ''),
    enrollment_date: String(formData.get('enrollment_date') || ''),
  }

  const fieldErrors: Record<string, string> = {}
  if (!raw.student_id) fieldErrors.student_id = 'Pick a student from the list.'
  if (!raw.class_id) fieldErrors.class_id = 'Choose a grade / class.'
  if (!raw.admission_type) fieldErrors.admission_type = 'Choose an admission type.'
  if (!raw.enrollment_date) fieldErrors.enrollment_date = 'Enter an enrollment date.'

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, values: raw }
  }

  let enrollmentId: number
  try {
    enrollmentId = await createEnrollment({
      student_id: Number(raw.student_id),
      class_id: Number(raw.class_id),
      admission_type: raw.admission_type,
      enrollment_date: raw.enrollment_date,
    })
  } catch (cause) {
    return { error: toOdooError(cause).message, values: raw }
  }

  redirect(`/enrollments/${enrollmentId}`)
}

const PROMOTION_FIELDS = ['nextYearId', 'nextClassId', 'effectiveDate'] as const

export interface PromotionState {
  error?: string
  fieldErrors?: Record<string, string>
  /** Echoed back so a refusal does not empty the form. */
  values?: Record<(typeof PROMOTION_FIELDS)[number], string>
}

/**
 * Promote one student into the next academic year.
 *
 * Odoo owns every rule: the destination must be a later year, the effective
 * date may not precede the current enrolment, and a student already enrolled
 * for that year is refused by name. Those messages are written for the
 * registrar, so they are surfaced unchanged rather than pre-empted here.
 */
export async function promoteEnrollmentAction(
  _previous: PromotionState,
  form: FormData,
): Promise<PromotionState> {
  await requireSession()

  const enrollmentId = Number(form.get('enrollmentId'))
  const nextYearId = Number(form.get('nextYearId'))
  const nextClassId = Number(form.get('nextClassId'))
  const effectiveDate = String(form.get('effectiveDate') ?? '').trim()

  if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
    return { error: 'That enrolment could not be identified.' }
  }

  const fieldErrors: Record<string, string> = {}
  if (!Number.isInteger(nextYearId) || nextYearId <= 0) {
    fieldErrors.nextYearId = 'Choose the year to promote into.'
  }
  if (!effectiveDate) fieldErrors.effectiveDate = 'Choose the date this takes effect.'
  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, values: submitted(form, PROMOTION_FIELDS) }
  }

  let newEnrollmentId: number | null
  try {
    newEnrollmentId = await promoteEnrollment({
      enrollmentId,
      nextYearId,
      nextClassId: Number.isInteger(nextClassId) && nextClassId > 0 ? nextClassId : undefined,
      effectiveDate,
    })
  } catch (cause) {
    return { error: toOdooError(cause).message, values: submitted(form, PROMOTION_FIELDS) }
  }

  revalidatePath('/enrollments')
  revalidatePath(`/enrollments/${enrollmentId}`)
  redirect(newEnrollmentId ? `/enrollments/${newEnrollmentId}` : '/enrollments')
}

const TRANSFER_FIELDS = ['new_class_id', 'effective_date', 'reason'] as const

export interface TransferState {
  error?: string
  ok?: string
  fieldErrors?: Record<string, string>
  /**
   * Echoed back so a refusal does not empty the form — the reason in
   * particular, which is written prose and is required.
   */
  values?: Record<(typeof TRANSFER_FIELDS)[number], string>
}

/**
 * Move a student to another class inside the same academic year.
 *
 * Every rule stays Odoo's: the target must be in the same year, the effective
 * date may not precede the current placement, and a full class is refused
 * unless a capacity override has been authorised on this enrolment. Those
 * messages name the class and the date, so they are surfaced unchanged.
 */
export async function transferEnrollmentAction(
  _previous: TransferState,
  form: FormData,
): Promise<TransferState> {
  await requireSession()

  const enrollmentId = Number(String(form.get('enrollmentId') ?? ''))
  const newClassId = Number(String(form.get('new_class_id') ?? ''))
  const effectiveDate = String(form.get('effective_date') ?? '').trim()
  const reason = String(form.get('reason') ?? '').trim()

  if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
    return { error: 'That enrolment could not be identified.' }
  }

  const fieldErrors: Record<string, string> = {}
  if (!Number.isInteger(newClassId) || newClassId <= 0) {
    fieldErrors.new_class_id = 'Choose the class to move the student to.'
  }
  if (!effectiveDate) fieldErrors.effective_date = 'An effective date is required.'
  if (!reason) fieldErrors.reason = 'A reason is required — it is kept with the placement.'
  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, values: submitted(form, TRANSFER_FIELDS) }
  }

  try {
    await transferEnrollment({ enrollmentId, newClassId, effectiveDate, reason })
  } catch (cause) {
    // A full class is refused here unless an override has been authorised, so
    // this path is reached with a reason already written out.
    return { error: toOdooError(cause).message, values: submitted(form, TRANSFER_FIELDS) }
  }

  revalidatePath(`/enrollments/${enrollmentId}`)
  revalidatePath('/enrollments')
  return { ok: 'Transferred. The previous placement is closed and kept as history.' }
}

const OVERRIDE_FIELDS = ['operation', 'reason'] as const

export interface OverrideState {
  error?: string
  ok?: string
  fieldErrors?: Record<string, string>
  /**
   * Echoed back so a refusal does not empty the form. This one matters most:
   * the reason is permanent, so it tends to be the most carefully written text
   * anyone types into this application, and the refusals it runs into — wrong
   * group, overrides disabled in settings — are ones the user cannot foresee.
   */
  values?: Record<(typeof OVERRIDE_FIELDS)[number], string>
}

/**
 * Authorise an exception on one enrolment.
 *
 * Odoo's `create` re-checks the director group and that overrides are enabled
 * in School Settings, and refuses `unlink` — an override is an audit record,
 * so this never offers to remove one.
 */
export async function authorizeOverrideAction(
  _previous: OverrideState,
  form: FormData,
): Promise<OverrideState> {
  await requireSession()

  const enrollmentId = Number(String(form.get('enrollmentId') ?? ''))
  const operation = String(form.get('operation') ?? '').trim()
  const reason = String(form.get('reason') ?? '').trim()

  if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
    return { error: 'That enrolment could not be identified.' }
  }

  const fieldErrors: Record<string, string> = {}
  if (!operation) fieldErrors.operation = 'Choose what is being overridden.'
  if (!reason) fieldErrors.reason = 'A reason is required — it is permanent.'
  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, values: submitted(form, OVERRIDE_FIELDS) }
  }

  try {
    await authorizeOverride({ enrollmentId, operation, reason })
  } catch (cause) {
    // "Only a Principal or School Administrator can approve overrides." and
    // "Enrollment overrides are disabled in School Settings." Neither is
    // something the user could have known before writing the reason.
    return { error: toOdooError(cause).message, values: submitted(form, OVERRIDE_FIELDS) }
  }

  revalidatePath(`/enrollments/${enrollmentId}`)
  return { ok: 'Override authorised and recorded against your name.' }
}
