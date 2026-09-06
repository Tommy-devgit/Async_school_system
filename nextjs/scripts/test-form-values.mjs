/** Run: node scripts/test-form-values.mjs */
import assert from 'node:assert/strict'
import { submitted } from '../lib/form-values.ts'

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

console.log('form-values: ok')
