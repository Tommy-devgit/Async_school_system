import { LinkButton, StatusBadge } from '@/components/ui'
import { ResourceList } from '@/components/resource-list'
import { hasAccess } from '@/lib/odoo/client'
import { classOptions } from '@/lib/odoo/filter-options'
import { listStudents } from '@/lib/odoo/models/school'
import { selectionOptions } from '@/lib/odoo/selections'
import { toOdooOrder } from '@/lib/list-query'
import { formatText } from '@/lib/format'
import { m2oId, m2oLabel } from '@/lib/odoo/types'

export const metadata = { title: 'Students · Async School' }

/**
 * Searching, filtering, sorting and paging all reach Odoo as a domain, an
 * order and a limit. Nothing is narrowed in the browser: record rules already
 * scope the rows per user, and one page is never the whole result set.
 */
export default async function StudentsPage({ searchParams }: PageProps<'/students'>) {
  const [canCreate, registrationStatuses, lifecycleStatuses, classes] = await Promise.all([
    hasAccess('school.student', 'create'),
    selectionOptions('school.student', 'registration_status'),
    selectionOptions('school.student', 'lifecycle_status'),
    classOptions(),
  ])

  return (
    <ResourceList
      title="Students"
      icon="students"
      basePath="/students"
      searchParams={searchParams}
      search={{ placeholder: 'Name, student ID or admission number' }}
      filters={[
        { key: 'status', label: 'Registration', options: registrationStatuses },
        { key: 'lifecycle', label: 'Lifecycle', options: lifecycleStatuses },
        { key: 'class', label: 'Class', options: classes },
      ]}
      /*
        Grade first, because that is how a school reads its own roll. Ordering
        on `grade_id` follows school.grade's `sequence, name` — 10, 20 … 120 —
        so Grade 10 comes after Grade 9 instead of between Grade 1 and Grade 2,
        which is what ordering on the class name did.
      */
      defaultSort={{ field: 'grade_id', direction: 'asc' }}
      load={(query) => {
        /*
          The name is the tiebreaker inside whatever the reader chose, so a
          grade's students are alphabetical. Skipped when they are already
          sorting by name, which would otherwise ask Odoo to order by it twice.
        */
        const order = toOdooOrder(query)
        return listStudents({
          search: query.search,
          filters: query.filters,
          order: order && !order.startsWith('name') ? `${order}, name asc` : order,
          limit: query.limit,
          offset: query.offset,
        })
      }}
      /*
        Grouped only while the list is sorted by grade — see ResourceList. The
        label is Odoo's own grade name, never a number parsed out of anything.
      */
      groupBy={{
        sortField: 'grade_id',
        of: (row) =>
          m2oId(row.grade_id) === null
            ? null
            : { key: String(m2oId(row.grade_id)), label: m2oLabel(row.grade_id) },
      }}
      action={
        canCreate ? (
          <LinkButton href="/students/new" variant="primary" icon="plus">
            Register student
          </LinkButton>
        ) : undefined
      }
      rowHref={(row) => `/students/${row.id}`}
      removable="student"
      emptyTitle="No students visible"
      emptyHint="Odoo scopes this list to the records your role may see."
      emptyAction={
        canCreate ? (
          <LinkButton href="/students/new" variant="primary" icon="plus" size="sm">
            Register the first student
          </LinkButton>
        ) : undefined
      }
      columns={[
        {
          key: 'name',
          label: 'Name',
          sortField: 'name',
          render: (row) => row.name,
        },
        {
          key: 'regno',
          label: 'Student ID',
          sortField: 'regno',
          render: (row) => <span className="tabular">{formatText(row.regno)}</span>,
        },
        /*
          Kept as a column even though the group heading repeats it, because it
          is what makes grade a sort the reader can choose: sorting by name
          scatters the grades and drops the headings, and this is the way back.
          Hidden on the narrowest screens, where the heading already carries it.
        */
        {
          key: 'grade',
          label: 'Grade',
          sortField: 'grade_id',
          hideBelow: 'sm',
          render: (row) => m2oLabel(row.grade_id),
        },
        /* The class carries the section, so it stays beside the grade. */
        { key: 'class', label: 'Class', render: (row) => m2oLabel(row.class_id) },
        {
          key: 'year',
          label: 'Academic year',
          hideBelow: 'md',
          render: (row) => m2oLabel(row.academic_year_id),
        },
        {
          key: 'lifecycle',
          label: 'Lifecycle',
          hideBelow: 'lg',
          render: (row) => <StatusBadge state={row.lifecycle_status} size="sm" />,
        },
        {
          key: 'status',
          label: 'Registration',
          render: (row) => <StatusBadge state={row.registration_status} model="school.student" />,
        },
      ]}
    />
  )
}
