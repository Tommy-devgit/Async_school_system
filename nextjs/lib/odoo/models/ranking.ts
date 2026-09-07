import 'server-only'

import { readGroup, searchRead } from '@/lib/odoo/client'
import type { Many2one, Selection } from '@/lib/odoo/types'
import { m2oId, m2oLabel } from '@/lib/odoo/types'

/**
 * Class and grade ranking, as the report card model already computes it.
 *
 * Nothing here calculates a position. `class_rank`, `class_size`, `grade_rank`
 * and `grade_size` are computed fields on `school.report.card`, and reading
 * them is what produces the numbers — so this screen and the individual report
 * card can never disagree about where a student placed.
 *
 * Two consequences of those fields being `store=False` shape everything below.
 *
 * They cannot be ordered on. `order='class_rank'` is an SQL sort over a column
 * that does not exist, so the rows are fetched for one scope and sorted here.
 * That is also why the scope is mandatory rather than a filter: ranking is only
 * meaningful inside one term, and "every card in the school" would be both
 * meaningless and a full-table compute.
 *
 * And they are recomputed on every read, each one running two searches over its
 * peers. One term of one grade is a few dozen cards, which is fine; the whole
 * school would not be. The scope keeps that bounded.
 */

/** A card's own fields, plus the four ranking numbers Odoo computes on read. */
export interface RankedCard {
  id: number
  name: string
  student_id: Many2one
  class_id: Many2one
  grade_id: Many2one
  term_id: Many2one
  academic_year_id: Many2one
  state: Selection
  result: Selection
  overall_average: number
  version: number
  superseded_by_id: Many2one
  class_rank: number
  class_size: number
  grade_rank: number
  grade_size: number
}

const RANKING_FIELDS = [
  'name',
  'student_id',
  'class_id',
  'grade_id',
  'term_id',
  'academic_year_id',
  'state',
  'result',
  'overall_average',
  'version',
  'superseded_by_id',
  'class_rank',
  'class_size',
  'grade_rank',
  'grade_size',
] as const

export interface RankingScope {
  termId: number
  /** Optional. Absent means every class of the term the reader can see. */
  classId?: number
}

/**
 * The latest card per student, which is the row set Odoo ranked.
 *
 * `_compute_rankings` builds its peer group by walking `version desc` and
 * keeping the first card it meets for each student. This has to do the same,
 * or the table would disagree with the sizes printed in its own rows: the demo
 * data holds a student with three versions, none of them flagged superseded,
 * and listing all three would show one person occupying rank 1 three times out
 * of a class of three.
 *
 * `superseded_by_id` is not sufficient on its own for exactly that reason —
 * versions exist that were never linked — so the version walk is what decides,
 * and the flag is only used to drop cards that were explicitly retired.
 */
function latestPerStudent(rows: RankedCard[]): RankedCard[] {
  const latest = new Map<number, RankedCard>()
  for (const row of [...rows].sort((a, b) => b.version - a.version)) {
    const studentId = m2oId(row.student_id)
    if (studentId === null) continue
    if (!latest.has(studentId)) latest.set(studentId, row)
  }
  return [...latest.values()]
}

/**
 * Every ranked card for one scope, ordered by class rank then by name.
 *
 * Record rules apply as they do everywhere else: a reader scoped to their own
 * classes gets their own classes, and this asks Odoo nothing about who it is
 * talking to. A tie shares a position — three students on the same average are
 * all fourth — so the ordering falls back to the student's name to keep the
 * table stable between reads rather than letting equal ranks shuffle.
 */
export async function listRanking(scope: RankingScope): Promise<RankedCard[]> {
  const domain: [string, string, unknown][] = [
    ['term_id', '=', scope.termId],
    ['state', '!=', 'superseded'],
    ['superseded_by_id', '=', false],
  ]
  if (scope.classId) domain.push(['class_id', '=', scope.classId])

  const page = await searchRead<RankedCard>('school.report.card', RANKING_FIELDS, {
    domain,
    // One term of one grade. Far above any real cohort, far below a full table.
    limit: 500,
    order: 'version desc',
    withTotal: false,
  })

  return latestPerStudent(page.rows).sort(
    (a, b) =>
      a.class_rank - b.class_rank ||
      b.overall_average - a.overall_average ||
      m2oLabel(a.student_id).localeCompare(m2oLabel(b.student_id)),
  )
}

export interface RankingOption {
  value: string
  label: string
}

export interface RankingScopeOptions {
  terms: RankingOption[]
  classes: RankingOption[]
  /**
   * The term to open on: the one holding the most report cards this reader can
   * see, or null when they can see none.
   *
   * Not simply the newest term. Terms are created for all sorts of reasons —
   * a rename, a trial, a test run — and the most recently dated one is often
   * empty, which would land every reader on "no report cards for this term"
   * while the real cohort sat one selection away. The busiest term is the one
   * somebody opening a ranking screen almost always means.
   */
  defaultTermId: number | null
}

/**
 * What the reader may choose between, taken from the cards themselves.
 *
 * Both lists are grouped out of `school.report.card` rather than read from
 * `school.term` and `school.class`. That is not a shortcut — it is what makes
 * the screen work for a Director, who holds read on report cards but no ACL row
 * at all on `school.term`. Reading the terms directly turned the whole page
 * into a refusal for them, which the navigation had already promised was a
 * working link.
 *
 * It is also the better list. A grouped read offers exactly the terms and
 * classes that have cards in them, so every option leads somewhere, and the
 * record rules narrow it on the way: a reader scoped to their own classes is
 * offered their own classes and nothing else.
 */
export async function listRankingScopes(): Promise<RankingScopeOptions> {
  const live: [string, string, unknown][] = [
    ['state', '!=', 'superseded'],
    ['superseded_by_id', '=', false],
  ]

  const [byTerm, byClass] = await Promise.all([
    readGroup<{ term_id: Many2one; __count: number }>(
      'school.report.card',
      live,
      ['term_id'],
      ['term_id'],
    ),
    readGroup<{ class_id: Many2one; __count: number }>(
      'school.report.card',
      live,
      ['class_id'],
      ['class_id'],
    ),
  ])

  const busiest = byTerm.reduce<{ id: number | null; count: number }>(
    (best, row) => {
      const id = m2oId(row.term_id)
      return id !== null && row.__count > best.count ? { id, count: row.__count } : best
    },
    { id: null, count: 0 },
  )

  const options = (rows: { id: number | null; label: string; count: number }[]) =>
    rows
      .filter((row) => row.id !== null)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .map((row) => ({ value: String(row.id), label: row.label }))

  return {
    defaultTermId: busiest.id,
    terms: options(
      byTerm.map((row) => ({
        id: m2oId(row.term_id),
        label: m2oLabel(row.term_id),
        count: row.__count,
      })),
    ),
    classes: options(
      byClass.map((row) => ({
        id: m2oId(row.class_id),
        label: m2oLabel(row.class_id),
        count: row.__count,
      })),
    ),
  }
}

/**
 * Whether ranking is switched on for this school.
 *
 * `school_ranking` gates the compute: with it off every card reports 0, which
 * would otherwise render as a table of dashes with no explanation. Reading it
 * lets the page say so instead. `res.company` is readable by every signed-in
 * user, so this needs no permission of its own.
 */
export async function rankingEnabled(): Promise<boolean> {
  const page = await searchRead<{ id: number; school_ranking: boolean }>(
    'res.company',
    ['school_ranking'],
    { limit: 1, withTotal: false },
  )
  return page.rows[0]?.school_ranking ?? false
}
