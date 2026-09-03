import { redirect } from 'next/navigation'
import { Card, PageHeader } from '@/components/ui'
import { roomAccess } from '@/lib/odoo/models/facilities'
import { selectionOptions } from '@/lib/odoo/selections'
import { RoomForm } from '../room-form'

export const metadata = { title: 'New room · Async School' }

export default async function NewRoomPage() {
  const [{ canCreate }, roomTypes] = await Promise.all([
    roomAccess(),
    selectionOptions('school.room', 'room_type'),
  ])

  // Re-checked here as well as on the list, so a typed-in URL is not a way in.
  // Odoo refuses the write regardless; this only avoids a dead end.
  if (!canCreate) redirect('/rooms')

  return (
    <>
      <PageHeader
        title="New room"
        subtitle="Rooms are what classes and timetable slots are placed in."
        breadcrumbs={[
          { label: 'Configuration', href: '/configuration' },
          { label: 'Rooms', href: '/rooms' },
          { label: 'New' },
        ]}
      />
      <Card className="max-w-3xl">
        <RoomForm
          mode="create"
          values={{ name: '', code: '', room_type: 'classroom', capacity: '', active: 'true' }}
          roomTypes={roomTypes}
        />
      </Card>
    </>
  )
}
