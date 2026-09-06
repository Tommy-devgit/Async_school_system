'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/odoo/auth'
import { toOdooError } from '@/lib/odoo/errors'
import {
  addResponsibility,
  createStaff,
  endResponsibility,
  setPrimaryResponsibility,
  updateResponsibility,
  updateStaff,
  type StaffIntake,
} from '@/lib/odoo/models/staff'
import { todayIso } from '@/lib/format'

/**
 * Every mutation here runs as the signed-in user's Odoo session. Nothing from
 * the browser is trusted for authorisation — no user id, no role, no staff id.
 * Odoo re-checks the ACL, the record rule and every constraint, and a refusal
 * comes back as a safe message.
 */

export interface FormState {
  error?: string
  fieldErrors?: Record<string, string>
  ok?: boolean
  /**
   * What the user typed, echoed back so a rejected submit does not empty the
   * form. A server-action form re-renders from scratch, so uncontrolled inputs
   * lose their values unless they are given back explicitly.
   */
  values?: Record<string, string>
}

/** Every field the registration form posts, for round-tripping on error. */
const INTAKE_FIELDS = [
  'first_name', 'last_name', 'gender', 'date_of_birth', 'fayda_id',
  'phone', 'mobile', 'email', 'department', 'job_title_id',
  'employment_type', 'employment_status', 'hire_date', 'responsibility',
] as const

function submittedValues(form: FormData): Record<string, string> {
  return Object.fromEntries(INTAKE_FIELDS.map((f) => [f, String(form.get(f) ?? '')]))
}

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim()
}

/** Client-side checks are for speed of feedback only; Odoo decides. */
function validateIntake(form: FormData): { values?: StaffIntake; fieldErrors?: Record<string, string> } {
  const fieldErrors: Record<string, string> = {}
  const first_name = text(form, 'first_name')
  const last_name = text(form, 'last_name')
  const department = text(form, 'department')
  const jobTitle = text(form, 'job_title_id')
  const responsibility = text(form, 'responsibility')
  const employment_status = text(form, 'employment_status')

  if (!first_name) fieldErrors.first_name = 'First name is required.'
  if (!last_name) fieldErrors.last_name = 'Last name is required.'
  if (!department) fieldErrors.department = 'Choose a department.'
  if (!jobTitle) fieldErrors.job_title_id = 'Choose a job title.'
  if (!responsibility) fieldErrors.responsibility = 'Choose a responsibility.'
  if (!employment_status) fieldErrors.employment_status = 'Choose an employment status.'

  const fayda = text(form, 'fayda_id')
  // Mirrors school.staff._check_fayda_id purely so the user hears sooner.
  if (fayda && !/^[0-9]{16}$/.test(fayda)) {
    fieldErrors.fayda_id = 'Fayda ID must be exactly 16 digits.'
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }

  return {
    values: {
      first_name,
      last_name,
      department,
      job_title_id: Number(jobTitle),
      employment_status,
      responsibility,
      employment_type: text(form, 'employment_type') || undefined,
      gender: text(form, 'gender') || undefined,
      phone: text(form, 'phone') || undefined,
      mobile: text(form, 'mobile') || undefined,
      email: text(form, 'email') || undefined,
      hire_date: text(form, 'hire_date') || undefined,
      date_of_birth: text(form, 'date_of_birth') || undefined,
      fayda_id: fayda || undefined,
    },
  }
}

export async function registerStaffAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  await requireSession()
  const { values, fieldErrors } = validateIntake(form)
  if (fieldErrors) return { fieldErrors, values: submittedValues(form) }

  let id: number
  try {
    id = await createStaff(values!)
  } catch (cause) {
    // Odoo's ValidationError messages are written for end users — the Fayda
    // duplicate, the minimum-age rule, the phone clash. Surface them as-is.
    return { error: toOdooError(cause).message, values: submittedValues(form) }
  }

  revalidatePath('/staff')
  redirect(`/staff/${id}`)
}

/**
 * Fields a staff record may be edited through.
 *
 * `name`, `staff_id` and `primary_responsibility` are computed or sequence-
 * assigned and are absent on purpose — Odoo would ignore or refuse them.
 * `state` is absent because it moves through the workflow actions, which mint
 * the sequence, create the hr.employee and cascade to teacher profiles; a
 * direct write would skip all of that.
 *
 * The list is an allowlist, not a filter over whatever the form posts: a
 * hand-crafted request naming another field gets it dropped here, and Odoo's
 * own field-level groups still apply on top.
 */
const EDITABLE_FIELDS = [
  'first_name',
  'last_name',
  'gender',
  'date_of_birth',
  'fayda_id',
  'phone',
  'mobile',
  'email',
  'department',
  'job_title_id',
  'employment_type',
  'employment_status',
  'hire_date',
  'end_date',
  'campus_id',
  'manager_id',
] as const

/** Many2one fields have to reach Odoo as integers, or be cleared with false. */
const RELATIONAL = new Set(['job_title_id', 'campus_id', 'manager_id'])

export async function updateStaffAction(_previous: FormState, form: FormData): Promise<FormState> {
  await requireSession()
  const id = Number(text(form, 'id'))
  if (!Number.isInteger(id) || id <= 0) return { error: 'That record could not be identified.' }

  const fieldErrors: Record<string, string> = {}
  const values: Record<string, unknown> = {}

  for (const field of EDITABLE_FIELDS) {
    // Only fields the form actually rendered are touched. A role that cannot
    // see date_of_birth never posts it, so the write never mentions it.
    if (!form.has(field)) continue
    const raw = text(form, field)
    if (RELATIONAL.has(field)) {
      values[field] = raw ? Number(raw) : false
    } else {
      values[field] = raw || false
    }
  }

  if (form.has('first_name') && !text(form, 'first_name')) {
    fieldErrors.first_name = 'First name is required.'
  }
  if (form.has('last_name') && !text(form, 'last_name')) {
    fieldErrors.last_name = 'Last name is required.'
  }
  const fayda = text(form, 'fayda_id')
  // Mirrors school.staff._check_fayda_id so the user hears sooner; Odoo decides.
  if (form.has('fayda_id') && fayda && !/^[0-9]{16}$/.test(fayda)) {
    fieldErrors.fayda_id = 'Fayda ID must be exactly 16 digits.'
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, values: Object.fromEntries(EDITABLE_FIELDS.map((f) => [f, text(form, f)])) }
  }

  try {
    await updateStaff(id, values)
  } catch (cause) {
    // "Cannot leave Draft while the following are missing: …", the Fayda
    // duplicate, the phone clash, the job-title/department mismatch — all
    // written for the person doing the work.
    return {
      error: toOdooError(cause).message,
      values: Object.fromEntries(EDITABLE_FIELDS.map((f) => [f, text(form, f)])),
    }
  }

  revalidatePath(`/staff/${id}`)
  revalidatePath('/staff')
  redirect(`/staff/${id}`)
}

/* -------------------------------------------------------- responsibility --- */

export interface ResponsibilityState {
  error?: string
  ok?: string
  fieldErrors?: Record<string, string>
}

/**
 * Add a responsibility.
 *
 * This is what unblocks activation: `_missing_registration_fields` requires at
 * least one active responsibility before a staff member may leave Draft, and
 * until now the frontend could create staff it could never activate.
 */
export async function addResponsibilityAction(
  _previous: ResponsibilityState,
  form: FormData,
): Promise<ResponsibilityState> {
  await requireSession()
  const staffId = Number(text(form, 'staffId'))
  const responsibility = text(form, 'responsibility')
  if (!Number.isInteger(staffId) || staffId <= 0) return { error: 'That record could not be identified.' }
  if (!responsibility) return { error: 'Choose a responsibility.' }

  const campusId = Number(text(form, 'campus_id'))
  const managerId = Number(text(form, 'manager_id'))

  try {
    await addResponsibility(staffId, {
      responsibility,
      is_primary: form.get('is_primary') === 'on',
      department: text(form, 'department') || undefined,
      campus_id: Number.isInteger(campusId) && campusId > 0 ? campusId : undefined,
      manager_id: Number.isInteger(managerId) && managerId > 0 ? managerId : undefined,
      start_date: text(form, 'start_date') || todayIso(),
      end_date: text(form, 'end_date') || undefined,
    })
  } catch (cause) {
    // "already has a primary responsibility", "cannot report to themselves",
    // and the unique constraint on (staff, responsibility, department, date).
    return { error: toOdooError(cause).message }
  }

  revalidatePath(`/staff/${staffId}`)
  return { ok: 'Responsibility added.' }
}

/**
 * Change an existing responsibility.
 *
 * Odoo owns every rule this touches — the unique
 * (staff, responsibility, department, start date), the "cannot report to
 * themselves" check, and the end-after-start constraint — and states each in
 * its own words, so they are passed through rather than restated.
 *
 * An emptied optional field is written as `false`, not skipped: clearing the
 * campus or the reporting manager has to be expressible, and Odoo reads a
 * missing key as "leave it alone".
 */
export async function updateResponsibilityAction(
  _previous: ResponsibilityState,
  form: FormData,
): Promise<ResponsibilityState> {
  await requireSession()

  const id = Number(text(form, 'id'))
  const staffId = Number(text(form, 'staffId'))
  if (!Number.isInteger(id) || id <= 0) return { error: 'That responsibility could not be identified.' }
  if (!Number.isInteger(staffId) || staffId <= 0) return { error: 'That record could not be identified.' }

  const responsibility = text(form, 'responsibility')
  if (!responsibility) return { error: 'Choose a responsibility.' }

  const startDate = text(form, 'start_date')
  if (!startDate) return { error: 'Give the responsibility a start date.' }

  const endDate = text(form, 'end_date')
  if (endDate && endDate < startDate) {
    // Mirrors the model's CHECK(end_date >= start_date); Odoo enforces it too.
    return { error: 'The effective-to date cannot be before the effective-from date.' }
  }

  const campusId = Number(text(form, 'campus_id'))
  const managerId = Number(text(form, 'manager_id'))

  try {
    await updateResponsibility(id, {
      responsibility,
      department: text(form, 'department') || false,
      campus_id: Number.isInteger(campusId) && campusId > 0 ? campusId : false,
      manager_id: Number.isInteger(managerId) && managerId > 0 ? managerId : false,
      start_date: startDate,
      end_date: endDate || false,
    })
  } catch (cause) {
    return { error: toOdooError(cause).message }
  }

  revalidatePath(`/staff/${staffId}`)
  return { ok: 'Responsibility updated.' }
}

/** End a responsibility. Kept as history rather than deleted — see the model. */
export async function endResponsibilityAction(
  _previous: ResponsibilityState,
  form: FormData,
): Promise<ResponsibilityState> {
  await requireSession()
  const id = Number(text(form, 'id'))
  const staffId = Number(text(form, 'staffId'))
  if (!Number.isInteger(id) || id <= 0) return { error: 'That responsibility could not be identified.' }

  try {
    await endResponsibility(id, text(form, 'end_date') || todayIso())
  } catch (cause) {
    return { error: toOdooError(cause).message }
  }

  revalidatePath(`/staff/${staffId}`)
  return { ok: 'Responsibility ended.' }
}

export async function setPrimaryResponsibilityAction(
  _previous: ResponsibilityState,
  form: FormData,
): Promise<ResponsibilityState> {
  await requireSession()
  const id = Number(text(form, 'id'))
  const staffId = Number(text(form, 'staffId'))
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(staffId) || staffId <= 0) {
    return { error: 'That responsibility could not be identified.' }
  }

  try {
    await setPrimaryResponsibility(staffId, id)
  } catch (cause) {
    return { error: toOdooError(cause).message }
  }

  revalidatePath(`/staff/${staffId}`)
  return { ok: 'Primary responsibility updated.' }
}
