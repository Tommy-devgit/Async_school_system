'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui'
import { EthiopianDateInput } from '@/components/ui/ethiopian-date-input'
import {
  Field,
  FormError,
  FormResponse,
  FormSuccess,
  INPUT_CLASS,
  SelectField,
  useFormResponse,
} from '@/components/ui/form'
import { transferEnrollmentAction, type TransferState } from '../actions'

/**
 * Moving a student between classes within one academic year.
 *
 * This is not an edit of the enrolment: Odoo closes the current placement and
 * opens a new one, so the student's history says where they sat and when. The
 * class list is already narrowed to the enrolment's own year, because a
 * cross-year move is a promotion, not a transfer.
 */
export function TransferForm({
  enrollmentId,
  currentClass,
  classes,
}: {
  enrollmentId: number
  currentClass: string
  classes: Array<{ id: number; name: string; full: boolean }>
}) {
  const [state, formAction, pending] = useActionState<TransferState, FormData>(
    transferEnrollmentAction,
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
          Currently in {currentClass}. A transfer closes that placement and opens a new one in
          the same academic year.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-[9999px] border border-silver px-4 py-2 text-[13px] hover:bg-paper"
        >
          Transfer to another class
        </button>
      </div>
    )
  }

  return (
    <FormResponse state={state}>
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="enrollmentId" value={enrollmentId} />
        <FormError>{state.error}</FormError>

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="New class"
            name="new_class_id"
            required
            defaultValue={prior?.new_class_id ?? ''}
            error={errors.new_class_id}
            options={classes.map((option) => ({
              value: String(option.id),
              // Odoo refuses a full class without a capacity override, so saying
              // so here saves a round trip to find out.
              label: option.full ? `${option.name} — full` : option.name,
            }))}
          />
          <Field
            label="Effective from"
            htmlFor="effective_date"
            required
            error={errors.effective_date}
            hint="Cannot be before the current placement began."
          >
            {/* Keyed: it keeps the date in its own state, so a new default
                only reaches it on a remount. */}
            <EthiopianDateInput
              key={`effective_date-${response}`}
              id="effective_date"
              name="effective_date"
              defaultValue={prior?.effective_date ?? ''}
            />
          </Field>
        </div>

        <Field
          label="Reason"
          htmlFor="reason"
          required
          error={errors.reason}
          hint="Kept with the placement record."
        >
          <textarea
            id="reason"
            name="reason"
            rows={2}
            defaultValue={prior?.reason ?? ''}
            className={INPUT_CLASS}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" pending={pending}>
            {pending ? 'Transferring…' : 'Transfer'}
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
    </FormResponse>
  )
}
