'use client'

import { useActionState, useState, useRef, useCallback } from 'react'
import { MarkRow } from './mark-row'
import { saveMarksAction, type MarkListState } from '../actions'

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

/**
 * The mark list as an auto-saving form.
 *
 * A roster is entered dynamically. As the teacher types, the form intercepts
 * the changes and triggers a debounced silent save. The action diffs each
 * row against the values it was rendered with and writes only what moved.
 * Scores are bounds-checked here before the round trip, and again by Odoo.
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
  
  // Stores client-side validation errors (e.g., score > maxScore) before sending to the server
  const [clientErrors, setClientErrors] = useState<Record<number, string>>({})
  
  // References needed for the auto-save mechanism
  const formRef = useRef<HTMLFormElement>(null)
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)

  /**
   * Pre-flight validation before handing off to the server action.
   * Ensures no row has a score exceeding its max bounds.
   */
  function handleSubmit(form: FormData) {
    const errors: Record<number, string> = {}

    for (const row of rows) {
      const raw = String(form.get(`score-${row.id}`) ?? '').trim()
      if (raw === '') continue
      const score = Number(raw)
      
      // Client-side guard against impossible scores
      if (!Number.isFinite(score) || score < 0 || score > row.maxScore) {
        errors[row.id] = `Score must be between 0 and ${row.maxScore}.`
      }
    }

    if (Object.keys(errors).length > 0) {
      setClientErrors(errors)
      return // Abort server save if client validation fails
    }

    setClientErrors({})
    formAction(form)
  }

  /**
   * Debounced Auto-Save Trigger
   * 
   * Waits 1.2 seconds after the user stops typing before triggering a silent save.
   * This prevents spamming the server with requests on every single keystroke.
   */
  const handleAutoSave = useCallback(() => {
    // Clear the previous timer if the user keeps typing
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    
    // Set a new timer
    timeoutRef.current = setTimeout(() => {
      formRef.current?.requestSubmit() // Programmatically trigger the form submission
    }, 1200)
  }, [])

  // Merge client-side validation errors with Odoo's server-side refusal errors
  const errors = Object.keys(clientErrors).length > 0 ? clientErrors : (state.rowErrors ?? {})

  return (
    <form
      action={handleSubmit}
      ref={formRef}
      // Event delegation: placing onChange on the form captures edits from any child input
      onChange={editable ? handleAutoSave : undefined}
    >
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
                score={row.score}
                maxScore={row.maxScore}
                percentage={row.percentage}
                grade={row.grade}
                status={row.status}
                note={row.note}
                statusOptions={statusOptions}
                editable={editable}
                error={errors[row.id]}
              />
            ))}
          </tbody>
        </table>
      </div>

      {editable ? (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-silver bg-paper/30 px-4 py-3">
          <span className="text-[12px] text-stone transition-opacity">
            {pending ? 'Saving changes…' : 'Changes save automatically'}
          </span>

          {state.error ? (
            <span role="alert" className="text-[12px] font-medium text-danger">
              {state.error}
            </span>
          ) : null}

          {state.ok && !state.error && !pending ? (
            <span role="status" className="text-[12px] font-medium text-action-blue">
              {state.ok}
            </span>
          ) : null}
        </div>
      ) : null}
    </form>
  )
}