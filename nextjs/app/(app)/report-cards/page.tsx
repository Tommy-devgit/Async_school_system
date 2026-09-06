import { Card, CardHeader, Note, StatusBadge } from '@/components/ui'
import { formatPercent } from '@/lib/format'
import { ResourceList } from '@/components/resource-list'
import { toOdooOrder } from '@/lib/list-query'
import { classOptions, studentOptions, termOptions } from '@/lib/odoo/filter-options'
import {
  canGenerateReportCards,
  listReportCards,
} from '@/lib/odoo/models/assessment'
import { selectionOptions } from '@/lib/odoo/selections'
import { m2oLabel } from '@/lib/odoo/types'
import { GenerateReportCards } from './generate-form'

export const metadata = { title: 'Report cards · Async School' }

export default async function ReportCardsPage({ searchParams }: PageProps<'/report-cards'>) {
  const [states, results, classes, terms, students, canGenerate] = await Promise.all([
    selectionOptions('school.report.card', 'state'),
    selectionOptions('school.report.card', 'result'),
    classOptions(),
    termOptions(),
    studentOptions(),
    canGenerateReportCards(),
  ])

  return (
    <>
      {canGenerate ? (
        <Card className="mb-4">
          <CardHeader
            title="Generate report cards"
            icon="reportCards"
            hint="Reads the term's published marks and mints a versioned card per student."
          />
          <div className="max-w-md">
            <GenerateReportCards classes={classes} students={students} terms={terms} />
          </div>
          <Note>
            Odoo requires a grading scheme with bands covering 0–100 before it will generate, and
            only an Administrator or Exam Officer may do it. Publishing a new version supersedes
            the previous one rather than overwriting it.
          </Note>
        </Card>
      ) : null}
      <ResourceList
      title="Report cards"
      icon="reportCards"
      basePath="/report-cards"
      searchParams={searchParams}
      subtitle="Versioned and permanent — Odoo supersedes rather than overwrites, and refuses deletion."
      search={{ placeholder: 'Student or reference' }}
      filters={[
        { key: 'status', label: 'Status', options: states },
        { key: 'result', label: 'Result', options: results },
        { key: 'class', label: 'Class', options: classes },
        { key: 'term', label: 'Term', options: terms },
      ]}
      load={(query) =>
        listReportCards({
          search: query.search,
          filters: query.filters,
          order: toOdooOrder(query),
          limit: query.limit,
          offset: query.offset,
        })
      }
      rowHref={(row) => `/report-cards/${row.id}`}
      removable="reportCard"
      emptyTitle="No report cards visible"
      emptyHint="Generated from published marks by an Exam Officer."
      columns={[
        {
          key: 'name',
          label: 'Report card',
          render: (row) => row.name,
        },
        { key: 'student', label: 'Student', render: (row) => m2oLabel(row.student_id) },
        { key: 'class', label: 'Class', hideBelow: 'sm', render: (row) => m2oLabel(row.class_id) },
        { key: 'term', label: 'Term', render: (row) => m2oLabel(row.term_id) },
        {
          key: 'average',
          label: 'Average',
          numeric: true,
          render: (row) => formatPercent(row.overall_average, 2),
        },
        {
          key: 'result',
          label: 'Result',
          render: (row) => (row.result ? <StatusBadge state={row.result} size="sm" /> : '—'),
        },
        {
          key: 'version',
          label: 'Version',
          numeric: true,
          hideBelow: 'lg',
          render: (row) => row.version,
        },
        {
          key: 'year',
          label: 'Year',
          hideBelow: 'md',
          render: (row) => m2oLabel(row.academic_year_id),
        },
        { key: 'state', label: 'Status', render: (row) => <StatusBadge state={row.state} /> },
      ]}
      />
    </>
  )
}
