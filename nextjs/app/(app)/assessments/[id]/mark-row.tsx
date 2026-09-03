'use client'

import { formatPercent, formatText } from '@/lib/format'

/**
 * One row of the mark list.
 *
 * Presentational: the inputs belong to the single form in `MarkList`, and are
 * named by mark id so one submit carries the whole roster. Percentage and
 * grade are Odoo's computed values, shown read-only.
 */
export function MarkRow({
  markId,
  student,
  score,
  maxScore,
  percentage,
  grade,
  status,
  note,
  statusOptions,
  editable,
  error,
}: {
  markId: number
  student: string
  score: number
  maxScore: number
  percentage: number
  grade: string | false
  status: string
  note: string
  statusOptions: Array<{ value: string; label: string }>
  editable: boolean
  error?: string
}) {
  const cell = 'px-4 py-2 align-middle'
  const control =
    'rounded-[8px] border border-silver px-2 py-1 text-[13px] focus:border-action-blue ' +
    'focus:outline-none disabled:bg-paper disabled:text-stone'

  /**
   * Spreadsheet-style keyboard navigation.
   * Allows teachers to use Enter, ArrowDown, or ArrowUp to quickly jump between
   * students without reaching for the mouse.
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault() // Prevent form submission or standard scrolling

      // Query all score inputs currently rendered on the page
      const inputs = Array.from(
        document.querySelectorAll<HTMLInputElement>('input[id^="score-"]')
      )
      const currentIndex = inputs.indexOf(e.currentTarget)

      if (e.key === 'ArrowUp' && currentIndex > 0) {
        inputs[currentIndex - 1].focus()
        inputs[currentIndex - 1].select() // Auto-highlight existing score
      } else if (
        (e.key === 'Enter' || e.key === 'ArrowDown') &&
        currentIndex < inputs.length - 1
      ) {
        inputs[currentIndex + 1].focus()
        inputs[currentIndex + 1].select()
      }
    }
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
        {/* The original values ride along so the action writes only what moved. */}
        <input type="hidden" name="markId" value={markId} />
        <input type="hidden" name={`max-${markId}`} value={maxScore} />
        <input type="hidden" name={`was-score-${markId}`} value={score ?? ''} />
        <input type="hidden" name={`was-status-${markId}`} value={status} />
        <input type="hidden" name={`was-note-${markId}`} value={note} />

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
            defaultValue={score ?? ''}
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
          defaultValue={status}
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
          defaultValue={note}
          disabled={!editable}
          placeholder="Remark"
          className={`${control} min-w-[120px] w-full text-[12px]`}
        />
      </td>
    </tr>
  )
}