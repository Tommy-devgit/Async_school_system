'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireSession } from '@/lib/odoo/auth'
import { toOdooError } from '@/lib/odoo/errors'
import { createRoom, updateRoom } from '@/lib/odoo/models/facilities'

/**
 * Creating and editing rooms.
 *
 * Odoo owns every rule this form touches — the unique name, the non-negative
 * capacity — and answers in its own words. The checks below only save a round
 * trip. Nothing here decides who may write either: `school.room` grants create
 * to `group_school_admin` alone and Odoo refuses on submit regardless.
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

const ROOM_FORM = ['name', 'code', 'room_type', 'capacity', 'active'] as const

function collectRoom(form: FormData): {
  values?: Record<string, unknown>
  fieldErrors?: Record<string, string>
} {
  const fieldErrors: Record<string, string> = {}

  const name = text(form, 'name')
  if (!name) fieldErrors.name = 'The room needs a name.'

  const rawCapacity = text(form, 'capacity')
  const capacity = rawCapacity === '' ? 0 : Number(rawCapacity)
  if (!Number.isFinite(capacity) || capacity < 0 || !Number.isInteger(capacity)) {
    // Mirrors the model's CHECK(capacity >= 0); Odoo still enforces it.
    fieldErrors.capacity = 'Capacity must be a whole number, and cannot be negative.'
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }

  return {
    values: {
      name,
      code: text(form, 'code') || false,
      room_type: text(form, 'room_type') || false,
      capacity,
      ...(form.has('active') ? { active: checked(form, 'active') } : {}),
    },
  }
}

export async function createRoomAction(
  _previous: FacilityFormState,
  form: FormData,
): Promise<FacilityFormState> {
  await requireSession()

  const { values, fieldErrors } = collectRoom(form)
  if (fieldErrors) return { fieldErrors, values: submitted(form, ROOM_FORM) }

  let id: number
  try {
    id = await createRoom(values ?? {})
  } catch (cause) {
    // "This room already exists." arrives in Odoo's words, not a guess at them.
    return { error: toOdooError(cause).message, values: submitted(form, ROOM_FORM) }
  }

  revalidatePath('/rooms')
  revalidatePath('/configuration')
  redirect(`/rooms/${id}`)
}

export async function updateRoomAction(
  _previous: FacilityFormState,
  form: FormData,
): Promise<FacilityFormState> {
  await requireSession()

  const id = Number(text(form, 'id'))
  if (!Number.isInteger(id) || id <= 0) return { error: 'That room could not be identified.' }

  const { values, fieldErrors } = collectRoom(form)
  if (fieldErrors) return { fieldErrors, values: submitted(form, ROOM_FORM) }

  try {
    await updateRoom(id, values ?? {})
  } catch (cause) {
    return { error: toOdooError(cause).message, values: submitted(form, ROOM_FORM) }
  }

  revalidatePath('/rooms')
  revalidatePath(`/rooms/${id}`)
  revalidatePath('/configuration')
  redirect(`/rooms/${id}`)
}

