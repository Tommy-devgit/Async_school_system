import { redirect } from 'next/navigation'
import { Icon } from '@/components/icons'
import { getSession } from '@/lib/odoo/auth'
import { landingPath } from '@/lib/navigation'
import { LoginForm } from './login-form'

export const metadata = { title: 'Sign in · Async School' }

/**
 * The sign-in page.
 *
 * This is the only screen anyone outside the school ever sees, and it was a
 * form under a black square with a letter in it. The letter is gone — see the
 * note on the mark in components/layout/sidebar.tsx — and the page now says
 * what the system is before asking for credentials.
 *
 * Two columns on a wide screen, one on a narrow one. The left column is
 * decoration in the strict sense that nothing there is required to sign in, so
 * it is `aria-hidden` and skipped entirely rather than read out ahead of the
 * form. On a phone it is not rendered at all: a person on a 390px screen wants
 * the two fields, not a paragraph about the product.
 */
export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const params = await searchParams
  const expired = params.expired === '1'

  // Only bounce an already signed-in visitor onward, and send them to the same
  // page a fresh sign-in would. Arriving here after an expired Odoo session
  // must not loop back.
  const session = expired ? null : await getSession()
  if (session) redirect(landingPath(session.user.roles))

  return (
    /*
      The body is already `paper`, so the form column is the white one. Without
      that inversion the two halves were the same grey and the split did not
      read at all — and on a phone, where the left column is not rendered, the
      whole page is simply white behind the form.
    */
    <main className="min-h-screen bg-white lg:grid lg:grid-cols-[1.05fr_1fr]">
      <aside
        aria-hidden
        className="hidden flex-col justify-between border-r border-silver bg-paper p-12 lg:flex xl:p-16"
      >
        <div className="flex items-center gap-2.5 text-graphite">
          <Icon name="campus" size={24} />
          <span className="font-display text-[15px] leading-tight">Async School</span>
        </div>

        <div className="max-w-[420px]">
          <p className="font-display text-[30px] leading-[1.25] text-graphite">
            One record of the school, kept straight.
          </p>
          <p className="mt-4 text-[14px] leading-relaxed text-slate">
            Registration, timetables, attendance, marks and report cards — each held once,
            authorised by the school system itself, and visible to the people whose job it is.
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-6 border-t border-silver pt-6">
          {[
            ['Registration', 'students'],
            ['Attendance', 'attendance'],
            ['Report cards', 'reportCards'],
          ].map(([label, icon]) => (
            <div key={label}>
              <dt className="text-stone">
                <Icon name={icon as 'students'} size={17} />
              </dt>
              <dd className="mt-1.5 text-[12px] text-slate">{label}</dd>
            </div>
          ))}
        </dl>
      </aside>

      <div className="flex min-h-screen items-center justify-center px-6 py-12 lg:min-h-0">
        <div className="w-full max-w-[360px]">
          {/* The mark repeats here only where the left column is not shown. */}
          <div className="mb-8 flex items-center gap-2.5 text-graphite lg:hidden">
            <Icon name="campus" size={22} />
            <span className="font-display text-[14px] leading-tight">Async School</span>
          </div>

          <h1 className="text-[26px] leading-tight">Sign in</h1>
          <p className="mt-1.5 text-[14px] text-slate">
            Use the account your school administrator issued you.
          </p>

          {expired ? (
            <p
              role="status"
              className="mt-5 rounded-[8px] bg-info-bg px-3 py-2.5 text-[13px] text-action-blue"
            >
              Your session expired and you have been signed out. Please sign in again.
            </p>
          ) : null}

          <div className="mt-6">
            <LoginForm />
          </div>
        </div>
      </div>
    </main>
  )
}
