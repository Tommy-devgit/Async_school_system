/**
 * A direct Odoo session, so a test can check what was actually written rather
 * than what the page claims. Reading the UI to verify the UI has produced
 * three false results on this project already.
 *
 *   node scripts/rpc.mjs <model> <method> '<json args>' '<json kwargs>'
 *
 * Env: ODOO_BASE_URL, ODOO_DB, ODOO_LOGIN, ODOO_PASSWORD
 *
 * Reads go anywhere. Writes go only where scripts/production-guard.mjs says
 * they may — this client can create and delete res.users and school.student
 * rows, and ODOO_BASE_URL is one stale shell variable away from production.
 */
import { assertWritable, isMutatingMethod } from './production-guard.mjs'

const URL_BASE = process.env.ODOO_BASE_URL ?? 'http://localhost:8090'
const DB = process.env.ODOO_DB ?? 'school19'
const LOGIN = process.env.ODOO_LOGIN
const PASSWORD = process.env.ODOO_PASSWORD

let cookie = ''
async function jsonrpc(path, params) {
  const res = await fetch(`${URL_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params }),
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  const body = await res.json()
  if (body.error) throw new Error(JSON.stringify(body.error.data?.message ?? body.error))
  return body.result
}

export async function login() {
  if (!LOGIN || !PASSWORD) {
    throw new Error('Set ODOO_LOGIN and ODOO_PASSWORD before running this script.')
  }
  return jsonrpc('/web/session/authenticate', { db: DB, login: LOGIN, password: PASSWORD })
}

export async function call(model, method, args = [], kwargs = {}) {
  // Before the request, not after: a refused write must never reach the wire.
  if (isMutatingMethod(method)) assertWritable(URL_BASE, `${model}.${method}()`)
  return jsonrpc('/web/dataset/call_kw', { model, method, args, kwargs })
}

if (process.argv[1]?.endsWith('rpc.mjs')) {
  await login()
  const [, , model, method, args = '[]', kwargs = '{}'] = process.argv
  console.log(JSON.stringify(await call(model, method, JSON.parse(args), JSON.parse(kwargs)), null, 2))
}
