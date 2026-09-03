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
import { createRoomAction, updateRoomAction, type FacilityFormState } from './actions'

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

export interface RoomValues {
  name: string
  code: string
  room_type: string
  capacity: string
  active: string
}

export function RoomForm({
  mode,
  id,
  values,
  roomTypes,
}: {
  mode: 'create' | 'edit'
  id?: number
  values: RoomValues
  roomTypes: Option[]
}) {
  const [state, formAction, pending] = useActionState<FacilityFormState, FormData>(
    mode === 'create' ? createRoomAction : updateRoomAction,
    {},
  )
  const value = (key: keyof RoomValues) => state.values?.[key] ?? values[key]
  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction}>
      {mode === 'edit' && id ? <input type="hidden" name="id" value={id} /> : null}
      <FormError>{state.error}</FormError>

      <FormSection title="Room">
        <TextField
          label="Name"
          name="name"
          required
          defaultValue={value('name')}
          error={errors.name}
          hint="Odoo keeps room names unique."
        />
        <TextField
          label="Code"
          name="code"
          defaultValue={value('code')}
          error={errors.code}
          placeholder="R-301"
        />
        <SelectField
          label="Type"
          name="room_type"
          options={roomTypes}
          defaultValue={value('room_type')}
          error={errors.room_type}
        />
        <TextField
          label="Capacity"
          name="capacity"
          type="number"
          min={0}
          step={1}
          defaultValue={value('capacity')}
          error={errors.capacity}
          hint="How many people it seats. Leave blank if it is not recorded."
        />
        <ActiveField defaultChecked={value('active') !== 'false'} />
      </FormSection>

      <FormActions>
        <Button type="submit" variant="primary" pending={pending}>
          {mode === 'create' ? 'Add room' : 'Save changes'}
        </Button>
      </FormActions>

      {mode === 'create' ? (
        <Note>
          A room is what a class and a timetable slot both point at. Adding one here makes it
          available in those pickers immediately.
        </Note>
      ) : null}
    </form>
  )
}

