import 'server-only'
import { callKw, create, readOne, searchCount, searchRead, write } from '@/lib/odoo/client'
import { orNullOnRefusal } from '@/lib/odoo/errors'
import { ethiopianYearOf } from '@/lib/ethiopian-date'
import { listDomain, type ListOptions } from '@/lib/odoo/list'
import type { Domain, Ids, Many2one, Page, Selection } from '@/lib/odoo/types'

/**
 * Typed read services per school model.
 *
 * Every field list is explicit and minimal. Two reasons, both measured against
 * staging: a bare read raises AccessError for anyone below base.group_system
 * (school.staff carries system-only fields), and reading everything pulls
 * unstored computes that each run their own queries per row.
 *
 * `fayda_id` appears in exactly one place — the staff detail field list used
 * only where the caller is expected to hold the personal-data groups. Odoo
 * refuses it for anyone else with a 403, which is the intended behaviour and
 * must not be worked around.
 */

/* ------------------------------------------------------------- Students --- */

export interface StudentRow {
  id: number
  name: string
  regno: string | false
  class_id: Many2one
  grade_id: Many2one
  academic_year_id: Many2one
  registration_status: Selection
  lifecycle_status: Selection
  gender: Selection
}

const STUDENT_LIST_FIELDS = [
  'name',
  'regno',
  'class_id',
  'grade_id',
  'academic_year_id',
  'registration_status',
  'lifecycle_status',
  'gender',
] as const

/** The filters this screen offers, and the Odoo field each one narrows. */
export const STUDENT_FILTERS = {
  status: { field: 'registration_status' },
  lifecycle: { field: 'lifecycle_status' },
  class: { field: 'class_id', kind: 'many2one' },
  year: { field: 'academic_year_id', kind: 'many2one' },
} as const

/**
 * The default order, and the reason the screen can group by grade at all.
 *
 * A school's students are read by grade, so the list leads with it and falls
 * back to the name inside each one. Ordering on `grade_id` follows
 * school.grade's own `sequence, name` — 10, 20 … 120 — so Grade 10 lands after
 * Grade 9 rather than between Grade 1 and Grade 2, which is what ordering on
 * the class name did.
 *
 * A reader who sorts by a column still gets exactly what they asked for: this
 * is only the default, and `toOdooOrder` replaces it. Grouping follows the
 * order rather than imposing one, so a name-sorted list simply shows the
 * grades interleaved, which is what sorting by name means.
 */
export const STUDENT_DEFAULT_ORDER = 'grade_id asc, name asc'

export function listStudents(options: ListOptions = {}): Promise<Page<StudentRow>> {
  return searchRead<StudentRow>('school.student', STUDENT_LIST_FIELDS, {
    domain: listDomain(options, {
      searchFields: ['name', 'regno', 'admission_number'],
      filters: STUDENT_FILTERS,
    }),
    limit: options.limit ?? 25,
    offset: options.offset ?? 0,
    order: options.order ?? STUDENT_DEFAULT_ORDER,
  })
}

export interface StudentDetail extends StudentRow {
  admission_number: string | false
  date_of_birth: string | false
  age: number
  guardian_name: string | false
  guardian_phone: string | false
  education_level: Selection
  admission_type: Selection
  enrollment_count: number
}

export function getStudent(id: number): Promise<StudentDetail | null> {
  return readOne<StudentDetail>('school.student', id, [
    ...STUDENT_LIST_FIELDS,
    'admission_number',
    'date_of_birth',
    'age',
    'guardian_name',
    'guardian_phone',
    'education_level',
    'admission_type',
    'enrollment_count',
  ])
}

/* ---------------------------------------------------------------- Staff --- */

export interface StaffRow {
  id: number
  name: string
  staff_id: string | false
  department: Selection
  job_title_id: Many2one
  state: Selection
  employment_status: Selection
  primary_responsibility: Selection
}

const STAFF_LIST_FIELDS = [
  'name',
  'staff_id',
  'department',
  'job_title_id',
  'state',
  'employment_status',
  'primary_responsibility',
] as const

export const STAFF_FILTERS = {
  status: { field: 'state' },
  department: { field: 'department' },
  employment: { field: 'employment_status' },
} as const

export function listStaff(options: ListOptions = {}): Promise<Page<StaffRow>> {
  return searchRead<StaffRow>('school.staff', STAFF_LIST_FIELDS, {
    domain: listDomain(options, {
      searchFields: ['name', 'staff_id'],
      filters: STAFF_FILTERS,
    }),
    limit: options.limit ?? 25,
    offset: options.offset ?? 0,
    order: options.order ?? 'name asc',
  })
}

/* ------------------------------------------------------------- Teachers --- */

export interface TeacherRow {
  id: number
  name: string
  teacher_id: string | false
  department: Selection
  teaching_status: Selection
  assigned_class_count: number
  assigned_subject_count: number
  total_student_count: number
  current_weekly_periods: number
}

const TEACHER_FIELDS = [
  'name',
  'teacher_id',
  'department',
  'teaching_status',
  'assigned_class_count',
  'assigned_subject_count',
  'total_student_count',
  'current_weekly_periods',
] as const

export const TEACHER_FILTERS = {
  status: { field: 'teaching_status' },
  department: { field: 'department' },
} as const

export function listTeachers(options: ListOptions = {}): Promise<Page<TeacherRow>> {
  return searchRead<TeacherRow>('school.teacher', TEACHER_FIELDS, {
    domain: listDomain(options, {
      searchFields: ['name', 'teacher_id'],
      filters: TEACHER_FILTERS,
    }),
    limit: options.limit ?? 25,
    offset: options.offset ?? 0,
    order: options.order ?? 'name asc',
  })
}

/* ---------------------------------------------------------- Assignments --- */

export interface AssignmentRow {
  id: number
  name: string
  teacher_id: Many2one
  subject_id: Many2one
  class_id: Many2one
  term_id: Many2one
  academic_year_id: Many2one
  weekly_periods: number
  responsibility: Selection
  state: Selection
}

const ASSIGNMENT_FIELDS = [
  'name',
  'teacher_id',
  'subject_id',
  'class_id',
  'term_id',
  'academic_year_id',
  'weekly_periods',
  'responsibility',
  'state',
] as const

export const ASSIGNMENT_FILTERS = {
  status: { field: 'state' },
  responsibility: { field: 'responsibility' },
  teacher: { field: 'teacher_id', kind: 'many2one' },
  class: { field: 'class_id', kind: 'many2one' },
  subject: { field: 'subject_id', kind: 'many2one' },
  term: { field: 'term_id', kind: 'many2one' },
} as const

export function listAssignments(options: ListOptions = {}): Promise<Page<AssignmentRow>> {
  return searchRead<AssignmentRow>('school.teacher.assignment', ASSIGNMENT_FIELDS, {
    domain: listDomain(options, { searchFields: ['name'], filters: ASSIGNMENT_FILTERS }),
    limit: options.limit ?? 25,
    offset: options.offset ?? 0,
    order: options.order ?? 'academic_year_id desc, term_id asc',
  })
}

/* ---------------------------------------------------------------- Marks --- */

export interface MarkRow {
  id: number
  student_id: Many2one
  subject_id: Many2one
  class_id: Many2one
  term_id: Many2one
  exam_type: Selection
  score: number
  max_score: number
  percentage: number
  /** Computed by Odoo's grading scheme. Never recomputed here. */
  grade: string | false
  mark_status: Selection
}

const MARK_FIELDS = [
  'student_id',
  'subject_id',
  'class_id',
  'term_id',
  'exam_type',
  'score',
  'max_score',
  'percentage',
  'grade',
  'mark_status',
] as const

export const MARK_FILTERS = {
  status: { field: 'mark_status' },
  type: { field: 'exam_type' },
  class: { field: 'class_id', kind: 'many2one' },
  subject: { field: 'subject_id', kind: 'many2one' },
  term: { field: 'term_id', kind: 'many2one' },
} as const

export function listMarks(options: ListOptions = {}): Promise<Page<MarkRow>> {
  return searchRead<MarkRow>('school.mark', MARK_FIELDS, {
    // Searching a related field is Odoo's own dotted path, resolved server-side.
    domain: listDomain(options, {
      searchFields: ['student_id.name'],
      filters: MARK_FILTERS,
    }),
    limit: options.limit ?? 25,
    offset: options.offset ?? 0,
    order: options.order ?? 'student_id asc',
  })
}

/* ------------------------------------------------------------- Academic --- */

export interface ClassRow {
  id: number
  name: string
  grade_id: Many2one
  section_id: Many2one
  academic_year_id: Many2one
  education_level: Selection
  capacity: number
  student_ids: Ids
}

export const CLASS_FILTERS = {
  level: { field: 'education_level' },
  year: { field: 'academic_year_id', kind: 'many2one' },
  grade: { field: 'grade_id', kind: 'many2one' },
} as const

export function listClasses(options: ListOptions = {}): Promise<Page<ClassRow>> {
  return searchRead<ClassRow>(
    'school.class',
    ['name', 'grade_id', 'section_id', 'academic_year_id', 'education_level', 'capacity', 'student_ids'],
    {
      domain: listDomain(options, { searchFields: ['name'], filters: CLASS_FILTERS }),
      limit: options.limit ?? 25,
      offset: options.offset ?? 0,
      order: options.order ?? 'name asc',
    },
  )
}

export interface SubjectRow {
  id: number
  name: string
  code: string | false
  subject_type: Selection
  active: boolean
}

export const SUBJECT_FILTERS = {
  type: { field: 'subject_type' },
} as const

export function listSubjects(options: ListOptions = {}): Promise<Page<SubjectRow>> {
  return searchRead<SubjectRow>('school.subject', ['name', 'code', 'subject_type', 'active'], {
    domain: listDomain(options, { searchFields: ['name', 'code'], filters: SUBJECT_FILTERS }),
    limit: options.limit ?? 25,
    offset: options.offset ?? 0,
    order: options.order ?? 'name asc',
  })
}

/* ------------------------------------------------- classes: read/write --- */

export interface ClassDetail extends ClassRow {
  room_id: Many2one
  shift_id: Many2one
  stream_id: Many2one
  campus_id: Many2one
  homeroom_teacher_id: Many2one
  is_entry_level: boolean
  min_age: number
  max_age: number
  active: boolean
}

const CLASS_DETAIL_FIELDS = [
  'name', 'grade_id', 'section_id', 'academic_year_id', 'education_level',
  'capacity', 'student_ids', 'room_id', 'shift_id', 'stream_id', 'campus_id',
  'homeroom_teacher_id', 'is_entry_level', 'min_age', 'max_age', 'active',
] as const

export function getClass(id: number): Promise<ClassDetail | null> {
  return orNullOnRefusal(readOne<ClassDetail>('school.class', id, CLASS_DETAIL_FIELDS))
}

export function createClass(values: Record<string, unknown>): Promise<number> {
  return create('school.class', values)
}

/**
 * `section_id` and `academic_year_id` are half of the uniqueness constraint
 * and the scope every enrolled student was checked against, so Odoo, not this
 * layer, decides whether a change to them is allowed.
 */
export function updateClass(id: number, values: Record<string, unknown>): Promise<boolean> {
  return write('school.class', [id], values)
}

/* ------------------------------------------------ subjects: read/write --- */

export interface SubjectDetail extends SubjectRow {
  sequence_code: string | false
  short_name: string | false
  credit_hours: number
}

export function getSubject(id: number): Promise<SubjectDetail | null> {
  return orNullOnRefusal(
    readOne<SubjectDetail>('school.subject', id, [
      'name', 'code', 'short_name', 'sequence_code', 'subject_type', 'credit_hours', 'active',
    ]),
  )
}

export function createSubject(values: Record<string, unknown>): Promise<number> {
  return create('school.subject', values)
}

export function updateSubject(id: number, values: Record<string, unknown>): Promise<boolean> {
  return write('school.subject', [id], values)
}

export interface AcademicYearRow {
  id: number
  name: string
  date_start: string
  date_end: string
  state: Selection
  is_current: boolean
  class_count: number
}

export const ACADEMIC_YEAR_FILTERS = {
  status: { field: 'state' },
} as const

const ACADEMIC_YEAR_FIELDS = [
  'name',
  'date_start',
  'date_end',
  'state',
  'is_current',
  'class_count',
] as const

export function listAcademicYears(options: ListOptions = {}): Promise<Page<AcademicYearRow>> {
  return searchRead<AcademicYearRow>('school.academic.year', ACADEMIC_YEAR_FIELDS, {
    domain: listDomain(options, { searchFields: ['name'], filters: ACADEMIC_YEAR_FILTERS }),
    limit: options.limit ?? 25,
    offset: options.offset ?? 0,
    order: options.order ?? 'name desc',
  })
}

export function getAcademicYear(id: number): Promise<AcademicYearRow | null> {
  return readOne<AcademicYearRow>('school.academic.year', id, ACADEMIC_YEAR_FIELDS)
}

export interface AcademicYearIntake {
  date_start: string
  date_end: string
  is_current: boolean
}

/**
 * Create an academic year.
 *
 * The name is derived, never typed. Odoo's `_check_year_name` requires it to
 * be the four-digit Ethiopian year of the Gregorian `date_start`, so asking a
 * registrar to retype it can only produce a validation error. `is_current` is
 * still Odoo's to police — `_check_single_current_year` rejects a second one.
 */
export function createAcademicYear(intake: AcademicYearIntake): Promise<number> {
  const year = ethiopianYearOf(intake.date_start)
  if (year === null) throw new Error('The start date is not a valid date.')

  return create('school.academic.year', {
    name: String(year),
    date_start: intake.date_start,
    date_end: intake.date_end,
    is_current: intake.is_current,
  })
}

/* ------------------------------------------------------------ Aggregate --- */

/**
 * A count that returns null instead of throwing when the role cannot read the
 * model at all. Four record rules are known to be ineffective, so several
 * roles legitimately get AccessError on school.student and school.mark; a
 * dashboard tile should say "not available to your role", not crash the page.
 */
/**
 * Correct a draft or open academic year.
 *
 * The name follows the start date rather than being typed: `_check_year_name`
 * requires it to be the four-digit Ethiopian year of `date_start`, so moving
 * the start date without moving the name can only produce a refusal.
 *
 * Odoo's `write` makes closed and archived years read-only for everything but
 * state, is_current and active — those need `correctAcademicYear`.
 */
export function updateAcademicYear(
  id: number,
  intake: AcademicYearIntake,
): Promise<boolean> {
  const year = ethiopianYearOf(intake.date_start)
  if (year === null) throw new Error('The start date is not a valid date.')

  return write('school.academic.year', [id], {
    name: String(year),
    date_start: intake.date_start,
    date_end: intake.date_end,
    is_current: intake.is_current,
  })
}

export interface YearCorrectionIntake {
  academicYearId: number
  name: string
  dateStart: string
  dateEnd: string
  reason: string
}

/**
 * Change a closed or archived year through the authorized workflow.
 *
 * `action_confirm` re-checks the director group, writes with the
 * `authorized_academic_correction` context that Odoo's `write` requires, and
 * posts the reason to the record's chatter. Writing the fields directly would
 * be refused, and bypassing the wizard would lose the audit trail.
 */
export async function correctAcademicYear(intake: YearCorrectionIntake): Promise<void> {
  const wizardId = await create('school.academic.year.correction', {
    academic_year_id: intake.academicYearId,
    name: intake.name,
    date_start: intake.dateStart,
    date_end: intake.dateEnd,
    reason: intake.reason,
  })
  await callKw('school.academic.year.correction', 'action_confirm', [[wizardId]])
}

export function safeCount(model: string, domain: Domain = []): Promise<number | null> {
  return orNullOnRefusal(searchCount(model, domain))
}
