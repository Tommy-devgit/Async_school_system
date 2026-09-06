/** Run: node scripts/test-form-values.mjs */
import assert from 'node:assert/strict'
import { isEmail, relationalId, submitted, submittedList } from '../lib/form-values.ts'

function scenario(name, run) {
  run()
  console.log(`  ok — ${name}`)
}

scenario('every listed field comes back', () => {
  const form = new FormData()
  form.set('first_name', 'Almaz')
  form.set('last_name', 'Bekele')
  assert.deepEqual(submitted(form, ['first_name', 'last_name']), {
    first_name: 'Almaz',
    last_name: 'Bekele',
  })
})

scenario('a field that was not submitted is empty, not missing', () => {
  // The form still has to render every input, so every key must exist.
  const form = new FormData()
  form.set('first_name', 'Almaz')
  assert.deepEqual(submitted(form, ['first_name', 'middle_name']), {
    first_name: 'Almaz',
    middle_name: '',
  })
})

scenario('an unlisted field is not echoed', () => {
  const form = new FormData()
  form.set('login', 'teacher@example.invalid')
  form.set('password', 'not-for-the-browser')
  assert.deepEqual(submitted(form, ['login']), { login: 'teacher@example.invalid' })
})

scenario('a checked box reads back as on and an unchecked one as empty', () => {
  const checked = new FormData()
  checked.set('is_primary', 'on')
  assert.equal(submitted(checked, ['is_primary']).is_primary, 'on')
  assert.equal(submitted(new FormData(), ['is_primary']).is_primary, '')
})

scenario('what was typed is echoed exactly, spaces and all', () => {
  // Validation trims for its own purposes. The form must show the user what
  // they actually typed, or a stray leading space becomes invisible.
  const form = new FormData()
  form.set('fayda_id', '  1234 5678  ')
  assert.equal(submitted(form, ['fayda_id']).fayda_id, '  1234 5678  ')
})

scenario('zero is a value, not an absence', () => {
  const form = new FormData()
  form.set('credit_hours', '0')
  assert.equal(submitted(form, ['credit_hours']).credit_hours, '0')
})

scenario('a file cannot be echoed and does not become "[object File]"', () => {
  const form = new FormData()
  form.set('document', new File(['x'], 'transcript.pdf'))
  assert.equal(submitted(form, ['document']).document, '')
})

scenario('a repeated name keeps every value, not just the first', () => {
  const form = new FormData()
  for (const id of ['4', '7', '9']) form.append('gradeIds', id)
  assert.deepEqual(submittedList(form, ['gradeIds']), { gradeIds: ['4', '7', '9'] })
})

scenario('a repeated name that was never submitted is an empty list', () => {
  assert.deepEqual(submittedList(new FormData(), ['gradeIds']), { gradeIds: [] })
})

scenario('submitted() would have kept only the first, which is why the pair exists', () => {
  const form = new FormData()
  for (const id of ['4', '7', '9']) form.append('gradeIds', id)
  assert.equal(submitted(form, ['gradeIds']).gradeIds, '4')
  assert.equal(submittedList(form, ['gradeIds']).gradeIds.length, 3)
})

scenario('a relational id parses to an integer', () => {
  assert.equal(relationalId('42'), 42)
})

scenario('an empty relational id clears the field', () => {
  // Odoo wants false, not null and not 0 — this is how a many2one is unset.
  assert.equal(relationalId(''), false)
})

scenario('a non-numeric relational id is refused, not silently cleared', () => {
  // The bug this guards: Number('abc') is NaN, NaN serialises to null, and
  // Odoo reads null as false — so the write used to clear the relation.
  assert.equal(relationalId('abc'), null)
  assert.equal(relationalId('7abc'), null)
})

scenario('a relational id that is not a positive whole number is refused', () => {
  for (const raw of ['0', '-3', '1.5', 'Infinity', 'NaN', '1e999']) {
    assert.equal(relationalId(raw), null, `expected ${raw} to be refused`)
  }
})

scenario('an ordinary address passes', () => {
  for (const value of ['t@example.et', 'first.last+tag@sub.example.co.uk']) {
    assert.equal(isEmail(value), true, value)
  }
})

scenario('a malformed address is refused before it becomes a login', () => {
  for (const value of ['plain', 'no@domain', 'two@@at.et', 'sp ace@example.et', '@example.et']) {
    assert.equal(isEmail(value), false, value)
  }
})

console.log('form-values: ok')
