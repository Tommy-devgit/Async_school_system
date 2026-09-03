'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireSession } from '@/lib/odoo/auth'
import { toOdooError } from '@/lib/odoo/errors'
import { createBranch, updateBranch } from '@/lib/odoo/models/facilities'

/**
 * Creating and editing branches.
 *
 * `school.campus` is readable by nearly every school role and writable by the
 * administrator alone. Odoo keeps the name unique and says so in its own words
 * when it is not.
 */

export interface FacilityFormState {
  error?: string
  fieldErrors?: Record<string, string>
  values?: Record<string, string>
}

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim()
}

/*
  An unchecked checkbox submits nothing at all, so a hidden "false" is paired
  with every box and the last value wins. Without that, clearing "Active" would
  send no key and Odoo would leave the record as it was.
*/
function checked(form: FormData, key: string): boolean {
  return String(form.getAll(key).at(-1) ?? '') === 'true'
}

function submitted(form: FormData, fields: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    fields.map((field) => [
      field,
      field === 'active' ? String(checked(form, field)) : String(form.get(field) ?? ''),
    ]),
  )
}

const BRANCH_FORM = ['name', 'code', 'address', 'active'] as const

function collectBranch(form: FormData): {
  values?: Record<string, unknown>
  fieldErrors?: Record<string, string>
} {
  const name = text(form, 'name')
  if (!name) return { fieldErrors: { name: 'The branch needs a name.' } }

  return {
    values: {
      name,
      code: text(form, 'code') || false,
      address: text(form, 'address') || false,
      ...(form.has('active') ? { active: checked(form, 'active') } : {}),
    },
  }
}

export async function createBranchAction(
  _previous: FacilityFormState,
  form: FormData,
): Promise<FacilityFormState> {
  await requireSession()

  const { values, fieldErrors } = collectBranch(form)
  if (fieldErrors) return { fieldErrors, values: submitted(form, BRANCH_FORM) }

  let id: number
  try {
    id = await createBranch(values ?? {})
  } catch (cause) {
    return { error: toOdooError(cause).message, values: submitted(form, BRANCH_FORM) }
  }

  revalidatePath('/branches')
  revalidatePath('/configuration')
  redirect(`/branches/${id}`)
}

export async function updateBranchAction(
  _previous: FacilityFormState,
  form: FormData,
): Promise<FacilityFormState> {
  await requireSession()

  const id = Number(text(form, 'id'))
  if (!Number.isInteger(id) || id <= 0) return { error: 'That branch could not be identified.' }

  const { values, fieldErrors } = collectBranch(form)
  if (fieldErrors) return { fieldErrors, values: submitted(form, BRANCH_FORM) }

  try {
    await updateBranch(id, values ?? {})
  } catch (cause) {
    return { error: toOdooError(cause).message, values: submitted(form, BRANCH_FORM) }
  }

  revalidatePath('/branches')
  revalidatePath(`/branches/${id}`)
  revalidatePath('/configuration')
  redirect(`/branches/${id}`)
}

