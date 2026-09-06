import 'server-only'

/**
 * What may be removed from a list, and how.
 *
 * The browser posts a key from this table and never a model name, for the same
 * reason it posts a workflow key rather than a method name in `workflows.ts`:
 * a screen that could name its own model is a screen that could name any of
 * them. Everything here is resolved server-side, and Odoo re-checks the ACL
 * afterwards regardless.
 *
 * Two modes, and the difference is not cosmetic:
 *
 *   **delete** — `unlink`. Offered only where `ir.model.access.csv` grants it
 *   to somebody. Odoo still decides whether *this* user is that somebody.
 *
 *   **archive** — `active = False`. For models where the ACL grants unlink to
 *   nobody at all, which is a deliberate answer rather than an oversight: a
 *   student carries enrolments, marks, report cards, attendance and documents,
 *   so deleting one either fails on a foreign key or destroys academic history
 *   that a school is required to keep. Archiving removes it from every list and
 *   every picker, reversibly, and is what a record entered in error actually
 *   needs.
 *
 * The label always says which one is happening. A button that says Delete and
 * archives is worse than either.
 */

export type RemovalMode = 'delete' | 'archive'

export interface Removal {
  model: string
  mode: RemovalMode
  /** Singular, lowercase — "student", "program". Used in the confirmation. */
  noun: string
  plural: string
  /** Paths whose cached render is now wrong. */
  revalidate: string[]
  /** Shown next to the control, for a mode that needs explaining. */
  note?: string
}

/*
  Every entry's `mode` was decided by reading ir.model.access.csv, not by
  guessing. The models marked archive grant unlink to no group at all.
*/
export const REMOVALS = {
  student: {
    model: 'school.student',
    mode: 'archive',
    noun: 'student',
    plural: 'students',
    revalidate: ['/students', '/enrollments'],
    note:
      'Students are archived rather than deleted. Enrolments, marks, report cards and attendance all hang off the record, and a school has to keep them. An archived student leaves every list and can be restored.',
  },
  document: {
    model: 'school.document',
    mode: 'archive',
    noun: 'document',
    plural: 'documents',
    revalidate: ['/documents'],
    note:
      'Documents are archived rather than deleted. A verified document is evidence that a requirement was met, so removing it outright would rewrite the registration record.',
  },

  staff: {
    model: 'school.staff',
    mode: 'delete',
    noun: 'staff member',
    plural: 'staff members',
    revalidate: ['/staff', '/teachers'],
  },
  teacher: {
    model: 'school.teacher',
    mode: 'delete',
    noun: 'teaching profile',
    plural: 'teaching profiles',
    revalidate: ['/teachers', '/staff'],
  },
  guardian: {
    model: 'school.student.guardian',
    mode: 'delete',
    noun: 'guardian',
    plural: 'guardians',
    revalidate: ['/guardians'],
  },
  enrollment: {
    model: 'school.enrollment',
    mode: 'delete',
    noun: 'enrolment',
    plural: 'enrolments',
    revalidate: ['/enrollments', '/students'],
  },
  program: {
    model: 'school.program',
    mode: 'delete',
    noun: 'program',
    plural: 'programs',
    revalidate: ['/programs', '/programs/calendar'],
  },
  announcement: {
    model: 'school.announcement',
    mode: 'delete',
    noun: 'announcement',
    plural: 'announcements',
    revalidate: ['/announcements'],
  },
  assessment: {
    model: 'school.assessment',
    mode: 'delete',
    noun: 'assessment',
    plural: 'assessments',
    revalidate: ['/assessments', '/marks'],
  },
  curriculum: {
    model: 'school.grade.subject',
    mode: 'delete',
    noun: 'curriculum line',
    plural: 'curriculum lines',
    revalidate: ['/curriculum', '/configuration'],
  },
  classes: {
    model: 'school.class',
    mode: 'delete',
    noun: 'class',
    plural: 'classes',
    revalidate: ['/classes', '/configuration'],
  },
  subject: {
    model: 'school.subject',
    mode: 'delete',
    noun: 'subject',
    plural: 'subjects',
    revalidate: ['/subjects', '/curriculum'],
  },
  room: {
    model: 'school.room',
    mode: 'delete',
    noun: 'room',
    plural: 'rooms',
    revalidate: ['/rooms'],
  },
  branch: {
    model: 'school.campus',
    mode: 'delete',
    noun: 'campus',
    plural: 'campuses',
    revalidate: ['/branches'],
  },
  academicYear: {
    model: 'school.academic.year',
    mode: 'delete',
    noun: 'academic year',
    plural: 'academic years',
    revalidate: ['/academic-years', '/configuration'],
  },
  schedule: {
    model: 'school.class.schedule',
    mode: 'delete',
    noun: 'timetable slot',
    plural: 'timetable slots',
    revalidate: ['/schedule', '/schedule/grid'],
  },
  reportCard: {
    model: 'school.report.card',
    mode: 'delete',
    noun: 'report card',
    plural: 'report cards',
    revalidate: ['/report-cards'],
  },
  promotion: {
    model: 'school.promotion.batch',
    mode: 'delete',
    noun: 'promotion batch',
    plural: 'promotion batches',
    revalidate: ['/promotion'],
  },
} as const satisfies Record<string, Removal>

export type RemovalKey = keyof typeof REMOVALS

export function getRemoval(key: string): Removal | null {
  return Object.prototype.hasOwnProperty.call(REMOVALS, key)
    ? REMOVALS[key as RemovalKey]
    : null
}

/**
 * Which Odoo permission the mode needs.
 *
 * Archiving is a write, not an unlink — asking for the wrong one would hide the
 * control from every role that can actually do it.
 */
export function permissionFor(mode: RemovalMode): 'unlink' | 'write' {
  return mode === 'delete' ? 'unlink' : 'write'
}
