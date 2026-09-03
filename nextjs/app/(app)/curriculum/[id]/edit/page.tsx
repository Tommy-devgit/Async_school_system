import { notFound, redirect } from 'next/navigation'
import { Card, PageHeader } from '@/components/ui'
import { hasAccess } from '@/lib/odoo/client'
import { getCurriculumLine } from '@/lib/odoo/models/operations'
import { selectionOptions } from '@/lib/odoo/selections'
import { m2oLabel } from '@/lib/odoo/types'
import { CurriculumForm } from '../../curriculum-form'

export const metadata = { title: 'Edit curriculum · Async School' }

/**
 * How one subject is graded for one class.
 *
 * The curriculum was listed on the configuration screen and editable nowhere,
 * so a school could say "this class studies Mathematics" and could not say it
 * is marked out of 100 with a pass at 50 — the two numbers every mark list and
 * report card is generated against. Setting them meant opening Odoo directly.
 *
 * `school.grade.subject` grants write to the administrator and the registrar,
 * which is checked here and again by Odoo on submit.
 */
export default async function EditCurriculumPage({
  params,
}: PageProps<'/curriculum/[id]/edit'>) {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const [line, canWrite, subjectTypes] = await Promise.all([
    getCurriculumLine(id),
    hasAccess('school.grade.subject', 'write'),
    selectionOptions('school.grade.subject', 'subject_type'),
  ])
  if (!line) notFound()
  if (!canWrite) redirect('/configuration')

  const className = m2oLabel(line.class_id)
  const subjectName = m2oLabel(line.subject_id)

  return (
    <>
      <PageHeader
        title={`${subjectName} — ${className}`}
        subtitle="What this subject is marked out of, and what counts as a pass."
        breadcrumbs={[
          { label: 'Configuration', href: '/configuration' },
          { label: subjectName },
        ]}
      />
      <Card className="max-w-3xl">
        <CurriculumForm
          id={id}
          className={className}
          subjectName={subjectName}
          values={{
            subject_type: String(line.subject_type || ''),
            maximum_mark: String(line.maximum_mark ?? ''),
            pass_mark: String(line.pass_mark ?? ''),
            optional_selection_limit: String(line.optional_selection_limit ?? 0),
            active: String(line.active),
          }}
          subjectTypes={subjectTypes}
        />
      </Card>
    </>
  )
}
