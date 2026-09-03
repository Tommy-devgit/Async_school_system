'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { Button } from '@/components/ui'
import { EthiopianDateInput } from '@/components/ui/ethiopian-date-input'
import {
  Field,
  FormActions,
  FormError,
  FormSection,
  ReadOnlyField,
  SelectField,
  TextField,
  type Option,
} from '@/components/ui/form'
import { updateAssessmentAction, type AssessmentFormState } from '../../actions'

export interface AssessmentEditValues {
  id: number
  name: string
  assessment_type: string
  date: string
  max_mark: string
  weight: string
  className: string
  subject: string
  term: string
  markCount: number
}

export function AssessmentEditForm({
  assessment,
  types,
  setupFrozen,
}: {
  assessment: AssessmentEditValues
  types: Option[]
  setupFrozen: boolean
}) {
  const [state, formAction, pending] = useActionState<AssessmentFormState, FormData>(
    updateAssessmentAction,
    {},
  )
  const prior = state.values ?? {}
  const value = (field: keyof AssessmentEditValues) =>
    prior[field] !== undefined ? prior[field] : String(assessment[field] ?? '')
  const errors = state.fieldErrors ?? {}

  // React state for auto-fill logic (initialized with the existing database values)
  const [maxMark, setMaxMark] = useState(value('max_mark'))
  const [weight, setWeight] = useState(value('weight'))

  const handleTypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const type = event.target.value
    
    if (type === 'quiz') {
      setMaxMark('5')
      setWeight('1')
    } else if (type === 'assignment') {
      setMaxMark('15')
      setWeight('2')
    } else if (type === 'test') {
      setMaxMark('10')
      setWeight('3')
    } else if (type === 'mid' || type === 'mid_term' || type === 'midterm') {
      setMaxMark('20')
      setWeight('4')
    } else if (type === 'final' || type === 'exam' || type === 'final_exam') {
      setMaxMark('50')
      setWeight('5')
    }
  }

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="id" value={assessment.id} />
      <FormError>{state.error}</FormError>

      <FormSection title="Assessment">
        <TextField
          label="Name"
          name="name"
          required
          defaultValue={value('name')}
          error={errors.name}
        />
        <ReadOnlyField label="Class" value={assessment.className} />
        <ReadOnlyField label="Subject" value={assessment.subject} />
        <ReadOnlyField
          label="Term"
          value={assessment.term}
          hint="Set by the teacher assignment this was created against."
        />
      </FormSection>

      {setupFrozen ? (
        <FormSection title="Setup" columns={1}>
          <div className="space-y-3">
            <p className="text-[12px] text-slate">
              The mark list has been generated, so Odoo has frozen the type, date, maximum mark
              and weight — {assessment.markCount}{' '}
              {assessment.markCount === 1 ? 'row was' : 'rows were'} built against them. The name
              above can still be corrected.
            </p>
            <dl className="grid gap-4 sm:grid-cols-2">
              <ReadOnlyField label="Type" value={assessment.assessment_type || '—'} />
              <ReadOnlyField label="Date" value={assessment.date || '—'} />
              <ReadOnlyField label="Maximum mark" value={assessment.max_mark} />
              <ReadOnlyField label="Weight" value={assessment.weight} />
            </dl>
          </div>
        </FormSection>
      ) : (
        <FormSection
          title="Setup"
          hint="Editable only while the assessment is in draft. Generating the mark list fixes these."
        >
          <SelectField
            label="Type"
            name="assessment_type"
            required
            options={types}
            defaultValue={value('assessment_type')}
            onChange={handleTypeChange}
            error={errors.assessment_type}
          />
          <Field
            label="Date"
            htmlFor="date"
            required
            error={errors.date}
            hint="Must fall inside the term."
          >
            <EthiopianDateInput id="date" name="date" defaultValue={value('date')} />
          </Field>
          <TextField
            label="Maximum mark"
            name="max_mark"
            type="number"
            min={1}
            step="0.5"
            required
            value={maxMark}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxMark(e.target.value)}
            error={errors.max_mark}
          />
          <TextField
            label="Weight"
            name="weight"
            type="number"
            min={0.1}
            step="0.1"
            required
            value={weight}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWeight(e.target.value)}
            error={errors.weight}
            hint="All assessments for this subject and term may not exceed 100 together."
          />
        </FormSection>
      )}

      <FormActions>
        <Button type="submit" pending={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        <Link
          href={`/assessments/${assessment.id}`}
          className="rounded-[9999px] border border-silver px-5 py-2.5 text-[13px] hover:bg-paper"
        >
          Cancel
        </Link>
      </FormActions>
    </form>
  )
}