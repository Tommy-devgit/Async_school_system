'use client'

import { useActionState } from 'react'
import { Button, Cell, DataTable, EmptyState, Row } from '@/components/ui'
import { FormError, FormSuccess, INPUT_CLASS } from '@/components/ui/form'
import { addOptionAction, removeOptionAction, type QuestionFormState } from '../actions'

/**
 * The choices a selection question offers.
 *
 * `value` is what an answer stores; `name` is the label and is translatable,
 * so the two are collected separately rather than derived from one another.
 * Odoo's ondelete is `restrict`, so an option an answer already points at
 * cannot be removed — that refusal is surfaced rather than worked around.
 */
export function QuestionOptions({
  questionId,
  options,
  canWrite,
}: {
  questionId: number
  options: Array<{ id: number; name: string; value: string; sequence: number }>
  canWrite: boolean
}) {
  const [addState, addAction, addPending] = useActionState<QuestionFormState, FormData>(
    addOptionAction,
    {},
  )
  const [removeState, removeAction] = useActionState<QuestionFormState, FormData>(
    removeOptionAction,
    {},
  )
  const errors = addState.fieldErrors ?? {}
  // The rejected submission, so a refused option keeps what was typed.
  const prior = addState.values

  return (
    <div>
      {options.length === 0 ? (
        <EmptyState
          title="No choices yet"
          hint="A selection question with no choices cannot be answered."
        />
      ) : (
        <DataTable columns={['Label', 'Stored value', 'Order', '']}>
          {options.map((option) => (
            <Row key={option.id}>
              <Cell strong>{option.name}</Cell>
              <Cell>
                <span className="tabular">{option.value}</span>
              </Cell>
              <Cell numeric>{option.sequence}</Cell>
              <Cell>
                {canWrite ? (
                  <form action={removeAction}>
                    <input type="hidden" name="id" value={option.id} />
                    <input type="hidden" name="questionId" value={questionId} />
                    <button
                      type="submit"
                      className="text-[12px] text-slate underline underline-offset-2 hover:text-danger"
                    >
                      Remove
                    </button>
                  </form>
                ) : null}
              </Cell>
            </Row>
          ))}
        </DataTable>
      )}

      {canWrite ? (
        <form action={addAction} className="space-y-3 border-t border-silver p-6">
          <p className="text-[12px] font-medium text-graphite">Add a choice</p>
          <FormError>{addState.error ?? removeState.error}</FormError>
          <FormSuccess>{addState.ok ?? removeState.ok}</FormSuccess>
          <input type="hidden" name="questionId" value={questionId} />
          <div className="grid gap-2 sm:grid-cols-[2fr_2fr_5rem]">
            <div>
              <input
                name="name"
                required
                defaultValue={prior?.name ?? ''}
                aria-label="Label"
                placeholder="Label"
                className={INPUT_CLASS}
              />
              {errors.name ? (
                <p role="alert" className="mt-1 text-[11px] text-danger">
                  {errors.name}
                </p>
              ) : null}
            </div>
            <div>
              <input
                name="value"
                required
                defaultValue={prior?.value ?? ''}
                aria-label="Stored value"
                placeholder="Stored value"
                className={INPUT_CLASS}
              />
              {errors.value ? (
                <p role="alert" className="mt-1 text-[11px] text-danger">
                  {errors.value}
                </p>
              ) : null}
            </div>
            <input
              name="sequence"
              type="number"
              min={0}
              defaultValue={prior ? prior.sequence : 10}
              aria-label="Order"
              className={INPUT_CLASS}
            />
          </div>
          <Button type="submit" pending={addPending}>
            {addPending ? 'Adding…' : 'Add choice'}
          </Button>
        </form>
      ) : null}
    </div>
  )
}
