/**
 * School wall-clock time ↔ the UTC Odoo actually stores.
 *
 * Odoo keeps every `fields.Datetime` in UTC and converts on the way in and out
 * using the reader's timezone. This application never did either: it sent
 * `'2026-09-10 14:00:00'` exactly as typed and printed it back the same way, so
 * it looked perfectly consistent from inside while storing a value three hours
 * from what it claimed.
 *
 * That is not cosmetic. `school.announcement._compute_is_live` compares
 * `publish_datetime` against `fields.Datetime.now()`, which is real UTC, so an
 * announcement set to publish at 09:00 in Addis Ababa was stored as 09:00 UTC
 * and went live at noon. Every scheduled announcement published and expired
 * three hours late.
 *
 * No dependency. `Intl.DateTimeFormat` can already report what the wall clock
 * reads in a given zone at a given instant, and the offset is the difference
 * between that and the instant itself. Handles DST wherever it applies —
 * Ethiopia has none, but the school timezone is configurable and a hardcoded
 * +3 would be wrong the moment somebody changes it.
 */

/** Odoo's stored shape: `YYYY-MM-DD HH:MM:SS`, no zone, always UTC. */
const ODOO = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/

const pad = (value: number) => String(value).padStart(2, '0')

/**
 * How far ahead of UTC the zone is at a given instant, in milliseconds.
 *
 * Formats the instant into the zone, reads that wall clock back as though it
 * were UTC, and takes the difference. `hour12: false` can report hour 24 for
 * midnight in some engines, hence the modulo.
 */
function offsetAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)

  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)

  const asIfUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour') % 24,
    read('minute'),
    read('second'),
  )
  return asIfUtc - instant.getTime()
}

/**
 * A date and time as somebody typed them, to the UTC string Odoo stores.
 *
 * `date` is `YYYY-MM-DD` and `time` is `HH:MM`; a blank date yields a blank
 * string, because a cleared optional datetime must stay cleared rather than
 * becoming midnight today.
 *
 * The offset is applied twice. The first pass guesses using the offset at the
 * naive instant, the second corrects it at the instant that guess implies —
 * which matters only across a DST boundary, where the offset before and after
 * differ. It costs one extra format call and removes a once-a-year bug.
 */
export function toUtc(date: string, time: string, timeZone: string): string {
  if (!date) return ''

  const [year, month, day] = date.split('-').map(Number)
  const [hour = 0, minute = 0] = (time || '00:00').split(':').map(Number)
  if (!year || !month || !day) return ''

  const naive = Date.UTC(year, month - 1, day, hour, minute, 0)
  const firstPass = naive - offsetAt(new Date(naive), timeZone)
  const utc = new Date(naive - offsetAt(new Date(firstPass), timeZone))

  return (
    `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}` +
    ` ${pad(utc.getUTCHours())}:${pad(utc.getUTCMinutes())}:${pad(utc.getUTCSeconds())}`
  )
}

/**
 * The UTC string Odoo stored, back to the wall clock the school reads.
 *
 * Anything that is not a datetime — false, an empty string, a bare date — is
 * returned untouched, so this is safe to map over a record's fields without
 * knowing which of them carry a time.
 */
export function fromUtc(stored: unknown, timeZone: string): string {
  if (typeof stored !== 'string') return ''
  const match = ODOO.exec(stored)
  if (!match) return stored

  const [, year, month, day, hour, minute, second = '00'] = match
  const instant = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)),
  )
  const local = new Date(instant.getTime() + offsetAt(instant, timeZone))

  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    ` ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`
  )
}

/**
 * `fromUtc` across the datetime fields of one record, leaving the rest alone.
 *
 * The services call this on the way out so that everything above them — the
 * lists, the detail screens, the edit forms — keeps handling one kind of time.
 * A component that renders `start_datetime` needs no timezone of its own.
 */
export function localiseFields<T extends object>(
  row: T,
  fields: readonly string[],
  timeZone: string,
): T {
  /*
    `object` rather than `Record<string, unknown>`: the services pass declared
    interfaces, and an interface without an index signature does not satisfy
    that constraint, so every call site would have needed a cast.
  */
  const out: Record<string, unknown> = { ...(row as object) } as Record<string, unknown>
  for (const field of fields) {
    const value = out[field]
    if (typeof value === 'string' && value) {
      out[field] = fromUtc(value, timeZone)
    }
  }
  return out as T
}
