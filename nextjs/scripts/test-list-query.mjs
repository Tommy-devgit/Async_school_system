/** Run: node scripts/test-list-query.mjs */
import assert from 'node:assert/strict'
import { parseListQuery, toOdooOrder } from '../lib/list-query.ts'

function scenario(name, run) {
  run()
  console.log(`  ok — ${name}`)
}

const opts = { sortFields: ['name', 'id'], defaultSort: { field: 'name', direction: 'asc' }, pageSize: 25 }

scenario('a whole page number becomes an exact offset', () => {
  assert.equal(parseListQuery({ page: '3' }, opts).offset, 50)
})

scenario('a fractional page cannot reach Odoo as a fractional offset', () => {
  // OFFSET 12.5 is not a thing; the page is floored before the multiply.
  const q = parseListQuery({ page: '1.5' }, opts)
  assert.equal(q.page, 1)
  assert.equal(Number.isInteger(q.offset), true)
  assert.equal(q.offset, 0)
})

scenario('a page below one is pulled back to the first', () => {
  for (const page of ['-3', '0', '-0.5']) {
    assert.equal(parseListQuery({ page }, opts).page, 1, page)
  }
})

scenario('an unparseable page is the first page, not NaN', () => {
  for (const page of ['abc', '', ' ']) {
    assert.equal(parseListQuery({ page }, opts).page, 1, JSON.stringify(page))
  }
})

scenario('an enormous page is capped, so the offset stays a finite integer', () => {
  // Infinity has no JSON form and would reach Odoo as null, quietly serving
  // page one to somebody who asked for something else entirely.
  for (const page of ['1e400', 'Infinity', '99999999999999999999']) {
    const q = parseListQuery({ page }, opts)
    assert.equal(Number.isFinite(q.offset), true, page)
    assert.equal(Number.isInteger(q.offset), true, page)
  }
})

scenario('only an allowlisted field can order the query', () => {
  assert.equal(toOdooOrder(parseListQuery({ sort: 'name:desc' }, opts)), 'name desc')
  // Anything else falls back to the screen's own default.
  assert.equal(toOdooOrder(parseListQuery({ sort: "id;DROP TABLE--:asc" }, opts)), 'name asc')
  assert.equal(toOdooOrder(parseListQuery({ sort: 'password:asc' }, opts)), 'name asc')
})

scenario('an unrecognised direction falls back rather than reaching SQL', () => {
  assert.equal(toOdooOrder(parseListQuery({ sort: 'name:sideways' }, opts)), 'name asc')
})

scenario('only declared filter keys survive the URL', () => {
  const q = parseListQuery({ status: 'draft', evil: 'x' }, { ...opts, filterKeys: ['status'] })
  assert.deepEqual(q.filters, { status: 'draft' })
})

console.log('list-query: ok')
