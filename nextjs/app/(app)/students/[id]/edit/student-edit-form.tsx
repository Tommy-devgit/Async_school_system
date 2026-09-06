'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { Button } from '@/components/ui'
import { EthiopianDateInput } from '@/components/ui/ethiopian-date-input'
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
import { updateStudentAction, type StudentFormState } from '../../actions'

export interface StudentEditValues {
  id: number
  name: string
  regno: string
  first_name: string
  middle_name: string
  last_name: string
  gender: string
  date_of_birth: string
  place_of_birth: string
  primary_language: string
  email: string
  fan_number: string
  national_id: string
  regional_id: string
  guardian_name: string
  guardian_phone: string
  guardian_relationship: string
  guardian_occupation: string
  emergency_contact_name: string
  emergency_contact_phone: string
  admission_type: string
  previous_school: string
  transfer_reference: string
  registration_date: string
  support_need: boolean
}

/**
 * Correcting a registration.
 *
 * The full name is not an input: `school.student.name` is computed from the
 * three parts, so editing it directly would be undone the next time any part
 * changes. The parts are the field of record and the name follows.
 *
 * Placement is absent for a different reason — class, year, section, stream
 * and education level have to move together or Odoo's `_check_registration_scope`
 * refuses the write, and moving a student between classes is a transfer, not
 * a correction.
 */
export function StudentEditForm({
  student,
  genders,
  admissionTypes,
  relationships,
  editable,
}: {
  student: StudentEditValues
  genders: Option[]
  admissionTypes: Option[]
  relationships: Option[]
  /** Field names Odoo returned for this user. Anything absent is not rendered. */
  editable: string[]
}) {
  const [state, formAction, pending] = useActionState<StudentFormState, FormData>(
    updateStudentAction,
    {},
  )
  const prior = state.values ?? {}
  const value = (field: keyof StudentEditValues) =>
    prior[field] !== undefined ? prior[field] : String(student[field] ?? '')

  const [admissionType, setAdmissionType] = useState(value('admission_type'))
  const can = (field: string) => editable.includes(field)
  const errors = state.fieldErrors ?? {}

  return (
    <FormResponse state={state}>
      <form action={formAction} className="space-y-6">
        <input type="hidden" name="id" value={student.id} />
        <FormError>{state.error}</FormError>

        <FormSection
          title="Identity"
          hint="Odoo composes the full name from the three parts below."
        >
          <ReadOnlyField
            label="Student ID"
            value={student.regno || '—'}
            hint="Minted by Odoo when the registration is approved."
          />
          <ReadOnlyField label="Full name" value={student.name} />
          {can('first_name') ? (
            <TextField
              label="First name"
              name="first_name"
              required
              defaultValue={value('first_name')}
              error={errors.first_name}
            />
          ) : null}
          {can('middle_name') ? (
            <TextField
              label="Middle name"
              name="middle_name"
              defaultValue={value('middle_name')}
              error={errors.middle_name}
              hint="The father's name, where that is the convention."
            />
          ) : null}
          {can('last_name') ? (
            <TextField
              label="Last name"
              name="last_name"
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
              placeholder="Not specified"
              error={errors.gender}
            />
          ) : null}
          {can('date_of_birth') ? (
            <Field
              label="Date of birth"
              htmlFor="date_of_birth"
              required
              error={errors.date_of_birth}
              hint="Odoo enforces a minimum age for the class the student sits in."
            >
              <EthiopianDateInput
                id="date_of_birth"
                name="date_of_birth"
                defaultValue={value('date_of_birth')}
              />
            </Field>
          ) : null}
          {can('place_of_birth') ? (
            <TextField
              label="Place of birth"
              name="place_of_birth"
              defaultValue={value('place_of_birth')}
            />
          ) : null}
          {can('primary_language') ? (
            <TextField
              label="Primary language"
              name="primary_language"
              defaultValue={value('primary_language')}
            />
          ) : null}
          {can('email') ? (
            <TextField
              label="Email"
              name="email"
              type="email"
              defaultValue={value('email')}
              error={errors.email}
            />
          ) : null}
          {can('fan_number') ? (
            <TextField
              label="FAN (National ID)"
              name="fan_number"
              inputMode="numeric"
              maxLength={16}
              defaultValue={value('fan_number')}
              error={errors.fan_number}
              hint="Exactly 16 digits, unique across students."
            />
          ) : null}
          {can('national_id') ? (
            <TextField
              label="National ID"
              name="national_id"
              defaultValue={value('national_id')}
              error={errors.national_id}
            />
          ) : null}
          {can('regional_id') ? (
            <TextField
              label="Regional ID"
              name="regional_id"
              defaultValue={value('regional_id')}
              error={errors.regional_id}
            />
          ) : null}
        </FormSection>

        <FormSection
          title="Parent / guardian"
          hint="The intake contact on the registration. Guardian records themselves are managed on the student page."
        >
          {can('guardian_name') ? (
            <TextField
              label="Guardian name"
              name="guardian_name"
              required
              defaultValue={value('guardian_name')}
              error={errors.guardian_name}
            />
          ) : null}
          {can('guardian_phone') ? (
            <TextField
              label="Guardian phone"
              name="guardian_phone"
              required
              defaultValue={value('guardian_phone')}
              error={errors.guardian_phone}
              hint="Local number, or include + and the country code."
            />
          ) : null}
          {can('guardian_relationship') ? (
            <SelectField
              label="Relationship"
              name="guardian_relationship"
              options={relationships}
              defaultValue={value('guardian_relationship')}
              error={errors.guardian_relationship}
            />
          ) : null}
          {can('guardian_occupation') ? (
            <TextField
              label="Occupation"
              name="guardian_occupation"
              defaultValue={value('guardian_occupation')}
            />
          ) : null}
          {can('emergency_contact_name') ? (
            <TextField
              label="Emergency contact name"
              name="emergency_contact_name"
              required
              defaultValue={value('emergency_contact_name')}
              error={errors.emergency_contact_name}
            />
          ) : null}
          {can('emergency_contact_phone') ? (
            <TextField
              label="Emergency contact phone"
              name="emergency_contact_phone"
              required
              defaultValue={value('emergency_contact_phone')}
              error={errors.emergency_contact_phone}
            />
          ) : null}
        </FormSection>

        <FormSection
          title="Admission"
          hint="The class, academic year and section are a placement, not a correction — move a student with a transfer."
        >
          {can('admission_type') ? (
            <SelectField
              label="Admission type"
              name="admission_type"
              options={admissionTypes}
              value={admissionType}
              onChange={(event) => setAdmissionType(event.target.value)}
              error={errors.admission_type}
            />
          ) : null}
          {can('registration_date') ? (
            <Field
              label="Registration date"
              htmlFor="registration_date"
              required
              error={errors.registration_date}
            >
              <EthiopianDateInput
                id="registration_date"
                name="registration_date"
                defaultValue={value('registration_date')}
              />
            </Field>
          ) : null}
          {can('previous_school') ? (
            <TextField
              label="Previous school"
              name="previous_school"
              required={admissionType === 'transfer'}
              defaultValue={value('previous_school')}
              error={errors.previous_school}
            />
          ) : null}
          {can('transfer_reference') ? (
            <TextField
              label="Transfer reference"
              name="transfer_reference"
              required={admissionType === 'transfer'}
              defaultValue={value('transfer_reference')}
              error={errors.transfer_reference}
            />
          ) : null}
          {can('support_need') ? (
            <Field label="Additional support" htmlFor="support_need">
              {/* An unchecked box posts nothing, which the action cannot tell from
                  a field this role never saw. The hidden input makes the cleared
                  state explicit. */}
              <input type="hidden" name="support_need" value="false" />
              <div className="flex min-h-[38px] items-center gap-2 rounded-[8px] border border-silver bg-white px-3 py-2 text-[13px] text-graphite">
                <input
                  id="support_need"
                  name="support_need"
                  type="checkbox"
                  value="true"
                  defaultChecked={
                    prior.support_need !== undefined
                      ? prior.support_need === 'true'
                      : student.support_need
                  }
                />
                <span>Requires learning or medical support</span>
              </div>
            </Field>
          ) : null}
        </FormSection>

        <FormActions>
          <Button type="submit" pending={pending}>
            {pending ? 'Saving…' : 'Save changes'}
          </Button>
          <Link
            href={`/students/${student.id}`}
            className="rounded-[9999px] border border-silver px-5 py-2.5 text-[13px] hover:bg-paper"
          >
            Cancel
          </Link>
        </FormActions>
      </form>
    </FormResponse>
  )
}
