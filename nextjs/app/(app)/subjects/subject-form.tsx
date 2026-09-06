'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { Button } from '@/components/ui'
import {
  Field,
  FormActions,
  FormError,
  FormResponse,
  FormSection,
  ReadOnlyField,
  SelectField,
  TextField,
  type Option,
} from '@/components/ui/form'
import { createSubjectAction, updateSubjectAction, type SubjectFormState } from './actions'

export interface SubjectFormValues {
  id?: number
  sequence_code: string
  name: string
  code: string
  short_name: string
  subject_type: string
  credit_hours: string
  active: boolean
}

export function SubjectForm({
  mode,
  subject,
  types,
}: {
  mode: 'create' | 'edit'
  subject: SubjectFormValues
  types: Option[]
}) {
  const [state, formAction, pending] = useActionState<SubjectFormState, FormData>(
    mode === 'create' ? createSubjectAction : updateSubjectAction,
    {},
  )
  const prior = state.values ?? {}
  const value = (field: keyof SubjectFormValues) =>
    prior[field] !== undefined ? prior[field] : String(subject[field] ?? '')
  const errors = state.fieldErrors ?? {}

  return (
    <FormResponse state={state}>
      <form action={formAction} className="space-y-6">
        {subject.id ? <input type="hidden" name="id" value={subject.id} /> : null}
        <FormError>{state.error}</FormError>

        <FormSection title="Subject" hint="The name has to be unique across the school.">
          {mode === 'edit' ? (
            <ReadOnlyField
              label="Subject ID"
              value={subject.sequence_code || '—'}
              hint="Assigned by Odoo on creation."
            />
          ) : null}
          <TextField
            label="Name"
            name="name"
            required
            defaultValue={value('name')}
            error={errors.name}
            placeholder="Mathematics"
          />
          <TextField
            label="Code"
            name="code"
            defaultValue={value('code')}
            error={errors.code}
            placeholder="MATH"
          />
          <TextField
            label="Short name"
            name="short_name"
            defaultValue={value('short_name')}
            hint="Used where the full name will not fit, such as a timetable cell."
          />
          <SelectField
            label="Type"
            name="subject_type"
            required
            options={types}
            defaultValue={value('subject_type') || 'compulsory'}
            error={errors.subject_type}
          />
          <TextField
            label="Credit hours"
            name="credit_hours"
            type="number"
            min={0}
            step="0.5"
            defaultValue={value('credit_hours')}
            error={errors.credit_hours}
          />
          {mode === 'edit' ? (
            <Field label="Status" htmlFor="active">
              <input type="hidden" name="active" value="false" />
              <div className="flex min-h-[38px] items-center gap-2 rounded-[8px] border border-silver bg-white px-3 py-2 text-[13px] text-graphite">
                <input
                  id="active"
                  name="active"
                  type="checkbox"
                  value="true"
                  defaultChecked={
                    prior.active !== undefined ? prior.active === 'true' : subject.active
                  }
                />
                <span>In use</span>
              </div>
            </Field>
          ) : null}
        </FormSection>

        <FormActions>
          <Button type="submit" pending={pending}>
            {pending
              ? mode === 'create'
                ? 'Creating…'
                : 'Saving…'
              : mode === 'create'
                ? 'Create subject'
                : 'Save changes'}
          </Button>
          <Link
            href="/subjects"
            className="rounded-[9999px] border border-silver px-5 py-2.5 text-[13px] hover:bg-paper"
          >
            Cancel
          </Link>
        </FormActions>
      </form>
    </FormResponse>
  )
}
