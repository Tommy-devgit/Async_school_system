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
import { formatText, pluralise } from '@/lib/format'
import { branchAccess, branchUsage, getBranch } from '@/lib/odoo/models/facilities'

export const metadata = { title: 'Branch · Async School' }

/**
 * One branch, and everything scoped to it.
 *
 * Five models point at `school.campus`, and each is readable by a different
 * set of roles — an HR user can see the staff on a branch and not the classes;
 * a teacher the reverse. So every count answers for itself, and a refusal says
 * so rather than reporting zero.
 *
 * That distinction matters more here than almost anywhere else in the app:
 * these numbers are what somebody reads before deciding a branch is safe to
 * archive, and a zero that really meant "you cannot see this" would be the
 * wrong answer to exactly that question.
 */
export default async function BranchPage({ params }: PageProps<'/branches/[id]'>) {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const [branch, usage, { canWrite }] = await Promise.all([
    getBranch(id),
    branchUsage(id),
    branchAccess(),
  ])
  if (!branch) notFound()

  const rows: Array<[string, string, number | null]> = [
    ['Classes', 'class', usage.classes],
    ['Staff', 'staff member', usage.staff],
    ['Responsibilities', 'responsibility', usage.responsibilities],
    ['Announcements', 'announcement', usage.announcements],
    ['Programs', 'program', usage.programs],
  ]
  const anyVisible = rows.some(([, , count]) => count !== null)
  const inUse = rows.some(([, , count]) => (count ?? 0) > 0)

  return (
    <>
      <PageHeader
        title={branch.name}
        subtitle={branch.code ? String(branch.code) : undefined}
        breadcrumbs={[
          { label: 'Configuration', href: '/configuration' },
          { label: 'Branches', href: '/branches' },
          { label: branch.name },
        ]}
        action={
          canWrite ? (
            <LinkButton href={`/branches/${id}/edit`} icon="configuration" size="sm">
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
              { label: 'Name', value: branch.name },
              { label: 'Code', value: formatText(branch.code) },
              { label: 'Address', value: formatText(branch.address) },
              {
                label: 'Status',
                value: <StatusBadge state={branch.active ? 'active' : 'archived'} size="sm" />,
              },
            ]}
          />
        </Card>

        <Card>
          <CardHeader title="Scoped to this branch" hint="What Odoo has attached to it." />
          <ul className="mt-3 space-y-1">
            {rows.map(([label, noun, count]) => (
              <li key={label} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="text-[13px] text-graphite">{label}</span>
                <span className="tabular text-[13px] text-graphite">
                  {count === null ? (
                    <span className="text-[11px] text-stone">Not available to your role</span>
                  ) : (
                    pluralise(count, noun)
                  )}
                </span>
              </li>
            ))}
          </ul>
          {!anyVisible ? (
            <Note>
              Your role cannot read any of the models that scope to a branch, so there is nothing
              to report here. That is the school system&apos;s answer, not a fault in this screen.
            </Note>
          ) : inUse ? (
            <Note>
              Archiving takes the branch out of every picker and leaves these records pointing at
              it. Odoo refuses to delete a branch that is still referenced.
            </Note>
          ) : null}
        </Card>
      </div>
    </>
  )
}
