/**
 * One vocabulary for every state the school module exposes.
 *
 * Twelve screens each carried their own `TONE` map, which is how the same
 * `draft` came to read as three different chips. This is the single table:
 * an Odoo state code in, a label and a tone out.
 *
 * Tones are semantic, not colours — a screen asks for "this is finished", not
 * "this is green", so the palette can change in one place. The rendering side
 * lives in `components/ui`.
 *
 * Nothing here decides behaviour. Odoo owns the state machine; this only
 * decides how its answer is drawn.
 */

import { formatSelection } from './format'

/**
 * - `idle`     nothing has happened yet (draft, not recorded)
 * - `progress` under way, waiting on somebody (submitted, pending, calculated)
 * - `active`   live and in force right now (active, open, published-and-live)
 * - `done`     completed and authoritative (approved, verified, locked, done)
 * - `stopped`  ended without completing (cancelled, rejected, withdrawn)
 * - `muted`    historical, superseded or switched off (archived, inactive)
 */
export type StatusTone = 'idle' | 'progress' | 'active' | 'done' | 'stopped' | 'muted'

interface StatusMeta {
  label: string
  tone: StatusTone
}

/**
 * Keyed by the raw Odoo selection code. Where two models use the same code
 * with the same meaning — `draft`, `published`, `cancelled` — one entry covers
 * both. Where a model's code means something specific it gets its own entry
 * under a `model:code` key, checked first.
 */
const BY_CODE: Record<string, StatusMeta> = {
  /* -------------------------------------------------- generic lifecycle --- */
  draft: { label: 'Draft', tone: 'idle' },
  new: { label: 'New', tone: 'idle' },
  incomplete: { label: 'Incomplete', tone: 'idle' },
  pending: { label: 'Pending', tone: 'progress' },
  pending_verification: { label: 'Pending verification', tone: 'progress' },
  submitted: { label: 'Submitted', tone: 'progress' },
  returned: { label: 'Returned', tone: 'progress' },
  calculated: { label: 'Calculated', tone: 'progress' },
  generated: { label: 'Generated', tone: 'progress' },
  uploaded: { label: 'Uploaded', tone: 'progress' },
  open: { label: 'Open', tone: 'active' },
  active: { label: 'Active', tone: 'active' },
  published: { label: 'Published', tone: 'active' },
  enrolled: { label: 'Enrolled', tone: 'active' },
  approved: { label: 'Approved', tone: 'done' },
  verified: { label: 'Verified', tone: 'done' },
  locked: { label: 'Locked', tone: 'done' },
  completed: { label: 'Completed', tone: 'done' },
  done: { label: 'Done', tone: 'done' },
  closed: { label: 'Closed', tone: 'done' },
  graduated: { label: 'Graduated', tone: 'done' },
  promoted: { label: 'Promoted', tone: 'done' },
  passed: { label: 'Passed', tone: 'done' },
  /*
    Both spellings are real and both are needed. Odoo's own
    `school.report.card.result` selection is `pass`/`fail`, while the
    report-card detail page derives the literals 'passed'/'failed' from a
    per-subject boolean. Only the long pair was listed here, so the result chip
    on the list fell through to the grey `idle` default — which made a failed
    report card look exactly like a passed one.
  */
  pass: { label: 'Pass', tone: 'done' },
  recorded: { label: 'Recorded', tone: 'done' },
  cancelled: { label: 'Cancelled', tone: 'stopped' },
  rejected: { label: 'Rejected', tone: 'stopped' },
  withdrawn: { label: 'Withdrawn', tone: 'stopped' },
  failed: { label: 'Failed', tone: 'stopped' },
  fail: { label: 'Fail', tone: 'stopped' },
  retained: { label: 'Retained', tone: 'stopped' },
  suspended: { label: 'Suspended', tone: 'stopped' },
  expired: { label: 'Expired', tone: 'stopped' },
  archived: { label: 'Archived', tone: 'muted' },
  inactive: { label: 'Inactive', tone: 'muted' },
  superseded: { label: 'Superseded', tone: 'muted' },
  transferred: { label: 'Transferred', tone: 'muted' },
  transferred_out: { label: 'Transferred out', tone: 'muted' },
  ended: { label: 'Ended', tone: 'muted' },
  exempt: { label: 'Exempt', tone: 'muted' },
  not_enrolled: { label: 'Not enrolled', tone: 'muted' },
  rescheduled: { label: 'Rescheduled', tone: 'progress' },
  applicant: { label: 'Applicant', tone: 'idle' },
  conditional: { label: 'Conditional', tone: 'progress' },

  /* ------------------------------------------------------- attendance --- */
  not_recorded: { label: 'Not recorded', tone: 'idle' },
  present: { label: 'Present', tone: 'done' },
  absent: { label: 'Absent', tone: 'stopped' },
  late: { label: 'Late', tone: 'progress' },
  excused: { label: 'Excused', tone: 'muted' },
  sick: { label: 'Sick', tone: 'muted' },
  official_duty: { label: 'Official duty', tone: 'active' },
  training: { label: 'Training', tone: 'active' },
  annual_leave: { label: 'Annual leave', tone: 'muted' },
  sick_leave: { label: 'Sick leave', tone: 'muted' },
  half_day: { label: 'Half day', tone: 'progress' },
}

/**
 * Codes whose meaning depends on the model they came from.
 * `completed` on an enrolment is a finished school year; on a timetable slot
 * it is a lesson that has been taught. Same tone, different words.
 */
const BY_MODEL_CODE: Record<string, StatusMeta> = {
  'school.enrollment:completed': { label: 'Completed year', tone: 'done' },
  'school.class.schedule:completed': { label: 'Taught', tone: 'done' },
  'school.class.schedule:published': { label: 'On timetable', tone: 'active' },
  'school.mark:draft': { label: 'Not entered', tone: 'idle' },
  'school.mark:submitted': { label: 'Entered', tone: 'progress' },
  /*
    `makeup` and `transfer` are the two codes this module genuinely overloads.
    A makeup on a timetable slot is a rescheduled lesson; on a mark it is a
    resit somebody still owes. `transfer` is an admission type on four models
    and a mark carried in from another school on this one. Scoped, so neither
    reading leaks into the other.
  */
  'school.mark:makeup': { label: 'Make-up required', tone: 'progress' },
  'school.mark:transfer': { label: 'Transfer mark', tone: 'muted' },
  'school.student:approved': { label: 'Registered', tone: 'done' },
}

/** The label and tone for a state code, optionally scoped to its model. */
export function statusMeta(code: unknown, model?: string): StatusMeta {
  if (code === false || code === null || code === undefined || code === '') {
    return { label: '—', tone: 'muted' }
  }
  const key = String(code)
  if (model) {
    const scoped = BY_MODEL_CODE[`${model}:${key}`]
    if (scoped) return scoped
  }
  // Unknown codes still render as prose rather than raw snake_case: the module
  // gains states over time and a new one must not surface as `pending_review`.
  return BY_CODE[key] ?? { label: formatSelection(key), tone: 'idle' }
}

export function statusLabel(code: unknown, model?: string): string {
  return statusMeta(code, model).label
}

export function statusTone(code: unknown, model?: string): StatusTone {
  return statusMeta(code, model).tone
}
