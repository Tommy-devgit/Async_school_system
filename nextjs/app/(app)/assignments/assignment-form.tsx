'use client'

import Link from 'next/link'
import { useActionState, useMemo, useState } from 'react'
import { Button, Note } from '@/components/ui'
import {
  Field,
  FormActions,
  FormError,
  FormResponse,
  FormSection,
  INPUT_CLASS,
  INPUT_INVALID,
  SelectField,
  TextField,
  type Option,
} from '@/components/ui/form'
import { cx } from '@/components/ui'
import { createAssignmentAction, updateAssignmentAction, type AssignmentFormState } from './actions'

export interface AssignmentFormData {
  id?: number
  teacher_id: string
  class_id: string
  subject_id: string
  term_id: string
  responsibility: string
  teaching_role: string
  weekly_periods: string
  start_date: string
  end_date: string
}

export interface PickerData {
  teachers: Array<{ id: number; name: string; teacher_id: string; periods: number; max: number }>
  classes: Array<{ id: number; name: string; yearId: number; yearName: string }>
  subjects: Array<{ id: number; name: string }>
  curriculum: Array<{ classId: number; subjectId: number }>
  terms: Array<{ id: number; name: string; yearId: number; start: string; end: string }>
  responsibilities: Option[]
  teachingRoles: Option[]
}

/**
 * Creating and editing an assignment.
 *
 * Two of Odoo's onchange methods never fire over RPC, and both of them exist to
 * stop the user building a combination the constraints will reject:
 *
 *   _onchange_class_id  clears a subject that is not on the class's curriculum,
 *                       and a term belonging to a different academic year
 *   _onchange_term_id   fills the effective dates from the term
 *
 * The first is reproduced here as filtering — the subject and term lists narrow
 * once a class is chosen. The second is not reproduced at all, because Odoo's
 * `create` and `write` overrides already fill the dates server-side; asking for
 * them would be asking the user to type the term's own range twice.
 *
 * None of this is a rules engine. It removes choices Odoo would refuse; Odoo
 * still refuses them if they arrive another way.
 */
export function AssignmentForm({
  mode,
  values,
  pickers,
}: {
  mode: 'create' | 'edit'
  values: AssignmentFormData
  pickers: PickerData
}) {
  const action = mode === 'create' ? createAssignmentAction : updateAssignmentAction
  const [state, formAction, pending] = useActionState<AssignmentFormState, FormData>(action, {})
  const prior = state.values ?? {}
  const initial = (field: keyof AssignmentFormData) =>
    prior[field] !== undefined ? prior[field] : String(values[field] ?? '')

  const [classId, setClassId] = useState(initial('class_id'))
  const [teacherId, setTeacherId] = useState(initial('teacher_id'))
  const errors = state.fieldErrors ?? {}

  const chosenClass = useMemo(
    () => pickers.classes.find((c) => String(c.id) === classId),
    [pickers.classes, classId],
  )

  /*
    A class with a curriculum accepts only what is on it; a class with none
    accepts anything. That second half matters — _check_subject_on_curriculum
    only fires `if curriculum and not offered`, so filtering to an empty list
    would make the assignment impossible to create rather than merely guided.
  */
  const subjectsForClass = useMemo(() => {
    if (!classId) return pickers.subjects
    const onCurriculum = pickers.curriculum
      .filter((entry) => String(entry.classId) === classId)
      .map((entry) => entry.subjectId)
    if (onCurriculum.length === 0) return pickers.subjects
    return pickers.subjects.filter((subject) => onCurriculum.includes(subject.id))
  }, [pickers.subjects, pickers.curriculum, classId])

  // _check_period: the term must belong to the class's academic year.
  const termsForClass = useMemo(() => {
    if (!chosenClass) return pickers.terms
    return pickers.terms.filter((term) => term.yearId === chosenClass.yearId)
  }, [pickers.terms, chosenClass])

  const chosenTeacher = pickers.teachers.find((t) => String(t.id) === teacherId)

  return (
    <FormResponse state={state}>
      <form action={formAction} className="space-y-6">
        {mode === 'edit' && values.id ? <input type="hidden" name="id" value={values.id} /> : null}
        <FormError>{state.error}</FormError>

        <FormSection
          title="Who and what"
          hint="Odoo allows one active teacher per subject, class and term."
        >
          <Field label="Teacher" htmlFor="teacher_id" required error={errors.teacher_id}>
            <select
              id="teacher_id"
              name="teacher_id"
              required
              value={teacherId}
              onChange={(event) => setTeacherId(event.target.value)}
              className={cx(INPUT_CLASS, errors.teacher_id && INPUT_INVALID)}
            >
              <option value="">Choose…</option>
              {pickers.teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.teacher_id ? `${teacher.name} · ${teacher.teacher_id}` : teacher.name}
                </option>
              ))}
            </select>
            {chosenTeacher && chosenTeacher.max > 0 ? (
              <p className="mt-1 text-[11px] text-stone">
                Currently {chosenTeacher.periods} of {chosenTeacher.max} weekly periods. Odoo refuses
                an assignment that would take them past the maximum.
              </p>
            ) : null}
          </Field>

          <Field label="Class" htmlFor="class_id" required error={errors.class_id}>
            <select
              id="class_id"
              name="class_id"
              required
              value={classId}
              onChange={(event) => setClassId(event.target.value)}
              className={cx(INPUT_CLASS, errors.class_id && INPUT_INVALID)}
            >
              <option value="">Choose…</option>
              {pickers.classes.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                  {option.yearName ? ` · ${option.yearName}` : ''}
                </option>
              ))}
            </select>
            {chosenClass ? (
              <p className="mt-1 text-[11px] text-stone">
                Academic year {chosenClass.yearName}, derived from the class — Odoo sets it.
              </p>
            ) : null}
          </Field>

          <SelectField
            label="Subject"
            name="subject_id"
            required
            options={subjectsForClass.map((subject) => ({
              value: String(subject.id),
              label: subject.name,
            }))}
            defaultValue={initial('subject_id')}
            error={errors.subject_id}
            hint={
              classId
                ? subjectsForClass.length === pickers.subjects.length
                  ? 'This class has no curriculum set, so any subject is accepted.'
                  : "Narrowed to this class's curriculum."
                : 'Choose a class first to narrow this to its curriculum.'
            }
          />

          <SelectField
            label="Term"
            name="term_id"
            required
            options={termsForClass.map((term) => ({ value: String(term.id), label: term.name }))}
            defaultValue={initial('term_id')}
            error={errors.term_id}
            hint={
              classId
                ? "Only terms in this class's academic year."
                : 'Choose a class first to narrow this to its academic year.'
            }
          />
        </FormSection>

        <FormSection title="Role and workload">
          <SelectField
            label="Responsibility"
            name="responsibility"
            options={pickers.responsibilities}
            defaultValue={initial('responsibility') || 'teacher'}
            error={errors.responsibility}
            hint="Only one homeroom teacher per class and term."
            placeholder="Teacher"
          />
          <SelectField
            label="Teaching role"
            name="teaching_role"
            options={pickers.teachingRoles}
            defaultValue={initial('teaching_role') || 'lead'}
            placeholder="Lead teacher"
          />
          <TextField
            label="Periods per week"
            name="weekly_periods"
            type="number"
            min={1}
            required
            defaultValue={initial('weekly_periods') || '1'}
            error={errors.weekly_periods}
          />
        </FormSection>

        <FormSection
          title="Effective dates"
          hint="Leave blank and Odoo takes the term's own start and end."
        >
          <TextField
            label="Start date"
            name="start_date"
            type="date"
            defaultValue={initial('start_date')}
            error={errors.start_date}
          />
          <TextField
            label="End date"
            name="end_date"
            type="date"
            defaultValue={initial('end_date')}
            error={errors.end_date}
          />
        </FormSection>

        <Note>
          On save Odoo checks that nobody else already teaches this subject to this class this term,
          that a second homeroom teacher is not being added, that the staff member can take work,
          that the subject is on the curriculum, that the dates sit inside the term, and that the
          teacher stays within their weekly maximum. If any of those fails you will see its own
          message here.
        </Note>

        <FormActions>
          <Button type="submit" pending={pending}>
            {pending
              ? 'Saving…'
              : mode === 'create'
                ? 'Create assignment'
                : 'Save changes'}
          </Button>
          <Link
            href={mode === 'edit' && values.id ? `/assignments/${values.id}` : '/assignments'}
            className="rounded-[9999px] border border-silver px-5 py-2.5 text-[13px] hover:bg-paper"
          >
            Cancel
          </Link>
        </FormActions>
      </form>
    </FormResponse>
  )
}
