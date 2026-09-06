import { Card, Skeleton } from '@/components/ui'

/**
 * What every authenticated route shows while Odoo is answering.
 *
 * Nothing here was acknowledging the navigation: each page renders on the
 * server against Odoo, so a click left the previous screen up, unchanged, for
 * as long as the round trip took — and on a cold instance that is the several
 * seconds the TIMEOUT copy in lib/odoo/errors.ts already apologises for.
 *
 * The shape is deliberately neutral — a heading block above one panel — because
 * this boundary covers list, detail and form routes alike. Sections whose shape
 * is worth matching more closely override it with their own loading.tsx and the
 * skeletons in components/ui/states.tsx.
 */
export default function AppLoading() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="mb-6">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="mt-2 h-3 w-72" />
      </div>
      <Card>
        <Skeleton className="h-4 w-32" />
        <div className="mt-5 space-y-3">
          {Array.from({ length: 6 }, (_, row) => (
            <Skeleton key={row} className="h-3" />
          ))}
        </div>
      </Card>
    </div>
  )
}
