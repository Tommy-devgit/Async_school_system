'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireSession } from '@/lib/odoo/auth'
import { toOdooError } from '@/lib/odoo/errors'
import { createSubject, updateSubject } from '@/lib/odoo/models/school'

export interface SubjectFormState {
  error?: string
  fieldErrors?: Record<string, string>
  values?: Record<string, string>
}

const FIELDS = ['name', 'code', 'short_name', 'subject_type', 'credit_hours', 'active'] as const

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim()
}

function checked(form: FormData, key: string): boolean {
  return String(form.getAll(key).at(-1) ?? '') === 'true'
}

// Checkbox-aware: see the note in classes/actions.ts.
function submitted(form: FormData): Record<string, string> {
  return Object.fromEntries(
    FIELDS.map((field) => [
      field,
      field === 'active' ? String(checked(form, field)) : String(form.get(field) ?? ''),
    ]),
  )
}

/**
 * Odoo owns the unique name and the non-negative credit hours; these checks
 * only save a round trip. `sequence_code` is assigned by an ir.sequence in
 * `create`, so it is never sent from here.
 */
function collect(form: FormData): {
  values?: Record<string, unknown>
  fieldErrors?: Record<string, string>
} {
  const fieldErrors: Record<string, string> = {}

  const name = text(form, 'name')
  if (!name) fieldErrors.name = 'The subject needs a name.'

  const subjectType = text(form, 'subject_type')
  if (!subjectType) fieldErrors.subject_type = 'Choose a subject type.'

  const rawHours = text(form, 'credit_hours')
  const creditHours = rawHours === '' ? 0 : Number(rawHours)
  if (!Number.isFinite(creditHours) || creditHours < 0) {
    fieldErrors.credit_hours = 'Credit hours cannot be negative.'
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }

  return {
    values: {
      name,
      code: text(form, 'code') || false,
      short_name: text(form, 'short_name') || false,
      subject_type: subjectType,
      credit_hours: creditHours,
      ...(form.has('active') ? { active: checked(form, 'active') } : {}),
    },
  }
}

export async function createSubjectAction(
  _previous: SubjectFormState,
  form: FormData,
): Promise<SubjectFormState> {
  await requireSession()

  const { values, fieldErrors } = collect(form)
  if (fieldErrors) return { fieldErrors, values: submitted(form) }

  try {
    await createSubject(values ?? {})
  } catch (cause) {
    // "A subject with that name already exists." arrives in Odoo's words.
    return { error: toOdooError(cause).message, values: submitted(form) }
  }

  revalidatePath('/subjects')
  redirect('/subjects')
}

export async function updateSubjectAction(
  _previous: SubjectFormState,
  form: FormData,
): Promise<SubjectFormState> {
  await requireSession()

  const id = Number(text(form, 'id'))
  if (!Number.isInteger(id) || id <= 0) return { error: 'That subject could not be identified.' }

  const { values, fieldErrors } = collect(form)
  if (fieldErrors) return { fieldErrors, values: submitted(form) }

  try {
    await updateSubject(id, values ?? {})
  } catch (cause) {
    return { error: toOdooError(cause).message, values: submitted(form) }
  }

  revalidatePath('/subjects')
  redirect('/subjects')
}
