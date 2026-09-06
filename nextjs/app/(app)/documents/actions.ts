'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/odoo/auth'
import { toOdooError } from '@/lib/odoo/errors'
import { submitted } from '@/lib/form-values'
import { createDocument } from '@/lib/odoo/models/operations'

/**
 * Filing a document.
 *
 * The screen could list documents, open them, verify and reject them — and
 * never take one in. An approval queue with no intake is only half a workflow:
 * every row in it had to be created in Odoo's own back office.
 */

const FIELDS = ['name', 'documentTypeId', 'ownerKind', 'studentId', 'staffId', 'expiryDate'] as const

export interface DocumentFormState {
  error?: string
  fieldErrors?: Record<string, string>
  /** Echoed back so a refusal does not empty the form; the file cannot be. */
  values?: Record<(typeof FIELDS)[number], string>
}

/** Matches the student upload path — Odoo stores these inline, base64. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png']

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim()

export async function uploadDocumentAction(
  _previous: DocumentFormState,
  form: FormData,
): Promise<DocumentFormState> {
  await requireSession()

  const echo = { values: submitted(form, FIELDS) }
  const fieldErrors: Record<string, string> = {}

  const name = text(form, 'name')
  if (!name) fieldErrors.name = 'Give the document a name.'

  const documentTypeId = Number(text(form, 'documentTypeId'))
  if (!Number.isInteger(documentTypeId) || documentTypeId <= 0) {
    fieldErrors.documentTypeId = 'Choose a document type.'
  }

  /*
    Exactly one owner. `_check_owner` refuses a document with none or with more
    than one, and says so — but the form should not be able to send a shape
    Odoo has already ruled out.
  */
  const ownerKind = text(form, 'ownerKind')
  const studentId = Number(text(form, 'studentId'))
  const staffId = Number(text(form, 'staffId'))

  let owner: { student_id: number } | { staff_id: number } | null = null
  if (ownerKind === 'student') {
    if (Number.isInteger(studentId) && studentId > 0) owner = { student_id: studentId }
    else fieldErrors.studentId = 'Choose the student this belongs to.'
  } else if (ownerKind === 'staff') {
    if (Number.isInteger(staffId) && staffId > 0) owner = { staff_id: staffId }
    else fieldErrors.staffId = 'Choose the staff member this belongs to.'
  } else {
    fieldErrors.ownerKind = 'Say whether this belongs to a student or a staff member.'
  }

  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    fieldErrors.file = 'Choose a file to upload.'
  } else if (file.size > MAX_UPLOAD_BYTES) {
    fieldErrors.file = 'That file is larger than 8 MB.'
  } else if (!ALLOWED_TYPES.includes(file.type)) {
    fieldErrors.file = 'Only PDF, JPG and PNG files are accepted.'
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors, ...echo }

  const upload = file as File
  const data = Buffer.from(await upload.arrayBuffer()).toString('base64')

  let id: number
  try {
    id = await createDocument({
      name,
      documentTypeId,
      owner: owner!,
      fileName: upload.name,
      data,
      mimetype: upload.type,
      expiryDate: text(form, 'expiryDate'),
    })
  } catch (cause) {
    return { error: toOdooError(cause).message, ...echo }
  }

  revalidatePath('/documents')
  redirect(`/documents/${id}`)
}
