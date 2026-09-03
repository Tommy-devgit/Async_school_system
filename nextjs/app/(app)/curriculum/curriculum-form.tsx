'use client'

import { useActionState } from 'react'
import { Button, Note } from '@/components/ui'
import {
  FormActions,
  FormError,
  FormSection,
  SelectField,
  TextField,
  type Option,
} from '@/components/ui/form'
import { updateCurriculumAction, type FacilityFormState } from './actions'

function ActiveField({ defaultChecked }: { defaultChecked: boolean }) {
  return (
    <label className="flex items-start gap-2.5 sm:col-span-2">
      <input type="hidden" name="active" value="false" />
      <input
        type="checkbox"
        name="active"
        value="true"
        defaultChecked={defaultChecked}
        className="mt-0.5 h-4 w-4 rounded-[4px] border-silver text-action-blue focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-action-blue"
      />
      <span>
        <span className="block text-[13px] text-graphite">Active</span>
        <span className="block text-[11px] text-stone">
          Archiving hides it from every picker without deleting it, so existing
          records keep pointing at it.
        </span>
      </span>
    </label>
  )
}

export interface CurriculumValues {
  subject_type: string
  maximum_mark: string
  pass_mark: string
  optional_selection_limit: string
  active: string
}

/**
 * How one subject is graded for one class.
 *
 * The class and the subject are shown, not edited. The pair is unique in Odoo
 * and every mark and report-card snapshot already hangs off it, so re-pointing
 * a line would rewrite history rather than correct it — removing the subject
 * and adding the right one is the honest operation, and the class-subjects
 * form on the configuration screen already does that.
 */
export function CurriculumForm({
  id,
  className,
  subjectName,
  values,
  subjectTypes,
}: {
  id: number
  className: string
  subjectName: string
  values: CurriculumValues
  subjectTypes: Option[]
}) {
  const [state, formAction, pending] = useActionState<FacilityFormState, FormData>(
    updateCurriculumAction,
    {},
  )
  const value = (key: keyof CurriculumValues) => state.values?.[key] ?? values[key]
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <FormError>{state.error}</FormError>

      <FormSection title={`${subjectName} in ${className}`}>
        <SelectField
          label="Type"
          name="subject_type"
          options={subjectTypes}
          defaultValue={value('subject_type')}
          error={errors.subject_type}
          hint="Compulsory subjects are taken by everybody; optional and elective ones are chosen."
        />
        <TextField
          label="Selection limit"
          name="optional_selection_limit"
          type="number"
          min={0}
          step={1}
          defaultValue={value('optional_selection_limit')}
          error={errors.optional_selection_limit}
          hint="How many of this kind a student must choose. Only meaningful for optional and elective subjects; leave at zero otherwise."
        />
        <TextField
          label="Maximum mark"
          name="maximum_mark"
          type="number"
          min={1}
          step="any"
          required
          defaultValue={value('maximum_mark')}
          error={errors.maximum_mark}
          hint="What a mark for this subject is out of."
        />
        <TextField
          label="Pass mark"
          name="pass_mark"
          type="number"
          min={0}
          step="any"
          required
          defaultValue={value('pass_mark')}
          error={errors.pass_mark}
          hint="Odoo keeps this between zero and the maximum."
        />
        <ActiveField defaultChecked={value('active') !== 'false'} />
      </FormSection>

      <FormActions>
        <Button type="submit" variant="primary" pending={pending}>
          Save changes
        </Button>
      </FormActions>

      <Note>
        Report cards are generated against these numbers, so changing the maximum after marks are
        recorded changes what those marks mean. Odoo keeps the marks themselves untouched.
      </Note>
    </form>
  )
}
