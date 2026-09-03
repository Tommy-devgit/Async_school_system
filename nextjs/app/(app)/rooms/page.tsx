import { LinkButton, StatusBadge } from '@/components/ui'
import { ResourceList } from '@/components/resource-list'
import { RowLink } from '@/components/ui/table'
import { formatSelection, formatText } from '@/lib/format'
import { toOdooOrder } from '@/lib/list-query'
import { listRooms, roomAccess } from '@/lib/odoo/models/facilities'
import { selectionOptions } from '@/lib/odoo/selections'

export const metadata = { title: 'Rooms · Async School' }

/**
 * Rooms were visible on the configuration screen and editable nowhere, so a
 * school could read the rooms it had and could not add one — the timetable and
 * every class had to point at whatever Odoo was seeded with.
 *
 * `school.room` grants create and write to `group_school_admin` alone, so the
 * button is offered on Odoo's answer rather than on a guess, and Odoo refuses
 * again on submit either way.
 */
export default async function RoomsPage({ searchParams }: PageProps<'/rooms'>) {
  const [{ canCreate }, types] = await Promise.all([
    roomAccess(),
    selectionOptions('school.room', 'room_type'),
  ])

  return (
    <ResourceList
      title="Rooms"
      icon="rooms"
      subtitle="Every place a class can be timetabled into."
      basePath="/rooms"
      searchParams={searchParams}
      search={{ placeholder: 'Room name or code' }}
      filters={[
        { key: 'type', label: 'Type', options: types },
        {
          key: 'status',
          label: 'Status',
          /*
            Odoo hides archived rows from a plain search, so "archived" is not
            a value of a field here — it is a different query. The service
            turns it into `active_test: false`.
          */
          options: [{ value: 'archived', label: 'Archived' }],
        },
      ]}
      defaultSort={{ field: 'name', direction: 'asc' }}
      load={(query) =>
        listRooms({
          search: query.search,
          filters: query.filters,
          order: toOdooOrder(query),
          limit: query.limit,
          offset: query.offset,
        })
      }
      action={
        canCreate ? (
          <LinkButton href="/rooms/new" variant="primary" icon="plus" size="sm">
            Add a room
          </LinkButton>
        ) : undefined
      }
      rowHref={(row) => `/rooms/${row.id}`}
      emptyTitle="No rooms yet"
      emptyHint="A class and a timetable slot both point at a room, so this is usually the first thing a school sets up."
      columns={[
        {
          key: 'name',
          label: 'Room',
          sortField: 'name',
          render: (row) => (
            <RowLink href={`/rooms/${row.id}`}>{row.name}</RowLink>
          ),
        },
        {
          key: 'code',
          label: 'Code',
          sortField: 'code',
          render: (row) => <span className="tabular">{formatText(row.code)}</span>,
        },
        {
          key: 'type',
          label: 'Type',
          hideBelow: 'sm',
          render: (row) => formatSelection(row.room_type),
        },
        {
          key: 'capacity',
          label: 'Capacity',
          numeric: true,
          sortField: 'capacity',
          // A capacity of zero means nobody recorded one, not a room holding
          // nobody, so it reads as a dash rather than a confident 0.
          render: (row) => (row.capacity > 0 ? row.capacity : '—'),
        },
        {
          key: 'active',
          label: 'Status',
          render: (row) => <StatusBadge state={row.active ? 'active' : 'archived'} size="sm" />,
        },
      ]}
    />
  )
}
