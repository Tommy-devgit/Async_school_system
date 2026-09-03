import 'server-only'
import { create, hasAccess, readOne, searchCount, searchRead, write } from '@/lib/odoo/client'
import { orNullOnRefusal } from '@/lib/odoo/errors'
import { listDomain, type ListOptions } from '@/lib/odoo/list'
import type { Page } from '@/lib/odoo/types'

/**
 * Rooms and branches — the two places a school physically is.
 *
 * Both models were readable from the configuration screen and editable
 * nowhere, so a school could see the rooms it had and could not add one. They
 * are small models, but everything hangs off them: a class has a room and a
 * branch, a timetable slot has a room, a staff member and a responsibility
 * have a branch, and announcements and programs are addressed to branches.
 *
 * **Who may change them is Odoo's answer, and it is narrow.** `school.room`
 * grants create/write to `group_school_admin` alone and read to teachers;
 * `school.campus` grants create/write to the administrator and read to nearly
 * everyone. Every screen here asks `hasAccess` rather than assuming, and Odoo
 * refuses again on submit regardless.
 */

/* ----------------------------------------------------------------- rooms --- */

export interface RoomRow {
  id: number
  name: string
  code: string | false
  room_type: string | false
  capacity: number
  active: boolean
}

export const ROOM_FIELDS = ['name', 'code', 'room_type', 'capacity', 'active'] as const

export const ROOM_FILTERS = {
  type: { field: 'room_type' },
} as const

/**
 * Odoo hides archived records from a plain search, so "show inactive" has to
 * ask for them explicitly. `active_test: false` is Odoo's own switch for that
 * — the alternative, a domain on `active`, is silently ignored.
 */
export function listRooms(options: ListOptions = {}): Promise<Page<RoomRow>> {
  const showArchived = options.filters?.status === 'archived'
  const filters = { ...options.filters }
  delete filters.status

  return searchRead<RoomRow>('school.room', ROOM_FIELDS, {
    domain: [
      ...listDomain({ ...options, filters }, {
        searchFields: ['name', 'code'],
        filters: ROOM_FILTERS,
      }),
      ...(showArchived ? [['active', '=', false]] : []),
    ],
    limit: options.limit ?? 25,
    offset: options.offset ?? 0,
    order: options.order ?? 'name',
    ...(showArchived ? { context: { active_test: false } } : {}),
  })
}

export function getRoom(id: number): Promise<RoomRow | null> {
  return readOne<RoomRow>('school.room', id, ROOM_FIELDS)
}

export function createRoom(values: Record<string, unknown>): Promise<number> {
  return create('school.room', values)
}

export function updateRoom(id: number, values: Record<string, unknown>): Promise<boolean> {
  return write('school.room', [id], values)
}

/**
 * What a room is currently holding.
 *
 * Both counts degrade to null on their own: `school.class.schedule` is
 * readable by administrators and teachers only, so a role that can manage
 * rooms but not read the timetable gets a stated boundary rather than a zero
 * implying the room is free.
 */
export interface RoomUsage {
  classes: number | null
  slots: number | null
}

export async function roomUsage(id: number): Promise<RoomUsage> {
  const [classes, slots] = await Promise.all([
    orNullOnRefusal(searchCount('school.class', [['room_id', '=', id]])),
    orNullOnRefusal(
      searchCount('school.class.schedule', [
        ['room_id', '=', id],
        ['state', '!=', 'cancelled'],
      ]),
    ),
  ])
  return { classes, slots }
}

/* -------------------------------------------------------------- branches --- */

export interface BranchRow {
  id: number
  name: string
  code: string | false
  address: string | false
  active: boolean
}

export const BRANCH_FIELDS = ['name', 'code', 'address', 'active'] as const

export function listBranches(options: ListOptions = {}): Promise<Page<BranchRow>> {
  const showArchived = options.filters?.status === 'archived'

  return searchRead<BranchRow>('school.campus', BRANCH_FIELDS, {
    domain: [
      ...listDomain({ ...options, filters: {} }, { searchFields: ['name', 'code'] }),
      ...(showArchived ? [['active', '=', false]] : []),
    ],
    limit: options.limit ?? 25,
    offset: options.offset ?? 0,
    order: options.order ?? 'name',
    ...(showArchived ? { context: { active_test: false } } : {}),
  })
}

export function getBranch(id: number): Promise<BranchRow | null> {
  return readOne<BranchRow>('school.campus', id, BRANCH_FIELDS)
}

export function createBranch(values: Record<string, unknown>): Promise<number> {
  return create('school.campus', values)
}

export function updateBranch(id: number, values: Record<string, unknown>): Promise<boolean> {
  return write('school.campus', [id], values)
}

/**
 * What a branch currently carries.
 *
 * Five models point at `school.campus` and each is readable by a different
 * set of roles, so every count answers for itself. A null is "your role cannot
 * see this", never "there are none" — the difference matters most here,
 * because these numbers are what tell somebody whether a branch is safe to
 * archive.
 */
export interface BranchUsage {
  classes: number | null
  staff: number | null
  responsibilities: number | null
  announcements: number | null
  programs: number | null
}

export async function branchUsage(id: number): Promise<BranchUsage> {
  const [classes, staff, responsibilities, announcements, programs] = await Promise.all([
    orNullOnRefusal(searchCount('school.class', [['campus_id', '=', id]])),
    orNullOnRefusal(searchCount('school.staff', [['campus_id', '=', id]])),
    orNullOnRefusal(searchCount('school.staff.responsibility', [['campus_id', '=', id]])),
    orNullOnRefusal(searchCount('school.announcement', [['campus_ids', 'in', [id]]])),
    orNullOnRefusal(searchCount('school.program', [['campus_ids', 'in', [id]]])),
  ])
  return { classes, staff, responsibilities, announcements, programs }
}

/* ---------------------------------------------------------------- access --- */

export interface FacilityAccess {
  canCreate: boolean
  canWrite: boolean
}

export async function roomAccess(): Promise<FacilityAccess> {
  const [canCreate, canWrite] = await Promise.all([
    hasAccess('school.room', 'create'),
    hasAccess('school.room', 'write'),
  ])
  return { canCreate, canWrite }
}

export async function branchAccess(): Promise<FacilityAccess> {
  const [canCreate, canWrite] = await Promise.all([
    hasAccess('school.campus', 'create'),
    hasAccess('school.campus', 'write'),
  ])
  return { canCreate, canWrite }
}
