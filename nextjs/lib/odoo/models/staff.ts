import 'server-only'
import { callKw, create, readOne, searchRead, write } from '@/lib/odoo/client'
import { orNullOnRefusal } from '@/lib/odoo/errors'
import type { Many2one, Page, Selection } from '@/lib/odoo/types'

/**
 * Staff registration, activation and employment history.
 *
 * Everything consequential here is an Odoo method call. In particular
 * `action_activate` is never reimplemented: it mints the STF- sequence, calls
 * `_ensure_employee()` to create the hr.employee, flips `state`, and
 * reactivates linked teacher profiles. Writing `state` directly would skip all
 * of that.
 */

/**
 * Resolves to null when Odoo refuses the read.
 *
 * A refusal is an expected outcome on a role-scoped ERP — several models are
 * legitimately invisible to some roles — so one restricted panel must not take
 * the whole page down. It never hides a value the caller was entitled to.
 */

/* ------------------------------------------------------------- metadata --- */

export interface SelectionOption {
  value: string
  label: string
}

export interface FieldMeta {
  type: string
  string: string
  required: boolean
  readonly: boolean
  selection?: SelectionOption[]
}

/**
 * Field metadata straight from Odoo.
 *
 * Odoo omits fields the caller may not access, so this doubles as the
 * permission check for the form: `school.staff.address` and `notes` are
 * restricted to base.group_system, and `date_of_birth`/`fayda_id` to the
 * personal-data groups. Rendering only what comes back means the form adapts
 * to the signed-in role instead of guessing — and never offers an input whose
 * write Odoo would refuse.
 */
export async function staffFieldMeta(): Promise<Record<string, FieldMeta>> {
  const raw = await callKw<Record<string, Record<string, unknown>>>(
    'school.staff',
    'fields_get',
    [],
    { attributes: ['type', 'string', 'required', 'readonly', 'selection'] },
  )
  const out: Record<string, FieldMeta> = {}
  for (const [name, meta] of Object.entries(raw)) {
    out[name] = {
      type: String(meta.type ?? 'char'),
      string: String(meta.string ?? name),
      required: Boolean(meta.required),
      readonly: Boolean(meta.readonly),
      selection: Array.isArray(meta.selection)
        ? (meta.selection as Array<[string, string]>).map(([value, label]) => ({ value, label }))
        : undefined,
    }
  }
  return out
}

/** True when the current user may see/write this field at all. */
export function canUse(meta: Record<string, FieldMeta>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(meta, field)
}

/* ----------------------------------------------------------------- read --- */

export interface StaffDetail {
  id: number
  name: string
  first_name: string | false
  last_name: string | false
  staff_id: string | false
  department: Selection
  job_title_id: Many2one
  employment_type: Selection
  employment_status: Selection
  state: Selection
  hire_date: string | false
  end_date: string | false
  phone: string | false
  mobile: string | false
  email: string | false
  gender: Selection
  primary_responsibility: Selection
  campus_id: Many2one
  manager_id: Many2one
  active: boolean
}

/**
 * What Odoo says still blocks activation, read on its own.
 *
 * `missing_to_activate` is a computed field that depends on `date_of_birth`,
 * which is restricted to the personal-data groups — so computing it raises
 * AccessError for a teacher and would take the whole record page down. It is
 * only needed by the activation panel, which requires write access anyway.
 */
export async function getActivationBlockers(id: number): Promise<string | null> {
  const row = await orNullOnRefusal(
    readOne<{ missing_to_activate: string | false }>(id ? 'school.staff' : 'school.staff', id, [
      'missing_to_activate',
    ]),
  )
  return row ? String(row.missing_to_activate || '') : null
}

/**
 * The HR and login links, read separately.
 *
 * Rendering `employee_id` means Odoo resolving an hr.employee display name,
 * and hr.employee is not readable by a plain internal user — so including it
 * in the main read made the whole page 403 for a teacher. Split out and
 * optional: the record stays visible, the links simply do not.
 */
export interface StaffLinks {
  employee_id: Many2one
  user_id: Many2one
}

export function getStaffLinks(id: number): Promise<StaffLinks | null> {
  return orNullOnRefusal(readOne<StaffLinks>('school.staff', id, ['employee_id', 'user_id'])) as Promise<
    StaffLinks | null
  >
}

const STAFF_DETAIL_FIELDS = [
  'name',
  'first_name',
  'last_name',
  'staff_id',
  'department',
  'job_title_id',
  'employment_type',
  'employment_status',
  'state',
  'hire_date',
  'end_date',
  'phone',
  'mobile',
  'email',
  'gender',
  'primary_responsibility',
  'campus_id',
  'manager_id',
  'active',
] as const

export function getStaff(id: number): Promise<StaffDetail | null> {
  return readOne<StaffDetail>('school.staff', id, STAFF_DETAIL_FIELDS)
}

/**
 * Personal data, fetched separately and deliberately.
 *
 * `date_of_birth` and `fayda_id` carry a field-level group. Asking for them
 * as a role that lacks it raises AccessError — so this returns null rather
 * than failing the whole page, and the caller renders "restricted".
 * This is not a workaround: the value is never obtained.
 */
export function getStaffPersonalData(
  id: number,
): Promise<{ date_of_birth: string | false; fayda_id: string | false; age: number } | null> {
  return orNullOnRefusal(readOne('school.staff', id, ['date_of_birth', 'fayda_id', 'age']))
}

export interface ResponsibilityRow {
  id: number
  responsibility: Selection
  is_primary: boolean
  department: Selection
  campus_id: Many2one
  manager_id: Many2one
  start_date: string
  end_date: string | false
  active: boolean
}

export function listResponsibilities(staffId: number): Promise<Page<ResponsibilityRow>> {
  return searchRead<ResponsibilityRow>(
    'school.staff.responsibility',
    ['responsibility', 'is_primary', 'department', 'campus_id', 'manager_id', 'start_date', 'end_date', 'active'],
    { domain: [['staff_id', '=', staffId]], limit: 50 },
  )
}

export interface EmploymentRow {
  id: number
  job_title_id: Many2one
  responsibility: Selection
  manager_id: Many2one
  campus_id: Many2one
  date_start: string
  date_end: string | false
  reason: string | false
}

/**
 * Employment history and daily status are owned by HR: only
 * group_school_hr and group_school_admin carry an ACL row for them
 * (security/ir.model.access.csv). A Registrar viewing a staff record therefore
 * gets AccessError on these two reads, which is correct — so they resolve to
 * null and the page renders "not available to your role" for that card alone
 * rather than failing whole.
 */
export function listEmployment(staffId: number): Promise<Page<EmploymentRow> | null> {
  return orNullOnRefusal(searchRead<EmploymentRow>(
    'school.staff.employment',
    ['job_title_id', 'responsibility', 'manager_id', 'campus_id', 'date_start', 'date_end', 'reason'],
    { domain: [['staff_id', '=', staffId]], limit: 50 },
  ))
}

export interface DailyStatusRow {
  id: number
  date: string
  status: Selection
  check_in: string | false
  check_out: string | false
  worked_hours: number
}

export function listDailyStatus(staffId: number, limit = 14): Promise<Page<DailyStatusRow> | null> {
  return orNullOnRefusal(searchRead<DailyStatusRow>(
    'school.staff.daily.status',
    ['date', 'status', 'check_in', 'check_out', 'worked_hours'],
    { domain: [['staff_id', '=', staffId]], limit, order: 'date desc' },
  ))
}

export interface JobTitleOption {
  id: number
  name: string
  department: Selection
  responsibility: Selection
}

/** Job titles carry the responsibility they grant — see school.job.title. */
export async function listJobTitles(): Promise<JobTitleOption[]> {
  const page = await searchRead<JobTitleOption>(
    'school.job.title',
    ['name', 'department', 'responsibility'],
    { domain: [['active', '=', true]], limit: 200, order: 'department, name' },
  )
  return page.rows
}

/**
 * Staff members who can be somebody's reporting manager.
 *
 * `_check_manager_is_not_self` refuses a self-reference, so the caller's own
 * record is dropped here too — offering a choice Odoo will reject is a worse
 * experience than not offering it, and the constraint still has the final say.
 */
export async function listManagerOptions(excludeId?: number): Promise<Array<{ id: number; name: string; staff_id: string | false }>> {
  const page = await orNullOnRefusal(
    searchRead<{ id: number; name: string; staff_id: string | false }>(
      'school.staff',
      ['name', 'staff_id'],
      {
        domain: [
          ['active', '=', true],
          ['state', '=', 'active'],
          ...(excludeId ? [['id', '!=', excludeId]] : []),
        ],
        limit: 300,
        order: 'name',
      },
    ),
  )
  return page?.rows ?? []
}

/** Campuses, for the responsibility and staff forms. Read as the caller. */
export async function listCampusOptions(): Promise<Array<{ id: number; name: string }>> {
  const page = await orNullOnRefusal(
    searchRead<{ id: number; name: string }>('school.campus', ['name'], {
      domain: [['active', '=', true]],
      limit: 100,
      order: 'name',
    }),
  )
  return page?.rows ?? []
}

/**
 * The teacher profile on this staff record, if there is one.
 *
 * `school.teacher.staff_id` is required and one profile per staff member is
 * the practical rule, so this reads at most one. It is what makes the staff
 * page the entry point to the teaching side of the domain.
 */
export function getTeacherProfileFor(
  staffId: number,
): Promise<Page<{ id: number; name: string; teacher_id: string | false; teaching_status: Selection }> | null> {
  return orNullOnRefusal(
    searchRead('school.teacher', ['name', 'teacher_id', 'teaching_status'], {
      domain: [['staff_id', '=', staffId]],
      limit: 1,
    }),
  )
}

/* ---------------------------------------------------------------- write --- */

export interface StaffIntake {
  first_name: string
  last_name: string
  department: string
  job_title_id: number
  employment_status: string
  employment_type?: string
  gender?: string
  phone?: string
  mobile?: string
  email?: string
  hire_date?: string
  date_of_birth?: string
  fayda_id?: string
  /** Responsibility the new staff member holds. Required to leave Draft. */
  responsibility: string
}

/**
 * Create a staff record ready for activation.
 *
 * The one piece of UI behaviour that has no server-side equivalent is
 * `_onchange_job_title_id`, which seeds the primary responsibility line from
 * `job_title_id.responsibility`. Onchange never fires over RPC, so without it
 * `action_activate` fails on "at least one active Responsibility".
 *
 * Rather than re-deriving that rule here, the responsibility is an explicit
 * field on the form (defaulted in the UI from the chosen job title) and is
 * written inline as a One2many command — the same payload the onchange
 * builds, in the same transaction as the staff row.
 */
export async function createStaff(intake: StaffIntake): Promise<number> {
  const { responsibility, ...values } = intake
  const payload: Record<string, unknown> = {
    ...Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== '')),
    responsibility_ids: [
      [
        0,
        0,
        {
          responsibility,
          is_primary: true,
          department: intake.department,
          start_date: intake.hire_date || new Date().toISOString().slice(0, 10),
        },
      ],
    ],
  }
  return create('school.staff', payload)
}

export function updateStaff(id: number, values: Record<string, unknown>): Promise<boolean> {
  return write('school.staff', [id], values)
}

/* ------------------------------------------------------- state machine --- */

/**
 * Responsibilities decide whether a staff member can be activated at all.
 *
 * `_missing_registration_fields` requires "at least one active Responsibility"
 * before the record may leave Draft, and `_compute_primary_responsibility`
 * reads the primary one. Without a way to manage these from the frontend, a
 * staff member created here could be stuck in Draft permanently — which is
 * what was happening.
 */
export function addResponsibility(
  staffId: number,
  values: {
    responsibility: string
    is_primary: boolean
    department?: string
    campus_id?: number
    manager_id?: number
    start_date: string
    end_date?: string
  },
): Promise<number> {
  return create('school.staff.responsibility', {
    staff_id: staffId,
    ...Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== '')),
  })
}

/**
 * Change an existing responsibility.
 *
 * Add, End and Make-primary were all reachable and this was not, so a
 * responsibility recorded with the wrong department, campus, reporting manager
 * or start date could only be ended and replaced — which loses the history the
 * `mail.thread` mixin exists to keep, and leaves a misleading ended row behind.
 *
 * `is_primary` is deliberately not writable here. It carries a uniqueness
 * constraint across the staff member's other rows, so it keeps its own action
 * which clears the previous primary first.
 */
export function updateResponsibility(
  id: number,
  values: {
    responsibility?: string
    department?: string | false
    campus_id?: number | false
    manager_id?: number | false
    start_date?: string
    end_date?: string | false
  },
): Promise<boolean> {
  return write('school.staff.responsibility', [id], values)
}

/**
 * End a responsibility rather than delete it.
 *
 * The model is `mail.thread`-tracked precisely so the history survives, and
 * the brief calls for responsibility history to be recorded. Closing it with
 * an end date and clearing `active` keeps the row; deleting would not.
 */
export function endResponsibility(id: number, endDate: string): Promise<boolean> {
  return write('school.staff.responsibility', [id], { end_date: endDate, active: false })
}

/**
 * Make one responsibility the primary.
 *
 * `_check_single_primary` refuses a second primary on the same staff member,
 * so the previous one is cleared first — in the caller's own session, so both
 * writes are authorised the same way. Odoo still re-checks.
 */
export async function setPrimaryResponsibility(staffId: number, id: number): Promise<boolean> {
  const current = await searchRead<{ id: number }>('school.staff.responsibility', ['id'], {
    domain: [
      ['staff_id', '=', staffId],
      ['is_primary', '=', true],
      ['id', '!=', id],
    ],
    limit: 10,
  })
  if (current.rows.length) {
    await write(
      'school.staff.responsibility',
      current.rows.map((row) => row.id),
      { is_primary: false },
    )
  }
  return write('school.staff.responsibility', [id], { is_primary: true })
}


/* --------------------------------------------------------- dataset import --- */

/**
 * What `school.staff.import._analyse` reports back.
 *
 * Every list holds source `staff_id` values, except the column and name lists.
 * Nothing is written by a dry run.
 */
export interface StaffImportReport {
  source_rows: number
  importable: string[]
  already_imported: string[]
  unknown_department: string[]
  unknown_employment_status: string[]
  unknown_gender: string[]
  invalid_fayda: string[]
  name_matches_existing: string[]
  unmapped_source_columns: string[]
  duplicate_source_ids: string[]
  duplicate_source_names: string[]
  teaching_staff: string[]
  created?: string[]
}

/**
 * Analyse an uploaded CSV without writing anything.
 *
 * The file is parsed and validated by Odoo against the live vocabularies —
 * department, employment status, gender, Fayda format — and against staff that
 * already exist. Reimplementing any of that here would let the preview and the
 * import disagree.
 */
export function dryRunStaffImport(base64Csv: string): Promise<StaffImportReport> {
  return callKw<StaffImportReport>('school.staff.import', 'dry_run_upload', [base64Csv])
}

/**
 * Import an uploaded CSV.
 *
 * Only the rows the analysis cleared are created, and they land in Draft:
 * activation needs a birth date, phone, job title and responsibility that no
 * source file carries. Odoo requires a system administrator for this.
 */
export function runStaffImport(base64Csv: string): Promise<StaffImportReport> {
  return callKw<StaffImportReport>('school.staff.import', 'run_import_upload', [base64Csv])
}
