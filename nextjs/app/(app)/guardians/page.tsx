import { LinkButton, StatusBadge } from '@/components/ui'
import { ResourceList } from '@/components/resource-list'
import { hasAccess } from '@/lib/odoo/client'
import {
  listAllGuardians,
  type GlobalGuardianRow,
} from '@/lib/odoo/models/student'
import { selectionOptions } from '@/lib/odoo/selections'
import { toOdooOrder } from '@/lib/list-query'
import { formatText } from '@/lib/format'
import { m2oId, m2oLabel } from '@/lib/odoo/types'

export const metadata = { title: 'Guardians · Async School' }

export default async function GuardiansPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [canCreate, relationships] = await Promise.all([
    hasAccess('school.student.guardian', 'create'),
    selectionOptions('school.student.guardian', 'relationship'),
  ])

  return (
    <ResourceList<GlobalGuardianRow>
      title="Guardians"
      icon="students"
      basePath="/guardians"
      searchParams={searchParams}
      search={{ placeholder: 'Student, guardian name or phone' }}
      filters={[
        {
          key: 'relationship',
          label: 'Relationship',
          options: relationships,
        },
      ]}
      defaultSort={{ field: 'student_id', direction: 'asc' }}
      load={(query) =>
        listAllGuardians({
          search: query.search,
          filters: query.filters,
          order: toOdooOrder(query),
          limit: query.limit,
          offset: query.offset,
        })
      }
      action={
        canCreate ? (
          <LinkButton href="/guardians/new" variant="primary" icon="plus">
            Add guardian
          </LinkButton>
        ) : undefined
      }
      rowHref={(row) => `/students/${m2oId(row.student_id) ?? 0}`}
      removable="guardian"
      emptyTitle="No guardians visible"
      emptyHint="Odoo scopes this list to the records your role may see."
      emptyAction={
        canCreate ? (
          <LinkButton
            href="/guardians/new"
            variant="primary"
            icon="plus"
            size="sm"
          >
            Add the first guardian
          </LinkButton>
        ) : undefined
      }
      columns={[
        {
          key: 'student',
          label: 'Student',
          render: (row) => (
            <span className="font-medium text-graphite">
              {m2oLabel(row.student_id)}
            </span>
          ),
        },
        {
          key: 'contact',
          label: 'Contact',
          render: (row) => (
            <span className="text-graphite">
              {m2oLabel(row.partner_id)}
            </span>
          ),
        },
        {
          key: 'relationship',
          label: 'Relationship',
          render: (row) => (
            <span>{formatText(row.relationship)}</span>
          ),
        },
        {
          key: 'phone',
          label: 'Phone',
          render: (row) => (
            <span className="tabular">{formatText(row.phone)}</span>
          ),
        },
        {
          key: 'occupation',
          label: 'Occupation',
          render: (row) => (
            <span>{formatText(row.occupation)}</span>
          ),
        },
        {
          key: 'primary',
          label: 'Primary Contact',
          render: (row) => (
            <StatusBadge
              state={row.is_primary ? 'Primary' : 'No'}
              size="sm"
            />
          ),
        },
      ]}
    />
  )
}