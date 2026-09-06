import Link from 'next/link'
import { Badge, DateText, LinkButton, StatusBadge } from '@/components/ui'
import { ResourceList } from '@/components/resource-list'
import { formatSelection } from '@/lib/format'
import { toOdooOrder } from '@/lib/list-query'
import { hasAccess } from '@/lib/odoo/client'
import { listAnnouncements } from '@/lib/odoo/models/operations'
import { selectionOptions } from '@/lib/odoo/selections'

export const metadata = { title: 'Announcements · Async School' }

export default async function AnnouncementsPage({ searchParams }: PageProps<'/announcements'>) {
  const [states, categories, audiences, priorities, canCreate] = await Promise.all([
    selectionOptions('school.announcement', 'state'),
    selectionOptions('school.announcement', 'category'),
    selectionOptions('school.announcement', 'audience_type'),
    selectionOptions('school.announcement', 'priority'),
    hasAccess('school.announcement', 'create'),
  ])
  const priorityLabel = new Map(priorities.map((option) => [option.value, option.label]))

  return (
    <ResourceList
      title="Announcements"
      icon="announcements"
      basePath="/announcements"
      searchParams={searchParams}
      subtitle="Odoo resolves the audience and refreshes visibility on a schedule."
      search={{ placeholder: 'Title' }}
      filters={[
        { key: 'status', label: 'Status', options: states },
        { key: 'category', label: 'Category', options: categories },
        { key: 'audience', label: 'Audience', options: audiences },
        { key: 'priority', label: 'Priority', options: priorities },
      ]}
      defaultSort={{ field: 'publish_datetime', direction: 'desc' }}
      load={(query) =>
        listAnnouncements({
          search: query.search,
          filters: query.filters,
          order: toOdooOrder(query),
          limit: query.limit,
          offset: query.offset,
        })
      }
      rowHref={(row) => `/announcements/${row.id}`}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/announcements/board"
            className="rounded-[9999px] border border-silver px-4 py-2 text-[13px] hover:bg-paper"
          >
            Board view
          </Link>
          {canCreate ? (
            <LinkButton href="/announcements/new" variant="primary" icon="plus">
              New announcement
            </LinkButton>
          ) : null}
        </div>
      }
      emptyTitle="No announcements visible"
      emptyHint="You see the ones you authored and the ones addressed to you."
      columns={[
        {
          key: 'name',
          label: 'Title',
          sortField: 'name',
          render: (row) => row.name,
        },
        {
          key: 'category',
          label: 'Category',
          hideBelow: 'md',
          render: (row) => formatSelection(row.category),
        },
        {
          key: 'audience',
          label: 'Audience',
          hideBelow: 'lg',
          render: (row) => formatSelection(row.audience_type),
        },
        {
          key: 'priority',
          label: 'Priority',
          hideBelow: 'sm',
          // Odoo's own label, so a new priority level needs no change here.
          render: (row) => priorityLabel.get(String(row.priority)) ?? '—',
        },
        {
          key: 'publish',
          label: 'Published',
          sortField: 'publish_datetime',
          hideBelow: 'md',
          render: (row) => <DateText value={row.publish_datetime} withTime />,
        },
        {
          key: 'live',
          label: 'Live now',
          render: (row) => (row.is_live ? <Badge tone="live">Live</Badge> : null),
        },
        { key: 'state', label: 'Status', render: (row) => <StatusBadge state={row.state} /> },
      ]}
    />
  )
}
