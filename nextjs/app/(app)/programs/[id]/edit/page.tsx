import { notFound } from 'next/navigation'
import { Card, ErrorState, LinkButton, PageHeader } from '@/components/ui'
import { hasAccess } from '@/lib/odoo/client'
import { toOdooError } from '@/lib/odoo/errors'
import { audienceChoices, getProgramDetail } from '@/lib/odoo/models/operations'
import { listManagerOptions } from '@/lib/odoo/models/staff'
import { selectionOptions } from '@/lib/odoo/selections'

import { ProgramForm } from '../../program-form'

export const metadata = { title: 'Edit program · Async School' }

/**
 * Odoo stores a datetime as `YYYY-MM-DD HH:MM:SS`; the form asks for the date
 * and the time separately. Anything unparseable comes back blank rather than
 * half-filled, so a bad stored value cannot quietly become a different one.
 */
function splitDateTime(value: string | false): { date: string; time: string } {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(value ?? ''))
  return match ? { date: match[1], time: match[2] } : { date: '', time: '' }
}

export default async function EditProgramPage({ params }: PageProps<'/programs/[id]/edit'>) {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) notFound()

  let program, programTypes, audienceTypes, departments, responsibilities, audiences, staff, allowed

  try {
    ;[
      program,
      programTypes,
      audienceTypes,
      departments,
      responsibilities,
      audiences,
      staff,
      allowed,
    ] = await Promise.all([
      getProgramDetail(id),
      selectionOptions('school.program', 'program_type'),
      selectionOptions('school.program', 'audience_type'),
      selectionOptions('school.program', 'department'),
      selectionOptions('school.program', 'responsibility'),
      audienceChoices(),
      listManagerOptions(),
      hasAccess('school.program', 'write'),
    ])
  } catch (cause) {
    return (
      <>
        <PageHeader title="Edit program" />
        <ErrorState {...toOdooError(cause).toClient()} />
      </>
    )
  }

  if (!program) notFound()

  if (!allowed) {
    return (
      <>
        <PageHeader title="Edit program" />
        <ErrorState
          code="FORBIDDEN"
          message="Your role can read programs but not change them. A registrar or administrator can."
        />
      </>
    )
  }

  const start = splitDateTime(program.start_datetime)
  const end = splitDateTime(program.end_datetime)

  /*
    The audience arrives as one field per type, because that is how the model
    stores it. Only the one matching `audience_type` is offered back to the
    form — the others are cleared on every write, so anything still sitting in
    them is from before a change and would be misleading to show.
  */
  const audienceIds =
    program.audience_type === 'teacher_group'
      ? program.teacher_ids
      : program.audience_type === 'subject_group'
        ? program.subject_ids
        : program.audience_type === 'class_section'
          ? program.class_ids
          : program.audience_type === 'branch_campus'
            ? program.campus_ids
            : program.audience_type === 'selected_staff'
              ? program.staff_ids
              : []

  const audienceCode =
    program.audience_type === 'department'
      ? String(program.department || '')
      : program.audience_type === 'responsibility'
        ? String(program.responsibility || '')
        : ''

  return (
    <>
      <PageHeader
        title="Edit program"
        subtitle={program.name}
        action={
          <LinkButton href={`/programs/${program.id}`} icon="arrowLeft">
            Cancel
          </LinkButton>
        }
      />
      <Card>
        <ProgramForm
          mode="edit"
          values={{
            id: program.id,
            name: program.name,
            program_type: String(program.program_type || ''),
            audience_type: String(program.audience_type || 'all_staff'),
            audience_code: audienceCode,
            audience_ids: audienceIds.map(String),
            start_date: start.date,
            start_time: start.time,
            end_date: end.date,
            end_time: end.time,
            location: String(program.location || ''),
            organizer_id: program.organizer_id ? String(program.organizer_id[0]) : '',
            description: String(program.description || ''),
          }}
          programTypes={programTypes}
          audienceTypes={audienceTypes}
          departments={departments}
          responsibilities={responsibilities}
          audiences={audiences}
          organizers={staff}
        />
      </Card>
    </>
  )
}
