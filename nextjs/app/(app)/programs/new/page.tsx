import { Card, ErrorState, LinkButton, PageHeader } from '@/components/ui'
import { hasAccess } from '@/lib/odoo/client'
import { toOdooError } from '@/lib/odoo/errors'
import { audienceChoices } from '@/lib/odoo/models/operations'
// Active staff, which is what an organiser is. The helper is named for the
// responsibility form's manager picker but its domain is exactly this.
import { listManagerOptions } from '@/lib/odoo/models/staff'
import { selectionOptions } from '@/lib/odoo/selections'

import { ProgramForm } from '../program-form'

export const metadata = { title: 'New program · Async School' }

const EMPTY = {
  name: '',
  program_type: 'meeting',
  audience_type: 'all_staff',
  audience_code: '',
  audience_ids: [] as string[],
  start_date: '',
  start_time: '',
  end_date: '',
  end_time: '',
  location: '',
  organizer_id: '',
  description: '',
}

export default async function NewProgramPage() {
  let programTypes, audienceTypes, departments, responsibilities, audiences, staff, allowed

  try {
    ;[programTypes, audienceTypes, departments, responsibilities, audiences, staff, allowed] =
      await Promise.all([
        selectionOptions('school.program', 'program_type'),
        selectionOptions('school.program', 'audience_type'),
        selectionOptions('school.program', 'department'),
        selectionOptions('school.program', 'responsibility'),
        audienceChoices(),
        listManagerOptions(),
        hasAccess('school.program', 'create'),
      ])
  } catch (cause) {
    return (
      <>
        <PageHeader title="New program" />
        <ErrorState {...toOdooError(cause).toClient()} />
      </>
    )
  }

  if (!allowed) {
    return (
      <>
        <PageHeader title="New program" />
        <ErrorState
          code="FORBIDDEN"
          message="Your role cannot create programs. A registrar or administrator can."
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="New program"
        subtitle="Saved as a draft. Publishing it is a separate step, so nothing is announced by accident."
        action={
          <LinkButton href="/programs" icon="arrowLeft">
            Cancel
          </LinkButton>
        }
      />
      <Card>
        <ProgramForm
          mode="create"
          values={EMPTY}
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
