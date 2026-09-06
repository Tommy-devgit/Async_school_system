'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/odoo/auth'
import { ethiopianYearOf } from '@/lib/ethiopian-date'
import { toOdooError } from '@/lib/odoo/errors'
import { submitted, submittedList } from '@/lib/form-values'
import {
  ensureGradeSections,
  runSchoolSetup,
  setClassSubjects,
} from '@/lib/odoo/models/setup'

const SETUP_SCALARS = [
  'dateStart', 'dateEnd', 'termCount', 'sectionNames', 'isCurrent',
  'gradeId', 'academicYearId', 'newSectionNames',
  'classId', 'subjectType', 'maximumMark', 'passMark',
] as const

const SETUP_LISTS = ['gradeIds', 'sectionIds', 'subjectIds'] as const

export interface SetupState {
  error?: string
  ok?: string
  fieldErrors?: Record<string, string>
  /**
   * What was submitted, echoed back so a refusal does not empty the form.
   *
   * These three forms are the most expensive in the application to refill —
   * one of them asks for two dates, a term count and a tick against every
   * grade in the school — and they are refused for reasons nobody can predict,
   * like a year that already exists.
   */
  values?: Record<(typeof SETUP_SCALARS)[number], string>
  /** Multi-selects, kept separately because a name submitted many times
   *  cannot survive a scalar echo. */
  selected?: Record<(typeof SETUP_LISTS)[number], string[]>
}

const echo = (form: FormData) => ({
  values: submitted(form, SETUP_SCALARS),
  selected: submittedList(form, SETUP_LISTS),
})

const TERM_COUNTS = new Set(['1', '2', '3', '4'])

function ids(form: FormData, key: string): number[] {
  return form
    .getAll(key)
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)
}

/**
 * Open an academic year with its terms and classes.
 *
 * Odoo owns the shape of all of it — how a year splits into terms, how a class
 * is named per grade and section, and whether one already exists. The year
 * name is not collected because it must be the Ethiopian year of the start
 * date, so asking for it can only produce a validation error.
 */
export async function schoolSetupAction(
  _previous: SetupState,
  form: FormData,
): Promise<SetupState> {
  await requireSession()

  const dateStart = String(form.get('dateStart') ?? '').trim()
  const dateEnd = String(form.get('dateEnd') ?? '').trim()
  const termCount = String(form.get('termCount') ?? '3')
  const gradeIds = ids(form, 'gradeIds')
  const sectionNames = String(form.get('sectionNames') ?? '').trim()

  const fieldErrors: Record<string, string> = {}
  if (!dateStart) fieldErrors.dateStart = 'Choose the day the year starts.'
  if (!dateEnd) fieldErrors.dateEnd = 'Choose the day the year ends.'
  if (dateStart && dateEnd && dateEnd <= dateStart) {
    fieldErrors.dateEnd = 'The year must end after it starts.'
  }
  if (dateStart && ethiopianYearOf(dateStart) === null) {
    fieldErrors.dateStart = 'That start date could not be read.'
  }
  if (!TERM_COUNTS.has(termCount)) fieldErrors.termCount = 'Choose how the year is divided.'
  if (gradeIds.length === 0) fieldErrors.gradeIds = 'Choose at least one grade.'
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors, ...echo(form) }

  try {
    await runSchoolSetup({
      dateStart,
      dateEnd,
      isCurrent: form.get('isCurrent') === 'on',
      termCount: termCount as '1' | '2' | '3' | '4',
      gradeIds,
      sectionNames,
    })
  } catch (cause) {
    return { error: toOdooError(cause).message, ...echo(form) }
  }

  revalidatePath('/configuration')
  revalidatePath('/academic-years')
  revalidatePath('/classes')
  return { ok: `Academic year ${ethiopianYearOf(dateStart)} is set up.` }
}

/** Add sections to a grade for one year. */
export async function gradeSectionsAction(
  _previous: SetupState,
  form: FormData,
): Promise<SetupState> {
  await requireSession()

  const gradeId = Number(form.get('gradeId'))
  const academicYearId = Number(form.get('academicYearId'))
  const sectionIds = ids(form, 'sectionIds')
  const newSectionNames = String(form.get('newSectionNames') ?? '').trim()

  const fieldErrors: Record<string, string> = {}
  if (!Number.isInteger(gradeId) || gradeId <= 0) fieldErrors.gradeId = 'Choose a grade.'
  if (!Number.isInteger(academicYearId) || academicYearId <= 0) {
    fieldErrors.academicYearId = 'Choose an academic year.'
  }
  if (sectionIds.length === 0 && !newSectionNames) {
    fieldErrors.sectionIds = 'Pick at least one section, or type a new one.'
  }
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors, ...echo(form) }

  try {
    await ensureGradeSections({ gradeId, academicYearId, sectionIds, newSectionNames })
  } catch (cause) {
    return { error: toOdooError(cause).message, ...echo(form) }
  }

  revalidatePath('/configuration')
  revalidatePath('/classes')
  return { ok: 'Sections are in place.' }
}

/**
 * Set the subjects a class studies.
 *
 * Unticking a subject deactivates its curriculum row rather than deleting it —
 * that is the wizard's behaviour, and it is why marks already recorded against
 * a dropped subject survive.
 */
export async function classSubjectsAction(
  _previous: SetupState,
  form: FormData,
): Promise<SetupState> {
  await requireSession()

  const classId = Number(form.get('classId'))
  const subjectIds = ids(form, 'subjectIds')
  const subjectType = String(form.get('subjectType') ?? 'compulsory')
  const maximumMark = Number(form.get('maximumMark'))
  const passMark = Number(form.get('passMark'))

  const fieldErrors: Record<string, string> = {}
  if (!Number.isInteger(classId) || classId <= 0) fieldErrors.classId = 'Choose a class.'
  if (!Number.isFinite(maximumMark) || maximumMark <= 0) {
    fieldErrors.maximumMark = 'The maximum mark must be greater than zero.'
  }
  if (!Number.isFinite(passMark) || passMark < 0 || passMark > maximumMark) {
    fieldErrors.passMark = 'The pass mark must sit between zero and the maximum.'
  }
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors, ...echo(form) }

  try {
    await setClassSubjects({ classId, subjectIds, subjectType, maximumMark, passMark })
  } catch (cause) {
    return { error: toOdooError(cause).message, ...echo(form) }
  }

  revalidatePath('/configuration')
  return {
    ok: subjectIds.length === 0
      ? 'Every subject was removed from that class.'
      : `${subjectIds.length} ${subjectIds.length === 1 ? 'subject' : 'subjects'} set on that class.`,
  }
}
