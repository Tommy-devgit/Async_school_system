import { Badge } from '@/components/ui'
import { ResourceList } from '@/components/resource-list'
import { RowLink } from '@/components/ui/table'
import { formatSelection } from '@/lib/format'
import { toOdooOrder } from '@/lib/list-query'
import { classOptions, subjectOptions } from '@/lib/odoo/filter-options'
import { hasAccess } from '@/lib/odoo/client'
import { listCurriculum } from '@/lib/odoo/models/operations'
import { selectionOptions } from '@/lib/odoo/selections'
import { m2oLabel } from '@/lib/odoo/types'

export const metadata = { title: 'Curriculum · Async School' }

/**
 * What each class studies, and what it is marked out of.
 *
 * These lines were only reachable through the Configuration page, which lists
 * every one of them at once with no search, no filter and no paging. That is
 * fine for a demo school and useless for a real one: a curriculum is one row
 * per class per subject, so a school with forty classes and ten subjects has
 * four hundred of them.
 *
 * A line is created by the class-subjects wizard on Configuration, not here,
 * and its class and subject are not editable afterwards — the pair is unique
 * and every mark and report-card snapshot hangs off it. So this screen offers
 * no "New" button: what it offers is finding the line you meant and correcting
 * the two numbers on it.
 */
export default async function CurriculumPage({ searchParams }: PageProps<'/curriculum'>) {
  const [types, classes, subjects, canEdit] = await Promise.all([
    selectionOptions('school.grade.subject', 'subject_type'),
    classOptions(),
    subjectOptions(),
    hasAccess('school.grade.subject', 'write'),
  ])

  return (
    <ResourceList
      title="Curriculum"
      icon="subjects"
      basePath="/curriculum"
      searchParams={searchParams}
      subtitle="What each class studies, and what every mark list and report card is generated against."
      search={{ placeholder: 'Class or subject' }}
      filters={[
        { key: 'class', label: 'Class', options: classes },
        { key: 'subject', label: 'Subject', options: subjects },
        { key: 'type', label: 'Type', options: types },
        {
          key: 'active',
          label: 'In use',
          allLabel: 'Active only',
          options: [
            { value: 'true', label: 'Active' },
            { value: 'false', label: 'Archived' },
          ],
        },
      ]}
      defaultSort={{ field: 'class_id', direction: 'asc' }}
      load={(query) =>
        listCurriculum({
          search: query.search,
          filters: query.filters,
          order: toOdooOrder(query),
          limit: query.limit,
          offset: query.offset,
        })
      }
      emptyTitle="No curriculum lines match"
      emptyHint="Curriculum lines are created for a whole class at once, on Configuration."
      columns={[
        {
          key: 'class',
          label: 'Class',
          sortField: 'class_id',
          /*
            The link is built here rather than handed to `rowHref`, which the
            list shell accepts and then does nothing with — see /subjects and
            /classes, whose rows do not currently go anywhere.

            Only a role that could save the form is given the link:
            `school.grade.subject` grants write to the administrator and the
            registrar, while the director, teacher and exam officer read it and
            are shown the same list without a door into a form Odoo would
            refuse.
          */
          render: (row) =>
            canEdit ? (
              <RowLink href={`/curriculum/${row.id}/edit`}>{m2oLabel(row.class_id)}</RowLink>
            ) : (
              m2oLabel(row.class_id)
            ),
        },
        {
          key: 'subject',
          label: 'Subject',
          sortField: 'subject_id',
          render: (row) => m2oLabel(row.subject_id),
        },
        {
          key: 'type',
          label: 'Type',
          sortField: 'subject_type',
          render: (row) => formatSelection(row.subject_type),
        },
        {
          key: 'maximum',
          label: 'Maximum',
          sortField: 'maximum_mark',
          numeric: true,
          render: (row) => <span className="tabular">{row.maximum_mark}</span>,
        },
        {
          key: 'pass',
          label: 'Pass mark',
          sortField: 'pass_mark',
          numeric: true,
          render: (row) => <span className="tabular">{row.pass_mark}</span>,
        },
        {
          key: 'active',
          label: 'In use',
          render: (row) =>
            row.active ? <Badge tone="neutral">Active</Badge> : <Badge tone="muted">Archived</Badge>,
        },
      ]}
    />
  )
}
