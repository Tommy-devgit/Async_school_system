'use client'

import { useActionState } from 'react'
import { Button, Cell, DataTable, EmptyState, Row } from '@/components/ui'
import { FormError, FormSuccess, INPUT_CLASS } from '@/components/ui/form'
import {
  activateSchemeAction,
  addBandAction,
  removeBandAction,
  setSchemeActiveAction,
  type GradingFormState,
} from '../actions'

interface BandView {
  id: number
  name: string
  minimum: number
  maximum: number
  remark: string
}

export function SchemeBands({
  schemeId,
  bands,
  coverageProblem,
  isInUse,
  isActive,
  canWrite,
}: {
  schemeId: number
  bands: BandView[]
  /** Odoo's own rule, evaluated server-side. Null when the scheme is usable. */
  coverageProblem: string | null
  isInUse: boolean
  isActive: boolean
  canWrite: boolean
}) {
  const [addState, addAction, addPending] = useActionState<GradingFormState, FormData>(
    addBandAction,
    {},
  )
  // The rejected band, so "bands cannot overlap" does not also cost the typing.
  const band = addState.band

  const [removeState, removeAction] = useActionState<GradingFormState, FormData>(
    removeBandAction,
    {},
  )
  const [activateState, activateAction, activatePending] = useActionState<
    GradingFormState,
    FormData
  >(activateSchemeAction, {})
  const [retireState, retireAction] = useActionState<GradingFormState, FormData>(
    setSchemeActiveAction,
    {},
  )

  return (
    <div>
      {bands.length === 0 ? (
        <EmptyState
          title="No bands yet"
          hint="Add bands covering every percentage from 0 through 100."
        />
      ) : (
        <DataTable columns={['Grade', 'From', 'To', 'Remark', '']}>
          {bands.map((band) => (
            <Row key={band.id}>
              <Cell strong>{band.name}</Cell>
              <Cell numeric>{band.minimum}%</Cell>
              <Cell numeric>{band.maximum}%</Cell>
              <Cell>{band.remark || '—'}</Cell>
              <Cell>
                {canWrite ? (
                  <form action={removeAction}>
                    <input type="hidden" name="id" value={band.id} />
                    <input type="hidden" name="schemeId" value={schemeId} />
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

      <div className="space-y-4 border-t border-silver p-6">
        <FormError>{removeState.error ?? activateState.error ?? retireState.error}</FormError>
        <FormSuccess>{activateState.ok ?? retireState.ok}</FormSuccess>

        <p className="text-[12px] text-slate">
          {coverageProblem ? (
            <span className="text-danger">{coverageProblem}</span>
          ) : isInUse ? (
            'Report cards and published assessments are graded by this scheme.'
          ) : (
            'The bands cover 0 through 100, so this scheme can be put into use.'
          )}
        </p>

        {canWrite ? (
          <div className="flex flex-wrap items-center gap-3">
            {isInUse ? null : (
              <form action={activateAction}>
                <input type="hidden" name="id" value={schemeId} />
                <Button type="submit" pending={activatePending}>
                  {activatePending ? 'Applying…' : 'Use for report cards'}
                </Button>
              </form>
            )}

            {/* Odoo refuses to activate a retired scheme, and refuses to
                unlink one a report card already references, so retiring is the
                only way to take a scheme out of circulation. */}
            <form action={retireAction}>
              <input type="hidden" name="id" value={schemeId} />
              <input type="hidden" name="active" value={isActive ? 'false' : 'true'} />
              <button
                type="submit"
                disabled={isInUse}
                title={isInUse ? 'Put another scheme into use before retiring this one.' : undefined}
                className="rounded-[9999px] border border-silver px-4 py-2 text-[13px] hover:bg-paper disabled:opacity-40"
              >
                {isActive ? 'Retire scheme' : 'Restore scheme'}
              </button>
            </form>
          </div>
        ) : null}
      </div>

      {canWrite ? (
        <form action={addAction} className="space-y-3 border-t border-silver p-6">
          <p className="text-[12px] font-medium text-graphite">Add a band</p>
          <FormError>{addState.error}</FormError>
          <FormSuccess>{addState.ok}</FormSuccess>

          <input type="hidden" name="schemeId" value={schemeId} />
          <div className="grid gap-2 sm:grid-cols-[1fr_5rem_5rem_2fr]">
            <input
              name="band_name"
              required
              defaultValue={band?.band_name ?? ''}
              aria-label="Grade"
              placeholder="Grade"
              className={INPUT_CLASS}
            />
            <input
              name="band_min"
              type="number"
              defaultValue={band?.band_min ?? ''}
              min={0}
              max={100}
              step="0.01"
              required
              aria-label="Lowest percentage"
              placeholder="From"
              className={INPUT_CLASS}
            />
            <input
              name="band_max"
              type="number"
              defaultValue={band?.band_max ?? ''}
              min={0}
              max={100}
              step="0.01"
              required
              aria-label="Highest percentage"
              placeholder="To"
              className={INPUT_CLASS}
            />
            <input
              name="band_remark"
              defaultValue={band?.band_remark ?? ''}
              aria-label="Remark"
              placeholder="Remark"
              className={INPUT_CLASS}
            />
          </div>
          <Button type="submit" pending={addPending}>
            {addPending ? 'Adding…' : 'Add band'}
          </Button>
        </form>
      ) : null}
    </div>
  )
}
