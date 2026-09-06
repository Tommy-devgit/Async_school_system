import { LinkButton } from '@/components/ui'

/**
 * Where the 33 `notFound()` calls across the record pages land.
 *
 * Without this they fell through to Next's built-in 404, which renders outside
 * the app shell — no navigation, no way back except the browser's own button.
 *
 * The wording covers deleted as well as absent, and permission as well as
 * either: `orNullOnRefusal` turns an Odoo refusal into null, and every record
 * page treats null as not-found, so a registrar looking at a record their role
 * cannot read arrives here too.
 */
export default function AppNotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-[20px] leading-tight">Not found</h1>
      <p className="mt-2 text-[13px] text-slate">
        This record does not exist, has been removed, or is not visible to your role.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <LinkButton href="/dashboard" variant="primary" size="md">
          Back to dashboard
        </LinkButton>
      </div>
    </div>
  )
}
