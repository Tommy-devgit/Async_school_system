import Link from 'next/link'
import type { ReactNode } from 'react'
import { Icon } from '@/components/icons'
import { cx } from './primitives'

/*
  The table every list screen renders.

  School data is dense and read in columns, so the rules are fixed here rather
  than per page: headings are 11px uppercase slate, rows separate with a hairline,
  numbers are tabular and right-aligned, and a wide table scrolls inside its own
  container so the page body never scrolls sideways.
*/

export interface Column {
  key: string
  label: string
  numeric?: boolean
  /** Replaces the plain label — a sort link, for instance. */
  header?: ReactNode
  /** Announced by screen readers when the column carries a SortHeader. */
  sort?: 'ascending' | 'descending' | 'none'
  /** Hidden below the given breakpoint, for narrow screens. */
  hideBelow?: 'sm' | 'md' | 'lg'
}

const HIDE_BELOW: Record<NonNullable<Column['hideBelow']>, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
}

export function DataTable({
  columns,
  children,
  caption,
}: {
  /** Plain strings for a static table, or Column objects for sorting. */
  columns: Array<string | Column>
  children: ReactNode
  /** Screen-reader description of what the table lists. */
  caption?: string
}) {
  const resolved: Column[] = columns.map((column) =>
    typeof column === 'string' ? { key: column, label: column } : column,
  )

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {resolved.map((column) => (
              <th
                key={column.key}
                scope="col"
                aria-sort={column.sort}
                className={cx(
                  'border-b border-silver px-4 py-2.5 text-[11px] font-medium',
                  'tracking-wide whitespace-nowrap text-slate uppercase',
                  column.numeric ? 'text-right' : 'text-left',
                  column.hideBelow && HIDE_BELOW[column.hideBelow],
                )}
              >
                {column.header ?? column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

/**
 * A heading that splits the rows below it into a named group.
 *
 * A row in the table rather than a separate card per group: the columns stay
 * aligned down the whole list, one horizontal scroll still covers everything on
 * a narrow screen, and the sticky-free markup keeps working when a group runs
 * across a page boundary. Splitting into one table per group would align each
 * group's columns independently and make the list harder to scan, which is the
 * opposite of the point.
 *
 * `scope="colgroup"` so a screen reader announces the grade before reading the
 * students under it, and the styling is the table's own column-heading
 * treatment one step darker, so it reads as structure rather than as data.
 */
export function GroupHeader({
  label,
  span,
  count,
}: {
  label: string
  /** How many columns the table has, so the heading spans all of them. */
  span: number
  /** Shown beside the label — how many rows are in this group on this page. */
  count?: number
}) {
  return (
    <tr className="bg-paper">
      <th
        scope="colgroup"
        colSpan={span}
        className={cx(
          'border-y border-silver px-4 py-2 text-left text-[11px] font-semibold',
          'tracking-wide whitespace-nowrap text-graphite uppercase',
        )}
      >
        {label}
        {count === undefined ? null : (
          <span className="ml-2 font-normal text-stone normal-case">
            {count} {count === 1 ? 'student' : 'students'}
          </span>
        )}
      </th>
    </tr>
  )
}

/**
 * A sortable column heading.
 *
 * Sorting is a link, not a click handler: it writes the field into the URL and
 * the server component re-queries Odoo with a new `order`. The browser never
 * sorts locally, because one page is not the whole result set — sorting a
 * hundred visible rows out of nine hundred would simply be wrong.
 */
export function SortHeader({
  field,
  label,
  numeric,
  activeField,
  activeDirection,
  hrefFor,
}: {
  field: string
  label: string
  numeric?: boolean
  activeField?: string
  activeDirection?: 'asc' | 'desc'
  hrefFor: (field: string, direction: 'asc' | 'desc') => string
}) {
  const active = activeField === field
  const next: 'asc' | 'desc' = active && activeDirection === 'asc' ? 'desc' : 'asc'

  return (
    <Link
      href={hrefFor(field, next)}
      scroll={false}
      className={cx(
        'group inline-flex items-center gap-1 hover:text-graphite',
        numeric && 'flex-row-reverse',
        active && 'text-graphite',
      )}
    >
      {label}
      {/* One glyph, flipped: down for descending, up for ascending. A right
          chevron reads as "next", which is not what a sorted column means. */}
      <Icon
        name="chevronDown"
        size={11}
        className={cx(
          'shrink-0 transition-opacity',
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40',
          (active ? activeDirection : 'desc') === 'asc' && 'rotate-180',
        )}
      />
    </Link>
  )
}

export function Row({
  children,
  href,
  className,
}: {
  children: ReactNode
  /**
   * Marks the row as navigable, which is all this does — it selects the hover
   * affordance. The link itself is rendered into the first cell by
   * `ResourceList`. Said plainly because the previous wording claimed this
   * carried the link, and three list screens were built on that claim and had
   * rows that went nowhere.
   */
  href?: string
  className?: string
}) {
  return (
    <tr
      className={cx(
        'border-b border-silver/70 transition-colors last:border-0',
        href ? 'hover:bg-paper' : 'hover:bg-paper/60',
        className,
      )}
    >
      {children}
    </tr>
  )
}

export function Cell({
  children,
  numeric,
  strong,
  hideBelow,
  className,
}: {
  children: ReactNode
  numeric?: boolean
  strong?: boolean
  hideBelow?: Column['hideBelow']
  className?: string
}) {
  return (
    <td
      className={cx(
        'px-4 py-2.5 align-middle',
        numeric && 'tabular text-right',
        strong ? 'font-medium text-graphite' : 'text-graphite/90',
        hideBelow && HIDE_BELOW[hideBelow],
        className,
      )}
    >
      {children}
    </td>
  )
}

/** The primary link out of a row, styled once so every table matches. */
export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-graphite hover:text-action-blue">
      {children}
    </Link>
  )
}

/* ----------------------------------------------------------- Pagination --- */

export function Pagination({
  page,
  pageSize,
  total,
  hrefForPage,
}: {
  page: number
  pageSize: number
  total: number
  hrefForPage: (page: number) => string
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize))
  if (lastPage <= 1) return null

  const first = total === 0 ? 0 : (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-silver px-4 py-3 text-[12px]"
    >
      <p className="text-slate">
        <span className="tabular">
          {first}–{last}
        </span>{' '}
        of <span className="tabular">{total.toLocaleString('en-GB')}</span>
      </p>
      <div className="flex items-center gap-2">
        <PageLink href={hrefForPage(page - 1)} disabled={page <= 1} label="Previous page">
          <Icon name="arrowLeft" size={13} />
          Previous
        </PageLink>
        <span className="tabular px-1 text-slate">
          {page} / {lastPage}
        </span>
        <PageLink href={hrefForPage(page + 1)} disabled={page >= lastPage} label="Next page">
          Next
          <Icon name="arrowRight" size={13} />
        </PageLink>
      </div>
    </nav>
  )
}

function PageLink({
  href,
  disabled,
  label,
  children,
}: {
  href: string
  disabled: boolean
  label: string
  children: ReactNode
}) {
  const shape =
    'inline-flex items-center gap-1.5 rounded-[9999px] border px-3 py-1.5 transition-colors'
  if (disabled) {
    return (
      <span aria-disabled className={cx(shape, 'border-silver/60 text-stone')}>
        {children}
      </span>
    )
  }
  return (
    <Link href={href} aria-label={label} className={cx(shape, 'border-silver hover:bg-paper')}>
      {children}
    </Link>
  )
}

/* -------------------------------------------------------------- Toolbar --- */

/** The strip above a table holding search, filters and a result count. */
export function Toolbar({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-silver p-4">
      {children}
      {hint ? <span className="ml-auto self-center text-[12px] text-slate">{hint}</span> : null}
    </div>
  )
}
