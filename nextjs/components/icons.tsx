import type { SVGProps } from 'react'

/**
 * The application's icon set.
 *
 * Written out rather than pulled from an icon package: the navigation needs
 * about thirty glyphs, they never change, and a dependency would ship a
 * runtime and a resolver for something a single file of path data covers. It
 * also keeps the drawing consistent — one grid, one stroke weight, one join.
 *
 * Every glyph is a 24×24 stroked outline on the same 1.6px weight, so icons
 * sit at the same optical weight as the 300-weight body text beside them.
 *
 * Icons are decorative by default: they carry `aria-hidden`, and the control
 * around them supplies the accessible name. Pass a `title` only for an icon
 * that is genuinely the sole label for something.
 */

const PATHS = {
  /* -------------------------------------------------------- navigation --- */
  dashboard: 'M4 4h6v7H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 15h6v5H4z',
  students: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M17 11.5a3 3 0 1 0-1.5-5.6M18 20h3.5a5.5 5.5 0 0 0-4-5.3',
  enrolment: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M18 12v6M15 15h6',
  staff: 'M4 8h16v12H4zM9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 13h16',
  teachers: 'M3 4h18v11H3zM12 15v5M8 20h8M8.5 11l2.5-3 2 2.2 2.5-3.2',
  classes: 'M4 20V7l8-4 8 4v13M9 20v-5h6v5M9 10h.01M15 10h.01',
  subjects: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM19 19v2H6a2 2 0 0 1-2-2M8.5 7.5h7',
  curriculum: 'M12 3 3 7.5l9 4.5 9-4.5zM3 12.5 12 17l9-4.5M3 17l9 4.5 9-4.5',
  academicYear: 'M4 6h16v14H4zM8 3v5M16 3v5M4 11h16M9 15h2M14 15h2',
  attendance: 'M4 6h16v14H4zM8 3v5M16 3v5M4 11h16M9.5 15.5l1.8 1.8 3.4-3.4',
  timetable: 'M4 6h16v14H4zM8 3v5M16 3v5M4 11h16M12 13.5V16l1.8 1.2',
  assignments: 'M9 4h6v3H9zM7 5.5H5.5A1.5 1.5 0 0 0 4 7v12.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H17M8 12h8M8 16h5',
  assessments: 'M9 4h6v3H9zM7 5.5H5.5A1.5 1.5 0 0 0 4 7v12.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H17M8.5 13.5l2 2 4-4.5',
  marks: 'M4 20V10M9.5 20V4M15 20v-7M20.5 20V7',
  reportCards: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h4',
  promotion: 'M12 3 2.5 7.5 12 12l9.5-4.5zM6 10v5.5c0 1.5 2.7 3 6 3s6-1.5 6-3V10M20.5 8v6',
  rankings: 'M3.5 20.5h17M10 20.5V8h4v12.5M4 20.5v-6.5h6M20 20.5v-4.5h-6M12 4.5l.7 1.5 1.6.2-1.2 1.1.3 1.6-1.4-.8-1.4.8.3-1.6-1.2-1.1 1.6-.2z',
  announcements: 'M4 9v5h3l7 4V5l-7 4zM17.5 9a4 4 0 0 1 0 6M14 18v3',
  programs: 'M4 6h16v14H4zM8 3v5M16 3v5M4 11h16M12 13l.9 1.9 2.1.3-1.5 1.4.4 2-1.9-1-1.9 1 .4-2-1.5-1.4 2.1-.3z',
  documents: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6M9 8h2',
  configuration:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 15a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10.5 4.5a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.8 2 2 0 1 1 0 4h-.2z',
  campus: 'M3 21h18M5 21V6l7-3 7 3v15M9 10h.01M15 10h.01M9 14h.01M15 14h.01M10.5 21v-4h3v4',
  rooms: 'M5 21V4h11v17M5 21h14M12.5 12.5h.01M16 8h3v13',

  /* --------------------------------------------------------- interface --- */
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  chevronLeft: 'm15 6-6 6 6 6',
  collapse: 'M4 5h16v14H4zM10 5v14M7.5 10.5 6 12l1.5 1.5',
  expand: 'M4 5h16v14H4zM10 5v14M4.5 10.5 6 12l-1.5 1.5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'm6 6 12 12M18 6 6 18',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  signOut: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  check: 'm5 13 4 4L19 7',
  alert: 'M12 8v5M12 16.5h.01M12 3 2 20h20z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  plus: 'M12 5v14M5 12h14',
  arrowRight: 'M4 12h16M14 6l6 6-6 6',
  arrowLeft: 'M20 12H4M10 18l-6-6 6-6',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  refresh: 'M20 11a8 8 0 1 0-.7 4.5M20 5v6h-6',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6z',
  eyeOff:
    'M9.9 5.7A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.4 17.4 0 0 1-2.8 3.5M6.2 7.8A17 17 0 0 0 2.5 12S6 18.5 12 18.5a9.5 9.5 0 0 0 3.7-.7M10 10a2.8 2.8 0 0 0 4 4M4 4l16 16',
} as const

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  size = 16,
  title,
  className,
  ...rest
}: {
  name: IconName
  size?: number
  /** Only for an icon that is itself the label. Otherwise leave it out. */
  title?: string
} & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  )
}
