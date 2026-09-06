'use server'

import { redirect } from 'next/navigation'
import { login, logout } from '@/lib/odoo/auth'
import { toOdooError } from '@/lib/odoo/errors'
import { landingPath } from '@/lib/navigation'
import { submitted } from '@/lib/form-values'

export interface LoginState {
  error?: string
  /**
   * The email, echoed back so a mistyped password does not also cost the user
   * their address — school logins are long and are typed on shared machines.
   *
   * The password is deliberately not here, and must never be: this state is
   * serialised to the browser and rendered into the page.
   */
  values?: Record<'login', string>
}

const ECHOED = ['login'] as const

/**
 * The password crosses this boundary once, is forwarded to Odoo, and is never
 * stored or logged. What returns is an Odoo session id, sealed server-side
 * into an httpOnly cookie by `login()`.
 */
export async function loginAction(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const loginName = String(formData.get('login') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!loginName || !password) {
    return { error: 'Enter both your email and password.', values: submitted(formData, ECHOED) }
  }

  let session
  try {
    session = await login(loginName, password)
  } catch (cause) {
    // Only the normalised message — never Odoo's traceback.
    return { error: toOdooError(cause).message, values: submitted(formData, ECHOED) }
  }

  // The groups Odoo just resolved decide the first page — a teacher's open
  // mark lists, an exam officer's approval queue — rather than everyone
  // landing on an overview most roles have to click straight through.
  redirect(landingPath(session.user.roles))
}

export async function logoutAction(): Promise<void> {
  await logout()
  redirect('/login')
}
