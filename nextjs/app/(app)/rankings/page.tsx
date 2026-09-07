import { FilterSelect } from '@/components/list-toolbar'
import {
  Cell,
  DataTable,
  EmptyState,
  ErrorState,
  Note,
  PageHeader,
  Row,
  RowLink,
  Stat,
  StatusBadge,
  TableCard,
  Toolbar,
  type Column,
} from '@/components/ui'
import { toOdooError } from '@/lib/odoo/errors'
import { listRanking, listRankingScopes, rankingEnabled } from '@/lib/odoo/models/ranking'
import { m2oId, m2oLabel } from '@/lib/odoo/types'

export const metadata = { title: 'Rankings - Async School' }

/**
 * Class and grade position, for one term.
 *
 * The numbers are `school.report.card`'s own computed fields, so this screen is
 * a different arrangement of the same figures printed on each card rather than
 * a second opinion about them. That matters: a ranking a school publishes has
 * to match the card it hands the guardian.
 *
 * A term is required rather than optional. Ranking compares a student against
 * peers, and the peer group is one term of one class or grade — "rank across
 * every term at once" has no meaning, and asking for it would recompute the
 * whole table for an answer nobody could use.
 *
 * Ties share a position, because the underlying compute counts how many peers
 * scored higher rather than handing out consecutive numbers. Three students on
 * the same average are all fourth, and the next is seventh. The table says so
 * where it happens rather than leaving the reader to notice the repeat.
 */
export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const one = (key: string) => {
    const value = params[key]
    return Array.isArray(value) ? value[0] : value
  }

  let scopes, enabled
  try {
    ;[scopes, enabled] = await Promise.all([listRankingScopes(), rankingEnabled()])
  } catch (cause) {
    return (
      <>
        <PageHeader title="Rankings" />
        <ErrorState {...toOdooError(cause).toClient()} retryHref="/rankings" />
      </>
    )
  }

  // Open on the term that actually holds cards, not the newest one — see
  // listRankingScopes. An explicit ?term always wins.
  const termId = Number(one('term') ?? scopes.defaultTermId ?? 0)
  const classId = Number(one('class') ?? 0)

  const filters = [
    { key: 'term', label: 'Term', options: scopes.terms, allLabel: 'Select a term' },
    { key: 'class', label: 'Class', options: scopes.classes },
  ]

  const header = (
    <>
      <PageHeader
        title="Rankings"
        subtitle="Class and grade position for one term, from each student's report card."
      />
      <Toolbar>
        {filters.map((filter) => (
          <FilterSelect key={filter.key} filter={filter} />
        ))}
      </Toolbar>
    </>
  )

  if (!enabled) {
    return (
      <>
        {header}
        <Note>
          Student ranking is switched off for this school, so every position reads as zero.
          A system administrator can enable it in Odoo under the school settings.
        </Note>
      </>
    )
  }

  if (!termId) {
    return (
      <>
        {header}
        <EmptyState
          title="Choose a term"
          hint="A ranking compares students within one term, so a term has to be chosen before there is anything to place."
        />
      </>
    )
  }

  let rows
  try {
    rows = await listRanking({ termId, classId: classId || undefined })
  } catch (cause) {
    return (
      <>
        {header}
        <ErrorState {...toOdooError(cause).toClient()} retryHref="/rankings" />
      </>
    )
  }

  if (rows.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          title="No report cards for this term"
          hint="Ranking is drawn from generated report cards. Generate them for a class and the positions appear here."
        />
      </>
    )
  }

  /*
    A shared position is worth pointing at. Without the note a reader seeing
    three fourths in a row reasonably suspects the table is broken, when it is
    reporting a genuine tie on the overall average.

    Counted per class, not across the table. Showing every class of a term puts
    one rank 1 in it per class, and comparing the numbers alone marked all of
    them tied — which was wrong in exactly the place a reader would trust it.
  */
  const seen = new Map<string, number>()
  for (const row of rows) {
    const key = `${m2oId(row.class_id)}:${row.class_rank}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  const isTied = (row: (typeof rows)[number]) =>
    (seen.get(`${m2oId(row.class_id)}:${row.class_rank}`) ?? 0) > 1

  const averages = rows.map((row) => row.overall_average)
  const top = rows.find((row) => row.class_rank === 1)

  const columns: Column[] = [
    { key: 'class_rank', label: 'Class rank' },
    { key: 'grade_rank', label: 'Grade rank' },
    { key: 'student', label: 'Student' },
    { key: 'class_name', label: 'Class', hideBelow: 'md' },
    { key: 'overall_average', label: 'Average', numeric: true },
    { key: 'result', label: 'Result' },
    { key: 'state', label: 'Card', hideBelow: 'sm' },
  ]

  return (
    <>
      {header}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Students ranked" value={String(rows.length)} />
        <Stat
          label="Highest average"
          value={averages.length ? `${Math.max(...averages).toFixed(2)}%` : '—'}
        />
        <Stat
          label="Cohort average"
          value={
            averages.length
              ? `${(averages.reduce((sum, value) => sum + value, 0) / averages.length).toFixed(2)}%`
              : '—'
          }
        />
        <Stat label="Top of class" value={top ? m2oLabel(top.student_id) : '—'} />
      </div>

      <TableCard
        title={classId ? m2oLabel(rows[0].class_id) : 'All classes'}
        hint={`${rows.length} ranked · ${m2oLabel(rows[0].term_id)}`}
        icon="rankings"
      >
        <DataTable columns={columns}>
          {rows.map((row) => (
            /*
              No `href` on the Row. It only selects the hover affordance — the
              link has to be a real anchor in a cell — and a row that looks
              clickable and is not is a defect this codebase has already had.
              The student's name is the link, and it goes to the card the
              position was read from.
            */
            <Row key={row.id}>
              <Cell strong>
                {row.class_rank || '—'}
                <span className="font-normal text-stone"> of {row.class_size || '—'}</span>
                {isTied(row) ? (
                  <span className="ml-1 text-[11px] font-normal text-stone">tied</span>
                ) : null}
              </Cell>
              <Cell>
                {row.grade_rank || '—'}
                <span className="text-stone"> of {row.grade_size || '—'}</span>
              </Cell>
              <Cell>
                <RowLink href={`/report-cards/${row.id}`}>{m2oLabel(row.student_id)}</RowLink>
              </Cell>
              <Cell hideBelow="md">{m2oLabel(row.class_id)}</Cell>
              <Cell numeric>{row.overall_average.toFixed(2)}%</Cell>
              <Cell>
                <StatusBadge state={row.result} model="school.report.card" />
              </Cell>
              <Cell hideBelow="sm">
                <StatusBadge state={row.state} model="school.report.card" />
              </Cell>
            </Row>
          ))}
        </DataTable>
      </TableCard>

      <Note>
        Positions come from each student&apos;s report card, so they match the card exactly.
        Only the latest version of a card counts, and a tie shares a position — three students
        on the same average are all fourth, and the next is seventh.
      </Note>
    </>
  )
}
