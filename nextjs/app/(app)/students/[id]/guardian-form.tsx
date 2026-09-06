'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormResponse } from '@/components/ui/form'
import { addGuardianAction, editGuardianAction, type GuardianFormState } from '../actions'

interface Option {
  value: string
  label: string
}

const INPUT =
  'w-full rounded-[8px] border border-silver bg-white px-3 py-2 text-[12px] text-graphite ' +
  'placeholder:text-stone focus:border-action-blue focus:outline-none'

/**
 * Add a guardian to a student.
 *
 * Odoo owns identity resolution (`_ensure_guardian`'s pattern: reuse a
 * matching contact by name and phone, or create one) and the single-primary
 * constraint. This form just collects the intake fields Odoo already asks
 * for at registration — nothing here is validated beyond "not empty".
 */
export function AddGuardianForm({
  studentId,
  relationships,
}: {
  studentId: number
  relationships: Option[]
}) {
  const [state, formAction, pending] = useActionState<GuardianFormState, FormData>(
    addGuardianAction,
    {},
  )
  const prior = state.values ?? {}
  const err = state.fieldErrors ?? {}

  return (
    <form
      action={formAction}
      className="mt-3 grid gap-2 border-t border-silver pt-3 sm:grid-cols-2"
    >
      <input type="hidden" name="studentId" value={studentId} />

      <div>
        <label htmlFor="guardian-name" className="mb-1 block text-[11px] text-stone">
          Name<span className="ml-0.5 text-danger">*</span>
        </label>
        <input
          id="guardian-name"
          name="name"
          className={INPUT}
          defaultValue={prior.name ?? ''}
        />
        {err.name ? <p className="mt-1 text-[11px] text-danger">{err.name}</p> : null}
      </div>

      <div>
        <label htmlFor="guardian-relationship" className="mb-1 block text-[11px] text-stone">
          Relationship<span className="ml-0.5 text-danger">*</span>
        </label>
        <select
          id="guardian-relationship"
          name="relationship"
          className={INPUT}
          defaultValue={prior.relationship ?? relationships[0]?.value ?? ''}
        >
          {relationships.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {err.relationship ? (
          <p className="mt-1 text-[11px] text-danger">{err.relationship}</p>
        ) : null}
      </div>

      <div>
        <label htmlFor="guardian-phone" className="mb-1 block text-[11px] text-stone">
          Phone
        </label>
        <input
          id="guardian-phone"
          name="phone"
          className={INPUT}
          defaultValue={prior.phone ?? ''}
        />
      </div>

      <div>
        <label htmlFor="guardian-occupation" className="mb-1 block text-[11px] text-stone">
          Occupation
        </label>
        <input
          id="guardian-occupation"
          name="occupation"
          className={INPUT}
          defaultValue={prior.occupation ?? ''}
        />
      </div>

      <label className="flex items-center gap-2 text-[12px] text-graphite sm:col-span-2">
        <input type="checkbox" name="is_primary" className="h-3.5 w-3.5" />
        Primary contact
      </label>

      {state.error ? (
        <p role="alert" className="text-[11px] text-danger sm:col-span-2">
          {state.error}
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[9999px] border border-silver px-3.5 py-1.5 text-[12px] hover:bg-paper disabled:opacity-50"
        >
          {pending ? 'Adding…' : 'Add guardian'}
        </button>
      </div>
    </form>
  )
}

/**
 * Edit one guardian link in place. Only relationship, phone, occupation and
 * primary are writable here — the contact itself (partner_id) never changes,
 * matching the backend's own behaviour.
 */
export function EditGuardianRow({
  studentId,
  guardianId,
  relationship,
  phone,
  occupation,
  isPrimary,
  relationships,
  onDone,
}: {
  studentId: number
  guardianId: number
  relationship: string
  phone: string
  occupation: string
  isPrimary: boolean
  relationships: Option[]
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState<GuardianFormState, FormData>(
    editGuardianAction,
    {},
  )
  // Closes the row on a successful save, but not on first mount (state
  // starts as `{}` too) and not while an error is showing.
  const submittedOnce = useRef(false)
  useEffect(() => {
    if (pending) submittedOnce.current = true
    if (!pending && submittedOnce.current && !state.error) {
      onDone()
    }
  }, [pending, state.error, onDone])

  /*
    A refused save re-renders this row from scratch, so it reads back what was
    submitted before falling back to the stored guardian. Without it a phone
    number corrected in the same edit as a clashing primary was thrown away
    along with the refusal.
  */
  const prior = state.values
  const response = useFormResponse(state)

  return (
    <form action={formAction} className="grid gap-2 border-t border-silver bg-paper/60 p-3 sm:grid-cols-4">
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="guardianId" value={guardianId} />

      <select
        key={`relationship-${response}`}
        name="relationship"
        defaultValue={prior?.relationship ?? relationship}
        className={INPUT}
        aria-label="Relationship"
      >
        {relationships.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <input
        name="phone"
        defaultValue={prior?.phone ?? phone}
        className={INPUT}
        aria-label="Phone"
        placeholder="Phone"
      />

      <input
        name="occupation"
        defaultValue={prior?.occupation ?? occupation}
        className={INPUT}
        aria-label="Occupation"
        placeholder="Occupation"
      />

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-[11px] text-graphite">
          <input
            type="checkbox"
            name="is_primary"
            defaultChecked={prior ? prior.is_primary === 'on' : isPrimary}
            className="h-3.5 w-3.5"
          />
          Primary
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-[9999px] bg-ink px-3 py-1 text-[11px] text-white hover:bg-graphite disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="text-[11px] text-stone hover:text-graphite"
        >
          Cancel
        </button>
      </div>

      {state.error ? (
        <p role="alert" className="text-[11px] text-danger sm:col-span-4">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}

interface GuardianRowData {
  id: number
  name: string | false
  relationship: string | false
  is_primary: boolean
  phone: string | false
  occupation: string | false
}

/**
 * The whole guardians card body: table with per-row edit, plus the add form.
 * Owns which row (if any) is being edited — only one at a time.
 */
export function GuardiansSection({
  studentId,
  guardians,
  relationships,
  canWrite,
}: {
  studentId: number
  guardians: GuardianRowData[]
  relationships: Option[]
  canWrite: boolean
}) {
  const [editingId, setEditingId] = useState<number | null>(null)

  return (
    <div>
      {guardians.map((row) => (
        <div key={row.id}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-silver py-2.5 first:border-0">
            <div className="min-w-0">
              <span className="text-[13px] font-medium text-graphite">{row.name || '—'}</span>
              <span className="ml-2 text-[11px] text-stone">
                {formatSelectionLabel(row.relationship, relationships)}
                {row.is_primary ? ' · Primary' : ''}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[12px] text-slate">
              <span>{row.phone || '—'}</span>
              <span className="hidden sm:inline">{row.occupation || '—'}</span>
              {canWrite ? (
                <button
                  type="button"
                  onClick={() => setEditingId(editingId === row.id ? null : row.id)}
                  className="text-[11px] text-action-blue hover:underline"
                >
                  {editingId === row.id ? 'Close' : 'Edit'}
                </button>
              ) : null}
            </div>
          </div>
          {editingId === row.id ? (
            <EditGuardianRow
              studentId={studentId}
              guardianId={row.id}
              relationship={String(row.relationship || relationships[0]?.value || '')}
              phone={String(row.phone || '')}
              occupation={String(row.occupation || '')}
              isPrimary={row.is_primary}
              relationships={relationships}
              onDone={() => setEditingId(null)}
            />
          ) : null}
        </div>
      ))}

      {canWrite ? <AddGuardianForm studentId={studentId} relationships={relationships} /> : null}
    </div>
  )
}

function formatSelectionLabel(value: string | false, options: Option[]): string {
  if (!value) return '—'
  return options.find((o) => o.value === value)?.label ?? value
}
