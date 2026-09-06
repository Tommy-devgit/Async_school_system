import { Card, ErrorState, LinkButton, PageHeader } from '@/components/ui'
import { hasAccess } from '@/lib/odoo/client'
import { toOdooError } from '@/lib/odoo/errors'
import { documentTypeOptions, studentOptions } from '@/lib/odoo/filter-options'
import { listManagerOptions } from '@/lib/odoo/models/staff'

import { DocumentForm } from '../document-form'

export const metadata = { title: 'File a document · Async School' }

export default async function NewDocumentPage() {
  let documentTypes, students, staff, canCreate

  try {
    ;[documentTypes, students, staff, canCreate] = await Promise.all([
      documentTypeOptions(),
      studentOptions(),
      listManagerOptions(),
      hasAccess('school.document', 'create'),
    ])
  } catch (cause) {
    return (
      <>
        <PageHeader title="File a document" />
        <ErrorState {...toOdooError(cause).toClient()} />
      </>
    )
  }

  if (!canCreate) {
    return (
      <>
        <PageHeader title="File a document" />
        <ErrorState
          code="FORBIDDEN"
          message="Your role cannot file documents. A registrar or administrator can."
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="File a document"
        subtitle="Filed as uploaded. Verifying it is a separate step, so nothing counts as evidence by accident."
        action={
          <LinkButton href="/documents" icon="arrowLeft">
            Cancel
          </LinkButton>
        }
      />
      <Card>
        <DocumentForm
          documentTypes={documentTypes}
          students={students}
          staff={staff.map((member) => ({ value: String(member.id), label: member.name }))}
        />
      </Card>
    </>
  )
}
