'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from '@/components/icons'
import { cx } from '@/components/ui'
import type { NavSection } from '@/lib/navigation'
import { COLLAPSED_WIDTH, EXPANDED_WIDTH } from './sidebar-preference'

/**
 * The primary navigation.
 *
 * Two presentations of one link list: a fixed rail on a wide screen that
 * collapses to icons, and a drawer over the content below `lg`. Both are built
 * from `SidebarBody`, so there is no second navigation to keep in step — the
 * previous mobile fallback was a flat horizontal scroll of eighteen pills with
 * no grouping and no active state.
 *
 * Rendering both and letting the breakpoint choose is deliberate. Deciding in
 * JavaScript would need the viewport width, which the server does not have, and
 * would leave the rail briefly inert on first paint. When the drawer is closed
 * it carries `inert`, which takes it out of both the tab order and the
 * accessibility tree, so only one of the two is ever reachable.
 *
 * The section list arrives already filtered: what a role may see is decided on
 * the server in lib/navigation.ts, and even that is only a rendering decision,
 * because Odoo authorises every call regardless.
 */

export interface SidebarProps {
  sections: NavSection[]
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  mobileOpen: boolean
  onMobileOpenChange: (open: boolean) => void
  brand: { name: string }
  /** Who is signed in, for the footer. */
  account: { name: string; role: string; initials: string }
  /** The sign-out server action, passed down so the form stays server-owned. */
  signOutAction: () => Promise<void>
}

export function Sidebar(props: SidebarProps) {
  // The drawer closing on navigation is derived in ShellFrame, not reset here.
  const { collapsed, mobileOpen, onMobileOpenChange } = props
  const pathname = usePathname()
  const drawerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onMobileOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    // The first link is the useful landing spot once the drawer is open.
    drawerRef.current?.querySelector<HTMLAnchorElement>('a[href]')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileOpen, onMobileOpenChange])

  return (
    <>
      {/* Desktop rail. Fixed, so the content scrolls beneath it. */}
      <aside
        id="primary-navigation"
        aria-label="Main"
        style={{ width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH }}
        className={cx(
          'fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-silver bg-white',
          'transition-[width] duration-200 ease-out lg:flex',
        )}
      >
        <SidebarBody {...props} pathname={pathname} showClose={false} />
      </aside>

      {/* Mobile drawer and its backdrop. */}
      <div
        onClick={() => onMobileOpenChange(false)}
        aria-hidden
        className={cx(
          'fixed inset-0 z-40 bg-ink/25 transition-opacity duration-200 lg:hidden',
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <aside
        ref={drawerRef}
        id="mobile-navigation"
        aria-label="Main"
        inert={mobileOpen ? undefined : true}
        style={{ width: EXPANDED_WIDTH }}
        className={cx(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-silver bg-white',
          'transition-transform duration-200 ease-out lg:hidden',
          mobileOpen ? 'translate-x-0 shadow-[var(--shadow-raised)]' : '-translate-x-full',
        )}
      >
        {/* The drawer is never the collapsed variant — there is no room for a rail. */}
        <SidebarBody {...props} collapsed={false} pathname={pathname} showClose />
      </aside>
    </>
  )
}

function SidebarBody({
  sections,
  collapsed,
  onCollapsedChange,
  onMobileOpenChange,
  brand,
  account,
  signOutAction,
  pathname,
  showClose,
}: SidebarProps & { pathname: string; showClose: boolean }) {
  /*
    Resolved once over every section rather than per group: the entry that owns
    the current page may live in a different group from the one being drawn, and
    only the single longest match anywhere may be marked.
  */
  const current = activeHref(
    pathname,
    sections.flatMap((section) => section.items.map((item) => item.href)),
  )

  /*
    Bring the current entry into view when it is below the fold.

    The menu is longer than the rail on a laptop, so the sections at the bottom
    — Academic setup among them — sit off-screen with the list scrolled to the
    top. Landing on one of those pages left the sidebar showing no indication
    of where the user was: the highlight existed, several hundred pixels down.

    `block: 'nearest'` is what makes this safe to run on every navigation — it
    does nothing at all when the entry is already visible, so the common case
    is not a scroll jump.
  */
  const navRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!current) return
    navRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [current])

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <Link
          href="/dashboard"
          className="flex min-w-0 items-center gap-2.5"
          aria-label={`${brand.name} — dashboard`}
        >
          {/*
            The mark, not a monogram in a black box. A filled square holding a
            single letter reads as a placeholder somebody meant to replace, and
            it was the heaviest thing on the page. A stroked school building
            belongs to the same drawn set as every other icon here, carries the
            same weight as the navigation beside it, and still says what the
            product is when the rail is collapsed to 64px and this is the only
            thing left of the header.
          */}
          <span className="flex h-8 w-8 shrink-0 items-center justify-center text-graphite">
            <Icon name="campus" size={22} />
          </span>
          {collapsed ? null : (
            <span className="min-w-0">
              <span className="block truncate font-display text-[14px] leading-tight text-graphite">
                {brand.name}
              </span>
              <span className="block text-[10px] tracking-[0.08em] text-stone uppercase">
                School management
              </span>
            </span>
          )}
        </Link>
        {showClose ? (
          <button
            type="button"
            onClick={() => onMobileOpenChange(false)}
            aria-label="Close navigation"
            className="ml-auto rounded-[8px] p-1.5 text-slate hover:bg-paper"
          >
            <Icon name="close" size={16} />
          </button>
        ) : null}
      </div>

      <nav ref={navRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pt-1 pb-3">
        {sections.map((section) => (
          <NavGroup key={section.id} section={section} collapsed={collapsed} current={current} />
        ))}
      </nav>

      <div className="shrink-0 border-t border-silver p-2.5">
        <div
          className={cx(
            'flex items-center gap-2.5 rounded-[8px] py-1.5',
            collapsed ? 'justify-center px-0' : 'px-2',
          )}
        >
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-paper text-[11px] font-medium text-graphite"
            title={collapsed ? `${account.name} · ${account.role}` : undefined}
          >
            {account.initials}
          </span>
          {collapsed ? (
            <span className="sr-only">
              {account.name}, {account.role}
            </span>
          ) : (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium text-graphite">
                {account.name}
              </span>
              <span className="block truncate text-[11px] text-stone">{account.role}</span>
            </span>
          )}
        </div>

        {/*
          Signing out belongs in plain sight. It lived here, moved into the
          header account menu, and became a control nobody could find — an
          avatar with no affordance is not a way out of an application. It is
          offered in both places now; this is the visible one.

          The label is conditionally rendered rather than hidden with CSS, the
          same way the nav links do it, so the collapsed rail contains no text
          box at all.
        */}
        <form action={signOutAction}>
          <button
            type="submit"
            title={collapsed ? 'Sign out' : undefined}
            className={cx(
              'mt-1 flex w-full items-center gap-2.5 rounded-[8px] py-2 text-[12px]',
              'text-slate transition-colors hover:bg-danger-bg hover:text-danger',
              collapsed ? 'justify-center px-0' : 'px-2.5',
            )}
          >
            <Icon name="signOut" size={16} className="shrink-0" />
            {collapsed ? <span className="sr-only">Sign out</span> : <span>Sign out</span>}
          </button>
        </form>

        {showClose ? null : (
          <button
            type="button"
            onClick={() => onCollapsedChange(!collapsed)}
            aria-expanded={!collapsed}
            aria-controls="primary-navigation"
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            className={cx(
              'mt-1 flex w-full items-center gap-2.5 rounded-[8px] py-2',
              'text-[12px] text-slate transition-colors hover:bg-paper hover:text-graphite',
              collapsed ? 'justify-center px-0' : 'px-2.5',
            )}
          >
            <Icon name={collapsed ? 'expand' : 'collapse'} size={16} />
            {collapsed ? <span className="sr-only">Expand navigation</span> : 'Collapse'}
          </button>
        )}
      </div>
    </>
  )
}

/**
 * One titled group of links.
 *
 * Expanded, the title is a disclosure button, so a long menu folds down to the
 * parts somebody actually uses. Collapsed, a title would be noise, so the group
 * becomes a divided run of icons instead.
 */
function NavGroup({
  section,
  collapsed,
  current,
}: {
  section: NavSection
  collapsed: boolean
  /** The one href the current page belongs to, resolved across every section. */
  current: string | null
}) {
  const listId = useId()
  const [folded, setFolded] = useState(false)
  const containsActive = section.items.some((item) => item.href === current)

  // A folded group holding the current page would hide where the user is.
  const expanded = !folded || containsActive

  return (
    <div className={cx('mb-1', collapsed && 'mb-2 border-b border-silver/60 pb-2 last:border-0')}>
      {collapsed ? null : (
        <button
          type="button"
          onClick={() => setFolded(expanded)}
          aria-expanded={expanded}
          aria-controls={listId}
          className={cx(
            'flex w-full items-center gap-1 rounded-[6px] px-2.5 py-1.5',
            'text-[10px] font-medium tracking-[0.08em] text-stone uppercase',
            'transition-colors hover:text-slate',
          )}
        >
          {section.title}
          <Icon
            name="chevronDown"
            size={11}
            className={cx('transition-transform', expanded ? '' : '-rotate-90')}
          />
        </button>
      )}
      <ul id={listId} className={cx('space-y-0.5', !collapsed && !expanded && 'hidden')}>
        {section.items.map((item) => (
          <li key={item.href}>
            <NavLink item={item} collapsed={collapsed} active={item.href === current} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function NavLink({
  item,
  collapsed,
  active,
}: {
  item: NavSection['items'][number]
  collapsed: boolean
  active: boolean
}) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      // Collapsed, the icon is the only label, so the name has to come from
      // somewhere: `title` is the tooltip, the sr-only span is the accessible name.
      title={collapsed ? item.label : undefined}
      className={cx(
        'flex items-center gap-2.5 rounded-[8px] py-2 text-[13px] transition-colors',
        collapsed ? 'justify-center px-0' : 'px-2.5',
        active ? 'bg-ink font-medium text-white' : 'text-slate hover:bg-paper hover:text-graphite',
      )}
    >
      <Icon name={item.icon} size={16} className="shrink-0" />
      {collapsed ? (
        <span className="sr-only">{item.label}</span>
      ) : (
        <span className="truncate">{item.label}</span>
      )}
    </Link>
  )
}

/** `/students` is active on `/students/12` but not on `/students-archive`. */
/**
 * Which single nav entry the current page belongs to.
 *
 * A plain prefix test lit up two entries at once wherever one nav href nested
 * under another: on /configuration/grading both "Configuration" and "Grading
 * schemes" were drawn as the current page, so the sidebar claimed the user was
 * in two places.
 *
 * The longest matching href wins, which is the only entry that can be right —
 * the most specific one that still contains the page. Comparing lengths is
 * enough because every candidate here is already a prefix of the same path, so
 * they differ only in how far down they reach.
 */
function activeHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null
  for (const href of hrefs) {
    if (pathname !== href && !pathname.startsWith(`${href}/`)) continue
    if (best === null || href.length > best.length) best = href
  }
  return best
}
