'use client'

import { useActionState } from 'react'
import { Button, Note } from '@/components/ui'
import {
  FormActions,
  FormError,
  FormSection,
  TextField,
} from '@/components/ui/form'
import { createBranchAction, updateBranchAction, type FacilityFormState } from './actions'

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

export interface BranchValues {
  name: string
  code: string
  address: string
  active: string
}

export function BranchForm({
  mode,
  id,
  values,
}: {
  mode: 'create' | 'edit'
  id?: number
  values: BranchValues
}) {
  const [state, formAction, pending] = useActionState<FacilityFormState, FormData>(
    mode === 'create' ? createBranchAction : updateBranchAction,
    {},
  )
  const value = (key: keyof BranchValues) => state.values?.[key] ?? values[key]
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction}>
      {mode === 'edit' && id ? <input type="hidden" name="id" value={id} /> : null}
      <FormError>{state.error}</FormError>

      <FormSection title="Branch">
        <TextField
          label="Name"
          name="name"
          required
          defaultValue={value('name')}
          error={errors.name}
          hint="Odoo keeps branch names unique."
        />
        <TextField
          label="Code"
          name="code"
          defaultValue={value('code')}
          error={errors.code}
          placeholder="MAIN"
        />
        <TextField
          label="Address"
          name="address"
          defaultValue={value('address')}
          error={errors.address}
          className="sm:col-span-2"
        />
        <ActiveField defaultChecked={value('active') !== 'false'} />
      </FormSection>

      <FormActions>
        <Button type="submit" variant="primary" pending={pending}>
          {mode === 'create' ? 'Add branch' : 'Save changes'}
        </Button>
      </FormActions>

      {mode === 'create' ? (
        <Note>
          Classes, staff, responsibilities, announcements and programs can all be scoped to a
          branch. Adding one here makes it available wherever a branch is chosen.
        </Note>
      ) : null}
    </form>
  )
}

