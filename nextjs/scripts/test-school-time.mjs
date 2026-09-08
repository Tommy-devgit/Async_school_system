/**
 * School wall clock ↔ the UTC Odoo stores.
 *
 * The bug these guard against was invisible from inside the application: it
 * wrote the time exactly as typed and read it back the same way, so the screen
 * always agreed with itself while the stored value meant something three hours
 * away. Only Odoo noticed, when `_compute_is_live` compared it against a real
 * UTC now() and published every scheduled announcement late.
 *
 * So the assertions here are about the stored string, not about what a form
 * shows, and the round trip is asserted separately from each direction — a
 * conversion that is wrong in both directions by the same amount round-trips
 * perfectly and is still wrong.
 *
 * Run: node scripts/test-school-time.mjs
 */
import assert from 'node:assert/strict'
import { fromUtc, localiseFields, toUtc } from '../lib/school-time.ts'

const ADDIS = 'Africa/Addis_Ababa' // UTC+3 all year, no DST
const UTC = 'UTC'

/* ------------------------------------------------------------- writing --- */

// The case that was broken: 14:00 in Addis is 11:00 UTC, not 14:00 UTC.
assert.equal(toUtc('2026-09-10', '14:00', ADDIS), '2026-09-10 11:00:00')

// Crossing midnight backwards: 01:00 local is the previous day in UTC.
assert.equal(toUtc('2026-09-10', '01:00', ADDIS), '2026-09-09 22:00:00')

// Midnight itself, the default the form supplies when no time is given.
assert.equal(toUtc('2026-09-10', '', ADDIS), '2026-09-09 21:00:00')

// A zone with no offset must be left exactly alone.
assert.equal(toUtc('2026-09-10', '14:00', UTC), '2026-09-10 14:00:00')

// A blank date stays blank: clearing an optional datetime must not become
// midnight today, which would schedule something nobody asked for.
assert.equal(toUtc('', '14:00', ADDIS), '')
assert.equal(toUtc('not-a-date', '14:00', ADDIS), '')

/* ------------------------------------------------------------- reading --- */

assert.equal(fromUtc('2026-09-10 11:00:00', ADDIS), '2026-09-10 14:00:00')
assert.equal(fromUtc('2026-09-09 22:00:00', ADDIS), '2026-09-10 01:00:00')
assert.equal(fromUtc('2026-09-10 14:00:00', UTC), '2026-09-10 14:00:00')

// Odoo hands back `false` for an empty datetime, and dates carry no time.
assert.equal(fromUtc(false, ADDIS), '')
assert.equal(fromUtc('', ADDIS), '')
assert.equal(fromUtc('2026-09-10', ADDIS), '2026-09-10')

/* --------------------------------------------------------- round trip --- */

/*
  Asserted last and deliberately not on its own. Both directions being wrong by
  the same amount round-trips perfectly, which is exactly the state the
  application was already in.
*/
for (const [date, time] of [
  ['2026-09-10', '14:00'],
  ['2026-01-01', '00:00'],
  ['2026-12-31', '23:59'],
  ['2026-02-28', '03:30'],
]) {
  const stored = toUtc(date, time, ADDIS)
  assert.equal(fromUtc(stored, ADDIS).slice(0, 16), `${date} ${time}`, `${date} ${time}`)
}

/* ------------------------------------------- a zone that actually shifts --- */

/*
  Ethiopia has no daylight saving, so a hardcoded +3 would have passed
  everything above. This is why the offset is measured at the instant rather
  than assumed: London is +1 in July and +0 in January.
*/
const LONDON = 'Europe/London'
assert.equal(toUtc('2026-07-10', '12:00', LONDON), '2026-07-10 11:00:00')
assert.equal(toUtc('2026-01-10', '12:00', LONDON), '2026-01-10 12:00:00')
assert.equal(fromUtc('2026-07-10 11:00:00', LONDON), '2026-07-10 12:00:00')
assert.equal(fromUtc('2026-01-10 12:00:00', LONDON), '2026-01-10 12:00:00')

/* ------------------------------------------------------ whole records --- */

const row = {
  id: 7,
  name: 'Parents evening',
  start_datetime: '2026-09-10 11:00:00',
  end_datetime: '2026-09-10 13:00:00',
  create_date: '2026-09-01 06:00:00',
  location: 'Main hall',
  organizer_id: [3, 'A Person'],
  expiry_datetime: false,
}
const localised = localiseFields(row, ['start_datetime', 'end_datetime', 'expiry_datetime'], ADDIS)

assert.equal(localised.start_datetime, '2026-09-10 14:00:00')
assert.equal(localised.end_datetime, '2026-09-10 16:00:00')
// Not listed, so untouched — the caller decides which fields carry a time.
assert.equal(localised.create_date, '2026-09-01 06:00:00')
// Listed but empty: left as Odoo sent it rather than becoming a string.
assert.equal(localised.expiry_datetime, false)
// Everything else survives, including the many2one tuple.
assert.equal(localised.name, 'Parents evening')
assert.deepEqual(localised.organizer_id, [3, 'A Person'])
// The original is not mutated.
assert.equal(row.start_datetime, '2026-09-10 11:00:00')

console.log('school-time: ok')
