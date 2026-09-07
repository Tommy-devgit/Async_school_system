import Link from 'next/link'
import type { ReactNode } from 'react'
import { Icon, type IconName } from '@/components/icons'
import { Card, EmptyState, RestrictedState, cx } from '@/components/ui'
import { ContextSwitcher } from '@/components/dashboard/context-switcher'
import { Sparkline } from '@/components/dashboard/charts'
import { formatCount, formatDateTime } from '@/lib/format'
import type { AcademicPeriods, ActivityEntry, Scope } from '@/lib/odoo/models/overview'
import { m2oId } from '@/lib/odoo/types'

/*
  The frame of the command centre: the header, the KPI band, the section
  scaffolding and the two panels that are not charts.

  One rule governs all of it, and it is the rule the whole dashboard rests on:
  **a figure that came back null is not a zero.** Roles here differ enormously
  — a Director cannot read `school.class` at all, a Teacher sees only their own
  classes — so "not available to your role" and "none yet" are genuinely
  different answers and are drawn differently. Collapsing them would put a
  confident, wrong number in front of a head teacher.
*/

/* --------------------------------------------------------------- header --- */

/**
 * The dashboard header: who is looking, and at what slice of the school year.
 *
 * The year and term are stated in prose *and* offered as controls, because for
 * most people most of the time the answer is "the current one" and they only
 * need to see that it is right. Neither is hardcoded — both come from Odoo,
 * and where a role cannot read them the line says so rather than guessing.
 */
export function CommandHeader({
  name,
  role,
  department,
  scope,
  periods,
  action,
}: {
  name: string
  role: string
  department?: string
  scope: Scope
  periods: AcademicPeriods
  action?: ReactNode
}) {
  const firstName = name.split(' ').filter(Boolean)[0] ?? name
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const year = periods.years.find((candidate) => candidate.id === scope.yearId)
  const term = periods.terms.find((candidate) => candidate.id === scope.termId)

  return (
    <header className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[25px] leading-tight">
            {greeting}, {firstName}
          </h1>
          <p className="mt-1.5 text-[13px] text-slate">
            {role}
            {department ? ` · ${department}` : ''}
          </p>
        </div>
        {action}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-silver/70 pt-3.5">
        <p className="text-[12.5px] text-slate">
          {year ? (
            <>
              <span className="text-graphite">{year.name}</span>
              {term ? (
                <>
                  <span className="text-silver"> · </span>
                  <span className="text-graphite">{term.name}</span>
                </>
              ) : periods.terms.length > 0 ? (
                <span className="text-stone"> · whole year</span>
              ) : null}
            </>
          ) : periods.years.length > 0 ? (
            <span className="text-graphite">All academic years</span>
          ) : (
            /*
              A Director has no ACL row on `school.academic.year`. Saying so is
              better than printing a year nobody asked Odoo for.
            */
            <span className="text-stone">
              Academic calendar not available to your role — figures cover everything you can see
            </span>
          )}
        </p>

        <ContextSwitcher
          years={periods.years}
          terms={periods.terms.map((term) => ({
            id: term.id,
            name: term.name,
            yearId: m2oId(term.academic_year_id),
          }))}
          yearId={scope.yearId}
          termId={scope.termId}
        />
      </div>
    </header>
  )
}

/* ------------------------------------------------------------------ kpi --- */

export interface Kpi {
  label: string
  value: number | null
  /** The line under the value. Say what it is a count *of*. */
  context?: string
  icon: IconName
  href?: string
  /** A small line, only where a real series exists behind it. */
  spark?: number[]
}

/**
 * The headline figures.
 *
 * Deliberately not a row of ten identical cards: four or five, each with the
 * one line of context that turns a number into a fact. "1,248" is not
 * information; "1,248 students, 1,190 of them active" is.
 */
export function KpiBand({ items }: { items: Kpi[] }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <KpiCard key={item.label} {...item} />
      ))}
    </div>
  )
}

function KpiCard({ label, value, context, icon, href, spark }: Kpi) {
  const unavailable = value === null
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] text-slate">{label}</span>
        <span className={cx('shrink-0', unavailable ? 'text-silver' : 'text-stone')}>
          <Icon name={icon} size={15} />
        </span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span
          className={cx(
            'tabular text-[27px] leading-none',
            unavailable ? 'text-silver' : 'text-graphite',
          )}
        >
          {unavailable ? '—' : formatCount(value)}
        </span>
        {!unavailable && spark && spark.length >= 2 ? (
          <Sparkline points={spark} label={`${label} over recent periods`} />
        ) : null}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-stone">
        {unavailable ? 'Not available to your role' : (context ?? ' ')}
      </p>
    </>
  )

  const className =
    'block rounded-[12px] border border-silver/80 bg-white p-4 transition-colors'

  return href && !unavailable ? (
    <Link href={href} className={cx(className, 'hover:border-stone/60')}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

/* ------------------------------------------------------------- sections --- */

/** A titled band of the dashboard, so the page reads as a sequence not a pile. */
export function Section({
  title,
  hint,
  children,
  className,
}: {
  title: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className="mb-4">
      <div className="mb-2.5 flex items-baseline gap-3">
        <h2 className="text-[13px] font-medium tracking-wide text-graphite uppercase">{title}</h2>
        {hint ? <p className="min-w-0 truncate text-[11.5px] text-stone">{hint}</p> : null}
      </div>
      {/*
        The two `min-w-0` rules are load-bearing, not tidying.

        A grid item defaults to `min-width: auto`, which refuses to shrink below
        its content's min-content width. Every dashboard nests a further grid in
        here, and the teacher's holds a table: on a 390px screen that column
        measured 376px inside 358px and pushed the whole page wide, so the
        landing screen scrolled sideways. The table already sits in its own
        `overflow-x-auto` — it never got the chance to scroll, because nothing
        above it would give up the width.

        Both levels are needed. The nineteen nested grids across the seven
        dashboards are laid out the same way, so releasing only the outer one
        moves the overflow down a level rather than fixing it. Stating it here
        fixes the class of bug rather than nineteen instances of it, and keeps
        the next dashboard from reintroducing it.
      */}
      <div
        className={cx('grid items-start gap-3 *:min-w-0 [&>.grid>*]:min-w-0', className)}
      >
        {children}
      </div>
    </section>
  )
}

/**
 * A panel that knows the difference between "restricted", "nothing yet" and
 * "here it is".
 *
 * `data` being null is the refusal case and is handled here so no dashboard
 * has to remember to. `empty` is passed only when the data arrived and was
 * genuinely empty.
 */
export function Panel({
  title,
  hint,
  icon,
  href,
  hrefLabel = 'View all',
  restricted,
  empty,
  footer,
  bare,
  children,
  className,
}: {
  title: string
  hint?: string
  icon?: IconName
  href?: string
  hrefLabel?: string
  restricted?: boolean
  empty?: { title: string; hint?: string; icon?: IconName } | false | undefined
  /** For children that lay themselves out edge to edge, such as a table. */
  bare?: boolean
  footer?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <Card padded={false} className={cx('flex min-w-0 flex-col', className)}>
      {/*
        The panel writes its own header rather than borrowing `CardHeader`,
        which emits an `h2`. A dashboard band is already an `h2`, so a panel
        inside one has to be an `h3` — otherwise the page reads to a screen
        reader as a flat list of equal headings with no structure at all.
      */}
      <div className="flex items-start justify-between gap-3 p-4 pb-0">
        <div className="flex min-w-0 gap-2.5">
          {icon ? (
            <span className="mt-0.5 shrink-0 text-stone">
              <Icon name={icon} size={16} />
            </span>
          ) : null}
          <div className="min-w-0">
            <h3 className="text-[15px] leading-tight text-graphite">{title}</h3>
            {hint ? <p className="mt-1 text-[12px] text-slate">{hint}</p> : null}
          </div>
        </div>
        {href && !restricted ? (
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-1 pt-0.5 text-[12px] text-action-blue hover:underline"
          >
            {hrefLabel}
            <Icon name="arrowRight" size={12} />
          </Link>
        ) : null}
      </div>
      {restricted ? (
        <RestrictedState what={title} />
      ) : empty ? (
        <EmptyState title={empty.title} hint={empty.hint} icon={empty.icon ?? icon} />
      ) : (
        <div className={cx('flex-1', bare ? 'pt-1' : 'p-4 pt-1')}>{children}</div>
      )}
      {footer && !restricted && !empty ? (
        <div className="border-t border-silver/70 px-4 py-2.5">{footer}</div>
      ) : null}
    </Card>
  )
}

/* ---------------------------------------------------- needs attention --- */

export interface AttentionItem {
  label: string
  count: number | null
  href: string
  icon: IconName
  /** What the reader is expected to do, not what the record is. */
  action: string
}

/**
 * The queue: things waiting on this person, with the count and the way in.
 *
 * A zero is dropped rather than drawn — "0 documents to verify" is not a task,
 * and a list of them is a list of nothing. A null is dropped too: an item the
 * role cannot act on has no business appearing as work.
 */
export function NeedsAttention({ items }: { items: AttentionItem[] }) {
  const live = items.filter((item) => item.count !== null && item.count > 0)

  if (live.length === 0) {
    return (
      <EmptyState
        icon="check"
        title="Nothing waiting on you"
        hint="Approvals, verifications and queues that need a decision will appear here."
      />
    )
  }

  return (
    <ul className="space-y-1">
      {live.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            className="group flex items-center gap-3 rounded-[8px] px-2 py-2.5 transition-colors hover:bg-paper"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-paper text-slate">
              <Icon name={item.icon} size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-graphite">{item.label}</span>
              <span className="block truncate text-[11px] text-stone">{item.action}</span>
            </span>
            <span className="tabular shrink-0 text-[16px] font-medium text-graphite">
              {formatCount(item.count as number)}
            </span>
            <Icon
              name="chevronRight"
              size={13}
              className="shrink-0 text-silver group-hover:text-slate"
            />
          </Link>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------- activity --- */

/**
 * Where a chatter message's record actually lives in this application.
 *
 * A model with no screen here gets no link rather than a broken one, and the
 * entry still renders — knowing that a placement changed is useful even when
 * there is nowhere yet to go and look at it.
 */
const ROUTES: Record<string, string> = {
  'school.student': '/students',
  'school.staff': '/staff',
  'school.teacher': '/teachers',
  'school.teacher.assignment': '/assignments',
  'school.enrollment': '/enrollments',
  'school.class': '/classes',
  'school.assessment': '/assessments',
  'school.report.card': '/report-cards',
  'school.document': '/documents',
  'school.announcement': '/announcements',
  'school.program': '/programs',
  'school.attendance': '/attendance',
  'school.class.schedule': '/schedule',
  'school.academic.year': '/academic-years',
  'school.promotion.batch': '/promotion',
}

const LABELS: Record<string, string> = {
  'school.student': 'Student',
  'school.staff': 'Staff',
  'school.teacher': 'Teacher',
  'school.teacher.assignment': 'Assignment',
  'school.enrollment': 'Enrolment',
  'school.class': 'Class',
  'school.assessment': 'Assessment',
  'school.report.card': 'Report card',
  'school.document': 'Document',
  'school.announcement': 'Announcement',
  'school.program': 'Program',
  'school.attendance': 'Attendance',
  'school.class.schedule': 'Timetable',
  'school.academic.year': 'Academic year',
  'school.promotion.batch': 'Promotion',
  'school.staff.responsibility': 'Responsibility',
  'school.enrollment.placement': 'Placement',
}

/**
 * Recent activity, from Odoo's own chatter.
 *
 * Every row is a real `mail.message` on a real record: the author is who Odoo
 * recorded, the timestamp is when it happened, and the text is the line Odoo
 * itself wrote. Nothing here is synthesised from a `write_date`.
 *
 * The feed is authorised by Odoo rather than by this component —
 * `mail.message` record rules only return messages on records the reader may
 * read — so a teacher sees their own classes' activity without any filtering
 * on this side.
 */
export function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  return (
    <ol className="space-y-0">
      {entries.map((entry, index) => {
        const route = ROUTES[entry.model]
        const href = route ? `${route}/${entry.recordId}` : undefined
        const name = (
          <span className="font-medium text-graphite">{entry.recordName}</span>
        )
        return (
          <li
            key={entry.id}
            className={cx(
              'flex gap-3 py-2.5',
              index > 0 && 'border-t border-silver/60',
            )}
          >
            <span
              aria-hidden
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-silver"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] leading-snug text-slate">
                {href ? (
                  <Link href={href} className="hover:text-action-blue">
                    {name}
                  </Link>
                ) : (
                  name
                )}
                <span className="text-stone"> — {entry.what}</span>
              </span>
              <span className="mt-0.5 block text-[11px] text-stone">
                {LABELS[entry.model] ?? entry.model}
                <span className="text-silver"> · </span>
                {entry.author}
                <span className="text-silver"> · </span>
                <time dateTime={entry.at.replace(' ', 'T')}>{formatDateTime(entry.at)}</time>
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/* ------------------------------------------------------------ structure --- */

/**
 * The counted shape of the school, as a row of figures rather than tiles.
 *
 * These are structural facts that change once a year, not metrics — giving
 * each its own card would say they need watching, which they do not.
 */
export function StructureStrip({
  items,
}: {
  items: Array<{ label: string; value: number | null; href?: string }>
}) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      {items.map((item) => {
        const inner = (
          <>
            <dt className="text-[11px] text-stone">{item.label}</dt>
            <dd
              className={cx(
                'tabular mt-0.5 text-[19px] leading-none',
                item.value === null ? 'text-silver' : 'text-graphite',
              )}
            >
              {item.value === null ? '—' : formatCount(item.value)}
            </dd>
          </>
        )
        return (
          <div key={item.label} className="min-w-0">
            {item.href && item.value !== null ? (
              <Link href={item.href} className="block hover:text-action-blue">
                {inner}
              </Link>
            ) : (
              inner
            )}
          </div>
        )
      })}
    </dl>
  )
}
