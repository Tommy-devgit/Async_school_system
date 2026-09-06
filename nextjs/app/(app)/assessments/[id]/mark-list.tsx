'use client'

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MarkRow } from './mark-row'
import { saveMarksAction, type MarkListState } from '../actions'
import type { MarkValues } from '@/lib/mark-diff'

/** Percent and grade are derived and read-only, so they yield first on narrow screens. */
const COLUMNS = [
  { label: 'Student', hideBelow: '' },
  { label: 'Score', hideBelow: '' },
  { label: 'Status', hideBelow: '' },
  { label: 'Percent', hideBelow: ' hidden md:table-cell' },
  { label: 'Grade', hideBelow: ' hidden sm:table-cell' },
  { label: 'Remark', hideBelow: ' hidden lg:table-cell' },
] as const

export interface MarkListRow {
  id: number
  student: string
  score: number
  maxScore: number
  percentage: number
  grade: string | false
  status: string
  note: string
}

/** What the teacher has typed. Percentage and grade are never in here. */
type Entry = Record<number, MarkValues>
/** What Odoo has confirmed, for the same rows. */
type Derived = Record<number, { percentage: number; grade: string | false }>

const entryOf = (rows: MarkListRow[]): Entry =>
  Object.fromEntries(
    rows.map((row) => [
      row.id,
      { score: row.score === null || row.score === undefined ? '' : String(row.score), status: row.status, note: row.note },
    ]),
  )

const derivedOf = (rows: MarkListRow[]): Derived =>
  Object.fromEntries(rows.map((row) => [row.id, { percentage: row.percentage, grade: row.grade }]))

/**
 * The mark list as an auto-saving grid.
 *
 * **Every editable cell is controlled.** That is the whole design, and it is
 * load-bearing rather than stylistic. The grid used to be uncontrolled inputs
 * paired with hidden fields carrying the values the page had been rendered
 * with, and the action diffed one against the other. React 19 resets a form
 * once its action returns, so after a save the visible controls snapped back
 * to the rendered values while revalidation refreshed the hidden ones — a
 * teacher saw "Pending" on a row Odoo held as "Recorded", and the next
 * auto-save diffed that stale control against the fresh baseline and wrote
 * Pending back over their entry.
 *
 * With the values in React state there is nothing for a form reset to
 * desynchronise, and the diff is state against state.
 *
 * Percentage and grade are never computed here. They come back from Odoo with
 * every save, because they are stored computes driven by the grading scheme —
 * and a status like `absent` clears them on purpose.
 */
export function MarkList({
  assessmentId,
  rows,
  statusOptions,
  editable,
}: {
  assessmentId: number
  rows: MarkListRow[]
  statusOptions: Array<{ value: string; label: string }>
  editable: boolean
}) {
  const [state, formAction, pending] = useActionState<MarkListState, FormData>(saveMarksAction, {})

  /** What is on screen. */
  const [entry, setEntry] = useState<Entry>(() => entryOf(rows))
  /** What Odoo last confirmed — the other half of the diff. */
  const [baseline, setBaseline] = useState<Entry>(() => entryOf(rows))
  /** Odoo's computed columns. */
  const [derived, setDerived] = useState<Derived>(() => derivedOf(rows))

  /*
    Bounds are checked as the teacher types, not only on submit.

    `requestSubmit()` runs the browser's own constraint validation first, and a
    number above its `max` blocks the submission before the action is reached —
    so validating only inside the action meant an out-of-range score sat there
    with no explanation on the page at all, just a native tooltip that vanishes.
    Odoo checks the bound again on write regardless.
  */
  const boundsErrors = useMemo(() => {
    const found: Record<number, string> = {}
    for (const row of rows) {
      const raw = (entry[row.id]?.score ?? '').trim()
      if (raw === '') continue
      const score = Number(raw)
      if (!Number.isFinite(score) || score < 0 || score > row.maxScore) {
        found[row.id] = `Score must be between 0 and ${row.maxScore}.`
      }
    }
    return found
  }, [entry, rows])

  const formRef = useRef<HTMLFormElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastReconciled = useRef<number | undefined>(undefined)

  /*
    Reconcile against what Odoo actually stored.

    Only the rows the teacher has not touched since the save are adopted: a
    save is in flight while typing continues, and overwriting a cell somebody
    is still editing is the same class of bug this component exists to avoid.
  */
  useEffect(() => {
    if (!state.rows || state.savedAt === lastReconciled.current) return
    lastReconciled.current = state.savedAt

    const confirmed: Entry = {}
    const columns: Derived = {}
    for (const row of state.rows) {
      confirmed[row.id] = { score: String(row.score ?? ''), status: row.status, note: row.note }
      columns[row.id] = { percentage: row.percentage, grade: row.grade }
    }

    setDerived((previous) => ({ ...previous, ...columns }))
    setBaseline((previous) => ({ ...previous, ...confirmed }))
    setEntry((previous) => {
      const next = { ...previous }
      for (const [key, value] of Object.entries(confirmed)) {
        const id = Number(key)
        // Adopt Odoo's value only where the teacher has not moved on.
        const mine = previous[id]
        const wasSent = mine && mine.score.trim() === value.score.trim() &&
          mine.status === value.status && mine.note === value.note
        if (wasSent || !mine) next[id] = value
      }
      return next
    })
  }, [state.rows, state.savedAt])

  const update = useCallback((markId: number, patch: Partial<MarkValues>) => {
    setEntry((previous) => ({ ...previous, [markId]: { ...previous[markId], ...patch } }))
  }, [])

  /**
   * Debounced auto-save: 1.2s after the last edit, so a burst of typing costs
   * one round trip rather than one per keystroke.
   */
  const scheduleSave = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => formRef.current?.requestSubmit(), 1200)
  }, [])

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current) }, [])

  function handleSubmit(form: FormData) {
    // An out-of-range row is already flagged on screen; nothing is sent until
    // it is fixed, so one bad score cannot discard thirty good ones either.
    if (Object.keys(boundsErrors).length > 0) return

    form.set('current', JSON.stringify(entry))
    form.set('baseline', JSON.stringify(baseline))
    formAction(form)
  }

  const errors = Object.keys(boundsErrors).length > 0 ? boundsErrors : (state.rowErrors ?? {})
  const dirty = JSON.stringify(entry) !== JSON.stringify(baseline)

  return (
    <form action={handleSubmit} ref={formRef} noValidate>
      <input type="hidden" name="assessmentId" value={assessmentId} />

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {COLUMNS.map(({ label, hideBelow }) => (
                <th
                  key={label}
                  className={`border-b border-silver px-4 py-2.5 text-left text-[11px] font-medium tracking-wide text-slate uppercase${hideBelow}`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <MarkRow
                key={row.id}
                markId={row.id}
                student={row.student}
                maxScore={row.maxScore}
                values={entry[row.id] ?? { score: '', status: row.status, note: row.note }}
                percentage={derived[row.id]?.percentage ?? row.percentage}
                grade={derived[row.id]?.grade ?? row.grade}
                statusOptions={statusOptions}
                editable={editable}
                error={errors[row.id]}
                onChange={update}
                onCommit={scheduleSave}
              />
            ))}
          </tbody>
        </table>
      </div>

      {editable ? (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-silver bg-paper/30 px-4 py-3">
          <span className="text-[12px] text-stone">
            {Object.keys(boundsErrors).length > 0
              ? 'Not saved — fix the rows above'
              : pending
                ? 'Saving changes…'
                : dirty
                  ? 'Unsaved changes'
                  : 'Changes save automatically'}
          </span>

          {state.error ? (
            <span role="alert" className="text-[12px] font-medium text-danger">
              {state.error}
            </span>
          ) : null}

          {state.ok && !state.error && !pending && !dirty ? (
            <span role="status" className="text-[12px] font-medium text-action-blue">
              {state.ok}
            </span>
          ) : null}
        </div>
      ) : null}
    </form>
  )
}
