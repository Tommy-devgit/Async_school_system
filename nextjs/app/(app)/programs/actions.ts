'use server'

import { revalidatePath } from 'next/cache'
import { schoolTimeZone } from '@/lib/odoo/school-timezone'
import { toUtc } from '@/lib/school-time'
import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/odoo/auth'
import { toOdooError } from '@/lib/odoo/errors'
import { submitted } from '@/lib/form-values'
import {
  createProgram,
  updateProgram,
  type AudienceType,
  type ProgramIntake,
} from '@/lib/odoo/models/operations'

/**
 * Creating and correcting a program.
 *
 * A program is a scheduled thing the school runs — a meeting, an examination,
 * a training day — targeted at an audience. Until now it could be listed and
 * read but never entered, so every program in the system had to be created in
 * Odoo's own back office.
 *
 * `state` is never written here. Publish, cancel and complete are allowlisted
 * transitions that call the model's own methods, so this only records what the
 * program *is*.
 */

const SCALARS = [
  'name',
  'program_type',
  'audience_type',
  'audience_code',
  'start_date',
  'start_time',
  'end_date',
  'end_time',
  'location',
  'organizer_id',
  'description',
] as const

export interface ProgramFormState {
  error?: string
  fieldErrors?: Record<string, string>
  /** What was submitted, echoed back so a refusal does not empty the form. */
  values?: Record<(typeof SCALARS)[number], string>
  /** The audience selection, which is submitted once per chosen record. */
  selected?: { audience_ids: string[] }
}

const echo = (form: FormData) => ({
  values: submitted(form, SCALARS),
  // `submitted` keeps only the first value of a repeated name, and the audience
  // is submitted once per chosen record.
  selected: {
    audience_ids: form.getAll('audience_ids').filter((v) => typeof v === 'string'),
  },
})

/** Audience types whose value is a set of record ids rather than a code. */
const RECORD_AUDIENCES = new Set<string>([
  'teacher_group',
  'subject_group',
  'class_section',
  'branch_campus',
  'selected_staff',
])

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim()

/**
 * A date and a time as Odoo stores a datetime.
 *
 * The two are collected separately because a single `datetime-local` input is
 * unreadable on a phone, and because the time is far more often left at a
 * round hour than the date is left at today.
 */
async function joinDateTime(date: string, time: string): Promise<string> {
  /*
    Converted, not concatenated. Odoo stores a Datetime in UTC, and sending the
    wall clock verbatim stored a time three hours from the one that was typed —
    which nothing revealed, because reading it back skipped the conversion too.
  */
  if (!date) return ''
  return toUtc(date, time, await schoolTimeZone())
}

async function collect(form: FormData): Promise<{
  intake?: ProgramIntake
  fieldErrors?: Record<string, string>
}> {
  const fieldErrors: Record<string, string> = {}

  const name = text(form, 'name')
  if (!name) fieldErrors.name = 'The program needs a title.'

  const programType = text(form, 'program_type')
  if (!programType) fieldErrors.program_type = 'Choose what kind of program this is.'

  const audienceType = text(form, 'audience_type') as AudienceType
  if (!audienceType) fieldErrors.audience_type = 'Choose who this is for.'

  /*
    Odoo's `_check_audience_values` refuses a program whose audience type has
    no value against it, and says so in its own words. Catching it here saves a
    round trip and puts the message on the field rather than above the form.
  */
  const isRecordAudience = RECORD_AUDIENCES.has(audienceType)
  const audienceValue: string | number[] = isRecordAudience
    ? form.getAll('audience_ids').map(Number).filter(Number.isFinite)
    : text(form, 'audience_code')

  if (audienceType && audienceType !== 'all_staff' && audienceValue.length === 0) {
    fieldErrors.audience_value = 'Choose at least one audience value.'
  }

  const startDate = text(form, 'start_date')
  const endDate = text(form, 'end_date')
  if (!startDate) fieldErrors.start_date = 'Give the program a start date.'
  if (!endDate) fieldErrors.end_date = 'Give the program an end date.'

  const start = await joinDateTime(startDate, text(form, 'start_time'))
  const end = await joinDateTime(endDate, text(form, 'end_time'))
  if (start && end && end <= start) {
    // Mirrors CHECK(end_datetime > start_datetime); Odoo enforces it either way.
    fieldErrors.end_date = 'The program must end after it starts.'
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }

  const organizerId = Number(text(form, 'organizer_id'))

  return {
    intake: {
      name,
      program_type: programType,
      audience_type: audienceType,
      audience_value: audienceValue,
      start_datetime: start,
      end_datetime: end,
      location: text(form, 'location'),
      organizer_id: Number.isInteger(organizerId) && organizerId > 0 ? organizerId : undefined,
      description: text(form, 'description'),
    },
  }
}

export async function createProgramAction(
  _previous: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  await requireSession()

  const { intake, fieldErrors } = await collect(form)
  if (fieldErrors) return { fieldErrors, ...echo(form) }

  let id: number
  try {
    id = await createProgram(intake!)
  } catch (cause) {
    return { error: toOdooError(cause).message, ...echo(form) }
  }

  revalidatePath('/programs')
  revalidatePath('/programs/calendar')
  redirect(`/programs/${id}`)
}

export async function updateProgramAction(
  _previous: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  await requireSession()

  const id = Number(text(form, 'id'))
  if (!Number.isInteger(id) || id <= 0) return { error: 'That program could not be identified.' }

  const { intake, fieldErrors } = await collect(form)
  if (fieldErrors) return { fieldErrors, ...echo(form) }

  try {
    await updateProgram(id, intake!)
  } catch (cause) {
    return { error: toOdooError(cause).message, ...echo(form) }
  }

  revalidatePath('/programs')
  revalidatePath('/programs/calendar')
  revalidatePath(`/programs/${id}`)
  redirect(`/programs/${id}`)
}
