import { redirect } from 'next/navigation'
import { Card, PageHeader } from '@/components/ui'
import { branchAccess } from '@/lib/odoo/models/facilities'
import { BranchForm } from '../branch-form'

export const metadata = { title: 'New branch · Async School' }

export default async function NewBranchPage() {
  const { canCreate } = await branchAccess()
  if (!canCreate) redirect('/branches')

  return (
    <>
      <PageHeader
        title="New branch"
        subtitle="A campus that classes, staff and announcements can be scoped to."
        breadcrumbs={[
          { label: 'Configuration', href: '/configuration' },
          { label: 'Branches', href: '/branches' },
          { label: 'New' },
        ]}
      />
      <Card className="max-w-3xl">
        <BranchForm mode="create" values={{ name: '', code: '', address: '', active: 'true' }} />
      </Card>
    </>
  )
}
