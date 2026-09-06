'use client'

import { createContext, useActionState, useContext, useMemo, useRef, useState } from 'react'
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

/**
 * What to put back in the boxes after the action replies.
 *
 * React 19 resets the form once an action returns — including when it returns
 * a refusal — which clears every checkbox. Without restoring them, a refused
 * delete silently empties the selection, and the "archive instead" the refusal
 * offers submits nothing at all. The rows are rebuilt on each reply so the
 * restored `defaultChecked` actually lands; see `useFormResponse` in
 * components/ui/form for why a changed default is not enough on its own.
 */
const SelectionContext = createContext<{ keep: ReadonlySet<number>; response: number }>({
  keep: new Set<number>(),
  response: 0,
})

export function BulkRemove({
  resource,
  mode,
  archivable = false,
  noun,
  plural,
  note,
  children,
}: {
  resource: string
  mode: 'delete' | 'archive'
  /** The model also has `active`, so archiving is offered alongside deleting. */
  archivable?: boolean
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
  /** Which removal is being confirmed, or null while nothing is being asked. */
  const [intent, setIntent] = useState<'delete' | 'archive' | null>(null)

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
  const [response, setResponse] = useState(0)
  if (seen !== state) {
    setSeen(state)
    setResponse(response + 1)
    if (state.ok) {
      setIntent(null)
      setSelected(0)
    } else {
      // A refusal keeps the selection, so it can be acted on differently.
      setSelected(state.ids?.length ?? 0)
    }
  }

  /*
    Memoised on the reply rather than rebuilt every render.

    `RowSelect` is uncontrolled and carries `defaultChecked`, so it should only
    re-render when there is genuinely something new to put back. A context
    value rebuilt on every render would re-render every checkbox on the page
    each time anything in the bar moved.
  */
  const selection = useMemo(
    () => ({ keep: new Set(state.ok ? [] : (state.ids ?? [])), response }),
    [state.ok, state.ids, response],
  )

  const subject = selected === 1 ? noun : plural
  const these = selected === 1 ? 'this' : 'these'

  return (
    <form ref={formRef} action={formAction} onChange={recount}>
      <input type="hidden" name="resource" value={resource} />
      {/* Only the confirming submit sends these; see the server action. */}
      {intent ? <input type="hidden" name="confirmed" value="yes" /> : null}
      {intent ? <input type="hidden" name="mode" value={intent} /> : null}

      <SelectionContext value={selection}>{children}</SelectionContext>

      {state.error ? (
        <div
          role="alert"
          className="mx-6 mb-4 flex gap-2.5 rounded-[8px] bg-danger-bg px-3.5 py-3 text-[13px] text-danger"
        >
          <Icon name="alert" size={16} className="mt-px shrink-0" />
          <div className="min-w-0">
            <p>{state.error}</p>

            {/*
              Odoo ends that refusal with "How about archiving the record
              instead?" — so offer it, rather than leaving a good suggestion
              the user has no way to take.
            */}
            {state.offerArchive ? (
              <button
                type="button"
                onClick={() => setIntent('archive')}
                className="mt-2 rounded-[9999px] border border-danger px-3.5 py-1 text-[12px] font-medium hover:bg-white"
              >
                Archive {selected === 1 ? 'it' : 'them'} instead
              </button>
            ) : null}
          </div>
        </div>
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

          {/*
            The trigger stays put and goes disabled while the question is up,
            and the confirmation is appended after it.

            They used to be replaced by it, which put "Yes, archive" exactly
            where "Archive selected" had been — so one physical click could arm
            and confirm, because React re-renders during the click and the
            mouse-up landed on the new submit button. For a destructive action
            that is not a layout detail.
          */}
          {mode === 'delete' ? (
          <button
            type="button"
            disabled={Boolean(intent)}
            onClick={() => setIntent('delete')}
            className={cx(
              'rounded-[9999px] border border-danger px-4 py-1.5 text-[13px] text-danger',
              intent ? 'opacity-40' : 'hover:bg-danger-bg',
            )}
          >
            Delete selected
          </button>
          ) : null}

          {/*
            Archive is offered up front on any model that can be archived, not
            only after a delete has failed. Odoo refuses to delete a record
            another one points at, and that is the common case for exactly the
            records somebody wants gone.
          */}
          {mode === 'archive' || archivable ? (
          <button
            type="button"
            disabled={Boolean(intent)}
            onClick={() => setIntent('archive')}
            className={cx(
              'rounded-[9999px] border border-silver px-4 py-1.5 text-[13px]',
              intent ? 'opacity-40' : 'hover:bg-paper',
            )}
          >
            Archive selected
          </button>
          ) : null}

          {intent ? (
            <>
              <span className="text-[12px] text-danger">
                {intent === 'delete'
                  ? `Permanently delete ${these} ${subject}?`
                  : `Archive ${these} ${subject}?`}
              </span>
              <button
                type="submit"
                disabled={pending}
                className={cx(
                  'rounded-[9999px] px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-50',
                  intent === 'delete' ? 'bg-danger' : 'bg-ink',
                )}
              >
                {pending
                  ? intent === 'delete'
                    ? 'Deleting…'
                    : 'Archiving…'
                  : intent === 'delete'
                    ? 'Yes, delete'
                    : 'Yes, archive'}
              </button>
              <button
                type="button"
                onClick={() => setIntent(null)}
                className="rounded-[9999px] border border-silver px-4 py-1.5 text-[13px] hover:bg-paper"
              >
                Keep {selected === 1 ? 'it' : 'them'}
              </button>
            </>
          ) : null}

          {note && !intent ? (
            <span className="basis-full text-[11px] leading-relaxed text-stone">{note}</span>
          ) : null}

        </div>
      ) : null}
    </form>
  )
}

/** The checkbox in a row, named so the selection is the submission. */
export function RowSelect({ id, label }: { id: number; label: string }) {
  const { keep, response } = useContext(SelectionContext)

  return (
    <input
      // Rebuilt on each reply so a restored tick survives the form reset.
      key={`${id}-${response}`}
      type="checkbox"
      name="id"
      value={id}
      defaultChecked={keep.has(id)}
      aria-label={`Select ${label}`}
      className="h-4 w-4 rounded border-silver text-action-blue focus:ring-action-blue"
    />
  )
}
