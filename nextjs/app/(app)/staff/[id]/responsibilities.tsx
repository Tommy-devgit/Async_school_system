'use client'

import { useActionState, useState } from 'react'
import { Badge, Button, Cell, DataTable, DateText, EmptyState, Row, cx } from '@/components/ui'
import { Icon } from '@/components/icons'
import { INPUT_CLASS, type Option } from '@/components/ui/form'
import { formatSelection, todayIso } from '@/lib/format'
import {
  addResponsibilityAction,
  endResponsibilityAction,
  setPrimaryResponsibilityAction,
  updateResponsibilityAction,
  type ResponsibilityState,
} from '../actions'

export interface ResponsibilityItem {
  id: number
  responsibility: string
  is_primary: boolean
  department: string
  campus: string
  manager: string
  start_date: string
  end_date: string
  active: boolean
}

/**
 * Responsibilities are what let a staff member be activated at all.
 *
 * `_missing_registration_fields` requires "at least one active Responsibility"
 * before the record may leave Draft, and `_compute_primary_responsibility`
 * reads the primary one. Until this existed, the frontend could create a staff
 * member and then had no way to make them activatable.
 *
 * Ending rather than deleting is deliberate and matches the model: the row is
 * `mail.thread`-tracked so the history survives a change of role.
 */
export function Responsibilities({
  staffId,
  rows,
  responsibilities,
  departments,
  campuses,
  managers,
  canWrite,
}: {
  staffId: number
  rows: ResponsibilityItem[]
  responsibilities: Option[]
  departments: Option[]
  campuses: Array<{ id: number; name: string }>
  managers: Array<{ id: number; name: string; staff_id: string | false }>
  canWrite: boolean
}) {
  const [adding, setAdding] = useState(false)
  /** The row currently open for editing, if any. Only one at a time. */
  const [editing, setEditing] = useState<number | null>(null)
  const [editState, editAction, editPending] = useActionState<ResponsibilityState, FormData>(
    updateResponsibilityAction,
    {},
  )
  const [addState, addAction, addPending] = useActionState<ResponsibilityState, FormData>(
    addResponsibilityAction,
    {},
  )
  const [endState, endAction] = useActionState<ResponsibilityState, FormData>(
    endResponsibilityAction,
    {},
  )
  const [primaryState, primaryAction] = useActionState<ResponsibilityState, FormData>(
    setPrimaryResponsibilityAction,
    {},
  )

  const feedback = addState.error ?? endState.error ?? primaryState.error ?? editState.error
  const success = addState.ok ?? endState.ok ?? primaryState.ok ?? editState.ok
  const activeCount = rows.filter((row) => row.active).length

  return (
    <div>
      {activeCount === 0 ? (
        <div className="mx-6 mb-4 flex gap-2.5 rounded-[8px] bg-[var(--color-status-progress-bg)] px-3.5 py-3">
          <Icon
            name="alert"
            size={16}
            className="mt-px shrink-0 text-[var(--color-status-progress)]"
          />
          <p className="text-[12px] text-[var(--color-status-progress)]">
            This staff member has no active responsibility, so Odoo will refuse to activate them.
            Add one below.
          </p>
        </div>
      ) : null}

      {feedback ? (
        <p role="alert" className="mx-6 mb-3 rounded-[8px] bg-danger-bg px-3 py-2 text-[12px] text-danger">
          {feedback}
        </p>
      ) : null}
      {success && !feedback ? (
        <p role="status" className="mx-6 mb-3 rounded-[8px] bg-info-bg px-3 py-2 text-[12px] text-action-blue">
          {success}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="staff"
          title="No responsibilities recorded"
          hint="A staff member needs at least one active responsibility before they can be activated."
        />
      ) : (
        <DataTable
          caption="Responsibilities held by this staff member"
          columns={[
            { key: 'responsibility', label: 'Responsibility' },
            { key: 'department', label: 'Department', hideBelow: 'sm' },
            { key: 'campus', label: 'Campus', hideBelow: 'lg' },
            { key: 'manager', label: 'Reports to', hideBelow: 'lg' },
            { key: 'from', label: 'From', hideBelow: 'md' },
            { key: 'to', label: 'To', hideBelow: 'md' },
            { key: 'actions', label: '' },
          ]}
        >
          {rows.map((row) => (
            <Row key={row.id} className={row.active ? undefined : 'opacity-60'}>
              <Cell strong>
                <span className="flex flex-wrap items-center gap-2">
                  {formatSelection(row.responsibility)}
                  {row.is_primary ? <Badge tone="solid">Primary</Badge> : null}
                  {row.active ? null : <Badge tone="muted">Ended</Badge>}
                </span>
              </Cell>
              <Cell hideBelow="sm">{formatSelection(row.department)}</Cell>
              <Cell hideBelow="lg">{row.campus || '—'}</Cell>
              <Cell hideBelow="lg">{row.manager || '—'}</Cell>
              <Cell hideBelow="md">{<DateText value={row.start_date} />}</Cell>
              <Cell hideBelow="md">{row.end_date ? <DateText value={row.end_date} /> : 'Current'}</Cell>
              <Cell>
                {canWrite && row.active ? (
                  <span className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditing(editing === row.id ? null : row.id)}
                      aria-expanded={editing === row.id}
                      title="Change this responsibility's details"
                      className="rounded-[8px] px-2 py-1 text-[11px] text-slate hover:bg-paper hover:text-graphite"
                    >
                      {editing === row.id ? 'Close' : 'Edit'}
                    </button>
                    {row.is_primary ? null : (
                      <form action={primaryAction}>
                        <input type="hidden" name="id" value={row.id} />
                        <input type="hidden" name="staffId" value={staffId} />
                        <button
                          type="submit"
                          title="Make this the primary responsibility"
                          className="rounded-[8px] px-2 py-1 text-[11px] text-slate hover:bg-paper hover:text-graphite"
                        >
                          Make primary
                        </button>
                      </form>
                    )}
                    <form action={endAction}>
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="staffId" value={staffId} />
                      <input type="hidden" name="end_date" value={todayIso()} />
                      <button
                        type="submit"
                        title="End this responsibility, keeping it as history"
                        className="rounded-[8px] px-2 py-1 text-[11px] text-slate hover:bg-danger-bg hover:text-danger"
                      >
                        End
                      </button>
                    </form>
                  </span>
                ) : null}
              </Cell>
            </Row>
          ))}
        </DataTable>
      )}

      {/*
        The edit form sits outside the table rather than inside a cell: it needs
        the full width, and a form element nested in a row would not be valid
        table markup. Only one row is open at a time.
      */}
      {canWrite && editing !== null && rows.some((row) => row.id === editing) ? (
        <div className="border-t border-silver bg-paper/40 p-6">
          {(() => {
            const row = rows.find((item) => item.id === editing)!
            return (
              <form action={editAction} className="space-y-3" key={row.id}>
                <p className="text-[13px] font-medium text-graphite">
                  Editing {formatSelection(row.responsibility)}
                </p>
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="staffId" value={staffId} />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-medium text-graphite">
                      Responsibility <span className="text-danger">*</span>
                    </span>
                    <select
                      name="responsibility"
                      required
                      defaultValue={row.responsibility}
                      className={INPUT_CLASS}
                    >
                      {responsibilities.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-medium text-graphite">
                      Department
                    </span>
                    <select name="department" defaultValue={row.department || ''} className={INPUT_CLASS}>
                      <option value="">Same as staff record</option>
                      {departments.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-medium text-graphite">
                      Effective from <span className="text-danger">*</span>
                    </span>
                    <input
                      type="date"
                      name="start_date"
                      required
                      defaultValue={row.start_date || ''}
                      className={INPUT_CLASS}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-medium text-graphite">
                      Effective to
                    </span>
                    <input
                      type="date"
                      name="end_date"
                      defaultValue={row.end_date || ''}
                      className={INPUT_CLASS}
                    />
                  </label>
                  {campuses.length ? (
                    <label className="block">
                      <span className="mb-1.5 block text-[12px] font-medium text-graphite">Campus</span>
                      <select name="campus_id" defaultValue={campusValue(row, campuses)} className={INPUT_CLASS}>
                        <option value="">None</option>
                        {campuses.map((campus) => (
                          <option key={campus.id} value={campus.id}>
                            {campus.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {managers.length ? (
                    <label className="block">
                      <span className="mb-1.5 block text-[12px] font-medium text-graphite">
                        Reporting manager
                      </span>
                      <select name="manager_id" defaultValue={managerValue(row, managers)} className={INPUT_CLASS}>
                        <option value="">None</option>
                        {managers.map((manager) => (
                          <option key={manager.id} value={manager.id}>
                            {manager.staff_id ? `${manager.name} · ${manager.staff_id}` : manager.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
                <p className="text-[11px] text-stone">
                  Whether this is the primary responsibility is changed with “Make primary”, because
                  Odoo allows only one at a time and clears the previous one.
                </p>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" pending={editPending}>
                    {editPending ? 'Saving…' : 'Save changes'}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className={cx(
                      'rounded-[9999px] border border-silver px-3.5 py-1.5 text-[12px]',
                      'hover:bg-paper',
                    )}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )
          })()}
        </div>
      ) : null}

      {canWrite ? (
        <div className="border-t border-silver p-6 pt-4">
          {adding ? (
            <form action={addAction} className="space-y-3">
              <input type="hidden" name="staffId" value={staffId} />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-graphite">
                    Responsibility <span className="text-danger">*</span>
                  </span>
                  <select name="responsibility" required className={INPUT_CLASS}>
                    <option value="">Choose…</option>
                    {responsibilities.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-graphite">Department</span>
                  <select name="department" className={INPUT_CLASS}>
                    <option value="">Same as staff record</option>
                    {departments.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-graphite">
                    Effective from <span className="text-danger">*</span>
                  </span>
                  <input
                    type="date"
                    name="start_date"
                    required
                    defaultValue={todayIso()}
                    className={INPUT_CLASS}
                  />
                </label>
                {campuses.length ? (
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-medium text-graphite">Campus</span>
                    <select name="campus_id" className={INPUT_CLASS}>
                      <option value="">None</option>
                      {campuses.map((campus) => (
                        <option key={campus.id} value={campus.id}>
                          {campus.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {managers.length ? (
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-medium text-graphite">
                      Reporting manager
                    </span>
                    <select name="manager_id" className={INPUT_CLASS}>
                      <option value="">None</option>
                      {managers.map((manager) => (
                        <option key={manager.id} value={manager.id}>
                          {manager.staff_id ? `${manager.name} · ${manager.staff_id}` : manager.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
              <label className="flex items-center gap-2 text-[12px] text-graphite">
                <input
                  type="checkbox"
                  name="is_primary"
                  defaultChecked={activeCount === 0}
                  className="h-4 w-4 rounded border-silver"
                />
                Make this the primary responsibility
                <span className="text-stone">— only one is allowed at a time</span>
              </label>
              <div className="flex gap-2">
                <Button type="submit" size="sm" pending={addPending}>
                  {addPending ? 'Adding…' : 'Add responsibility'}
                </Button>
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  className={cx(
                    'rounded-[9999px] border border-silver px-3.5 py-1.5 text-[12px]',
                    'hover:bg-paper',
                  )}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <Button variant="ghost" size="sm" icon="plus" onClick={() => setAdding(true)}>
              Add responsibility
            </Button>
          )}
        </div>
      ) : null}
    </div>
  )
}

/*
  The rows arrive with campus and manager as display names, because that is
  what the table shows. Matching the name back to an id keeps the edit form
  from having to refetch, and an unmatched name simply preselects nothing
  rather than silently picking the wrong record.
*/
function campusValue(
  row: ResponsibilityItem,
  campuses: Array<{ id: number; name: string }>,
): string {
  const match = campuses.find((campus) => campus.name === row.campus)
  return match ? String(match.id) : ''
}

function managerValue(
  row: ResponsibilityItem,
  managers: Array<{ id: number; name: string; staff_id: string | false }>,
): string {
  const match = managers.find((manager) => manager.name === row.manager)
  return match ? String(match.id) : ''
}
