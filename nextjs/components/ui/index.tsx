/**
 * The design system barrel.
 *
 * Every screen imports its furniture from `@/components/ui` and nowhere else,
 * so a change to a button or a chip lands everywhere at once. The pieces are
 * grouped by what they are rather than kept in one file:
 *
 *   primitives  surfaces, controls, chips
 *   table       the dense list rendering, paging and sorting
 *   states      loading, empty, restricted and error
 *   page        headings, breadcrumbs, detail grids, stat tiles
 */

export {
  Badge,
  Button,
  Card,
  CardHeader,
  DateText,
  IconButton,
  LinkButton,
  Skeleton,
  Spinner,
  StatusBadge,
  TableCard,
  cx,
  type ButtonSize,
  type ButtonVariant,
} from './primitives'

export type { Column } from './table'

export {
  Cell,
  DataTable,
  GroupHeader,
  Pagination,
  Row,
  RowLink,
  SortHeader,
  Toolbar,
} from './table'

export {
  DashboardSkeleton,
  DetailSkeleton,
  EmptyState,
  ErrorState,
  ListSkeleton,
  RestrictedState,
  TableSkeleton,
} from './states'

export {
  Breadcrumbs,
  DetailField,
  DetailGrid,
  Note,
  PageHeader,
  Stat,
  type Crumb,
} from './page'
