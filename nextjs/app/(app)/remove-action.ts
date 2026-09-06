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
}

/** More than this in one click is almost certainly a mis-click, not an intent. */
const MAX_AT_ONCE = 100

export async function removeRecordsAction(
  _previous: RemoveState,
  form: FormData,
): Promise<RemoveState> {
  await requireSession()

  const removal = getRemoval(String(form.get('resource') ?? ''))
  if (!removal) return { error: 'That action is not available.' }

  const ids = form
    .getAll('id')
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)

  if (ids.length === 0) return { error: 'Nothing was selected.' }
  if (ids.length > MAX_AT_ONCE) {
    return { error: `Too many at once — ${MAX_AT_ONCE} is the limit. Narrow the list first.` }
  }

  /*
    Confirmation is required in the payload, not only in the browser. A form
    posted without it — by a script, or by a page that lost its client state —
    must not remove anything.
  */
  if (String(form.get('confirmed') ?? '') !== 'yes') {
    return { error: 'That removal was not confirmed.' }
  }

  const unique = [...new Set(ids)]

  try {
    if (removal.mode === 'delete') {
      await callKw<boolean>(removal.model, 'unlink', [unique])
    } else {
      await write(removal.model, unique, { active: false })
    }
  } catch (cause) {
    /*
      Odoo's own words. The useful ones here are its foreign-key refusals —
      "you cannot delete this record because it is referenced by…" — which name
      what is in the way, and are far more use than anything invented here.
    */
    return { error: toOdooError(cause).message }
  }

  for (const path of removal.revalidate) revalidatePath(path)

  const count = unique.length
  const noun = count === 1 ? removal.noun : removal.plural
  return {
    ok:
      removal.mode === 'delete'
        ? `Deleted ${count} ${noun}.`
        : `Archived ${count} ${noun}. They can be restored.`,
  }
}
