'use client'

import { useActionState } from 'react'
import { PasswordInput } from '@/components/ui/form'
import { loginAction, type LoginState } from './actions'

/*
  Focus is a visible ring, not a recoloured border.

  The previous style set `focus:outline-none` and changed the border colour by
  one shade, which a keyboard user on a bright screen cannot reliably see and
  which disappears entirely against a high-contrast setting. `outline` is drawn
  by the browser above the element and survives both.
*/
const FIELD =
  'w-full rounded-[8px] border border-silver bg-white px-3 py-2.5 text-[14px] text-graphite ' +
  'placeholder:text-stone transition-colors hover:border-stone ' +
  'focus-visible:border-action-blue focus-visible:outline-2 focus-visible:outline-offset-1 ' +
  'focus-visible:outline-action-blue ' +
  'aria-[invalid=true]:border-danger'

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {})
  const invalid = Boolean(state.error)

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div>
        <label htmlFor="login" className="mb-1.5 block text-[13px] font-medium text-graphite">
          Email
        </label>
        <input
          id="login"
          name="login"
          type="email"
          autoComplete="username"
          autoFocus
          required
          className={FIELD}
          placeholder="you@school.example"
          /*
            Both fields are marked invalid, never one of them. Odoo answers a
            bad email and a bad password with the same refusal on purpose —
            saying which half was wrong tells an attacker which logins exist.
          */
          aria-invalid={invalid || undefined}
          aria-describedby={state.error ? 'login-error' : undefined}
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-graphite">
          Password
        </label>
        <PasswordInput
          name="password"
          autoComplete="current-password"
          required
          invalid={invalid}
          className={FIELD}
          aria-describedby={state.error ? 'login-error' : undefined}
        />
      </div>

      {state.error ? (
        <p
          id="login-error"
          role="alert"
          className="rounded-[8px] bg-danger-bg px-3 py-2 text-[13px] text-danger"
        >
          {state.error}
        </p>
      ) : null}

      <button
        id="submit-login"
        type="submit"
        disabled={pending}
        className="w-full rounded-[9999px] bg-ink px-5 py-2.5 text-[14px] font-medium text-white transition-colors hover:bg-graphite focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-blue disabled:opacity-50"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>

      <p className="pt-1 text-center text-[12px] leading-relaxed text-stone">
        Trouble signing in? Contact your school administrator.
      </p>
    </form>
  )
}
