'use server'

import { revalidatePath } from 'next/cache'

import { requireSession } from '@/lib/odoo/auth'
import { toOdooError } from '@/lib/odoo/errors'
import {
  collectVocabulary,
  createVocabulary,
  getVocabulary,
  updateVocabulary,
  type FieldErrors,
} from '@/lib/odoo/models/vocabulary'

/**
 * Creating and editing one row of an academic vocabulary.
 *
 * The browser posts a vocabulary key, never a model name — the key is resolved
 * against the spec table here, and an unknown one is refused rather than
 * passed through. That keeps these two actions from being a general-purpose
 * write endpoint onto any Odoo model.
 *
 * Odoo owns every rule these forms touch: unique codes, one grade per level,
 * a shift whose end is after its start, a job title unique within its
 * department. Each answers in its own words, so nothing here guesses at the
 * message.
 */

export interface VocabularyFormState {
  error?: string
  fieldErrors?: FieldErrors
  /** Which row the message belongs to — 'new' for the add form. */
  target?: string
  /** Set on success so the form can say so without a full navigation. */
  saved?: string
  /**
   * What was submitted, echoed back so a refusal does not empty the form.
   * Keyed by the spec's own field names, because this screen renders whatever
   * fields the vocabulary declares rather than a fixed set.
   */
  values?: Record<string, string>
}

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? '')
}

/*
  An unchecked checkbox submits nothing at all, so every box is paired with a
  hidden "false" and the last value wins. Without that, clearing "Active" would
  send no key and Odoo would leave the record as it was.
*/
function lastValue(form: FormData, key: string): string {
  return String(form.getAll(key).at(-1) ?? '')
}

/*
  Every field read the way the action reads it — last value wins, so a checkbox
  paired with its hidden "false" echoes what the user left it on rather than
  the hidden default sitting in front of it.
*/
function echoed(spec: { fields: ReadonlyArray<{ name: string }> }, form: FormData) {
  return Object.fromEntries(spec.fields.map((field) => [field.name, lastValue(form, field.name)]))
}

function resolve(form: FormData) {
  const key = text(form, 'vocabulary')
  const spec = getVocabulary(key)
  return { key, spec }
}

export async function createVocabularyRowAction(
  _previous: VocabularyFormState,
  form: FormData,
): Promise<VocabularyFormState> {
  await requireSession()

  const { key, spec } = resolve(form)
  if (!spec) return { error: 'That configuration list does not exist.', target: 'new' }

  const { values, fieldErrors } = collectVocabulary(
    spec,
    (name) => lastValue(form, name),
    (name) => form.has(name),
  )
  if (fieldErrors) return { fieldErrors, target: 'new', values: echoed(spec, form) }

  try {
    await createVocabulary(spec, values ?? {})
  } catch (cause) {
    return { error: toOdooError(cause).message, target: 'new', values: echoed(spec, form) }
  }

  revalidatePath(`/configuration/vocabulary/${key}`)
  revalidatePath('/configuration')
  return { saved: `${spec.singular} added`, target: 'new' }
}

export async function updateVocabularyRowAction(
  _previous: VocabularyFormState,
  form: FormData,
): Promise<VocabularyFormState> {
  await requireSession()

  const { key, spec } = resolve(form)
  if (!spec) return { error: 'That configuration list does not exist.' }

  const id = Number(text(form, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    return { error: 'That row could not be identified.' }
  }

  const { values, fieldErrors } = collectVocabulary(
    spec,
    (name) => lastValue(form, name),
    (name) => form.has(name),
  )
  if (fieldErrors) return { fieldErrors, target: String(id), values: echoed(spec, form) }

  try {
    await updateVocabulary(spec, id, values ?? {})
  } catch (cause) {
    return { error: toOdooError(cause).message, target: String(id), values: echoed(spec, form) }
  }

  revalidatePath(`/configuration/vocabulary/${key}`)
  revalidatePath('/configuration')
  return { saved: 'saved', target: String(id) }
}
