import { notFound, redirect } from 'next/navigation'
import { Card, PageHeader } from '@/components/ui'
import { branchAccess, getBranch } from '@/lib/odoo/models/facilities'
import { BranchForm } from '../../branch-form'

export const metadata = { title: 'Edit branch · Async School' }

export default async function EditBranchPage({
  params,
}: PageProps<'/branches/[id]/edit'>) {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const [branch, { canWrite }] = await Promise.all([getBranch(id), branchAccess()])
  if (!branch) notFound()
  if (!canWrite) redirect(`/branches/${id}`)

  return (
    <>
      <PageHeader
        title={`Edit ${branch.name}`}
        breadcrumbs={[
          { label: 'Configuration', href: '/configuration' },
          { label: 'Branches', href: '/branches' },
          { label: branch.name, href: `/branches/${id}` },
          { label: 'Edit' },
        ]}
      />
      <Card className="max-w-3xl">
        <BranchForm
          mode="edit"
          id={id}
          values={{
            name: branch.name,
            code: String(branch.code || ''),
            address: String(branch.address || ''),
            active: String(branch.active),
          }}
        />
      </Card>
    </>
  )
}
