import { notFound, redirect } from 'next/navigation'
import { Card, PageHeader } from '@/components/ui'
import { getRoom, roomAccess } from '@/lib/odoo/models/facilities'
import { selectionOptions } from '@/lib/odoo/selections'
import { RoomForm } from '../../room-form'

export const metadata = { title: 'Edit room · Async School' }

export default async function EditRoomPage({ params }: PageProps<'/rooms/[id]/edit'>) {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const [room, { canWrite }, roomTypes] = await Promise.all([
    getRoom(id),
    roomAccess(),
    selectionOptions('school.room', 'room_type'),
  ])
  if (!room) notFound()
  if (!canWrite) redirect(`/rooms/${id}`)

  return (
    <>
      <PageHeader
        title={`Edit ${room.name}`}
        breadcrumbs={[
          { label: 'Configuration', href: '/configuration' },
          { label: 'Rooms', href: '/rooms' },
          { label: room.name, href: `/rooms/${id}` },
          { label: 'Edit' },
        ]}
      />
      <Card className="max-w-3xl">
        <RoomForm
          mode="edit"
          id={id}
          values={{
            name: room.name,
            code: String(room.code || ''),
            room_type: String(room.room_type || ''),
            capacity: room.capacity ? String(room.capacity) : '',
            active: String(room.active),
          }}
          roomTypes={roomTypes}
        />
      </Card>
    </>
  )
}
