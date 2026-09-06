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
import { createClassAction, updateClassAction, type ClassFormState } from './actions'

export interface ClassFormValues {
  id?: number
  name: string
  grade_id: string
  section_id: string
  academic_year_id: string
  education_level: string
  capacity: string
  room_id: string
  shift_id: string
  stream_id: string
  campus_id: string
  homeroom_teacher_id: string
  min_age: string
  max_age: string
  is_entry_level: boolean
  active: boolean
}

export interface ClassFormPickers {
  grades: Option[]
  sections: Option[]
  years: Option[]
  levels: Option[]
  rooms: Option[]
  shifts: Option[]
  streams: Option[]
  campuses: Option[]
  teachers: Option[]
}

/** Grades that Odoo's `_check_stream_grade` will accept a stream on. */
const STREAM_GRADES = ['11', '12']

export function ClassForm({
  mode,
  klass,
  pickers,
  gradeLevels,
}: {
  mode: 'create' | 'edit'
  klass: ClassFormValues
  pickers: ClassFormPickers
  /** Grade id → its level, so the stream picker can follow Odoo's rule. */
  gradeLevels: Record<string, string>
}) {
  const [state, formAction, pending] = useActionState<ClassFormState, FormData>(
    mode === 'create' ? createClassAction : updateClassAction,
    {},
  )
  const prior = state.values ?? {}
  const value = (field: keyof ClassFormValues) =>
    prior[field] !== undefined ? prior[field] : String(klass[field] ?? '')

  const [gradeId, setGradeId] = useState(value('grade_id'))
  const errors = state.fieldErrors ?? {}
  const streamAllowed = STREAM_GRADES.includes(gradeLevels[gradeId] ?? '')
  const cancelHref = klass.id ? `/classes/${klass.id}` : '/classes'

  return (
    <FormResponse state={state}>
      <form action={formAction} className="space-y-6">
        {klass.id ? <input type="hidden" name="id" value={klass.id} /> : null}
        <FormError>{state.error}</FormError>

        <FormSection
          title="Identity"
          hint="The name, section and academic year together have to be unique."
        >
          <TextField
            label="Class name"
            name="name"
            required
            defaultValue={value('name')}
            error={errors.name}
            placeholder="Grade 9"
          />
          <SelectField
            label="Academic year"
            name="academic_year_id"
            required
            options={pickers.years}
            defaultValue={value('academic_year_id')}
            error={errors.academic_year_id}
          />
          <Field label="Grade" htmlFor="grade_id" error={errors.grade_id}>
            <select
              id="grade_id"
              name="grade_id"
              value={gradeId}
              onChange={(event) => setGradeId(event.target.value)}
              className="w-full rounded-[8px] border border-silver bg-white px-3 py-2 text-[13px] text-graphite focus:border-action-blue focus:outline-none"
            >
              <option value="">None</option>
              {pickers.grades.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <SelectField
            label="Section"
            name="section_id"
            options={pickers.sections}
            defaultValue={value('section_id')}
            placeholder="None — the grade runs as one class"
            error={errors.section_id}
          />
          <SelectField
            label="Education level"
            name="education_level"
            options={pickers.levels}
            defaultValue={value('education_level')}
            placeholder="Not set"
          />
          {streamAllowed ? (
            <SelectField
              label="Stream"
              name="stream_id"
              options={pickers.streams}
              defaultValue={value('stream_id')}
              placeholder="None"
              hint="Odoo allows a stream only on Grades 11 and 12."
            />
          ) : null}
        </FormSection>

        <FormSection title="Places and people">
          <SelectField
            label="Campus"
            name="campus_id"
            options={pickers.campuses}
            defaultValue={value('campus_id')}
            placeholder="None"
          />
          <SelectField
            label="Room"
            name="room_id"
            options={pickers.rooms}
            defaultValue={value('room_id')}
            placeholder="None"
          />
          <SelectField
            label="Shift"
            name="shift_id"
            options={pickers.shifts}
            defaultValue={value('shift_id')}
            placeholder="None"
          />
          <SelectField
            label="Homeroom teacher"
            name="homeroom_teacher_id"
            options={pickers.teachers}
            defaultValue={value('homeroom_teacher_id')}
            placeholder="None"
          />
        </FormSection>

        <FormSection title="Intake rules">
          <TextField
            label="Capacity"
            name="capacity"
            type="number"
            min={0}
            defaultValue={value('capacity')}
            error={errors.capacity}
            hint="Maximum active enrolments. 0 means unlimited."
          />
          <TextField
            label="Minimum age"
            name="min_age"
            type="number"
            min={0}
            defaultValue={value('min_age')}
            error={errors.min_age}
          />
          <TextField
            label="Maximum age"
            name="max_age"
            type="number"
            min={0}
            defaultValue={value('max_age')}
            error={errors.max_age}
          />
          <Field label="Entry level" htmlFor="is_entry_level">
            <input type="hidden" name="is_entry_level" value="false" />
            <div className="flex min-h-[38px] items-center gap-2 rounded-[8px] border border-silver bg-white px-3 py-2 text-[13px] text-graphite">
              <input
                id="is_entry_level"
                name="is_entry_level"
                type="checkbox"
                value="true"
                defaultChecked={
                  prior.is_entry_level !== undefined
                    ? prior.is_entry_level === 'true'
                    : klass.is_entry_level
                }
              />
              <span>No previous-grade document required</span>
            </div>
          </Field>
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
                    prior.active !== undefined ? prior.active === 'true' : klass.active
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
                ? 'Create class'
                : 'Save changes'}
          </Button>
          <Link
            href={cancelHref}
            className="rounded-[9999px] border border-silver px-5 py-2.5 text-[13px] hover:bg-paper"
          >
            Cancel
          </Link>
        </FormActions>
      </form>
    </FormResponse>
  )
}
