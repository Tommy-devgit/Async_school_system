import { notFound } from 'next/navigation'
import { formatDualDate, formatSelection } from '@/lib/format'
import { ErrorState, LinkButton, PageHeader } from '@/components/ui'
import { WorkflowDetail } from '@/components/workflow-detail'
import { hasAccess } from '@/lib/odoo/client'
import { toOdooError } from '@/lib/odoo/errors'
import { getProgram } from '@/lib/odoo/models/operations'
import { m2oLabel } from '@/lib/odoo/types'

export const metadata = { title: 'Program · Async School' }

export default async function ProgramDetailPage({ params }: PageProps<'/programs/[id]'>) {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) notFound()

  let program, canWrite
  try {
    ;[program, canWrite] = await Promise.all([getProgram(id), hasAccess('school.program', 'write')])
  } catch (cause) {
    return (
      <>
        <PageHeader title="Program" />
        <ErrorState {...toOdooError(cause).toClient()} />
      </>
    )
  }
  if (!program) notFound()

  return (
    <WorkflowDetail
      title={program.name}
      subtitle={`${String(program.program_type || '')} · ${formatDualDate(program.start_datetime)}`}
      backHref="/programs"
      backLabel="Back to programs"
      workflow="program"
      id={program.id}
      state={String(program.state || '')}
      canWrite={canWrite}
      actions={
        canWrite ? (
          <LinkButton href={`/programs/${program.id}/edit`} icon="configuration" size="sm">
            Edit
          </LinkButton>
        ) : null
      }
      revalidate={[`/programs/${program.id}`, '/programs']}
      note="A cancelled program stays visible with its status rather than disappearing."
      fields={[
        { label: 'Type', value: formatSelection(program.program_type) },
        { label: 'Audience', value: formatSelection(program.audience_type) },
        { label: 'Starts', value: program.start_datetime },
        { label: 'Ends', value: program.end_datetime },
        { label: 'Location', value: program.location || '—' },
        { label: 'Organiser', value: m2oLabel(program.organizer_id) },
      ]}
    />
  )
}
