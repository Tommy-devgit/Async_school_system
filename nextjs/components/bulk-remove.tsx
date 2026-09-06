'use client'

import { useActionState, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '@/components/icons'
import { cx } from '@/components/ui/primitives'
import { removeRecordsAction, type RemoveState } from '@/app/(app)/remove-action'

/**
 * Selecting rows and removing them.
 *
 * The whole table sits inside one form and each row carries a checkbox named
 * `id`, so the selection *is* the submission — there is no parallel client
 * list of ids that could drift from what is on screen, and a row filtered away
 * by a new search cannot stay selected invisibly.
 *
 * Removing is two deliberate steps. The first click asks; the second does it,
 * and only the second sends `confirmed`. The server requires that field, so a
 * form posted without going through the question removes nothing.
 *
 * What this offers is decided upstream: the control is rendered only where
 * Odoo's `has_access` already said yes. It is a courtesy, not a boundary —
 * Odoo re-checks on every call and answers in its own words when it refuses.
 */
export function BulkRemove({
  resource,
  mode,
  noun,
  plural,
  note,
  children,
}: {
  resource: string
  mode: 'delete' | 'archive'
  noun: string
  plural: string
  note?: string
  children: ReactNode
}) {
  const [state, formAction, pending] = useActionState<RemoveState, FormData>(
    removeRecordsAction,
    {},
  )
  const formRef = useRef<HTMLFormElement>(null)
  const [selected, setSelected] = useState(0)
  const [asking, setAsking] = useState(false)

  /*
    Counted off the DOM rather than tracked in state, so the count cannot
    disagree with the boxes. Delegated from the form, so rows re-rendered by a
    filter or a page change need no re-wiring.
  */
  const recount = () => {
    const boxes = formRef.current?.querySelectorAll<HTMLInputElement>('input[name="id"]')
    setSelected(Array.from(boxes ?? []).filter((box) => box.checked).length)
  }

  /*
    A successful removal re-renders the list, and the question must not survive
    it — leaving "Yes, delete" on screen over a fresh selection is how the next
    click deletes something nobody meant. Adjusted during render rather than in
    an effect, so the bar is never painted in the stale state, and keyed on the
    reply's identity so two identical successes are still two replies.
  */
  const [seen, setSeen] = useState(state)
  if (seen !== state) {
    setSeen(state)
    if (state.ok) {
      setAsking(false)
      setSelected(0)
    }
  }

  const verb = mode === 'delete' ? 'Delete' : 'Archive'
  const subject = selected === 1 ? noun : plural

  return (
    <form ref={formRef} action={formAction} onChange={recount}>
      <input type="hidden" name="resource" value={resource} />
      {/* Only the confirming submit sends this; see the server action. */}
      {asking ? <input type="hidden" name="confirmed" value="yes" /> : null}

      {children}

      {state.error ? (
        <p
          role="alert"
          className="mx-6 mb-4 flex gap-2.5 rounded-[8px] bg-danger-bg px-3.5 py-3 text-[13px] text-danger"
        >
          <Icon name="alert" size={16} className="mt-px shrink-0" />
          <span className="min-w-0">{state.error}</span>
        </p>
      ) : null}

      {state.ok && !state.error ? (
        <p
          role="status"
          className="mx-6 mb-4 rounded-[8px] bg-info-bg px-3.5 py-3 text-[13px] text-action-blue"
        >
          {state.ok}
        </p>
      ) : null}

      {selected > 0 ? (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-silver bg-white/95 px-6 py-3 backdrop-blur">
          <span className="text-[13px] font-medium text-graphite">
            {selected} {subject} selected
          </span>

          {asking ? (
            <>
              <span className="text-[12px] text-danger">
                {mode === 'delete'
                  ? `Permanently delete ${selected === 1 ? 'this' : 'these'} ${subject}?`
                  : `Archive ${selected === 1 ? 'this' : 'these'} ${subject}?`}
              </span>
              <button
                type="submit"
                disabled={pending}
                className={cx(
                  'rounded-[9999px] px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-50',
                  mode === 'delete' ? 'bg-danger' : 'bg-ink',
                )}
              >
                {pending ? `${verb.slice(0, -1)}ing…` : `Yes, ${verb.toLowerCase()}`}
              </button>
              <button
                type="button"
                onClick={() => setAsking(false)}
                className="rounded-[9999px] border border-silver px-4 py-1.5 text-[13px] hover:bg-paper"
              >
                Keep {selected === 1 ? 'it' : 'them'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setAsking(true)}
              className={cx(
                'rounded-[9999px] border px-4 py-1.5 text-[13px]',
                mode === 'delete'
                  ? 'border-danger text-danger hover:bg-danger-bg'
                  : 'border-silver hover:bg-paper',
              )}
            >
              {verb} selected
            </button>
          )}

          {note && !asking ? (
            <span className="basis-full text-[11px] leading-relaxed text-stone">{note}</span>
          ) : null}
        </div>
      ) : null}
    </form>
  )
}

/** The checkbox in a row, named so the selection is the submission. */
export function RowSelect({ id, label }: { id: number; label: string }) {
  return (
    <input
      type="checkbox"
      name="id"
      value={id}
      aria-label={`Select ${label}`}
      className="h-4 w-4 rounded border-silver text-action-blue focus:ring-action-blue"
    />
  )
}
