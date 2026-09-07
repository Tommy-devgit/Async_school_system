import { notFound } from 'next/navigation'
import { ErrorState, PageHeader } from '@/components/ui'
import { WorkflowDetail } from '@/components/workflow-detail'
import { hasAccess } from '@/lib/odoo/client'
import { toOdooError } from '@/lib/odoo/errors'
import { getDocument } from '@/lib/odoo/models/operations'
import { m2oLabel } from '@/lib/odoo/types'

export const metadata = { title: 'Document · Async School' }

export default async function DocumentDetailPage({ params }: PageProps<'/documents/[id]'>) {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) notFound()

  let doc, canWrite
  try {
    ;[doc, canWrite] = await Promise.all([getDocument(id), hasAccess('school.document', 'write')])
  } catch (cause) {
    return (
      <>
        <PageHeader title="Document" />
        <ErrorState {...toOdooError(cause).toClient()} />
      </>
    )
  }
  if (!doc) notFound()

  return (
    <WorkflowDetail
      title={doc.name}
      subtitle={m2oLabel(doc.document_type_id)}
      backHref="/documents"
      backLabel="Back to documents"
      workflow="document"
      id={doc.id}
      state={String(doc.state || '')}
      canWrite={canWrite}
      revalidate={[`/documents/${doc.id}`, '/documents']}
      note="Rejecting requires a reason — Odoo refuses the transition without one. Document history cannot be deleted."
      fields={[
        { label: 'Type', value: m2oLabel(doc.document_type_id) },
        {
          label: 'File',
          /*
            The whole point of the record, and it was the one thing this screen
            could not show. A verifier had to take the checksum on trust or open
            Odoo's back office to see what they were approving.
          */
          value: (
            <a
              href={`/api/files/document/${doc.id}/file`}
              target="_blank"
              rel="noreferrer"
              className="text-action-blue hover:underline"
            >
              Open the document
            </a>
          ),
        },
        { label: 'Student', value: m2oLabel(doc.student_id) },
        { label: 'Staff', value: m2oLabel(doc.staff_id) },
        { label: 'Expires', value: doc.expiry_date || '—' },
        { label: 'Verified by', value: m2oLabel(doc.verified_by_id) },
        { label: 'Verified at', value: doc.verified_at || '—' },
        { label: 'Rejection reason', value: doc.rejection_reason || '—' },
      ]}
    />
  )
}
