'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui'
import { EthiopianDateInput } from '@/components/ui/ethiopian-date-input'
import {
  Field,
  FormError,
  FormSuccess,
  INPUT_CLASS,
  TextField,
  useFormResponse,
} from '@/components/ui/form'
import { correctAcademicYearAction, type YearCorrectionState } from '../actions'

/**
 * The way into a closed or archived year.
 *
 * Odoo's `write` refuses any field but state, is_current and active on these,
 * unless the `school.academic.year.correction` wizard supplies the authorized
 * context — and that wizard re-checks the director group and posts the reason
 * to the record's chatter. The reason is required for that audit trail, which
 * is the whole point of not editing the fields directly.
 */
export function YearCorrectionForm({
  yearId,
  name,
  dateStart,
  dateEnd,
}: {
  yearId: number
  name: string
  dateStart: string
  dateEnd: string
}) {
  const [state, formAction, pending] = useActionState<YearCorrectionState, FormData>(
    correctAcademicYearAction,
    {},
  )
  const [open, setOpen] = useState(false)
  const errors = state.fieldErrors ?? {}

  // The rejected submission, so a refusal does not cost the written reason.
  const prior = state.values
  const response = useFormResponse(state)

  if (!open) {
    return (
      <div className="space-y-3">
        <FormSuccess>{state.ok}</FormSuccess>
        <p className="text-[12px] text-slate">
          This year is closed, so its dates and name are read-only. A principal or administrator
          can still correct them, with a reason recorded on the year.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-[9999px] border border-silver px-4 py-2 text-[13px] hover:bg-paper"
        >
          Correct this year
        </button>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={yearId} />
      <FormError>{state.error}</FormError>
      <FormSuccess>{state.ok}</FormSuccess>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Name"
          name="name"
          required
          defaultValue={prior?.name ?? name}
          error={errors.name}
        />
        <div className="hidden sm:block" />
        <Field label="Starts on" htmlFor="date_start" required error={errors.date_start}>
          {/* Keyed: it keeps the date in its own state, so a new default only
              reaches it on a remount. */}
          <EthiopianDateInput
            key={`date_start-${response}`}
            id="date_start"
            name="date_start"
            defaultValue={prior?.date_start ?? dateStart}
          />
        </Field>
        <Field label="Ends on" htmlFor="date_end" required error={errors.date_end}>
          <EthiopianDateInput
            key={`date_end-${response}`}
            id="date_end"
            name="date_end"
            defaultValue={prior?.date_end ?? dateEnd}
          />
        </Field>
      </div>

      <Field
        label="Reason"
        htmlFor="reason"
        required
        error={errors.reason}
        hint="Written to the year's history, where it stays."
      >
        <textarea
          id="reason"
          name="reason"
          rows={3}
          defaultValue={prior?.reason ?? ''}
          className={INPUT_CLASS}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" pending={pending}>
          {pending ? 'Recording…' : 'Record correction'}
        </Button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-[9999px] border border-silver px-4 py-2 text-[13px] hover:bg-paper"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
