/**
 * Which Odoo a test script is allowed to write to.
 *
 * `E2E_ALLOW_WRITES=yes` says a suite *wants* to write. It says nothing about
 * *where*, and `ODOO_BASE_URL` is an ordinary environment variable that a
 * developer can leave pointing at the production Render deployment from an
 * earlier session. The two together are enough to create and delete real
 * student, staff and user records. That is the hole this closes:
 *
 *     write allowed  =  explicit intent  AND  approved destination
 *
 * The policy is deny-by-default. A host is writable only if it is localhost or
 * has been named in `E2E_WRITABLE_HOSTS`; production never becomes writable
 * because a variable was forgotten, and no allowance is made for "it looks like
 * staging". Reads are deliberately left alone, so a read-only smoke check
 * against production stays possible.
 *
 * Matching is on the parsed hostname and is exact. Substring tests are what let
 * `async-school-system.onrender.com.evil.com` through, so there are none here,
 * and a subdomain is never trusted on the strength of its parent.
 */

/**
 * Writable without any configuration. The loopback interface is the only place
 * a test can reach that is definitionally the developer's own machine.
 *
 * IPv6 loopback is listed unbracketed: `new URL()` reports it as `[::1]`, and
 * `hostnameOf` strips the brackets before comparing.
 */
const ALWAYS_WRITABLE = Object.freeze(['localhost', '127.0.0.1', '::1'])

/** The variable that names additional safe targets, e.g. a staging host. */
export const WRITABLE_HOSTS_VAR = 'E2E_WRITABLE_HOSTS'

/**
 * ORM methods that change the database.
 *
 * `action_*` is included as a family because the school module's business
 * transitions are all named that way and every one of them writes — activating
 * a staff member, approving a registration, applying a promotion batch. So are
 * `button_*` and Odoo's own `web_save`/`load`, which are write paths under
 * other names.
 *
 * Anything not recognised here is treated as a read, which is the correct
 * default for the ORM's surface: the mutating methods are a short, closed list
 * and the reading ones are open-ended.
 */
const MUTATING_METHODS = new Set([
  'create',
  'write',
  'unlink',
  'copy',
  'copy_data',
  'name_create',
  'web_save',
  'load',
  'import_file',
  'toggle_active',
  'action_archive',
  'action_unarchive',
])

const MUTATING_PREFIXES = ['action_', 'button_']

/** Whether calling `method` over call_kw would change stored data. */
export function isMutatingMethod(method) {
  if (typeof method !== 'string' || !method) return false
  const name = method.trim()
  if (MUTATING_METHODS.has(name)) return true
  return MUTATING_PREFIXES.some((prefix) => name.startsWith(prefix))
}

/**
 * The hostname a base URL resolves to, lowercased and without IPv6 brackets.
 *
 * Throws on anything that is not an absolute http(s) URL. A value that cannot
 * be parsed is not "probably fine" — it is a value nobody has checked, and the
 * safe reading of an unparseable destination is that it is not approved.
 */
export function hostnameOf(baseUrl) {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    throw new Error(
      'No Odoo base URL was given, so its host cannot be checked. ' +
        'Set ODOO_BASE_URL to the environment you mean to write to.',
    )
  }

  let parsed
  try {
    parsed = new URL(baseUrl.trim())
  } catch {
    throw new Error(
      `"${baseUrl}" is not a valid absolute URL, so its host cannot be checked. ` +
        'Give ODOO_BASE_URL a full origin, e.g. http://localhost:8070.',
    )
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `"${baseUrl}" uses ${parsed.protocol} — only http and https destinations can be checked.`,
    )
  }

  // Node reports an IPv6 host as "[::1]"; compare the address itself.
  return parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
}

/**
 * Every hostname writes are permitted against, in the order they were decided.
 *
 * Entries in `E2E_WRITABLE_HOSTS` may be written as bare hostnames or as full
 * URLs, because the value people have to hand is usually a URL. A wildcard is
 * rejected outright rather than quietly never matching, so nobody ships a
 * config believing `*.onrender.com` opened something.
 */
export function writableHosts(env = process.env) {
  const configured = (env[WRITABLE_HOSTS_VAR] ?? '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry.includes('*')) {
        throw new Error(
          `${WRITABLE_HOSTS_VAR} contains "${entry}". Wildcards are not supported — ` +
            'name each writable host in full.',
        )
      }
      // A full URL is accepted for convenience; anything else is a hostname.
      return /^[a-z][a-z0-9+.-]*:\/\//i.test(entry)
        ? hostnameOf(entry)
        : entry.toLowerCase().replace(/^\[|\]$/g, '')
    })

  return [...ALWAYS_WRITABLE, ...configured]
}

/** Whether writes are permitted against `baseUrl`. Never throws on policy. */
export function isWritable(baseUrl, env = process.env) {
  let host
  try {
    host = hostnameOf(baseUrl)
  } catch {
    // Unparseable is not approved.
    return false
  }
  return writableHosts(env).includes(host)
}

/**
 * Permit a write against `baseUrl`, or throw with an error a developer can act
 * on. `what` names the operation being refused, so the message points at the
 * call rather than only at the configuration.
 */
export function assertWritable(baseUrl, what = 'this operation', env = process.env) {
  // Let a malformed or non-http URL raise its own, more specific message.
  const host = hostnameOf(baseUrl)
  if (writableHosts(env).includes(host)) return

  throw new Error(
    [
      `Refusing to run ${what}: writes to this host are not approved.`,
      '',
      `  target host   ${host}`,
      `  base URL      ${baseUrl}`,
      `  approved      ${writableHosts(env).join(', ')}`,
      '',
      'Automated tests may only write to localhost or to a host named in',
      `${WRITABLE_HOSTS_VAR}. E2E_ALLOW_WRITES says a suite wants to write; it`,
      'does not make a destination safe, and it cannot override this.',
      '',
      'Point ODOO_BASE_URL at your local Odoo:',
      '',
      '  export ODOO_BASE_URL=http://localhost:8070',
      '',
      'or, to write to the shared staging database on purpose, name it:',
      '',
      `  export ${WRITABLE_HOSTS_VAR}=async-school-staging.onrender.com`,
      '',
      'Never add a production host here.',
    ].join('\n'),
  )
}
