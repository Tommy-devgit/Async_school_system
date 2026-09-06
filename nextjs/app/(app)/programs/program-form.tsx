'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { Button } from '@/components/ui'
import {
  Field,
  FormActions,
  FormError,
  FormSection,
  INPUT_CLASS,
  TextField,
  useFormResponse,
  type Option,
} from '@/components/ui/form'
import { createProgramAction, updateProgramAction, type ProgramFormState } from './actions'

/** Audience types whose value is a set of records rather than a code. */
const RECORD_AUDIENCES = {
  teacher_group: 'Teachers',
  subject_group: 'Subjects',
  class_section: 'Classes',
  branch_campus: 'Campuses',
  selected_staff: 'Staff',
} as const

type AudienceRecordType = keyof typeof RECORD_AUDIENCES

function isRecordAudience(value: string): value is AudienceRecordType {
  return value in RECORD_AUDIENCES
}

export interface ProgramFormValues {
  id?: number
  name: string
  program_type: string
  audience_type: string
  audience_code: string
  audience_ids: string[]
  start_date: string
  start_time: string
  end_date: string
  end_time: string
  location: string
  organizer_id: string
  description: string
}

export type AudienceChoices = Record<AudienceRecordType, Array<{ id: number; name: string }>>

/**
 * One form for creating and correcting a program.
 *
 * A program's status is not here. Publish, cancel and complete are workflow
 * transitions that go through Odoo's own methods, so this form only records
 * what the program is — writing `state` directly would skip the transition.
 *
 * The audience is the part worth reading twice. The model has an
 * `@api.onchange('audience_type')` that clears the values that no longer
 * apply, and an onchange never fires over JSON-RPC — so switching the audience
 * here has to actually clear the old one on the server. It does; see
 * `programAudience` in lib/odoo/models/operations.
 */
export function ProgramForm({
  mode,
  values,
  programTypes,
  audienceTypes,
  departments,
  responsibilities,
  audiences,
  organizers,
}: {
  mode: 'create' | 'edit'
  values: ProgramFormValues
  programTypes: Option[]
  audienceTypes: Option[]
  departments: Option[]
  responsibilities: Option[]
  audiences: AudienceChoices
  organizers: Array<{ id: number; name: string }>
}) {
  const action = mode === 'create' ? createProgramAction : updateProgramAction
  const [state, formAction, pending] = useActionState<ProgramFormState, FormData>(action, {})

  const prior = state.values
  const errors = state.fieldErrors ?? {}
  const response = useFormResponse(state)

  const value = (field: keyof ProgramFormValues) =>
    prior?.[field as keyof typeof prior] ?? String(values[field] ?? '')

  /*
    The audience type decides which control is shown below it, so it is
    mirrored in client state — but the field itself is uncontrolled and seeded
    from the submission, because a controlled field cannot survive React 19's
    post-action form reset. See useFormResponse.
  */
  const submittedAudience = value('audience_type') || 'all_staff'
  const [audienceType, setAudienceType] = useState(submittedAudience)
  const [seen, setSeen] = useState(response)
  if (seen !== response) {
    setSeen(response)
    setAudienceType(submittedAudience)
  }

  const codeOptions =
    audienceType === 'department'
      ? departments
      : audienceType === 'responsibility'
        ? responsibilities
        : null
  const records = isRecordAudience(audienceType) ? audiences[audienceType] : null

  const chosenIds = state.selected?.audience_ids ?? values.audience_ids

  return (
    <form action={formAction} className="space-y-6">
      {mode === 'edit' && values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <FormError>{state.error}</FormError>

      <FormSection title="What it is">
        <TextField
          label="Title"
          name="name"
          required
          defaultValue={value('name')}
          error={errors.name}
          placeholder="Grade 10 parents' evening"
        />
        <Field label="Kind" htmlFor="program_type" required error={errors.program_type}>
          <select
            key={`program_type-${response}`}
            id="program_type"
            name="program_type"
            defaultValue={value('program_type') || 'meeting'}
            className={INPUT_CLASS}
          >
            {programTypes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection
        title="When"
        hint="Odoo refuses a program that ends before it starts, whatever this form does."
      >
        <Field label="Starts" htmlFor="start_date" required error={errors.start_date}>
          <div className="flex gap-2">
            <input
              id="start_date"
              name="start_date"
              type="date"
              required
              defaultValue={value('start_date')}
              className={INPUT_CLASS}
            />
            <input
              name="start_time"
              type="time"
              aria-label="Start time"
              defaultValue={value('start_time') || '09:00'}
              className={INPUT_CLASS}
            />
          </div>
        </Field>
        <Field label="Ends" htmlFor="end_date" required error={errors.end_date}>
          <div className="flex gap-2">
            <input
              id="end_date"
              name="end_date"
              type="date"
              required
              defaultValue={value('end_date')}
              className={INPUT_CLASS}
            />
            <input
              name="end_time"
              type="time"
              aria-label="End time"
              defaultValue={value('end_time') || '10:00'}
              className={INPUT_CLASS}
            />
          </div>
        </Field>
        <TextField
          label="Location"
          name="location"
          defaultValue={value('location')}
          hint="A room, a hall, a campus, or a link."
          placeholder="Main hall"
        />
        <Field label="Organiser" htmlFor="organizer_id" error={errors.organizer_id}>
          <select
            key={`organizer_id-${response}`}
            id="organizer_id"
            name="organizer_id"
            defaultValue={value('organizer_id')}
            className={INPUT_CLASS}
          >
            <option value="">Nobody named</option>
            {organizers.map((staff) => (
              <option key={staff.id} value={staff.id}>
                {staff.name}
              </option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection
        title="Who it is for"
        hint="Changing this clears whatever the previous audience was, so a program never carries two."
      >
        <Field label="Audience" htmlFor="audience_type" required error={errors.audience_type}>
          <select
            key={`audience_type-${response}`}
            id="audience_type"
            name="audience_type"
            defaultValue={submittedAudience}
            onChange={(event) => setAudienceType(event.target.value)}
            className={INPUT_CLASS}
          >
            {audienceTypes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        {codeOptions ? (
          <Field label="Which one" htmlFor="audience_code" required error={errors.audience_value}>
            <select
              key={`audience_code-${audienceType}-${response}`}
              id="audience_code"
              name="audience_code"
              defaultValue={value('audience_code')}
              className={INPUT_CLASS}
            >
              <option value="">Choose…</option>
              {codeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {records ? (
          <Field
            label={RECORD_AUDIENCES[audienceType as AudienceRecordType]}
            htmlFor="audience_ids"
            required
            error={errors.audience_value}
            hint={
              records.length === 0
                ? 'Your role cannot read these records, so this audience is not available to you.'
                : 'Hold Ctrl or Cmd to choose more than one.'
            }
          >
            <select
              key={`audience_ids-${audienceType}-${response}`}
              id="audience_ids"
              name="audience_ids"
              multiple
              size={Math.min(8, Math.max(4, records.length))}
              disabled={records.length === 0}
              defaultValue={chosenIds}
              className={INPUT_CLASS}
            >
              {records.map((record) => (
                <option key={record.id} value={record.id}>
                  {record.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </FormSection>

      <FormSection title="Notes" columns={1}>
        <Field label="Description" htmlFor="description">
          <textarea
            id="description"
            name="description"
            rows={4}
            defaultValue={value('description')}
            className={INPUT_CLASS}
            placeholder="What it covers, what to bring, who to ask."
          />
        </Field>
      </FormSection>

      <FormActions>
        <Button type="submit" pending={pending}>
          {pending
            ? mode === 'create'
              ? 'Creating…'
              : 'Saving…'
            : mode === 'create'
              ? 'Create program'
              : 'Save changes'}
        </Button>
        <Link
          href={mode === 'edit' && values.id ? `/programs/${values.id}` : '/programs'}
          className="rounded-[9999px] border border-silver px-5 py-2.5 text-[13px] hover:bg-paper"
        >
          Cancel
        </Link>
      </FormActions>
    </form>
  )
}
