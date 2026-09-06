'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { Button } from '@/components/ui'
import {
  Field,
  FormActions,
  FormError,
  FormResponse,
  FormSection,
  SelectField,
  TextField,
  type Option,
} from '@/components/ui/form'
import {
  createQuestionAction,
  updateQuestionAction,
  type QuestionFormState,
} from './actions'

export interface QuestionFormValues {
  id?: number
  name: string
  code: string
  sequence: string
  answer_type: string
  grade_from: string
  grade_to: string
  admission_type: string
  stream_id: string
  support_need_only: boolean
  required: boolean
  active: boolean
}

function Toggle({
  name,
  label,
  hint,
  checked,
}: {
  name: string
  label: string
  hint?: string
  checked: boolean
}) {
  return (
    <Field label={label} htmlFor={name} hint={hint}>
      {/* A cleared checkbox posts nothing; the hidden input makes it explicit. */}
      <input type="hidden" name={name} value="false" />
      <div className="flex min-h-[38px] items-center gap-2 rounded-[8px] border border-silver bg-white px-3 py-2 text-[13px] text-graphite">
        <input id={name} name={name} type="checkbox" value="true" defaultChecked={checked} />
        <span>Yes</span>
      </div>
    </Field>
  )
}

export function QuestionForm({
  mode,
  question,
  answerTypes,
  admissionTypes,
  streams,
}: {
  mode: 'create' | 'edit'
  question: QuestionFormValues
  answerTypes: Option[]
  admissionTypes: Option[]
  streams: Option[]
}) {
  const [state, formAction, pending] = useActionState<QuestionFormState, FormData>(
    mode === 'create' ? createQuestionAction : updateQuestionAction,
    {},
  )
  const prior = state.values ?? {}
  const value = (field: keyof QuestionFormValues) =>
    prior[field] !== undefined ? prior[field] : String(question[field] ?? '')
  const flag = (field: keyof QuestionFormValues) =>
    prior[field] !== undefined ? prior[field] === 'true' : Boolean(question[field])

  const [answerType, setAnswerType] = useState(value('answer_type') || 'text')
  const errors = state.fieldErrors ?? {}

  return (
    <FormResponse state={state}>
      <form action={formAction} className="space-y-6">
        {question.id ? <input type="hidden" name="id" value={question.id} /> : null}
        <FormError>{state.error}</FormError>

        <FormSection title="Question">
          <TextField
            label="Question"
            name="name"
            required
            defaultValue={value('name')}
            error={errors.name}
            placeholder="Does the student have any medical conditions?"
          />
          <TextField
            label="Code"
            name="code"
            required
            defaultValue={value('code')}
            error={errors.code}
            hint="Unique, and how the answer is identified. Not shown to anyone."
          />
          <Field label="Answer type" htmlFor="answer_type">
            <select
              id="answer_type"
              name="answer_type"
              value={answerType}
              onChange={(event) => setAnswerType(event.target.value)}
              className="w-full rounded-[8px] border border-silver bg-white px-3 py-2 text-[13px] text-graphite focus:border-action-blue focus:outline-none"
            >
              {answerTypes.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <TextField
            label="Order"
            name="sequence"
            type="number"
            min={0}
            defaultValue={value('sequence')}
            hint="Lower numbers are asked first."
          />
          {answerType === 'selection' && mode === 'create' ? (
            <p className="text-[12px] text-slate sm:col-span-2">
              The choices are added on the question&apos;s own page once it exists.
            </p>
          ) : null}
        </FormSection>

        <FormSection
          title="Who is asked"
          hint="Odoo applies exactly these when it checks whether a registration may be submitted."
        >
          <TextField
            label="From grade"
            name="grade_from"
            type="number"
            min={1}
            max={12}
            defaultValue={value('grade_from')}
            error={errors.grade_from}
          />
          <TextField
            label="To grade"
            name="grade_to"
            type="number"
            min={1}
            max={12}
            defaultValue={value('grade_to')}
            error={errors.grade_to}
          />
          <SelectField
            label="Admission type"
            name="admission_type"
            options={admissionTypes}
            defaultValue={value('admission_type') || 'all'}
            placeholder="All"
          />
          <SelectField
            label="Stream"
            name="stream_id"
            options={streams}
            defaultValue={value('stream_id')}
            placeholder="Any stream"
            hint="Leave blank to ask it regardless of stream."
          />
          <Toggle
            name="required"
            label="Required"
            hint="A required question blocks submission until it is answered."
            checked={flag('required')}
          />
          <Toggle
            name="support_need_only"
            label="Only when support is needed"
            checked={flag('support_need_only')}
          />
          {mode === 'edit' ? (
            <Toggle name="active" label="In use" checked={flag('active')} />
          ) : null}
        </FormSection>

        <FormActions>
          <Button type="submit" pending={pending}>
            {pending
              ? mode === 'create' ? 'Creating…' : 'Saving…'
              : mode === 'create' ? 'Create question' : 'Save changes'}
          </Button>
          <Link
            href={
              question.id
                ? `/configuration/questionnaire/${question.id}`
                : '/configuration/questionnaire'
            }
            className="rounded-[9999px] border border-silver px-5 py-2.5 text-[13px] hover:bg-paper"
          >
            Cancel
          </Link>
        </FormActions>
      </form>
    </FormResponse>
  )
}
