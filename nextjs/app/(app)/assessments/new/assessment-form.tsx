'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { EthiopianDateInput } from '@/components/ui/ethiopian-date-input'
import { formatDate } from '@/lib/format'
import { createAssessmentAction, type AssessmentFormState } from '../actions'

export interface AssignmentChoice {
  id: number
  label: string
  startDate: string
  endDate: string | false
}

interface Option {
  value: string
  label: string
}

const INPUT =
  'w-full rounded-[8px] border border-silver bg-white px-3 py-2 text-[13px] text-graphite ' +
  'placeholder:text-stone focus:border-action-blue focus:outline-none'

function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  error?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[12px] font-medium text-graphite">
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </label>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-stone">{hint}</p> : null}
      {error ? (
        <p role="alert" className="mt-1 text-[11px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function AssessmentForm({
  assignments,
  types,
}: {
  assignments: AssignmentChoice[]
  types: Option[]
}) {
  const [state, formAction, pending] = useActionState<AssessmentFormState, FormData>(
    createAssessmentAction,
    {},
  )

  const values = state.values ?? {}
  const errors = state.fieldErrors ?? {}
  const [assignmentId, setAssignmentId] = useState(values.assignmentId ?? '')
  
  // React state for both fields so they auto-fill but remain editable
  const [maxMark, setMaxMark] = useState(values.max_mark ?? '')
  const [weight, setWeight] = useState(values.weight ?? '')

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
  
  const chosen = assignments.find((item) => String(item.id) === assignmentId)

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <section className="space-y-4">
        <div>
          <h2 className="text-[15px] leading-tight">What is being assessed</h2>
          <p className="mt-0.5 text-[12px] text-slate">
            The teaching assignment settles the class, subject and term together, which is what
            Odoo checks against.
          </p>
        </div>

        <Field
          label="Teaching assignment"
          htmlFor="assignmentId"
          required
          error={errors.assignmentId}
          hint={
            chosen
              ? `Active from ${formatDate(chosen.startDate)}${
                  chosen.endDate ? ` until ${formatDate(chosen.endDate)}` : ' with no end date'
                }. The assessment date must fall inside that.`
              : undefined
          }
        >
          <select
            id="assignmentId"
            name="assignmentId"
            className={INPUT}
            value={assignmentId}
            onChange={(event) => setAssignmentId(event.target.value)}
          >
            <option value="">Choose an assignment…</option>
            {assignments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="name" required error={errors.name}>
            <input
              id="name"
              name="name"
              className={INPUT}
              defaultValue={values.name ?? ''}
              placeholder="Mid-term, Unit 3 quiz…"
            />
          </Field>

          <Field label="Type" htmlFor="assessment_type" required error={errors.assessment_type}>
            <select
              id="assessment_type"
              name="assessment_type"
              className={INPUT}
              defaultValue={values.assessment_type ?? ''}
              onChange={handleTypeChange}
            >
              <option value="">Select type...</option>
              {types.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className="space-y-4 border-t border-silver pt-5">
        <div>
          <h2 className="text-[15px] leading-tight">When and how it counts</h2>
          <p className="mt-0.5 text-[12px] text-slate">
            Odoo requires the date to fall inside the term, and the weights for a subject in a term
            to total no more than 100.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Assessment date" htmlFor="date" required error={errors.date}>
            <EthiopianDateInput id="date" name="date" defaultValue={values.date ?? ''} />
          </Field>

          <Field label="Maximum mark" htmlFor="max_mark" required error={errors.max_mark}>
            <input
              id="max_mark"
              name="max_mark"
              type="number"
              step="0.01"
              min={0.01}
              className={INPUT}
              value={maxMark}
              onChange={(e) => setMaxMark(e.target.value)}
            />
          </Field>

          <Field
            label="Weight"
            htmlFor="weight"
            error={errors.weight}
            hint="Share of the term result."
          >
            <input
              id="weight"
              name="weight"
              type="number"
              step="0.01"
              min={0}
              className={INPUT}
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </Field>
        </div>
      </section>

      {state.error ? (
        <p role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[13px] text-danger">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-3 border-t border-silver pt-5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[9999px] bg-ink px-5 py-2.5 text-[13px] font-medium text-white hover:bg-graphite disabled:opacity-50"
        >
          {pending ? 'Creating…' : 'Create assessment'}
        </button>

        <Link
          href="/assessments"
          className="rounded-[9999px] border border-silver px-5 py-2.5 text-[13px] hover:bg-paper"
        >
          Cancel
        </Link>
      </div>

      <p className="text-[11px] text-stone">
        The assessment is created in draft with no mark list. Opening it generates one row per
        student from the subject enrolments valid on the assessment date.
      </p>
    </form>
  )
}