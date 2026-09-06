import 'server-only'
import { unstable_rethrow } from 'next/navigation'

/**
 * Odoo error normalisation.
 *
 * Odoo answers a failed call with the exception class, a human message, and a
 * `debug` field holding the full Python traceback and `/usr/lib/python3/...`
 * paths. Verified against staging: every error carries it, including 401s.
 * Nothing in this file may leak that outward — callers get a code and a
 * message, and the raw payload is logged server-side only.
 */

export type OdooErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UPSTREAM_UNAVAILABLE'
  | 'TIMEOUT'
  | 'UNKNOWN'

/** The only error shape allowed to cross into a page, component or response. */
export class OdooError extends Error {
  readonly code: OdooErrorCode
  readonly status: number
  /** Server-side only. Never serialise this to the client. */
  readonly detail?: string

  constructor(code: OdooErrorCode, message: string, status: number, detail?: string) {
    super(message)
    this.name = 'OdooError'
    this.code = code
    this.status = status
    this.detail = detail
  }

  /** Safe to return from a Route Handler or hand to a client component. */
  toClient(): { code: OdooErrorCode; message: string } {
    return { code: this.code, message: this.message }
  }
}

/** Raw JSON-RPC error payload as Odoo sends it. */
interface RawOdooError {
  message?: string
  data?: {
    name?: string
    message?: string
    arguments?: unknown[]
    debug?: string
  }
}

const BY_EXCEPTION: Record<string, { code: OdooErrorCode; status: number; message: string }> = {
  'odoo.exceptions.AccessDenied': {
    code: 'UNAUTHENTICATED',
    status: 401,
    message: 'Your username or password is incorrect.',
  },
  'odoo.http.SessionExpiredException': {
    code: 'UNAUTHENTICATED',
    status: 401,
    message: 'Your session has expired. Please sign in again.',
  },
  'odoo.exceptions.AccessError': {
    code: 'FORBIDDEN',
    status: 403,
    message: 'You do not have permission to view or change this.',
  },
  'odoo.exceptions.ValidationError': {
    code: 'VALIDATION',
    status: 422,
    message: 'That change was rejected.',
  },
  'odoo.exceptions.UserError': {
    code: 'VALIDATION',
    status: 422,
    message: 'That action could not be completed.',
  },
  'odoo.exceptions.MissingError': {
    code: 'NOT_FOUND',
    status: 404,
    message: 'That record no longer exists.',
  },
  'werkzeug.exceptions.Unauthorized': {
    code: 'UNAUTHENTICATED',
    status: 401,
    message: 'You are not signed in.',
  },
  'werkzeug.exceptions.NotFound': {
    code: 'NOT_FOUND',
    status: 404,
    message: 'That resource does not exist.',
  },
}

/**
 * ValidationError and UserError carry messages the school module authors wrote
 * for the person on the other end — "Fayda ID must be exactly 16 digits…",
 * "Cannot leave Draft while the following are missing: …". Those are worth
 * surfacing. Everything else gets a generic message, because Odoo's internal
 * errors describe the server, not the user's problem.
 */
const PASS_THROUGH_MESSAGE = new Set([
  'odoo.exceptions.ValidationError',
  'odoo.exceptions.UserError',
])

/** A message is only shown if it reads like prose, not like a stack frame. */
function isPresentable(message: string | undefined): message is string {
  if (!message) return false
  const trimmed = message.trim()
  if (!trimmed || trimmed.length > 400) return false
  return !/Traceback|File "|\/usr\/lib|psycopg2|odoo\.(tools|models|api)\./.test(trimmed)
}

export function normaliseOdooError(raw: RawOdooError | undefined): OdooError {
  const exception = raw?.data?.name ?? ''
  const mapped = BY_EXCEPTION[exception]
  const odooMessage = raw?.data?.message ?? raw?.message

  if (mapped) {
    const message =
      PASS_THROUGH_MESSAGE.has(exception) && isPresentable(odooMessage)
        ? odooMessage.trim()
        : mapped.message
    return new OdooError(mapped.code, message, mapped.status, raw?.data?.debug)
  }

  return new OdooError(
    'UNKNOWN',
    'Something went wrong. Please try again.',
    500,
    raw?.data?.debug ?? odooMessage,
  )
}

/** Anything thrown inside the client that is not already an OdooError. */
export function toOdooError(cause: unknown): OdooError {
  // redirect() and notFound() work by throwing. A catch-all that swallowed
  // them would turn "sign in again" into a generic error page.
  unstable_rethrow(cause)
  if (cause instanceof OdooError) return cause
  if (cause instanceof DOMException && cause.name === 'AbortError') {
    return new OdooError(
      'TIMEOUT',
      'The school system did not respond in time. It may be waking up — try again in a moment.',
      504,
    )
  }
  return new OdooError(
    'UPSTREAM_UNAVAILABLE',
    'The school system is unreachable right now.',
    502,
    cause instanceof Error ? cause.message : String(cause),
  )
}

/**
 * Codes that mean "you may not see this" or "it is not there" — the answers a
 * panel can legitimately render as empty.
 *
 * Everything else describes the server, not the caller's permissions: a
 * timeout, an unreachable Odoo, an unhandled fault. Those must not resolve to
 * null, because null is indistinguishable from an empty result and turns an
 * outage into a page that calmly reports no students.
 */
const REFUSAL_CODES = new Set<OdooErrorCode>(['FORBIDDEN', 'NOT_FOUND'])

/**
 * Resolve to null when Odoo refuses the read, while letting framework errors
 * through.
 *
 * Several models are legitimately invisible to some roles, so one restricted
 * panel must not fail a whole page. A bare `catch` here would also swallow the
 * redirect an expired session throws, which is what previously stranded users
 * on an error with no way to sign in again.
 *
 * A refusal is the only thing it absorbs. This used to catch everything, so a
 * slow or unreachable Odoo produced the same null a permission boundary does —
 * every list rendered empty, every record page 404'd, and nothing was logged
 * to say otherwise. Transport failures now reach the error boundary, which is
 * the one screen that offers a way to retry or sign in again.
 */
export async function orNullOnRefusal<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise
  } catch (cause) {
    unstable_rethrow(cause)
    const error = toOdooError(cause)
    if (!REFUSAL_CODES.has(error.code)) throw error
    // Structured, and free of anything the record itself contained: a refusal
    // is expected often enough that it must be greppable, not silent.
    console.warn(JSON.stringify({ event: 'odoo.read.refused', code: error.code }))
    return null
  }
}
