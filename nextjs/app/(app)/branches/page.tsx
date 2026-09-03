import { LinkButton, StatusBadge } from '@/components/ui'
import { ResourceList } from '@/components/resource-list'
import { RowLink } from '@/components/ui/table'
import { formatText } from '@/lib/format'
import { toOdooOrder } from '@/lib/list-query'
import { branchAccess, listBranches } from '@/lib/odoo/models/facilities'

export const metadata = { title: 'Branches · Async School' }

/**
 * Branches — `school.campus` in Odoo, which labels itself "Branch / Campus".
 *
 * Five models scope themselves to one: classes, staff, responsibilities,
 * announcements and programs. Nearly every role may read them and only
 * `group_school_admin` may write, so the button follows Odoo's answer.
 */
export default async function BranchesPage({ searchParams }: PageProps<'/branches'>) {
  const { canCreate } = await branchAccess()

  return (
    <ResourceList
      title="Branches"
      icon="campus"
      subtitle="The campuses this school runs. Classes, staff and announcements can each be scoped to one."
      basePath="/branches"
      searchParams={searchParams}
      search={{ placeholder: 'Branch name or code' }}
      filters={[
        { key: 'status', label: 'Status', options: [{ value: 'archived', label: 'Archived' }] },
      ]}
      defaultSort={{ field: 'name', direction: 'asc' }}
      load={(query) =>
        listBranches({
          search: query.search,
          filters: query.filters,
          order: toOdooOrder(query),
          limit: query.limit,
          offset: query.offset,
        })
      }
      action={
        canCreate ? (
          <LinkButton href="/branches/new" variant="primary" icon="plus" size="sm">
            Add a branch
          </LinkButton>
        ) : undefined
      }
      rowHref={(row) => `/branches/${row.id}`}
      emptyTitle="No branches yet"
      emptyHint="A single-site school does not need one; add a branch when there is more than one campus to tell apart."
      columns={[
        {
          key: 'name',
          label: 'Branch',
          sortField: 'name',
          render: (row) => (
            <RowLink href={`/branches/${row.id}`}>{row.name}</RowLink>
          ),
        },
        {
          key: 'code',
          label: 'Code',
          sortField: 'code',
          render: (row) => <span className="tabular">{formatText(row.code)}</span>,
        },
        {
          key: 'address',
          label: 'Address',
          hideBelow: 'md',
          render: (row) => formatText(row.address),
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
