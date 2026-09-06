import Link from 'next/link'
import { DateText, StatusBadge } from '@/components/ui'
import { ResourceList } from '@/components/resource-list'
import { formatSelection, formatText } from '@/lib/format'
import { toOdooOrder } from '@/lib/list-query'
import { hasAccess } from '@/lib/odoo/client'
import { listPrograms } from '@/lib/odoo/models/operations'
import { selectionOptions } from '@/lib/odoo/selections'
import { m2oLabel } from '@/lib/odoo/types'

export const metadata = { title: 'Programs · Async School' }

export default async function ProgramsPage({ searchParams }: PageProps<'/programs'>) {
  const [states, types, audiences, canCreate] = await Promise.all([
    selectionOptions('school.program', 'state'),
    selectionOptions('school.program', 'program_type'),
    selectionOptions('school.program', 'audience_type'),
    hasAccess('school.program', 'create'),
  ])

  return (
    <ResourceList
      title="Programs"
      icon="programs"
      basePath="/programs"
      searchParams={searchParams}
      subtitle="Events and activities on the school calendar."
      search={{ placeholder: 'Program name or location' }}
      action={
        <div className="flex items-center gap-2">
          <Link
            href="/programs/calendar"
            className="rounded-[9999px] border border-silver px-4 py-2 text-[13px] hover:bg-paper"
          >
            Calendar
          </Link>
          {/* Only where Odoo would accept the create — director and teacher read only. */}
          {canCreate ? (
            <Link
              href="/programs/new"
              className="rounded-[9999px] bg-ink px-4 py-2 text-[13px] text-white hover:bg-graphite"
            >
              New program
            </Link>
          ) : null}
        </div>
      }
      filters={[
        { key: 'status', label: 'Status', options: states },
        { key: 'type', label: 'Type', options: types },
        { key: 'audience', label: 'Audience', options: audiences },
      ]}
      defaultSort={{ field: 'start_datetime', direction: 'desc' }}
      load={(query) =>
        listPrograms({
          search: query.search,
          filters: query.filters,
          order: toOdooOrder(query),
          limit: query.limit,
          offset: query.offset,
        })
      }
      rowHref={(row) => `/programs/${row.id}`}
      removable="program"
      emptyTitle="No programs visible"
      columns={[
        {
          key: 'name',
          label: 'Program',
          sortField: 'name',
          render: (row) => row.name,
        },
        { key: 'type', label: 'Type', hideBelow: 'md', render: (row) => formatSelection(row.program_type) },
        {
          key: 'audience',
          label: 'Audience',
          hideBelow: 'lg',
          render: (row) => formatSelection(row.audience_type),
        },
        {
          key: 'start',
          label: 'Starts',
          sortField: 'start_datetime',
          render: (row) => <DateText value={row.start_datetime} withTime />,
        },
        {
          key: 'end',
          label: 'Ends',
          hideBelow: 'md',
          render: (row) => <DateText value={row.end_datetime} withTime />,
        },
        {
          key: 'location',
          label: 'Location',
          hideBelow: 'sm',
          render: (row) => formatText(row.location),
        },
        {
          key: 'organizer',
          label: 'Organiser',
          hideBelow: 'lg',
          render: (row) => m2oLabel(row.organizer_id),
        },
        { key: 'state', label: 'Status', render: (row) => <StatusBadge state={row.state} /> },
      ]}
    />
  )
}
