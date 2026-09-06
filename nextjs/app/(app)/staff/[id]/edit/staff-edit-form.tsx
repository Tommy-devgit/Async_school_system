'use client'

import Link from 'next/link'
import { useActionState, useMemo, useState } from 'react'
import { Button, cx } from '@/components/ui'
import {
  Field,
  FormActions,
  FormError,
  FormResponse,
  FormSection,
  INPUT_CLASS,
  INPUT_INVALID,
  ReadOnlyField,
  SelectField,
  TextField,
  type Option,
} from '@/components/ui/form'
import { updateStaffAction, type FormState } from '../../actions'

interface JobTitle {
  id: number
  name: string
  department: string
  responsibility: string
}

export interface StaffEditValues {
  id: number
  name: string
  staff_id: string
  first_name: string
  last_name: string
  gender: string
  date_of_birth: string
  fayda_id: string
  phone: string
  mobile: string
  email: string
  department: string
  job_title_id: string
  employment_type: string
  employment_status: string
  hire_date: string
  end_date: string
  campus_id: string
  manager_id: string
}

/**
 * Editing a staff record.
 *
 * Which inputs exist is decided by Odoo, not by this component: the page asks
 * `fields_get` as the signed-in user, and Odoo omits fields that user may not
 * touch. A registrar sees the Fayda ID and date of birth; anyone without the
 * personal-data groups simply has no such input, so the form never posts a
 * field whose write would be refused.
 *
 * What is *not* here is as deliberate: `name` and `staff_id` are computed or
 * sequence-assigned, and `state` moves through the workflow panel on the
 * record page, because activation mints the staff number, creates the
 * hr.employee and cascades to teacher profiles.
 */
export function StaffEditForm({
  staff,
  jobTitles,
  departments,
  genders,
  employmentTypes,
  employmentStatuses,
  campuses,
  managers,
  editable,
}: {
  staff: StaffEditValues
  jobTitles: JobTitle[]
  departments: Option[]
  genders: Option[]
  employmentTypes: Option[]
  employmentStatuses: Option[]
  campuses: Array<{ id: number; name: string }>
  managers: Array<{ id: number; name: string; staff_id: string | false }>
  /** Field names Odoo returned for this user. Anything absent is not rendered. */
  editable: string[]
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(updateStaffAction, {})
  const prior = state.values ?? {}
  const value = (field: keyof StaffEditValues) =>
    prior[field] !== undefined ? prior[field] : String(staff[field] ?? '')

  const [department, setDepartment] = useState(value('department'))
  const can = (field: string) => editable.includes(field)
  const errors = state.fieldErrors ?? {}

  // Odoo's job_title_id domain is [('department','=',department)] and
  // _check_job_title_department enforces it, so the list narrows as the
  // department changes rather than letting the user pick a pair Odoo refuses.
  const titlesForDepartment = useMemo(
    () => jobTitles.filter((title) => !department || title.department === department),
    [jobTitles, department],
  )

  return (
    <FormResponse state={state}>
      <form action={formAction} className="space-y-6">
        <input type="hidden" name="id" value={staff.id} />
        <FormError>{state.error}</FormError>

        <FormSection title="Identity" hint="The display name is composed by Odoo from the parts below.">
          <ReadOnlyField label="Staff number" value={staff.staff_id} hint="Assigned by Odoo on activation." />
          <ReadOnlyField label="Full name" value={staff.name} />
          {can('first_name') ? (
            <TextField
              label="First name"
              name="first_name"
              required
              defaultValue={value('first_name')}
              error={errors.first_name}
            />
          ) : null}
          {can('last_name') ? (
            <TextField
              label="Last name"
              name="last_name"
              required
              defaultValue={value('last_name')}
              error={errors.last_name}
            />
          ) : null}
          {can('gender') ? (
            <SelectField
              label="Gender"
              name="gender"
              options={genders}
              defaultValue={value('gender')}
              error={errors.gender}
            />
          ) : null}
          {can('date_of_birth') ? (
            <TextField
              label="Date of birth"
              name="date_of_birth"
              type="date"
              defaultValue={value('date_of_birth')}
              error={errors.date_of_birth}
              hint="Required before the record can leave Draft."
            />
          ) : null}
          {can('fayda_id') ? (
            <TextField
              label="Fayda ID"
              name="fayda_id"
              inputMode="numeric"
              maxLength={16}
              defaultValue={value('fayda_id')}
              error={errors.fayda_id}
              hint="Exactly 16 digits, unique across staff."
            />
          ) : null}
        </FormSection>

        <FormSection title="Contact">
          {can('phone') ? (
            <TextField
              label="Primary phone"
              name="phone"
              defaultValue={value('phone')}
              error={errors.phone}
              hint="Required before the record can leave Draft."
            />
          ) : null}
          {can('mobile') ? (
            <TextField label="Mobile" name="mobile" defaultValue={value('mobile')} error={errors.mobile} />
          ) : null}
          {can('email') ? (
            <TextField
              label="Email"
              name="email"
              type="email"
              defaultValue={value('email')}
              error={errors.email}
              hint="Needed before a teaching login can be created."
            />
          ) : null}
        </FormSection>

        <FormSection title="Role and employment">
          {can('department') ? (
            <Field label="Department" htmlFor="department" required error={errors.department}>
              <select
                id="department"
                name="department"
                required
                value={department}
                onChange={(event) => setDepartment(event.target.value)}
                className={cx(INPUT_CLASS, errors.department && INPUT_INVALID)}
              >
                <option value="">Choose…</option>
                {departments.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {can('job_title_id') ? (
            <SelectField
              label="Job title"
              name="job_title_id"
              required
              options={titlesForDepartment.map((title) => ({
                value: String(title.id),
                label: title.name,
              }))}
              defaultValue={value('job_title_id')}
              error={errors.job_title_id}
              hint={department ? undefined : 'Choose a department first.'}
            />
          ) : null}
          {can('employment_status') ? (
            <SelectField
              label="Employment status"
              name="employment_status"
              required
              options={employmentStatuses}
              defaultValue={value('employment_status')}
              error={errors.employment_status}
            />
          ) : null}
          {can('employment_type') ? (
            <SelectField
              label="Employment type"
              name="employment_type"
              options={employmentTypes}
              defaultValue={value('employment_type')}
              error={errors.employment_type}
            />
          ) : null}
          {can('hire_date') ? (
            <TextField label="Hire date" name="hire_date" type="date" defaultValue={value('hire_date')} />
          ) : null}
          {can('end_date') ? (
            <TextField label="End date" name="end_date" type="date" defaultValue={value('end_date')} />
          ) : null}
          {can('campus_id') && campuses.length ? (
            <SelectField
              label="Campus"
              name="campus_id"
              options={campuses.map((c) => ({ value: String(c.id), label: c.name }))}
              defaultValue={value('campus_id')}
              placeholder="None"
            />
          ) : null}
          {can('manager_id') && managers.length ? (
            <SelectField
              label="Reporting manager"
              name="manager_id"
              options={managers.map((m) => ({
                value: String(m.id),
                label: m.staff_id ? `${m.name} · ${m.staff_id}` : m.name,
              }))}
              defaultValue={value('manager_id')}
              placeholder="None"
              hint="A staff member cannot report to themselves."
            />
          ) : null}
        </FormSection>

        <FormActions>
          <Button type="submit" pending={pending}>
            {pending ? 'Saving…' : 'Save changes'}
          </Button>
          <Link
            href={`/staff/${staff.id}`}
            className="rounded-[9999px] border border-silver px-5 py-2.5 text-[13px] hover:bg-paper"
          >
            Cancel
          </Link>
        </FormActions>
      </form>
    </FormResponse>
  )
}
