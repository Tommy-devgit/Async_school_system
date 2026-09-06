'use client'

import { createContext, useContext, useId, useState } from 'react'
import type { ReactNode, SelectHTMLAttributes, InputHTMLAttributes } from 'react'
import { Icon } from '@/components/icons'
import { cx } from './primitives'

/**
 * A number that changes once for every reply a form action sends back.
 *
 * React 19 calls `form.reset()` after a `<form action={…}>` action returns —
 * including when it returns a validation error rather than succeeding. So a
 * refused save silently empties the form unless every field is re-seeded from
 * the values the action echoed back. What each kind of field needs was
 * established by experiment, not by reading:
 *
 *   - A **text input** given a fresh `defaultValue` survives. React writes the
 *     new default onto the existing node, and the reset lands on it.
 *
 *   - A **`<select>`** does not. React does not re-point an existing select at
 *     a different option when only `defaultValue` changes, so the reset puts
 *     back whatever was selected when the node was created. This is the worst
 *     of the three, because it does not blank the field — it quietly restores
 *     a plausible value. A teaching status changed to Inactive and refused for
 *     an unrelated reason comes back reading Active, and saves that way.
 *
 *   - A **controlled** field has no default to reset to at all, so it blanks;
 *     and because its `value` prop did not change, React sees nothing to
 *     repair. The DOM and React's state disagree, and React's state is the one
 *     nobody can see.
 *
 * The last two cannot be fixed by correcting state — the state was never
 * wrong — so the control has to be rebuilt. `SelectField` does that for itself
 * out of `FormResponse` below; a hand-written `<select>` needs
 * `key={`field-${useFormResponse(state)}`}` of its own.
 *
 * Keyed on the reply's identity rather than its contents. A contents hash
 * would work too — a repeated refusal echoes the same values, so the node from
 * the last rebuild already holds them — but identity needs no hashing and says
 * plainly what it counts: replies, not values.
 */
export function useFormResponse(state: unknown): number {
  // React's own "adjusting state during render" pattern, so the new count is
  // used by this render rather than one paint later.
  const [seen, setSeen] = useState(state)
  const [responses, setResponses] = useState(0)

  if (seen !== state) {
    setSeen(state)
    setResponses(responses + 1)
  }

  return responses
}

const FormResponseContext = createContext(0)

/**
 * Wrap a form's fields in this, passing the `useActionState` state, and every
 * `SelectField` inside keeps the user's choice when a submit is refused.
 *
 * Outside a provider the count is a constant, so an unwrapped form behaves
 * exactly as it did before — this can be adopted a form at a time.
 */
export function FormResponse({ state, children }: { state: unknown; children: ReactNode }) {
  const response = useFormResponse(state)
  return <FormResponseContext value={response}>{children}</FormResponseContext>
}

/*
  Form primitives.

  Extracted from the staff registration form, which was the only form in the
  application when it was written. Four more forms in this domain need the same
  label/hint/error arrangement, and a second copy would be the point at which
  they start to drift.

  The rule these encode: a field shows Odoo's own error when there is one, its
  hint otherwise, and never both — an error the user has to read past a hint to
  find is an error they will miss.
*/

export const INPUT_CLASS =
  'w-full rounded-[8px] border border-silver bg-white px-3 py-2 text-[13px] text-graphite ' +
  'placeholder:text-stone focus:border-action-blue focus:outline-none ' +
  'disabled:bg-paper disabled:text-stone'

export const INPUT_INVALID = 'border-danger focus:border-danger'

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  hint?: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1.5 block text-[12px] font-medium text-graphite">
        {label}
        {required ? (
          <span className="ml-0.5 text-danger" aria-hidden>
            *
          </span>
        ) : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>
      {children}
      {hint && !error ? <p className="mt-1 text-[11px] text-stone">{hint}</p> : null}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="mt-1 text-[11px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** A labelled text input wired to the shared error styling. */
export function TextField({
  label,
  name,
  error,
  hint,
  required,
  ...rest
}: {
  label: string
  name: string
  error?: string
  hint?: string
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} htmlFor={name} error={error} hint={hint} required={required}>
      <input
        id={name}
        name={name}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
        className={cx(INPUT_CLASS, error && INPUT_INVALID)}
        {...rest}
      />
    </Field>
  )
}

/**
 * A password input with a reveal control.
 *
 * Every password typed in this application is typed *for somebody else* — a
 * registrar setting a teacher's first password, or resetting one they have
 * lost. There is no muscle memory to fall back on and no confirmation field to
 * catch a typo, so a wrong character is discovered only when the teacher
 * cannot sign in. Being able to look is the check.
 *
 * It stays masked until asked: revealing is deliberate, never the default, and
 * the control states which way round it is for a screen reader too.
 */
export function PasswordInput({
  name,
  invalid,
  className,
  ...rest
}: {
  name: string
  invalid?: boolean
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [revealed, setRevealed] = useState(false)
  const statusId = useId()

  return (
    <span className="relative block">
      <input
        id={name}
        name={name}
        type={revealed ? 'text' : 'password'}
        aria-invalid={invalid ? true : undefined}
        className={cx(INPUT_CLASS, 'pr-10', invalid && INPUT_INVALID, className)}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setRevealed((was) => !was)}
        aria-pressed={revealed}
        aria-controls={name}
        aria-describedby={statusId}
        title={revealed ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-[8px] text-stone transition-colors hover:text-graphite focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-action-blue"
      >
        <Icon name={revealed ? 'eyeOff' : 'eye'} size={16} />
        <span className="sr-only">{revealed ? 'Hide password' : 'Show password'}</span>
      </button>
      {/* Announced on toggle, so it is clear the password is now on screen. */}
      <span id={statusId} role="status" className="sr-only">
        {revealed ? 'Password is visible' : 'Password is hidden'}
      </span>
    </span>
  )
}

/** PasswordInput wearing the same label, hint and error styling as TextField. */
export function PasswordField({
  label,
  name,
  error,
  hint,
  required,
  ...rest
}: {
  label: string
  name: string
  error?: string
  hint?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <Field label={label} htmlFor={name} error={error} hint={hint} required={required}>
      <PasswordInput
        name={name}
        required={required}
        invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : undefined}
        {...rest}
      />
    </Field>
  )
}

export interface Option {
  value: string
  label: string
}

export function SelectField({
  label,
  name,
  options,
  error,
  hint,
  required,
  placeholder = 'Choose…',
  ...rest
}: {
  label: string
  name: string
  options: Option[]
  error?: string
  hint?: string
  placeholder?: string
} & SelectHTMLAttributes<HTMLSelectElement>) {
  // Rebuilt on each reply from the form's action, so React 19's post-action
  // reset cannot revert the choice. See useFormResponse.
  const response = useContext(FormResponseContext)

  return (
    <Field label={label} htmlFor={name} error={error} hint={hint} required={required}>
      <select
        key={`${name}-${response}`}
        id={name}
        name={name}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
        className={cx(INPUT_CLASS, error && INPUT_INVALID)}
        {...rest}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

/** A titled group of fields, laid out two-up and single-column on a phone. */
export function FormSection({
  title,
  hint,
  children,
  columns = 2,
}: {
  title: string
  hint?: string
  children: ReactNode
  columns?: 1 | 2 | 3
}) {
  return (
    <section className="border-t border-silver pt-5 first:border-0 first:pt-0">
      <h2 className="text-[15px] leading-tight">{title}</h2>
      {hint ? <p className="mt-0.5 mb-3 text-[12px] text-slate">{hint}</p> : <div className="mb-3" />}
      <div
        className={cx(
          'grid gap-4',
          columns === 1 && 'sm:grid-cols-1',
          columns === 2 && 'sm:grid-cols-2',
          columns === 3 && 'sm:grid-cols-2 lg:grid-cols-3',
        )}
      >
        {children}
      </div>
    </section>
  )
}

/**
 * The banner for an error Odoo returned about the record as a whole — a
 * duplicate Fayda ID, a failed constraint, a refused transition. Field-level
 * problems belong on the field.
 */
export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <div
      role="alert"
      className="flex gap-2.5 rounded-[8px] bg-danger-bg px-3.5 py-3 text-[13px] text-danger"
    >
      <Icon name="alert" size={16} className="mt-px shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  )
}

export function FormSuccess({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <div
      role="status"
      className="flex gap-2.5 rounded-[8px] bg-info-bg px-3.5 py-3 text-[13px] text-action-blue"
    >
      <Icon name="check" size={16} className="mt-px shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  )
}

/**
 * A read-only value inside a form.
 *
 * Used for what Odoo computes or reserves — the staff number from its
 * sequence, the composed display name. Showing them greyed makes it clear
 * they exist and are not the user's to set, which is better than hiding them
 * and better than offering an input Odoo would ignore.
 */
export function ReadOnlyField({
  label,
  value,
  hint,
}: {
  label: string
  value: ReactNode
  hint?: string
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[12px] font-medium text-graphite">{label}</p>
      <p className="rounded-[8px] border border-silver/70 bg-paper px-3 py-2 text-[13px] text-slate">
        {value || '—'}
      </p>
      {hint ? <p className="mt-1 text-[11px] text-stone">{hint}</p> : null}
    </div>
  )
}

/** The action row every form ends with. */
export function FormActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-silver pt-5">{children}</div>
  )
}
