'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/odoo/auth'
import { callKw, write } from '@/lib/odoo/client'
import { toOdooError } from '@/lib/odoo/errors'
import { getRemoval } from '@/lib/odoo/removals'

/**
 * The single entry point for removing records.
 *
 * The client posts a resource key and a set of ids. It never posts a model
 * name — those come from the server-side allowlist in lib/odoo/removals.ts,
 * the same rule `runWorkflowAction` follows. An unknown key is refused before
 * anything reaches Odoo.
 *
 * The call runs as the signed-in user's Odoo session, so the ACL and every
 * record rule apply unchanged. `has_access` decides whether the control is
 * *offered*; Odoo decides whether it *works*, and the two are not the same
 * check.
 */

export interface RemoveState {
  error?: string
  ok?: string
  /**
   * Set when a delete was refused *only* because something else still points
   * at the record, and the model can be archived instead. The bar then offers
   * that, rather than leaving the user with Odoo's suggestion and no way to
   * take it.
   */
  offerArchive?: boolean
  /**
   * The ids that were submitted, echoed back on a refusal.
   *
   * React 19 resets the form once the action returns, which clears every
   * checkbox — so without this the selection is gone the moment a removal is
   * refused, and the "archive instead" it offers has nothing to act on.
   */
  ids?: number[]
}

/*
  Odoo's message when a foreign key is in the way. It names the model and the
  constraint and ends with "How about archiving the record instead?" — which is
  a good suggestion the user previously had no way to act on.

  Matched loosely on purpose: the wording carries a model name and a field
  name that differ every time, and a stricter pattern would quietly stop
  matching after a version bump. The worst case of a false positive is
  offering an archive that Odoo then refuses in its own words.
*/
const REFERENCED_BY_ANOTHER_RECORD =
  /another model is using the record|referenced by|foreign key|archiving the record instead/i

/** More than this in one click is almost certainly a mis-click, not an intent. */
const MAX_AT_ONCE = 100

export async function removeRecordsAction(
  _previous: RemoveState,
  form: FormData,
): Promise<RemoveState> {
  await requireSession()

  const removal = getRemoval(String(form.get('resource') ?? ''))
  if (!removal) return { error: 'That action is not available.' }

  /*
    The form may ask for archive on a model whose default is delete, but only
    where the allowlist says archiving is possible. Anything else falls back to
    the entry's own mode — the browser cannot talk this into an operation the
    server has not already agreed to.
  */
  const asked = String(form.get('mode') ?? '')
  const mode =
    asked === 'archive' && (removal.mode === 'archive' || removal.archivable)
      ? 'archive'
      : removal.mode

  const ids = form
    .getAll('id')
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)

  if (ids.length === 0) return { error: 'Nothing was selected.' }
  if (ids.length > MAX_AT_ONCE) {
    return {
      error: `Too many at once — ${MAX_AT_ONCE} is the limit. Narrow the list first.`,
      ids: [...new Set(ids)],
    }
  }

  /*
    Confirmation is required in the payload, not only in the browser. A form
    posted without it — by a script, or by a page that lost its client state —
    must not remove anything.
  */
  if (String(form.get('confirmed') ?? '') !== 'yes') {
    return { error: 'That removal was not confirmed.', ids: [...new Set(ids)] }
  }

  const unique = [...new Set(ids)]

  try {
    if (mode === 'delete') {
      await callKw<boolean>(removal.model, 'unlink', [unique])
    } else {
      await write(removal.model, unique, { active: false })
    }
  } catch (cause) {
    // Odoo's own words: its refusals name what is in the way, which is far
    // more use than anything invented here.
    const message = toOdooError(cause).message
    return {
      error: message,
      ids: unique,
      offerArchive:
        mode === 'delete' &&
        Boolean(removal.archivable) &&
        REFERENCED_BY_ANOTHER_RECORD.test(message),
    }
  }

  for (const path of removal.revalidate) revalidatePath(path)

  const count = unique.length
  const noun = count === 1 ? removal.noun : removal.plural
  return {
    ok:
      mode === 'delete'
        ? `Deleted ${count} ${noun}.`
        : `Archived ${count} ${noun}. They can be restored.`,
  }
}
