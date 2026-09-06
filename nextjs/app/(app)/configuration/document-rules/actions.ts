'use server'

import { revalidatePath } from 'next/cache'

import { requireSession } from '@/lib/odoo/auth'
import { toOdooError } from '@/lib/odoo/errors'
import { submitted } from '@/lib/form-values'
import {
  createDocumentRule,
  removeDocumentRule,
  updateDocumentRule,
} from '@/lib/odoo/models/registration'

const RULE_FIELDS = [
  'document_type_id', 'sequence', 'admission_type',
  'grade_from', 'grade_to', 'stream_id', 'required',
] as const

export interface DocumentRuleState {
  error?: string
  ok?: string
  fieldErrors?: Record<string, string>
  /** What was submitted, echoed back so a refusal does not empty the form. */
  values?: Record<(typeof RULE_FIELDS)[number], string>
}

/*
  `required` is submitted twice — a hidden "false" then the checkbox's "true" —
  so the last value wins, matching how `checked()` reads it below.
*/
const echoed = (form: FormData): Record<(typeof RULE_FIELDS)[number], string> => ({
  ...submitted(form, RULE_FIELDS),
  required: String(form.getAll('required').at(-1) ?? ''),
})

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim()
}

function checked(form: FormData, key: string): boolean {
  return String(form.getAll(key).at(-1) ?? '') === 'true'
}

/**
 * A required rule blocks submission for every student it matches, until a
 * document of that type is uploaded and at least in `uploaded` state — which
 * is what `_validate_submission_requirements` looks for.
 */
export async function createDocumentRuleAction(
  _previous: DocumentRuleState,
  form: FormData,
): Promise<DocumentRuleState> {
  await requireSession()

  const documentTypeId = Number(text(form, 'document_type_id'))
  if (!Number.isInteger(documentTypeId) || documentTypeId <= 0) {
    return { fieldErrors: { document_type_id: 'Choose a document type.' }, values: echoed(form) }
  }

  const gradeFrom = Number(text(form, 'grade_from') || '1')
  const gradeTo = Number(text(form, 'grade_to') || '12')
  const fieldErrors: Record<string, string> = {}
  if (!Number.isInteger(gradeFrom) || gradeFrom < 1 || gradeFrom > 12) {
    fieldErrors.grade_from = 'Between 1 and 12.'
  }
  if (!Number.isInteger(gradeTo) || gradeTo < 1 || gradeTo > 12) {
    fieldErrors.grade_to = 'Between 1 and 12.'
  }
  if (!fieldErrors.grade_from && !fieldErrors.grade_to && gradeFrom > gradeTo) {
    fieldErrors.grade_to = 'The last grade cannot be below the first.'
  }
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors, values: echoed(form) }

  const streamId = Number(text(form, 'stream_id'))
  try {
    await createDocumentRule({
      document_type_id: documentTypeId,
      sequence: Number(text(form, 'sequence') || '10'),
      admission_type: text(form, 'admission_type') || 'all',
      grade_from: gradeFrom,
      grade_to: gradeTo,
      stream_id: Number.isInteger(streamId) && streamId > 0 ? streamId : false,
      required: checked(form, 'required'),
    })
  } catch (cause) {
    return { error: toOdooError(cause).message, values: echoed(form) }
  }

  revalidatePath('/configuration/document-rules')
  return { ok: 'Rule added.' }
}

export async function setDocumentRuleActiveAction(
  _previous: DocumentRuleState,
  form: FormData,
): Promise<DocumentRuleState> {
  await requireSession()

  const id = Number(text(form, 'id'))
  if (!Number.isInteger(id) || id <= 0) return { error: 'That rule could not be identified.' }
  const active = text(form, 'active') === 'true'

  try {
    await updateDocumentRule(id, { active })
  } catch (cause) {
    return { error: toOdooError(cause).message }
  }

  revalidatePath('/configuration/document-rules')
  return { ok: active ? 'Rule restored.' : 'Rule retired.' }
}

export async function removeDocumentRuleAction(
  _previous: DocumentRuleState,
  form: FormData,
): Promise<DocumentRuleState> {
  await requireSession()

  const id = Number(text(form, 'id'))
  if (!Number.isInteger(id) || id <= 0) return { error: 'That rule could not be identified.' }

  try {
    await removeDocumentRule(id)
  } catch (cause) {
    return { error: toOdooError(cause).message }
  }

  revalidatePath('/configuration/document-rules')
  return { ok: 'Rule deleted.' }
}
