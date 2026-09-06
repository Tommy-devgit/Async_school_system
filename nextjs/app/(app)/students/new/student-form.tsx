'use client'

import Link from 'next/link'

import { useActionState, useState } from 'react'
import { formatSelection } from '@/lib/format'
import { registerStudentAction, type StudentFormState } from '../actions'

interface Option {
  value: string
  label: string
}

interface ClassOption {
  id: number
  name: string
  year: string
  level: string
  entryLevel: boolean
}

const INPUT =
  'w-full rounded-[8px] border border-silver bg-white px-3 py-2 text-[13px] text-graphite ' +
  'placeholder:text-stone focus:border-action-blue focus:outline-none'

function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  hint?: string
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

      {hint && !error ? (
        <p className="mt-1 text-[11px] text-stone">{hint}</p>
      ) : null}

      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="mt-1 text-[11px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="border-t border-silver pt-5 first:border-0 first:pt-0">
      <h2 className="text-[15px] leading-tight">{title}</h2>

      {hint ? (
        <p className="mt-0.5 mb-3 text-[12px] text-slate">{hint}</p>
      ) : (
        <div className="mb-3" />
      )}

      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

function FileField({
  label,
  htmlFor,
  required,
  hint,
  error,
}: {
  label: string
  htmlFor: string
  required?: boolean
  hint?: string
  error?: string
}) {
  return (
    <Field
      label={label}
      htmlFor={htmlFor}
      required={required}
      hint={hint}
      error={error}
    >
      <input
        id={htmlFor}
        name={htmlFor}
        type="file"
        accept=".pdf,.png"
        className="w-full rounded-[8px] border border-silver bg-white px-3 py-2 text-[12px] text-slate file:mr-3 file:rounded-[9999px] file:border file:border-silver file:bg-paper file:px-3 file:py-1.5 file:text-[12px] file:text-graphite hover:file:bg-paper"
      />
    </Field>
  )
}

export function StudentRegistrationForm({
  classes,
  genders,
  admissionTypes,
  canSeeFan,
}: {
  classes: ClassOption[]
  genders: Option[]
  admissionTypes: Option[]
  canSeeFan: boolean
}) {
  const [state, formAction, pending] = useActionState<StudentFormState, FormData>(
    registerStudentAction,
    {},
  )

  const prior = state.values ?? {}

  const [classId, setClassId] = useState(prior.class_id ?? '')
  const [admissionType, setAdmissionType] = useState(
    prior.admission_type ?? 'new',
  )

  const chosen = classes.find((c) => String(c.id) === classId)
  const err = state.fieldErrors ?? {}

  // Returning / re-admitted students already exist in the system — skip
  // personal info entirely and go straight to creating a school.enrollment
  // for the existing student, instead of registering a new one.
  if (admissionType === 'returning' || admissionType === 'readmitted') {
    return (
      <div className="space-y-5">
        <Field label="Admission type" htmlFor="admission_type">
          <select
            id="admission_type"
            className={INPUT}
            value={admissionType}
            onChange={(event) => setAdmissionType(event.target.value)}
          >
            {admissionTypes.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="rounded-[8px] border border-silver bg-paper px-4 py-3 text-[13px] text-graphite">
          {formatSelection(admissionType)} students already exist in the system. Create an
          enrolment for them instead of registering a new student.
        </div>

        <Link
          href="/enrollments/new"
          className="inline-block rounded-[9999px] bg-ink px-5 py-2.5 text-[13px] font-medium text-white hover:bg-graphite"
        >
          Go to new enrolment →
        </Link>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {/* ------------------------------------------------ Student --- */}

      <Section
        title="Student"
        hint="Enter the student's personal and identification information."
      >
        <Field label="Full name" htmlFor="name" required error={err.name}>
          <input
            id="name"
            name="name"
            className={INPUT}
            defaultValue={prior.name ?? ''}
          />
        </Field>

        <Field
          label="Date of birth"
          htmlFor="date_of_birth"
          required
          error={err.date_of_birth}
          hint="Odoo enforces a minimum age for the chosen grade."
        >
          <input
            id="date_of_birth"
            name="date_of_birth"
            type="date"
            className={INPUT}
            defaultValue={prior.date_of_birth ?? ''}
          />
        </Field>

        <Field label="Place of birth" htmlFor="place_of_birth">
          <input
            id="place_of_birth"
            name="place_of_birth"
            className={INPUT}
            defaultValue={prior.place_of_birth ?? ''}
          />
        </Field>

        <Field label="Gender" htmlFor="gender">
          <select
            id="gender"
            name="gender"
            className={INPUT}
            defaultValue={prior.gender ?? ''}
          >
            <option value="">Not specified</option>

            {genders.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Primary language" htmlFor="primary_language">
          <input
            id="primary_language"
            name="primary_language"
            className={INPUT}
            defaultValue={prior.primary_language ?? ''}
          />
        </Field>

        <Field
          label="Email"
          htmlFor="email"
          error={err.email}
        >
          <input
            id="email"
            name="email"
            type="email"
            className={INPUT}
            defaultValue={prior.email ?? ''}
          />
        </Field>

        {canSeeFan ? (
          <Field
            label="FAN (National ID)"
            htmlFor="fan_number"
            error={err.fan_number}
            hint="Exactly 16 digits. Required before the registration can be submitted."
          >
            <input
              id="fan_number"
              name="fan_number"
              inputMode="numeric"
              className={INPUT}
              defaultValue={prior.fan_number ?? ''}
            />
          </Field>
        ) : null}

        <Field
          label="National ID"
          htmlFor="national_id"
          error={err.national_id}
        >
          <input
            id="national_id"
            name="national_id"
            className={INPUT}
            defaultValue={prior.national_id ?? ''}
          />
        </Field>

        <Field
          label="Regional ID"
          htmlFor="regional_id"
          error={err.regional_id}
        >
          <input
            id="regional_id"
            name="regional_id"
            className={INPUT}
            defaultValue={prior.regional_id ?? ''}
          />
        </Field>

        <Field
          label="Student photo"
          htmlFor="photo"
          hint="PNG only."
        >
          <input
            id="photo"
            name="photo"
            type="file"
            accept=".png,image/png"
            className="w-full rounded-[8px] border border-silver bg-white px-3 py-2 text-[12px] text-slate file:mr-3 file:rounded-[9999px] file:border file:border-silver file:bg-paper file:px-3 file:py-1.5 file:text-[12px] file:text-graphite hover:file:bg-paper"
          />
        </Field>
      </Section>

      {/* ------------------------------------------------ Placement --- */}

      <Section
        title="Placement"
        hint="The academic year, section, stream and education level are taken from the class, exactly as Odoo derives them."
      >
        <Field
          label="Grade / class"
          htmlFor="class_id"
          required
          error={err.class_id}
        >
          <select
            id="class_id"
            name="class_id"
            className={INPUT}
            value={classId}
            onChange={(event) => setClassId(event.target.value)}
          >
            <option value="">Choose…</option>

            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.year}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Admission type" htmlFor="admission_type">
          <select
            id="admission_type"
            name="admission_type"
            className={INPUT}
            value={admissionType}
            onChange={(event) => setAdmissionType(event.target.value)}
          >
            {admissionTypes.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        {chosen ? (
          <p className="text-[11px] text-stone sm:col-span-2">
            {chosen.name} sits in {chosen.year}
            {chosen.level ? ` · ${formatSelection(chosen.level)}` : ''}
            {chosen.entryLevel
              ? ' · entry level, so no previous-grade document is needed'
              : ' · a previous-grade document is needed before submission'}
            .
          </p>
        ) : null}

        {admissionType === 'transfer' ? (
          <>
            <Field
              label="Previous school"
              htmlFor="previous_school"
              required
              error={err.previous_school}
              hint="Required for transfer admission."
            >
              <input
                id="previous_school"
                name="previous_school"
                className={INPUT}
                defaultValue={prior.previous_school ?? ''}
              />
            </Field>

            <Field
              label="Transfer reference"
              htmlFor="transfer_reference"
              required
              error={err.transfer_reference}
              hint="Reference or evidence identifying the transfer."
            >
              <input
                id="transfer_reference"
                name="transfer_reference"
                className={INPUT}
                defaultValue={prior.transfer_reference ?? ''}
              />
            </Field>
          </>
        ) : null}

        <Field label="Registration date" htmlFor="registration_date">
          <input
            id="registration_date"
            name="registration_date"
            type="date"
            className={INPUT}
            defaultValue={prior.registration_date ?? ''}
          />
        </Field>

        <Field
          label="Additional support needed"
          htmlFor="support_need"
          hint="Select this if the student requires additional support."
        >
          <label className="flex min-h-[38px] items-center gap-2 rounded-[8px] border border-silver bg-white px-3 py-2 text-[13px] text-graphite">
            <input
              id="support_need"
              name="support_need"
              type="checkbox"
              defaultChecked={prior.support_need === 'true'}
            />
            Student requires additional support
          </label>
        </Field>
      </Section>

      {/* ----------------------------------------------- Parent / guardian --- */}

      <Section
        title="Parent / guardian"
        hint="The guardian information is saved with the registration. Odoo creates the guardian relationship when the registration is approved."
      >
        <Field
          label="Guardian name"
          htmlFor="guardian_name"
          required
          error={err.guardian_name}
        >
          <input
            id="guardian_name"
            name="guardian_name"
            className={INPUT}
            defaultValue={prior.guardian_name ?? ''}
          />
        </Field>

        <Field
          label="Guardian phone"
          htmlFor="guardian_phone"
          required
          error={err.guardian_phone}
          hint="Local number, or include + and the country code."
        >
          <input
            id="guardian_phone"
            name="guardian_phone"
            className={INPUT}
            defaultValue={prior.guardian_phone ?? ''}
          />
        </Field>

        <Field
          label="Relationship"
          htmlFor="guardian_relationship"
          required
          error={err.guardian_relationship}
        >
          <select
            id="guardian_relationship"
            name="guardian_relationship"
            className={INPUT}
            defaultValue={prior.guardian_relationship ?? 'guardian'}
          >
            <option value="father">Father</option>
            <option value="mother">Mother</option>
            <option value="guardian">Guardian</option>
            <option value="other">Other</option>
          </select>
        </Field>

        <Field
          label="Occupation"
          htmlFor="guardian_occupation"
          error={err.guardian_occupation}
        >
          <input
            id="guardian_occupation"
            name="guardian_occupation"
            className={INPUT}
            defaultValue={prior.guardian_occupation ?? ''}
          />
        </Field>

        <Field
          label="Emergency contact name"
          htmlFor="emergency_contact_name"
          required
          error={err.emergency_contact_name}
        >
          <input
            id="emergency_contact_name"
            name="emergency_contact_name"
            className={INPUT}
            defaultValue={prior.emergency_contact_name ?? ''}
          />
        </Field>

        <Field
          label="Emergency contact phone"
          htmlFor="emergency_contact_phone"
          required
          error={err.emergency_contact_phone}
        >
          <input
            id="emergency_contact_phone"
            name="emergency_contact_phone"
            className={INPUT}
            defaultValue={prior.emergency_contact_phone ?? ''}
          />
        </Field>
      </Section>

      {/* ------------------------------------------------ Documents --- */}

      <Section
        title="Documents"
        hint="Only PDF and PNG files are accepted."
      >
        <FileField
          label="Birth certificate"
          htmlFor="birth_certificate"
          error={err.birth_certificate}
          hint="PDF or PNG. Can be attached later, before submission."
        />

        {!chosen?.entryLevel ? (
          <FileField
            label="Previous-grade document"
            htmlFor="previous_grade_document"
            error={err.previous_grade_document}
            hint="PDF or PNG. Can be attached later, before submission."
          />
        ) : null}
      </Section>

      {/* ------------------------------------------------ Errors --- */}

      {state.error ? (
        <p
          role="alert"
          className="rounded-[8px] bg-danger-bg px-3 py-2 text-[13px] text-danger"
        >
          {state.error}
        </p>
      ) : null}

      {/* ------------------------------------------------ Submit --- */}

      <div className="flex items-center gap-3 border-t border-silver pt-5">
        <button
          id="submit-student"
          type="submit"
          disabled={pending}
          className="rounded-[9999px] bg-ink px-5 py-2.5 text-[13px] font-medium text-white hover:bg-graphite disabled:opacity-50"
        >
          {pending ? 'Creating…' : 'Create registration'}
        </button>

        <span className="text-[12px] text-stone">
          Created in Draft — submit and approve from the student record.
        </span>
      </div>
    </form>
  )
}