'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireSession } from '@/lib/odoo/auth'
import { toOdooError } from '@/lib/odoo/errors'
import { submitted } from '@/lib/form-values'
import { overlappingBands } from '@/lib/grading-coverage'
import {
  addBand,
  createGradingScheme,
  removeBand,
  updateGradingScheme,
  activateForReportCards,
  type BandIntake,
} from '@/lib/odoo/models/grading'

/**
 * Nothing here decides who may act. Odoo re-checks the ACL and, for the active
 * scheme, `action_use_for_report_cards` re-checks the administrator group. The
 * checks below only save a round trip and say which band is wrong.
 */

export interface BandDraft {
  name: string
  minimum: string
  maximum: string
  remark: string
}

export interface GradingFormState {
  error?: string
  ok?: string
  fieldErrors?: Record<string, string>
  values?: { name: string; pass_percentage: string }
  bands?: BandDraft[]
  /** The single band the add-a-band form submitted, echoed back on a refusal. */
  band?: Record<(typeof BAND_FIELDS)[number], string>
}

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim()
}

/** Band inputs are posted as parallel arrays, so a row is never mis-paired. */
function draftBands(form: FormData): BandDraft[] {
  const names = form.getAll('band_name').map(String)
  const minimums = form.getAll('band_min').map(String)
  const maximums = form.getAll('band_max').map(String)
  const remarks = form.getAll('band_remark').map(String)
  return names.map((name, index) => ({
    name: name.trim(),
    minimum: (minimums[index] ?? '').trim(),
    maximum: (maximums[index] ?? '').trim(),
    remark: (remarks[index] ?? '').trim(),
  }))
}

function parseBands(drafts: BandDraft[]): { bands?: BandIntake[]; error?: string } {
  const bands: BandIntake[] = []

  for (const [index, draft] of drafts.entries()) {
    const row = index + 1
    if (!draft.name) return { error: `Band ${row} has no grade name.` }

    const minimum = Number(draft.minimum)
    const maximum = Number(draft.maximum)
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
      return { error: `Band ${row} needs a numeric range.` }
    }
    if (minimum < 0 || maximum > 100) {
      return { error: `Band ${row} falls outside 0–100.` }
    }

    bands.push({
      name: draft.name,
      minimum_percentage: minimum,
      maximum_percentage: maximum,
      remark: draft.remark || undefined,
    })
  }

  const overlap = overlappingBands(bands)
  if (overlap) return { error: overlap }

  return { bands }
}

export async function createSchemeAction(
  _previous: GradingFormState,
  form: FormData,
): Promise<GradingFormState> {
  await requireSession()

  const name = text(form, 'name')
  const passPercentage = text(form, 'pass_percentage')
  const drafts = draftBands(form)
  const echo = { values: { name, pass_percentage: passPercentage }, bands: drafts }

  const fieldErrors: Record<string, string> = {}
  if (!name) fieldErrors.name = 'Give the scheme a name.'

  const pass = Number(passPercentage)
  if (!Number.isFinite(pass) || pass < 0 || pass > 100) {
    fieldErrors.pass_percentage = 'The pass mark must be between 0 and 100.'
  }
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors, ...echo }

  const parsed = parseBands(drafts)
  if (parsed.error || !parsed.bands) return { error: parsed.error, ...echo }

  let id: number
  try {
    id = await createGradingScheme({
      name,
      pass_percentage: pass,
      bands: parsed.bands,
    })
  } catch (cause) {
    return { error: toOdooError(cause).message, ...echo }
  }

  revalidatePath('/configuration/grading')
  redirect(`/configuration/grading/${id}`)
}

const BAND_FIELDS = ['band_name', 'band_min', 'band_max', 'band_remark'] as const

export async function addBandAction(
  _previous: GradingFormState,
  form: FormData,
): Promise<GradingFormState> {
  await requireSession()

  const schemeId = Number(text(form, 'schemeId'))
  if (!Number.isInteger(schemeId) || schemeId <= 0) {
    return { error: 'That scheme could not be identified.' }
  }

  const parsed = parseBands([
    {
      name: text(form, 'band_name'),
      minimum: text(form, 'band_min'),
      maximum: text(form, 'band_max'),
      remark: text(form, 'band_remark'),
    },
  ])
  // Echoed on both refusals: "bands cannot overlap" is the common one here,
  // and it is not something the user could work out before typing the band.
  const band = submitted(form, BAND_FIELDS)

  if (parsed.error || !parsed.bands?.length) return { error: parsed.error, band }

  try {
    await addBand(schemeId, parsed.bands[0])
  } catch (cause) {
    // "Grading bands cannot overlap." and the 0–100 range constraint.
    return { error: toOdooError(cause).message, band }
  }

  revalidatePath(`/configuration/grading/${schemeId}`)
  return { ok: 'Band added.' }
}

export async function removeBandAction(
  _previous: GradingFormState,
  form: FormData,
): Promise<GradingFormState> {
  await requireSession()

  const id = Number(text(form, 'id'))
  const schemeId = Number(text(form, 'schemeId'))
  if (!Number.isInteger(id) || id <= 0) return { error: 'That band could not be identified.' }

  try {
    await removeBand(id)
  } catch (cause) {
    return { error: toOdooError(cause).message }
  }

  revalidatePath(`/configuration/grading/${schemeId}`)
  return { ok: 'Band removed.' }
}

/**
 * Make a scheme the one report cards and published assessments are graded by.
 *
 * The coverage check here is the same rule Odoo applies, run early only so the
 * page can name the gap. Odoo still has the final say.
 */
export async function activateSchemeAction(
  _previous: GradingFormState,
  form: FormData,
): Promise<GradingFormState> {
  await requireSession()

  const id = Number(text(form, 'id'))
  if (!Number.isInteger(id) || id <= 0) return { error: 'That scheme could not be identified.' }

  try {
    await activateForReportCards(id)
  } catch (cause) {
    return { error: toOdooError(cause).message }
  }

  revalidatePath('/configuration/grading')
  revalidatePath(`/configuration/grading/${id}`)
  revalidatePath('/report-cards')
  return { ok: 'Report cards and published assessments now use this scheme.' }
}

/** Retire a scheme, or bring one back. Odoo refuses to activate an archived one. */
export async function setSchemeActiveAction(
  _previous: GradingFormState,
  form: FormData,
): Promise<GradingFormState> {
  await requireSession()

  const id = Number(text(form, 'id'))
  if (!Number.isInteger(id) || id <= 0) return { error: 'That scheme could not be identified.' }
  const active = text(form, 'active') === 'true'

  try {
    await updateGradingScheme(id, { active })
  } catch (cause) {
    return { error: toOdooError(cause).message }
  }

  revalidatePath('/configuration/grading')
  revalidatePath(`/configuration/grading/${id}`)
  return { ok: active ? 'Scheme restored.' : 'Scheme retired.' }
}
