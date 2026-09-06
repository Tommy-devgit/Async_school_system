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
  INPUT_CLASS,
  TextField,
} from '@/components/ui/form'
import { uploadDocumentAction, type DocumentFormState } from './actions'

export interface Choice {
  value: string
  label: string
}

/**
 * Filing a document against a student or a staff member.
 *
 * The owner is one field or the other, never both: `_check_owner` refuses a
 * document unless exactly one of student, staff or guardian is set, so the
 * form asks which kind first and shows only that picker.
 *
 * Guardians are not offered. The model allows a guardian owner, but a guardian
 * is a `res.partner` reached through a student, and there is no screen that
 * lists them as owners — offering a picker with nothing sensible in it would
 * be worse than leaving it to the back office until that screen exists.
 */
export function DocumentForm({
  documentTypes,
  students,
  staff,
}: {
  documentTypes: Choice[]
  students: Choice[]
  staff: Choice[]
}) {
  const [state, formAction, pending] = useActionState<DocumentFormState, FormData>(
    uploadDocumentAction,
    {},
  )

  const prior = state.values
  const errors = state.fieldErrors ?? {}
  const value = (field: keyof NonNullable<typeof prior>) => prior?.[field] ?? ''

  const [ownerKind, setOwnerKind] = useState(value('ownerKind') || 'student')

  return (
    <FormResponse state={state}>
      <form action={formAction} className="space-y-6">
        <FormError>{state.error}</FormError>

        <FormSection title="The document">
          <TextField
            label="Name"
            name="name"
            required
            defaultValue={value('name')}
            error={errors.name}
            placeholder="Birth certificate"
          />
          <Field label="Type" htmlFor="documentTypeId" required error={errors.documentTypeId}>
            <select
              id="documentTypeId"
              name="documentTypeId"
              defaultValue={value('documentTypeId')}
              className={INPUT_CLASS}
            >
              <option value="">Choose…</option>
              {documentTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="File"
            htmlFor="file"
            required
            error={errors.file}
            hint="PDF, JPG or PNG, up to 8 MB. Odoo records a checksum and will not let the history be deleted."
          >
            {/*
              Never re-seeded: a browser will not let a value be put back into a
              file input, so a refused upload has to be chosen again. The rest
              of the form survives so that is the only thing to redo.
            */}
            <input
              id="file"
              type="file"
              name="file"
              required
              accept="application/pdf,image/jpeg,image/png"
              className={INPUT_CLASS}
            />
          </Field>

          <TextField
            label="Expires on"
            name="expiryDate"
            type="date"
            defaultValue={value('expiryDate')}
            hint="Leave blank if it does not expire."
          />
        </FormSection>

        <FormSection title="Who it belongs to" hint="One owner exactly — Odoo refuses anything else.">
          <Field label="Belongs to" htmlFor="ownerKind" required error={errors.ownerKind}>
            <select
              id="ownerKind"
              name="ownerKind"
              value={ownerKind}
              onChange={(event) => setOwnerKind(event.target.value)}
              className={INPUT_CLASS}
            >
              <option value="student">A student</option>
              <option value="staff">A staff member</option>
            </select>
          </Field>

          {ownerKind === 'student' ? (
            <Field label="Student" htmlFor="studentId" required error={errors.studentId}>
              <select
                id="studentId"
                name="studentId"
                defaultValue={value('studentId')}
                className={INPUT_CLASS}
              >
                <option value="">Choose…</option>
                {students.map((student) => (
                  <option key={student.value} value={student.value}>
                    {student.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Staff member" htmlFor="staffId" required error={errors.staffId}>
              <select
                id="staffId"
                name="staffId"
                defaultValue={value('staffId')}
                className={INPUT_CLASS}
              >
                <option value="">Choose…</option>
                {staff.map((member) => (
                  <option key={member.value} value={member.value}>
                    {member.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </FormSection>

        <FormActions>
          <Button type="submit" pending={pending}>
            {pending ? 'Uploading…' : 'File the document'}
          </Button>
          <Link
            href="/documents"
            className="rounded-[9999px] border border-silver px-5 py-2.5 text-[13px] hover:bg-paper"
          >
            Cancel
          </Link>
        </FormActions>
      </form>
    </FormResponse>
  )
}
