'use client'

import { useActionState, useState } from 'react'
import { EthiopianDateInput } from '@/components/ui/ethiopian-date-input'
import { useFormResponse } from '@/components/ui/form'
import { promoteEnrollmentAction, type PromotionState } from '../actions'

export interface YearChoice {
  id: number
  name: string
}

export interface ClassChoice {
  id: number
  name: string
  yearId: number | null
}

const CONTROL =
  'w-full rounded-[8px] border border-silver bg-white px-2.5 py-1.5 text-[12px] ' +
  'text-graphite focus:border-action-blue focus:outline-none'

/**
 * Promote this student into the next year.
 *
 * The destination class is optional on purpose — Odoo moves the student up one
 * grade keeping their section, and creates that class with the leaving class's
 * subjects if it does not exist yet. Picking one is an override, not a
 * requirement.
 */
export function PromoteForm({
  enrollmentId,
  years,
  classes,
}: {
  enrollmentId: number
  years: YearChoice[]
  classes: ClassChoice[]
}) {
  const [state, formAction, pending] = useActionState<PromotionState, FormData>(
    promoteEnrollmentAction,
    {},
  )
  const [open, setOpen] = useState(false)
  const [yearId, setYearId] = useState('')

  const errors = state.fieldErrors ?? {}

  /*
    Read the rejected submission back before the local state. The year select
    still drives which classes are offered, so its value stays mirrored in
    `yearId`, but the field itself is seeded from the echo — see
    useFormResponse for why a controlled field cannot survive the reset.
  */
  const prior = state.values
  const response = useFormResponse(state)
  const classesInYear = classes.filter((item) => String(item.yearId ?? '') === yearId)

  if (!open) {
    return (
      <div className="rounded-[8px] border border-silver p-3">
        <p className="mb-2.5 text-[12px] text-graphite">
          Promoting completes this enrolment and opens the next year&rsquo;s.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-[9999px] border border-silver px-3.5 py-1.5 text-[12px] font-medium hover:bg-paper"
        >
          Promote student
        </button>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-2.5 rounded-[8px] border border-silver p-3">
      <input type="hidden" name="enrollmentId" value={enrollmentId} />

      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-graphite">
          Next academic year <span className="text-danger">*</span>
        </span>
        <select
          key={`nextYearId-${response}`}
          name="nextYearId"
          defaultValue={prior?.nextYearId ?? yearId}
          onChange={(event) => setYearId(event.target.value)}
          className={CONTROL}
        >
          <option value="">Choose a year…</option>
          {years.map((year) => (
            <option key={year.id} value={year.id}>
              {year.name}
            </option>
          ))}
        </select>
        {errors.nextYearId ? (
          <span role="alert" className="mt-1 block text-[11px] text-danger">
            {errors.nextYearId}
          </span>
        ) : null}
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-graphite">Class</span>
        <select
          key={`nextClassId-${response}`}
          name="nextClassId"
          defaultValue={prior?.nextClassId ?? ''}
          className={CONTROL}
          disabled={!yearId}
        >
          <option value="">Next grade up, same section</option>
          {classesInYear.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-[11px] text-stone">
          {yearId
            ? 'Leave as is unless the student is moving somewhere other than the next grade.'
            : 'Choose a year first.'}
        </span>
      </label>

      <div>
        <span className="mb-1 block text-[11px] font-medium text-graphite">
          Takes effect <span className="text-danger">*</span>
        </span>
        {/* Keyed: it keeps the date in its own state, so a new default only
            reaches it on a remount. */}
        <EthiopianDateInput
          key={`effectiveDate-${response}`}
          name="effectiveDate"
          defaultValue={prior?.effectiveDate ?? ''}
        />
        {errors.effectiveDate ? (
          <span role="alert" className="mt-1 block text-[11px] text-danger">
            {errors.effectiveDate}
          </span>
        ) : null}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[9999px] bg-ink px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-graphite disabled:opacity-50"
        >
          {pending ? 'Promoting…' : 'Confirm promotion'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-[9999px] border border-silver px-3.5 py-1.5 text-[12px] hover:bg-paper"
        >
          Cancel
        </button>
      </div>

      {state.error ? (
        <p role="alert" className="text-[11px] text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
