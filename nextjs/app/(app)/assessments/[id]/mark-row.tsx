'use client'

import { formatPercent, formatText } from '@/lib/format'
import type { MarkValues } from '@/lib/mark-diff'

/**
 * One row of the mark list.
 *
 * Fully controlled: the value of every editable cell lives in `MarkList`'s
 * state, not in the DOM. That is what makes the grid survive React 19's
 * post-action form reset, which used to restore these controls to the values
 * the page was rendered with and leave them disagreeing with what Odoo had
 * just stored.
 *
 * Percentage and grade are Odoo's, shown read-only. They are stored computes
 * driven by the grading scheme, and a status such as `absent` clears them by
 * design — so an empty grade here is information, not a gap to fill in.
 */
export function MarkRow({
  markId,
  student,
  maxScore,
  values,
  percentage,
  grade,
  statusOptions,
  editable,
  error,
  onChange,
  onCommit,
}: {
  markId: number
  student: string
  maxScore: number
  values: MarkValues
  percentage: number
  grade: string | false
  statusOptions: Array<{ value: string; label: string }>
  editable: boolean
  error?: string
  onChange: (markId: number, patch: Partial<MarkValues>) => void
  /** Tell the grid an edit happened, so it can schedule the save. */
  onCommit: () => void
}) {
  const cell = 'px-4 py-2 align-middle'
  const control =
    'rounded-[8px] border border-silver px-2 py-1 text-[13px] focus:border-action-blue ' +
    'focus:outline-none disabled:bg-paper disabled:text-stone'

  /**
   * Spreadsheet-style keyboard navigation: Enter and the arrows move between
   * students without reaching for the mouse, which is how a roster of thirty
   * actually gets entered.
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()

    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[id^="score-"]'),
    )
    const index = inputs.indexOf(event.currentTarget)
    const next = event.key === 'ArrowUp' ? index - 1 : index + 1
    if (next >= 0 && next < inputs.length) {
      inputs[next].focus()
      inputs[next].select()
    }
  }

  const edit = (patch: Partial<MarkValues>) => {
    onChange(markId, patch)
    onCommit()
  }

  return (
    <tr className="border-b border-silver/70 last:border-0">
      <td className={`${cell} font-medium text-graphite`}>
        {student}
        {error ? (
          <span role="alert" className="mt-0.5 block text-[11px] text-danger">
            {error}
          </span>
        ) : null}
      </td>

      <td className={cell}>
        <label className="sr-only" htmlFor={`score-${markId}`}>
          Score for {student}
        </label>
        <div className="flex items-center gap-1.5">
          <input
            id={`score-${markId}`}
            name={`score-${markId}`}
            type="number"
            step="0.01"
            min={0}
            max={maxScore}
            value={values.score}
            onChange={(event) => edit({ score: event.target.value })}
            disabled={!editable}
            aria-invalid={error ? true : undefined}
            onKeyDown={handleKeyDown}
            className={`${control} tabular w-20`}
          />
          <span className="text-[12px] whitespace-nowrap text-stone">/ {maxScore}</span>
        </div>
      </td>

      <td className={cell}>
        <label className="sr-only" htmlFor={`status-${markId}`}>
          Status for {student}
        </label>
        <select
          id={`status-${markId}`}
          name={`status-${markId}`}
          value={values.status}
          onChange={(event) => edit({ status: event.target.value })}
          disabled={!editable}
          className={`${control} text-[12px]`}
        >
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </td>

      <td className={`${cell} tabular hidden text-right text-[12px] text-slate md:table-cell`}>
        {formatPercent(percentage)}
      </td>

      <td className={`${cell} hidden text-[12px] font-medium text-graphite sm:table-cell`}>
        {formatText(grade)}
      </td>

      <td className={`${cell} hidden lg:table-cell`}>
        <label className="sr-only" htmlFor={`note-${markId}`}>
          Remark for {student}
        </label>
        <input
          id={`note-${markId}`}
          name={`note-${markId}`}
          value={values.note}
          onChange={(event) => edit({ note: event.target.value })}
          disabled={!editable}
          placeholder="Remark"
          className={`${control} min-w-[120px] w-full text-[12px]`}
        />
      </td>
    </tr>
  )
}
