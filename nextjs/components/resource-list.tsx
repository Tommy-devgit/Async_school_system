import Link from 'next/link'
import type { ReactNode } from 'react'
import { FilterSelect, SearchField, type FilterSpec } from '@/components/list-toolbar'
import {
  Card,
  Cell,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Row,
  RowLink,
  SortHeader,
  Toolbar,
  type Column,
} from '@/components/ui'
import type { IconName } from '@/components/icons'
import { pluralise } from '@/lib/format'
import { listHrefs, parseListQuery, type ListQuery, type RawSearchParams } from '@/lib/list-query'
import { toOdooError } from '@/lib/odoo/errors'
import { hasAccess } from '@/lib/odoo/client'
import { getRemoval, permissionFor, type RemovalKey } from '@/lib/odoo/removals'
import { BulkRemove, RowSelect } from '@/components/bulk-remove'
import type { Page } from '@/lib/odoo/types'

/**
 * The shape every list screen shares: read the query out of the URL, fetch one
 * page from Odoo, render it, and turn a refusal into an explanation rather
 * than a crash.
 *
 * Several roles legitimately cannot read some models, so FORBIDDEN is an
 * expected outcome here and not an incident — it renders as a boundary, with
 * no suggestion of a way around it.
 *
 * Search, filtering, sorting and paging are all pushed into the Odoo query.
 * `load` receives the parsed query and is responsible for turning it into a
 * domain; the shell never touches the domain itself.
 */

export interface ListColumn<T> extends Omit<Column, 'header' | 'sort'> {
  /** The Odoo field to order by. Omit for a column that cannot be sorted. */
  sortField?: string
  render: (row: T) => ReactNode
}

export async function ResourceList<T extends { id: number }>({
  title,
  subtitle,
  icon,
  basePath,
  searchParams,
  load,
  columns,
  action,
  search,
  filters = [],
  defaultSort,
  pageSize = 25,
  emptyTitle,
  emptyHint,
  emptyIcon,
  emptyAction,
  rowHref,
  caption,
  removable,
  rowLabel,
}: {
  title: string
  /** Overrides the default "n records visible to you". */
  subtitle?: string
  icon?: IconName
  /** Where this list lives, for building filter and page links. */
  basePath: string
  searchParams: Promise<RawSearchParams>
  load: (query: ListQuery) => Promise<Page<T>>
  columns: Array<ListColumn<T>>
  action?: ReactNode
  search?: { placeholder: string }
  filters?: FilterSpec[]
  defaultSort?: { field: string; direction: 'asc' | 'desc' }
  pageSize?: number
  emptyTitle: string
  emptyHint?: string
  emptyIcon?: IconName
  emptyAction?: ReactNode
  /** Makes the first cell a link to the record. */
  rowHref?: (row: T) => string
  caption?: string
  /**
   * Lets rows be selected and removed, using the server-side allowlist in
   * lib/odoo/removals.ts. The screen names a key, never a model, and the
   * control appears only where Odoo's `has_access` already says yes.
   */
  removable?: RemovalKey
  /** What to call a row in the confirmation — defaults to the record's name. */
  rowLabel?: (row: T) => string
}) {
  const params = await searchParams
  const query = parseListQuery(params, {
    filterKeys: filters.map((filter) => filter.key),
    sortFields: columns.flatMap((column) => (column.sortField ? [column.sortField] : [])),
    defaultSort,
    pageSize,
  })
  const hrefs = listHrefs(basePath, params, query)

  let result: Page<T>
  try {
    result = await load(query)
  } catch (cause) {
    const error = toOdooError(cause)
    return (
      <>
        <PageHeader title={title} />
        <ErrorState {...error.toClient()} retryHref={basePath} />
      </>
    )
  }

  const hasToolbar = Boolean(search) || filters.length > 0

  /*
    Whether to offer removal at all. `has_access` asks Odoo about the model, so
    the answer is the real one for this user rather than a guess from their
    role — and the server action re-checks by doing the operation, which is the
    only check that decides anything.
  */
  const removal = removable ? getRemoval(removable) : null
  const canRemove = removal
    ? await hasAccess(removal.model, permissionFor(removal.mode)).catch(() => false)
    : false

  const selectColumn: Column[] = canRemove
    ? [{ key: '__select', label: '', header: <span className="sr-only">Select</span> }]
    : []

  const tableColumns: Column[] = columns.map((column) => ({
    key: column.key,
    label: column.label,
    numeric: column.numeric,
    hideBelow: column.hideBelow,
    sort: column.sortField
      ? query.sortField === column.sortField
        ? query.sortDirection === 'asc'
          ? 'ascending'
          : 'descending'
        : 'none'
      : undefined,
    header: column.sortField ? (
      <SortHeader
        field={column.sortField}
        label={column.label}
        numeric={column.numeric}
        activeField={query.sortField}
        activeDirection={query.sortDirection}
        hrefFor={hrefs.forSort}
      />
    ) : undefined,
  }))

  const rowsTable = (
        <DataTable columns={[...selectColumn, ...tableColumns]} caption={caption ?? title}>
          {result.rows.map((row) => (
            <Row key={row.id} href={rowHref?.(row)}>
              {canRemove ? (
                <Cell>
                  <RowSelect
                    id={row.id}
                    label={rowLabel?.(row) ?? String((row as { name?: unknown }).name ?? row.id)}
                  />
                </Cell>
              ) : null}
              {columns.map((column) => (
                <Cell
                  key={column.key}
                  numeric={column.numeric}
                  hideBelow={column.hideBelow}
                  strong={column === columns[0]}
                >
                  {/*
                    The link lives here, on the first cell, rather than in
                    each screen's own render function.

                    `rowHref` used to be handed to `Row` and quietly dropped —
                    it only ever chose a hover colour — so a screen that
                    relied on it alone had rows that went nowhere at all, and
                    the fifteen screens that worked did so because each had
                    built the same RowLink by hand. One mechanism, so a new
                    list cannot be born dead.
                  */}
                  {column === columns[0] && rowHref ? (
                    <RowLink href={rowHref(row)}>{column.render(row)}</RowLink>
                  ) : (
                    column.render(row)
                  )}
                </Cell>
              ))}
            </Row>
          ))}
        </DataTable>
  )

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle ?? `${pluralise(result.total, 'record')} visible to you`}
        action={action}
      />

      <Card padded={false}>
        {hasToolbar ? (
          <Toolbar
            hint={
              /*
                The count lives here rather than only in the subtitle, because a
                screen that overrides the subtitle to explain a rule — as the
                assignments list does — would otherwise leave a filtered result
                with no indication of how many matched.
              */
              <span className="flex items-center gap-3">
                <span className="tabular">{pluralise(result.total, 'record')}</span>
                {hrefs.isNarrowed ? (
                  <Link href={hrefs.cleared} className="text-action-blue hover:underline">
                    Clear filters
                  </Link>
                ) : null}
              </span>
            }
          >
            {search ? <SearchField placeholder={search.placeholder} /> : null}
            {filters.map((filter) => (
              <FilterSelect key={filter.key} filter={filter} />
            ))}
          </Toolbar>
        ) : null}

        {/*
          The selection form wraps the empty state as well as the table.

          Removing the last row a filter matched empties the list, and when the
          form only wrapped the table it unmounted at that moment — taking the
          "Archived 1 staff member" confirmation with it and leaving the user on
          "Nothing matches those filters", with nothing to say the removal had
          worked at all.
        */}
        {canRemove && removal ? (
          <BulkRemove
            resource={removable!}
            mode={removal.mode}
            archivable={removal.archivable}
            noun={removal.noun}
            plural={removal.plural}
            note={removal.note}
          >
            {result.rows.length === 0 ? (
          hrefs.isNarrowed ? (
            <EmptyState
              icon="search"
              title="Nothing matches those filters"
              hint="Try a different term, or clear the filters to see the full list."
              action={
                <Link
                  href={hrefs.cleared}
                  className="rounded-[9999px] border border-silver bg-white px-4 py-2 text-[13px] hover:bg-paper"
                >
                  Clear filters
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={emptyIcon ?? icon}
              title={emptyTitle}
              hint={emptyHint}
              action={emptyAction}
            />
          )
            ) : (
              rowsTable
            )}
          </BulkRemove>
        ) : result.rows.length === 0 ? (
          hrefs.isNarrowed ? (
            <EmptyState
              icon="search"
              title="Nothing matches those filters"
              hint="Try a different term, or clear the filters to see the full list."
              action={
                <Link
                  href={hrefs.cleared}
                  className="rounded-[9999px] border border-silver bg-white px-4 py-2 text-[13px] hover:bg-paper"
                >
                  Clear filters
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={emptyIcon ?? icon}
              title={emptyTitle}
              hint={emptyHint}
              action={emptyAction}
            />
          )
        ) : (
          rowsTable
        )}

        <Pagination
          page={query.page}
          pageSize={query.limit}
          total={result.total}
          hrefForPage={hrefs.forPage}
        />
      </Card>
    </>
  )
}

export { Cell }
