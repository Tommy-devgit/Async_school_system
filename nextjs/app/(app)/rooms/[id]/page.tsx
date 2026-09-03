import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  Card,
  CardHeader,
  DetailGrid,
  LinkButton,
  Note,
  PageHeader,
  StatusBadge,
} from '@/components/ui'
import { formatSelection, formatText, pluralise } from '@/lib/format'
import { getRoom, roomAccess, roomUsage } from '@/lib/odoo/models/facilities'

export const metadata = { title: 'Room · Async School' }

/**
 * One room, and what is currently in it.
 *
 * The usage counts are the point of this page. A room is only ever interesting
 * because something points at it, and the two things that do — classes and
 * timetable slots — are exactly what somebody needs to know before renaming or
 * archiving one.
 *
 * Each count answers for itself: `school.class.schedule` is readable by
 * administrators and teachers only, so a role that can manage rooms but not
 * read the timetable is told so rather than shown a zero implying the room is
 * free.
 */
export default async function RoomPage({ params }: PageProps<'/rooms/[id]'>) {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const [room, usage, { canWrite }] = await Promise.all([getRoom(id), roomUsage(id), roomAccess()])
  if (!room) notFound()

  const inUse = (usage.classes ?? 0) + (usage.slots ?? 0) > 0

  return (
    <>
      <PageHeader
        title={room.name}
        subtitle={formatSelection(room.room_type)}
        breadcrumbs={[
          { label: 'Configuration', href: '/configuration' },
          { label: 'Rooms', href: '/rooms' },
          { label: room.name },
        ]}
        action={
          canWrite ? (
            <LinkButton href={`/rooms/${id}/edit`} icon="configuration" size="sm">
              Edit
            </LinkButton>
          ) : undefined
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Details" />
          <DetailGrid
            fields={[
              { label: 'Name', value: room.name },
              { label: 'Code', value: formatText(room.code) },
              { label: 'Type', value: formatSelection(room.room_type) },
              // Zero means nobody recorded one, not a room that seats nobody.
              { label: 'Capacity', value: room.capacity > 0 ? String(room.capacity) : '—' },
              {
                label: 'Status',
                value: <StatusBadge state={room.active ? 'active' : 'archived'} size="sm" />,
              },
            ]}
          />
        </Card>

        <Card>
          <CardHeader title="In use by" hint="What points at this room right now." />
          <ul className="mt-3 space-y-1">
            <UsageRow
              label="Classes"
              count={usage.classes}
              href={`/classes?room=${id}`}
              linkable={false}
            />
            <UsageRow
              label="Timetable slots"
              count={usage.slots}
              href="/schedule"
              linkable={false}
            />
          </ul>
          {inUse ? (
            <Note>
              Archiving keeps every one of these pointing at the room — it only takes it out of
              the pickers. Odoo refuses to delete a room a class still uses.
            </Note>
          ) : null}
        </Card>
      </div>
    </>
  )
}

/**
 * A count that is a number, a dash, or nothing at all.
 *
 * `linkable` is false for both rows today: neither /classes nor /schedule
 * accepts a room filter, and pointing at a list that would ignore the filter
 * is worse than not linking. The prop is here so it can be turned on when one
 * of them gains it, rather than the fact being lost in a comment.
 */
function UsageRow({
  label,
  count,
  href,
  linkable,
}: {
  label: string
  count: number | null
  href: string
  linkable: boolean
}) {
  const body = (
    <span className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[13px] text-graphite">{label}</span>
      <span className="tabular text-[13px] text-graphite">
        {count === null ? (
          <span className="text-[11px] text-stone">Not available to your role</span>
        ) : (
          pluralise(count, label.toLowerCase().replace(/e?s$/, ''))
        )}
      </span>
    </span>
  )

  return (
    <li>
      {linkable && count ? (
        <Link href={href} className="-mx-1.5 block rounded-[8px] px-1.5 hover:bg-paper">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  )
}
