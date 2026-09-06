/**
 * What the user submitted, echoed back so a refused submit does not empty the
 * form.
 *
 * A server-action form re-renders from scratch and React 19 resets it once the
 * action returns — including when the action returns a validation error. So an
 * uncontrolled field loses what was typed unless the action hands it back and
 * the form re-seeds from it. `FormResponse` in components/ui/form covers the
 * rendering half of that; this is the half the action owns.
 *
 * Eleven actions had each grown their own copy of this over a module-local
 * tuple of field names, and the copies had already drifted over whether a
 * checkbox counts and whether the value is trimmed. Kept out of any one route
 * so the next form does not start a twelfth.
 */

/**
 * Values are echoed exactly as typed, not trimmed. Validation trims for its
 * own purposes; the form should show the user their own input back, and
 * silently eating a leading space is how a mistyped identifier becomes
 * impossible to spot.
 *
 * An unchecked checkbox is absent from the submission and reads back as `''`;
 * a checked one reads back as `'on'`, which is what a `defaultChecked` test
 * should compare against. A file input cannot be echoed at all — the browser
 * will not let a value be put back into one — so it also reads back as `''`.
 *
 * **Never list a password field.** The echo travels to the browser and into
 * the rendered HTML.
 */
export function submitted<Field extends string>(
  form: FormData,
  fields: readonly Field[],
): Record<Field, string> {
  const values = {} as Record<Field, string>

  for (const field of fields) {
    const value = form.get(field)
    values[field] = typeof value === 'string' ? value : ''
  }

  return values
}

/**
 * The same, for names a form submits more than once — a multi-select, or a
 * group of checkboxes sharing a name.
 *
 * `submitted()` would keep only the first of them, which is worse than keeping
 * none: a setup form refused after picking eight grades would come back
 * showing one, and look as though the other seven had been rejected.
 */
export function submittedList<Field extends string>(
  form: FormData,
  fields: readonly Field[],
): Record<Field, string[]> {
  const values = {} as Record<Field, string[]>

  for (const field of fields) {
    values[field] = form.getAll(field).filter((value) => typeof value === 'string')
  }

  return values
}
