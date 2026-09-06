'use client'

import { useActionState } from 'react'
import { Badge, Button, Cell, DataTable, EmptyState, Row } from '@/components/ui'
import { FormError, FormSuccess, INPUT_CLASS, useFormResponse } from '@/components/ui/form'
import {
  createDocumentRuleAction,
  removeDocumentRuleAction,
  setDocumentRuleActiveAction,
  type DocumentRuleState,
} from './actions'

interface RuleView {
  id: number
  documentType: string
  admissionType: string
  gradeFrom: number
  gradeTo: number
  stream: string
  required: boolean
  active: boolean
}

interface Option {
  value: string
  label: string
}

/**
 * Which documents a registration must carry before it can be submitted.
 *
 * `_validate_submission_requirements` searches the active, required rules
 * matching the student's grade, admission type and stream, and refuses the
 * submission naming any type with no uploaded document. Retiring a rule is
 * offered alongside deleting it because a rule that has shaped past intake is
 * usually worth keeping as history.
 */
export function DocumentRules({
  rules,
  documentTypes,
  admissionTypes,
  streams,
  canWrite,
}: {
  rules: RuleView[]
  documentTypes: Option[]
  admissionTypes: Option[]
  streams: Option[]
  canWrite: boolean
}) {
  const [addState, addAction, addPending] = useActionState<DocumentRuleState, FormData>(
    createDocumentRuleAction,
    {},
  )
  const [toggleState, toggleAction] = useActionState<DocumentRuleState, FormData>(
    setDocumentRuleActiveAction,
    {},
  )
  const [removeState, removeAction] = useActionState<DocumentRuleState, FormData>(
    removeDocumentRuleAction,
    {},
  )
  const errors = addState.fieldErrors ?? {}

  // The rejected submission, so a refused rule keeps the grade range and the
  // document type that were chosen.
  const prior = addState.values
  const response = useFormResponse(addState)

  return (
    <div>
      {rules.length === 0 ? (
        <EmptyState
          title="No document rules"
          hint="Registrations submit without any document requirement beyond the birth certificate."
        />
      ) : (
        <DataTable columns={['Document', 'Grades', 'Admission', 'Stream', 'Status', '']}>
          {rules.map((rule) => (
            <Row key={rule.id}>
              <Cell strong>{rule.documentType}</Cell>
              <Cell numeric>
                {rule.gradeFrom}–{rule.gradeTo}
              </Cell>
              <Cell>{rule.admissionType}</Cell>
              <Cell>{rule.stream}</Cell>
              <Cell>
                <div className="flex flex-wrap gap-1.5">
                  {rule.required ? <Badge tone="solid">Required</Badge> : <Badge>Optional</Badge>}
                  {rule.active ? null : <Badge tone="muted">Retired</Badge>}
                </div>
              </Cell>
              <Cell>
                {canWrite ? (
                  <div className="flex flex-wrap gap-3">
                    <form action={toggleAction}>
                      <input type="hidden" name="id" value={rule.id} />
                      <input type="hidden" name="active" value={rule.active ? 'false' : 'true'} />
                      <button
                        type="submit"
                        className="text-[12px] text-slate underline underline-offset-2 hover:text-graphite"
                      >
                        {rule.active ? 'Retire' : 'Restore'}
                      </button>
                    </form>
                    <form action={removeAction}>
                      <input type="hidden" name="id" value={rule.id} />
                      <button
                        type="submit"
                        className="text-[12px] text-slate underline underline-offset-2 hover:text-danger"
                      >
                        Delete
                      </button>
                    </form>
                  </div>
                ) : null}
              </Cell>
            </Row>
          ))}
        </DataTable>
      )}

      {canWrite ? (
        <form action={addAction} className="space-y-3 border-t border-silver p-6">
          <p className="text-[12px] font-medium text-graphite">Add a rule</p>
          <FormError>{addState.error ?? toggleState.error ?? removeState.error}</FormError>
          <FormSuccess>{addState.ok ?? toggleState.ok ?? removeState.ok}</FormSuccess>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block text-[12px] text-slate">Document type</span>
              <select
                key={`document_type_id-${response}`}
                name="document_type_id"
                required
                defaultValue={prior?.document_type_id ?? ''}
                className={INPUT_CLASS}
              >
                <option value="">Choose…</option>
                {documentTypes.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {errors.document_type_id ? (
                <span role="alert" className="mt-1 block text-[11px] text-danger">
                  {errors.document_type_id}
                </span>
              ) : null}
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12px] text-slate">Admission type</span>
              <select
                key={`admission_type-${response}`}
                name="admission_type"
                defaultValue={prior?.admission_type || 'all'}
                className={INPUT_CLASS}
              >
                {admissionTypes.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12px] text-slate">Stream</span>
              <select
                key={`stream_id-${response}`}
                name="stream_id"
                defaultValue={prior?.stream_id ?? ''}
                className={INPUT_CLASS}
              >
                <option value="">Any stream</option>
                {streams.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12px] text-slate">From grade</span>
              <input
                name="grade_from"
                type="number"
                min={1}
                max={12}
                defaultValue={prior ? prior.grade_from : 1}
                className={INPUT_CLASS}
              />
              {errors.grade_from ? (
                <span role="alert" className="mt-1 block text-[11px] text-danger">
                  {errors.grade_from}
                </span>
              ) : null}
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12px] text-slate">To grade</span>
              <input
                name="grade_to"
                type="number"
                min={1}
                max={12}
                defaultValue={prior ? prior.grade_to : 12}
                className={INPUT_CLASS}
              />
              {errors.grade_to ? (
                <span role="alert" className="mt-1 block text-[11px] text-danger">
                  {errors.grade_to}
                </span>
              ) : null}
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12px] text-slate">Required</span>
              <input type="hidden" name="required" value="false" />
              <span className="flex min-h-[38px] items-center gap-2 rounded-[8px] border border-silver bg-white px-3 py-2 text-[13px] text-graphite">
                <input
                  type="checkbox"
                  name="required"
                  value="true"
                  defaultChecked={prior ? prior.required === 'true' : true}
                />
                Blocks submission
              </span>
            </label>
          </div>

          <Button type="submit" pending={addPending}>
            {addPending ? 'Adding…' : 'Add rule'}
          </Button>
        </form>
      ) : null}
    </div>
  )
}
