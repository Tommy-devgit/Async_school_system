'use client'

import { useActionState, useState } from 'react'
import { Badge, Button, Cell, DataTable, EmptyState, Row } from '@/components/ui'
import { DateText } from '@/components/ui'
import {
  Field,
  FormError,
  FormResponse,
  FormSuccess,
  INPUT_CLASS,
  SelectField,
} from '@/components/ui/form'
import { authorizeOverrideAction, type OverrideState } from '../actions'

/**
 * Authorised exceptions on one enrolment (SRS BR-03).
 *
 * An override is a permanent audit record, not a setting: Odoo stamps who
 * approved it and when, and refuses to delete one — so nothing here offers to.
 * Creating one requires the director group and that overrides are enabled in
 * School Settings; both are re-checked by Odoo on write.
 */
export function OverrideSection({
  enrollmentId,
  overrides,
  operations,
  canAuthorize,
}: {
  enrollmentId: number
  overrides: Array<{
    id: number
    operation: string
    reason: string
    approvedBy: string
    approvedAt: string
    active: boolean
  }>
  operations: Array<{ value: string; label: string }>
  canAuthorize: boolean
}) {
  const [state, formAction, pending] = useActionState<OverrideState, FormData>(
    authorizeOverrideAction,
    {},
  )
  const [open, setOpen] = useState(false)
  const errors = state.fieldErrors ?? {}

  return (
    <div>
      {overrides.length === 0 ? (
        <EmptyState
          title="No overrides"
          hint="Capacity and roll-number rules apply to this enrolment as written."
        />
      ) : (
        <DataTable columns={['Override', 'Reason', 'Approved by', 'When']}>
          {overrides.map((override) => (
            <Row key={override.id}>
              <Cell strong>
                <div className="flex flex-wrap items-center gap-1.5">
                  {override.operation}
                  {override.active ? null : <Badge tone="muted">Inactive</Badge>}
                </div>
              </Cell>
              <Cell>{override.reason}</Cell>
              <Cell>{override.approvedBy}</Cell>
              <Cell>
                <DateText value={override.approvedAt} withTime />
              </Cell>
            </Row>
          ))}
        </DataTable>
      )}

      <div className="border-t border-silver p-6">
        <FormError>{state.error}</FormError>
        <FormSuccess>{state.ok}</FormSuccess>

        {!canAuthorize ? (
          <p className="text-[12px] text-slate">
            Only a principal or school administrator can authorise an override.
          </p>
        ) : !open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-[9999px] border border-silver px-4 py-2 text-[13px] hover:bg-paper"
          >
            Authorise an override
          </button>
        ) : (
          <FormResponse state={state}>
            <form action={formAction} className="space-y-4">
              <input type="hidden" name="enrollmentId" value={enrollmentId} />
              <SelectField
                label="What is being overridden"
                name="operation"
                required
                options={operations}
                error={errors.operation}
              />
              <Field
                label="Reason"
                htmlFor="reason"
                required
                error={errors.reason}
                hint="Recorded permanently against your name. Odoo does not allow an override to be deleted."
              >
                <textarea id="reason" name="reason" rows={2} className={INPUT_CLASS} />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" pending={pending}>
                  {pending ? 'Recording…' : 'Authorise'}
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
        )}
      </div>
    </div>
  )
}
