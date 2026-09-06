import Link from 'next/link'

/**
 * An address that matches no route at all.
 *
 * This one renders outside the app shell on purpose: an unmatched URL may well
 * be a signed-out visitor, and the shell needs a session to draw. Records that
 * exist as routes but not as data are handled by (app)/not-found.tsx, inside
 * the navigation.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-[20px] leading-tight">Page not found</h1>
      <p className="mt-2 text-[13px] text-slate">
        That address does not match anything in the school system.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 rounded-[9999px] bg-ink px-5 py-2.5 text-[13px] font-medium text-white hover:bg-graphite"
      >
        Back to dashboard
      </Link>
    </main>
  )
}
