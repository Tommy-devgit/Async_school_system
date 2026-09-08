import 'server-only'

import { cache } from 'react'
import { searchRead } from '@/lib/odoo/client'

/**
 * The timezone the school's wall clock runs on.
 *
 * `res.company.school_timezone` already exists and already defaults to
 * `Africa/Addis_Ababa`; nothing had ever read it. Everything that converts a
 * datetime goes through here rather than assuming +3, because the field is a
 * selection over every zone and a school that changes it should not have to
 * change the code.
 *
 * `cache()` scopes the read to one render, so a page showing a list of
 * programs asks once rather than once per row. It is deliberately not memoised
 * beyond that: a change in Odoo takes effect on the next request instead of
 * living in a module variable until the server restarts.
 *
 * Falls back rather than throwing. A timezone that cannot be read is not a
 * reason to fail a page, and every alternative — refusing to render, showing
 * raw UTC — is worse than using the default the field itself declares.
 */
export const schoolTimeZone = cache(async (): Promise<string> => {
  try {
    const page = await searchRead<{ id: number; school_timezone: string | false }>(
      'res.company',
      ['school_timezone'],
      { limit: 1, withTotal: false },
    )
    const zone = page.rows[0]?.school_timezone
    if (typeof zone === 'string' && zone) {
      // Reject anything Intl will not accept, so one bad value cannot make
      // every datetime on the site throw.
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: zone })
        return zone
      } catch {
        return DEFAULT_TIMEZONE
      }
    }
  } catch {
    /* Unreadable for this user, or Odoo is down. The default still renders. */
  }
  return DEFAULT_TIMEZONE
})

/** What the Odoo field itself defaults to. */
export const DEFAULT_TIMEZONE = 'Africa/Addis_Ababa'
