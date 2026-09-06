'use client'

import { useActionState, useState } from 'react'
import { useFormResponse } from '@/components/ui/form'
import { EthiopianDateInput } from '@/components/ui/ethiopian-date-input'
import { ethiopianYearOf } from '@/lib/ethiopian-date'
import {
  classSubjectsAction,
  gradeSectionsAction,
  schoolSetupAction,
  type SetupState,
} from './actions'

export interface Choice {
  id: number
  name: string
}

const CONTROL =
  'w-full rounded-[8px] border border-silver bg-white px-2.5 py-1.5 text-[12px] ' +
  'text-graphite placeholder:text-stone focus:border-action-blue focus:outline-none'

const SUBMIT =
  'rounded-[9999px] bg-ink px-3.5 py-1.5 text-[12px] font-medium text-white ' +
  'hover:bg-graphite disabled:opacity-50'

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="mb-1 block text-[11px] font-medium text-graphite">
      {children}
      {required ? <span className="ml-0.5 text-danger">*</span> : null}
    </span>
  )
}

function Feedback({ state }: { state: SetupState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-[11px] text-danger">
        {state.error}
      </p>
    )
  }
  if (state.ok) {
    return (
      <p role="status" className="text-[11px] text-action-blue">
        {state.ok}
      </p>
    )
  }
  return null
}

function fieldError(state: SetupState, key: string) {
  const message = state.fieldErrors?.[key]
  return message ? (
    <span role="alert" className="mt-1 block text-[11px] text-danger">
      {message}
    </span>
  ) : null
}

/* ------------------------------------------------------- open a new year --- */

export function SchoolSetupForm({ grades }: { grades: Choice[] }) {
  const [state, formAction, pending] = useActionState<SetupState, FormData>(schoolSetupAction, {})

  /*
    A refused setup used to cost every choice on this form — two dates, the
    term count, the section names and a tick against every grade in the school
    — for a refusal the user could not have foreseen, such as a year that
    already exists. Each field is now re-seeded from what was submitted.
  */
  const prior = state.values
  const priorGrades = state.selected?.gradeIds
  const response = useFormResponse(state)

  const [dateStart, setDateStart] = useState(prior?.dateStart ?? '')
  const [seen, setSeen] = useState(response)
  if (seen !== response) {
    setSeen(response)
    setDateStart(prior?.dateStart ?? '')
  }
  const derived = dateStart ? ethiopianYearOf(dateStart) : null

  return (
    <form action={formAction} className="space-y-3 p-6 pt-0">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label required>Starts on</Label>
          {/* Keyed: it keeps the date in its own state, so a new default only
              reaches it on a remount. */}
          <EthiopianDateInput
            key={`dateStart-${response}`}
            name="dateStart"
            defaultValue={prior?.dateStart ?? ''}
            onChange={setDateStart}
          />
          {fieldError(state, 'dateStart')}
        </div>
        <div>
          <Label required>Ends on</Label>
          <EthiopianDateInput
            key={`dateEnd-${response}`}
            name="dateEnd"
            defaultValue={prior?.dateEnd ?? ''}
          />
          {fieldError(state, 'dateEnd')}
        </div>
      </div>

      <p className="rounded-[8px] border border-silver bg-paper px-2.5 py-2 text-[11px] text-slate">
        {derived
          ? `The year will be named ${derived}, the Ethiopian year the start date falls in.`
          : 'Choose a start date and the year names itself.'}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <Label required>Divided into</Label>
          <select
            key={`termCount-${response}`}
            name="termCount"
            defaultValue={prior?.termCount || '3'}
            className={CONTROL}
          >
            <option value="1">One term</option>
            <option value="2">Two semesters</option>
            <option value="3">Three terms</option>
            <option value="4">Four quarters</option>
          </select>
        </label>

        <label className="block">
          <Label>Sections per grade</Label>
          <input
            name="sectionNames"
            defaultValue={prior ? prior.sectionNames : 'A'}
            placeholder="A, B"
            className={CONTROL}
          />
          <span className="mt-1 block text-[11px] text-stone">
            Comma separated. One class is created per grade and section.
          </span>
        </label>
      </div>

      <div>
        <Label required>Grades</Label>
        <select
          key={`gradeIds-${response}`}
          name="gradeIds"
          multiple
          size={Math.min(8, Math.max(4, grades.length))}
          // Every grade by default; whatever was actually picked after a refusal.
          defaultValue={priorGrades ?? grades.map((grade) => String(grade.id))}
          className={CONTROL}
        >
          {grades.map((grade) => (
            <option key={grade.id} value={grade.id}>
              {grade.name}
            </option>
          ))}
        </select>
        {fieldError(state, 'gradeIds')}
      </div>

      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          name="isCurrent"
          defaultChecked={prior ? prior.isCurrent === 'on' : true}
          className="h-4 w-4 rounded border-silver"
        />
        <span className="text-[12px] text-graphite">Make this the current year</span>
      </label>

      <div className="flex items-center gap-3 pt-1">
        <button type="submit" disabled={pending} className={SUBMIT}>
          {pending ? 'Setting up…' : 'Open the year'}
        </button>
        <Feedback state={state} />
      </div>

      <p className="text-[11px] text-stone">
        Re-running this for a year that already exists updates its dates and fills in anything
        missing. It never duplicates a class or a term.
      </p>
    </form>
  )
}

/* ---------------------------------------------------- sections on a grade --- */

export function GradeSectionsForm({
  grades,
  years,
  sections,
}: {
  grades: Choice[]
  years: Choice[]
  sections: Choice[]
}) {
  const [state, formAction, pending] = useActionState<SetupState, FormData>(gradeSectionsAction, {})

  // Re-seeded from the rejected submission; see SchoolSetupForm above.
  const prior = state.values
  const response = useFormResponse(state)

  return (
    <form action={formAction} className="space-y-3 p-6 pt-0">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <Label required>Grade</Label>
          <select
            key={`gradeId-${response}`}
            name="gradeId"
            defaultValue={prior?.gradeId ?? ''}
            className={CONTROL}
          >
            <option value="">Choose a grade…</option>
            {grades.map((grade) => (
              <option key={grade.id} value={grade.id}>
                {grade.name}
              </option>
            ))}
          </select>
          {fieldError(state, 'gradeId')}
        </label>

        <label className="block">
          <Label required>Academic year</Label>
          <select
            key={`academicYearId-${response}`}
            name="academicYearId"
            defaultValue={prior?.academicYearId ?? ''}
            className={CONTROL}
          >
            <option value="">Choose a year…</option>
            {years.map((year) => (
              <option key={year.id} value={year.id}>
                {year.name}
              </option>
            ))}
          </select>
          {fieldError(state, 'academicYearId')}
        </label>
      </div>

      <div>
        <Label>Existing sections</Label>
        <select
          key={`sectionIds-${response}`}
          name="sectionIds"
          multiple
          size={Math.min(6, Math.max(3, sections.length))}
          defaultValue={state.selected?.sectionIds ?? []}
          className={CONTROL}
        >
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.name}
            </option>
          ))}
        </select>
        {fieldError(state, 'sectionIds')}
      </div>

      <label className="block">
        <Label>Or new ones</Label>
        <input
          name="newSectionNames"
          defaultValue={prior?.newSectionNames ?? ''}
          placeholder="C, D"
          className={CONTROL}
        />
      </label>

      <div className="flex items-center gap-3 pt-1">
        <button type="submit" disabled={pending} className={SUBMIT}>
          {pending ? 'Working…' : 'Add sections'}
        </button>
        <Feedback state={state} />
      </div>

      <p className="text-[11px] text-stone">
        A class that already exists for that grade, year and section is left alone.
      </p>
    </form>
  )
}

/* ----------------------------------------------------- subjects on a class --- */

export function ClassSubjectsForm({
  classes,
  subjects,
  currentByClass,
}: {
  classes: Choice[]
  subjects: Choice[]
  currentByClass: Record<number, number[]>
}) {
  const [state, formAction, pending] = useActionState<SetupState, FormData>(classSubjectsAction, {})

  /*
    The class picker drives which subjects are pre-ticked, so its value is
    mirrored in client state — but it is not the source of truth for the field.
    A controlled field cannot survive React 19's post-action form reset; see
    useFormResponse.
  */
  const prior = state.values
  const response = useFormResponse(state)
  const submittedClassId = prior?.classId ?? ''

  const [classId, setClassId] = useState(submittedClassId)
  const [seen, setSeen] = useState(response)
  if (seen !== response) {
    setSeen(response)
    setClassId(submittedClassId)
  }

  const current = currentByClass[Number(classId)] ?? []

  return (
    <form action={formAction} className="space-y-3 p-6 pt-0">
      <label className="block">
        <Label required>Class</Label>
        <select
          key={`classId-${response}`}
          name="classId"
          defaultValue={submittedClassId}
          onChange={(event) => setClassId(event.target.value)}
          className={CONTROL}
        >
          <option value="">Choose a class…</option>
          {classes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        {fieldError(state, 'classId')}
      </label>

      <div>
        <Label>Subjects</Label>
        <select
          /*
            Remounts on a class change so the current curriculum shows as
            selected, and on each reply from the action so a refusal does not
            reset the ticks — the reply is in the key for that second reason.
          */
          key={`${classId}-${response}`}
          name="subjectIds"
          multiple
          size={Math.min(10, Math.max(5, subjects.length))}
          defaultValue={state.selected?.subjectIds ?? current.map(String)}
          disabled={!classId}
          className={CONTROL}
        >
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-[11px] text-stone">
          {classId
            ? 'Pre-ticked with what the class studies today. Unticking deactivates the row rather than deleting it, so recorded marks survive.'
            : 'Choose a class first.'}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <Label required>Type</Label>
          <select
            key={`subjectType-${response}`}
            name="subjectType"
            defaultValue={prior?.subjectType || 'compulsory'}
            className={CONTROL}
          >
            <option value="compulsory">Compulsory</option>
            <option value="optional">Optional</option>
            <option value="stream">Stream</option>
            <option value="elective">Elective</option>
            <option value="non_graded">Non-graded</option>
          </select>
        </label>

        <label className="block">
          <Label required>Maximum mark</Label>
          <input
            name="maximumMark"
            type="number"
            step="0.01"
            min={0.01}
            defaultValue={prior ? prior.maximumMark : '100'}
            className={CONTROL}
          />
          {fieldError(state, 'maximumMark')}
        </label>

        <label className="block">
          <Label required>Pass mark</Label>
          <input
            name="passMark"
            type="number"
            step="0.01"
            min={0}
            defaultValue={prior ? prior.passMark : '50'}
            className={CONTROL}
          />
          {fieldError(state, 'passMark')}
        </label>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button type="submit" disabled={pending} className={SUBMIT}>
          {pending ? 'Saving…' : 'Set subjects'}
        </button>
        <Feedback state={state} />
      </div>

      <p className="text-[11px] text-stone">
        Type and marks apply to subjects being added. Ones already on the class keep what they have.
      </p>
    </form>
  )
}
