/**
 * The write guard, and the proof that it stops a write before the wire.
 *
 * Two halves. The first is the policy itself: which hosts are writable, which
 * method names count as writes, and the hostile-hostname cases that a
 * substring test would wave through. The second is the one that actually
 * matters — `rpc.mjs` pointed at production, asked to create a record, with
 * `fetch` replaced by a spy that fails the run if it is ever called.
 *
 * A policy test alone would pass while the guard sat unwired in a module
 * nobody imported.
 *
 *   node scripts/test-production-guard.mjs
 */
import {
  WRITABLE_HOSTS_VAR,
  assertWritable,
  hostnameOf,
  isMutatingMethod,
  isWritable,
  writableHosts,
} from './production-guard.mjs'

const PRODUCTION = 'https://async-school-system.onrender.com'
const STAGING = 'https://async-school-staging.onrender.com'

let failures = 0
function check(label, ok, extra = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

/** An env with nothing configured, so a case cannot inherit the real shell. */
const bare = {}
const withStaging = { [WRITABLE_HOSTS_VAR]: 'async-school-staging.onrender.com' }

function blocks(baseUrl, env = bare) {
  try {
    assertWritable(baseUrl, 'a test', env)
    return false
  } catch {
    return true
  }
}

/* ------------------------------------------------------------- allowed --- */

console.log('\nlocalhost is writable with no configuration at all')
for (const url of [
  'http://localhost:3000',
  'http://localhost:8070',
  'http://127.0.0.1:8069',
  'https://127.0.0.1',
  'http://[::1]:8069',
  'http://LOCALHOST:8070',
]) {
  check(url, isWritable(url, bare))
}

console.log('\nan explicitly named host is writable')
check(STAGING, isWritable(STAGING, withStaging))
check(`${STAGING} without the variable set`, !isWritable(STAGING, bare))
check(
  'the variable accepts a full URL, not just a hostname',
  isWritable(STAGING, { [WRITABLE_HOSTS_VAR]: STAGING }),
)
check(
  'several hosts may be named at once',
  isWritable(STAGING, { [WRITABLE_HOSTS_VAR]: 'a.example.com, async-school-staging.onrender.com' }),
)

/* ------------------------------------------------------------- blocked --- */

console.log('\nproduction is blocked')
check('the production Render host', blocks(PRODUCTION))
check('with a trailing slash', blocks(`${PRODUCTION}/`))
check('with a path', blocks(`${PRODUCTION}/web/dataset/call_kw`))
check('over http rather than https', blocks('http://async-school-system.onrender.com'))
check(
  'even when staging has been named',
  blocks(PRODUCTION, withStaging),
)

console.log('\narbitrary and hostile hosts are blocked')
for (const url of [
  'https://example.com',
  'https://odoo.com',
  // The two shapes a substring test lets through.
  'https://async-school-system.onrender.com.evil.com',
  'https://evil-async-school-system.onrender.com',
  // A subdomain of an approved host is not the approved host.
  'https://api.async-school-staging.onrender.com',
  // Credentials in the authority do not move the hostname.
  'https://localhost@async-school-system.onrender.com',
  'https://async-school-system.onrender.com#localhost',
  'https://async-school-system.onrender.com/?host=localhost',
]) {
  check(url, blocks(url, withStaging))
}

console.log('\nmalformed and unusable base URLs are blocked')
for (const value of [
  '',
  '   ',
  undefined,
  null,
  42,
  'not-a-url',
  'localhost:8070', // no scheme: parses as a "localhost:" protocol, not a host
  '//async-school-system.onrender.com',
  'file:///etc/passwd',
  'javascript:alert(1)',
]) {
  check(JSON.stringify(value) ?? String(value), blocks(value))
  check(`  isWritable() says no rather than throwing`, isWritable(value, bare) === false)
}

console.log('\na wildcard is rejected rather than quietly matching nothing')
let wildcardRejected = false
try {
  writableHosts({ [WRITABLE_HOSTS_VAR]: '*.onrender.com' })
} catch {
  wildcardRejected = true
}
check('*.onrender.com raises at configuration time', wildcardRejected)
check('and never opens production', blocks(PRODUCTION, { [WRITABLE_HOSTS_VAR]: '*' }))

/* ----------------------------------------------------- E2E_ALLOW_WRITES --- */

console.log('\nE2E_ALLOW_WRITES cannot buy permission')
check(
  'yes, against production, is still refused',
  blocks(PRODUCTION, { ...withStaging, E2E_ALLOW_WRITES: 'yes' }),
)
check(
  'true, against production, is still refused',
  blocks(PRODUCTION, { E2E_ALLOW_WRITES: 'true' }),
)
check(
  'the guard does not read the variable at all',
  writableHosts({ E2E_ALLOW_WRITES: 'yes' }).every((host) => !host.includes('onrender')),
)

/* ------------------------------------------------------------- methods --- */

console.log('\nmutating methods are recognised')
for (const method of [
  'create',
  'write',
  'unlink',
  'copy',
  'web_save',
  'action_mark_submitted',
  'action_use_for_report_cards',
  'button_confirm',
  'toggle_active',
]) {
  check(method, isMutatingMethod(method))
}

console.log('\nreads are left alone')
for (const method of [
  'read',
  'search',
  'search_read',
  'search_count',
  'fields_get',
  'read_group',
  'formatted_read_group',
  'has_access',
  'name_search',
]) {
  check(method, !isMutatingMethod(method))
}
check('a non-string method is not a write', !isMutatingMethod(undefined))

/* -------------------------------------------------------------- parsing --- */

console.log('\nhostnames are parsed, not matched as strings')
check('IPv6 brackets are stripped', hostnameOf('http://[::1]:8069') === '::1')
check('case is normalised', hostnameOf('https://EXAMPLE.com') === 'example.com')
check('the port is not part of the host', hostnameOf('http://localhost:8070') === 'localhost')
check(
  'a userinfo prefix does not become the host',
  hostnameOf('https://localhost@evil.com') === 'evil.com',
)

/* ---------------------------------------------------------- integration --- */

/*
  The real claim: rpc.mjs, aimed at production, asked to create a record, sends
  nothing. `fetch` is replaced before the module is imported and fails the run
  if it is called at all, so this cannot pass by the request merely erroring.
*/
console.log('\nrpc.mjs refuses a production write before any HTTP request')

const realFetch = globalThis.fetch
let fetchCalls = []
globalThis.fetch = (...args) => {
  fetchCalls.push(String(args[0]))
  throw new Error('the guard let a request through')
}

process.env.ODOO_BASE_URL = PRODUCTION
process.env.ODOO_DB = 'school'
process.env[WRITABLE_HOSTS_VAR] = 'async-school-staging.onrender.com'
process.env.E2E_ALLOW_WRITES = 'yes'

const { call } = await import('./rpc.mjs')

for (const [model, method, args] of [
  ['school.student', 'create', [{ name: 'GUARD TEST — must never be created' }]],
  ['res.users', 'create', [{ login: 'guard-test' }]],
  ['school.student', 'write', [[1], { name: 'x' }]],
  ['school.subject', 'unlink', [[1]]],
  ['school.student', 'action_mark_submitted', [[1]]],
]) {
  fetchCalls = []
  let message = ''
  try {
    await call(model, method, args)
  } catch (error) {
    message = error.message
  }
  check(`${model}.${method}() is refused`, message.startsWith('Refusing to run'))
  check(`  and no request was sent`, fetchCalls.length === 0, fetchCalls.join(' '))
}

console.log('\nthe refusal explains itself')
let refusal = ''
try {
  assertWritable(PRODUCTION, 'a test', withStaging)
} catch (error) {
  refusal = error.message
}
check('names the blocked host', refusal.includes('async-school-system.onrender.com'))
check('lists what is approved', refusal.includes('localhost'))
check('says how to configure a safe target', refusal.includes(WRITABLE_HOSTS_VAR))
check('says E2E_ALLOW_WRITES cannot override it', refusal.includes('E2E_ALLOW_WRITES'))
check('carries no password', !/password|secret/i.test(refusal))

console.log('\nreads still reach the transport against any host')
fetchCalls = []
try {
  await call('school.student', 'search_count', [[]])
} catch {
  // The spy throws by design; what matters is that the guard did not stop it.
}
check('a read against production is attempted, not blocked', fetchCalls.length === 1)

globalThis.fetch = realFetch

/* ---------------------------------------------------------------- wiring --- */

/*
  A guard that is imported but never called is the failure mode a policy test
  cannot see. These four suites write through the browser, where no client
  guard can reach, so each has to check the destination itself.
*/
console.log('\nevery write-capable suite is wired to the guard')
const { readFileSync } = await import('node:fs')
for (const name of [
  'e2e-assignment-domain.mjs',
  'e2e-report-cards.mjs',
  'e2e-staff-domain.mjs',
  'e2e-teacher-domain.mjs',
]) {
  const source = readFileSync(new URL(name, import.meta.url), 'utf8')
  check(`${name} imports the guard`, source.includes("from './production-guard.mjs'"))
  check(`  guards its own client`, source.includes('if (isMutatingMethod(method)) assertWritable('))
  check(`  checks the destination before writing`, /assertWritable\(ODOO, '/.test(source))
}
const rpc = readFileSync(new URL('rpc.mjs', import.meta.url), 'utf8')
check('rpc.mjs guards call()', /if \(isMutatingMethod\(method\)\) assertWritable\(URL_BASE/.test(rpc))

console.log(
  failures === 0 ? '\nproduction-guard: ok' : `\nproduction-guard: ${failures} FAILED`,
)
process.exit(failures === 0 ? 0 : 1)
