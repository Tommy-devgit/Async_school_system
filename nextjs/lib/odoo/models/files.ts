import 'server-only'

import { callKw } from '@/lib/odoo/client'
import type { Many2one } from '@/lib/odoo/types'
import { m2oId } from '@/lib/odoo/types'

/**
 * Serving a stored document back to the person who uploaded it.
 *
 * Every one of these binaries is a `fields.Binary(attachment=True)` carrying a
 * field-level group, so the payload lives in `ir.attachment` and Odoo refuses
 * to read the field at all for a role without that group. The app could not
 * show them because nothing here ever fetched one: the student screen printed
 * the filename and offered Replace, which told a registrar a birth certificate
 * existed and gave them no way to look at it.
 *
 * **The browser names a kind and a record, never an attachment.** Handing
 * `/web/content/<id>` an id from the query string would let anyone walk every
 * attachment in the database — Odoo would still authorise each read, but the
 * app would be inviting the attempt. A key resolved here against a fixed table
 * cannot address anything that is not on it, which is the same rule the
 * workflow and removal allowlists follow.
 *
 * Authorisation is still Odoo's. This asks for the field as the signed-in user
 * and lets the AccessError through untouched when the group is missing.
 */

export interface FileSource {
  /** The Odoo model holding the binary. */
  model: string
  /** The binary field itself. */
  field: string
  /** The char field holding the name the file was uploaded under. */
  filenameField: string
  /** What to call it in the interface. */
  label: string
  /** Where a reader would have come from, for the error page's way back. */
  backTo: (id: number) => string
}

/**
 * Every binary this app will serve, by `kind/field`.
 *
 * `school.teacher` carries two of its own rather than reusing the staff
 * record's: a teaching qualification belongs to the teaching profile, and the
 * model keeps them apart, so this does too.
 */
export const FILE_SOURCES: Record<string, FileSource> = {
  'student/birth_certificate': {
    model: 'school.student',
    field: 'birth_certificate',
    filenameField: 'birth_certificate_filename',
    label: 'Birth certificate',
    backTo: (id) => `/students/${id}`,
  },
  'student/previous_grade_document': {
    model: 'school.student',
    field: 'previous_grade_document',
    filenameField: 'previous_grade_document_filename',
    label: 'Previous grade document',
    backTo: (id) => `/students/${id}`,
  },
  'staff/id_document': {
    model: 'school.staff',
    field: 'id_document',
    filenameField: 'id_document_filename',
    label: 'ID document',
    backTo: (id) => `/staff/${id}`,
  },
  'staff/qualification_document': {
    model: 'school.staff',
    field: 'qualification_document',
    filenameField: 'qualification_document_filename',
    label: 'Qualification',
    backTo: (id) => `/staff/${id}`,
  },
  'staff/employment_contract': {
    model: 'school.staff',
    field: 'employment_contract',
    filenameField: 'employment_contract_filename',
    label: 'Employment contract',
    backTo: (id) => `/staff/${id}`,
  },
  'teacher/qualification_document': {
    model: 'school.teacher',
    field: 'qualification_document',
    filenameField: 'qualification_document_filename',
    label: 'Qualification',
    backTo: (id) => `/teachers/${id}`,
  },
  'teacher/employment_document': {
    model: 'school.teacher',
    field: 'employment_document',
    filenameField: 'employment_document_filename',
    label: 'Employment document',
    backTo: (id) => `/teachers/${id}`,
  },
}

export function fileSource(kind: string, field: string): FileSource | null {
  return FILE_SOURCES[`${kind}/${field}`] ?? null
}

export interface StoredFile {
  /** Raw bytes, already decoded from the base64 Odoo returns. */
  bytes: Buffer
  filename: string
  mimetype: string
}

/**
 * Guess a content type from the name the file was uploaded under.
 *
 * Odoo records a mimetype on the attachment, but a binary field read returns
 * only the payload, and asking for the attachment row separately means naming
 * `ir.attachment` — the thing this module exists to avoid. The upload form
 * accepts PDF, JPEG and PNG, so the list is short and the fallback is the one
 * that makes a browser download rather than guess.
 */
function mimetypeOf(filename: string): string {
  const extension = filename.toLowerCase().split('.').pop() ?? ''
  return (
    {
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      txt: 'text/plain; charset=utf-8',
    }[extension] ?? 'application/octet-stream'
  )
}

/**
 * Read one stored binary as the signed-in user.
 *
 * Returns null when the record exists but the field is empty. A refusal is not
 * a null — the AccessError propagates, because "you may not see this" and
 * "there is nothing here" are different answers and the caller renders them
 * differently.
 */
export async function readStoredFile(
  source: FileSource,
  recordId: number,
): Promise<StoredFile | null> {
  const rows = await callKw<Array<Record<string, unknown>>>(source.model, 'read', [
    [recordId],
    [source.field, source.filenameField],
  ])

  const row = rows[0]
  if (!row) return null

  const payload = row[source.field]
  if (typeof payload !== 'string' || payload.length === 0) return null

  const stored = row[source.filenameField]
  const filename = typeof stored === 'string' && stored ? stored : `${source.field}`

  return {
    bytes: Buffer.from(payload, 'base64'),
    filename,
    mimetype: mimetypeOf(filename),
  }
}

/**
 * The attachment behind a `school.document`.
 *
 * This one is a record in its own right rather than a field on a person, so it
 * is resolved separately: read the document to find its attachment, then read
 * the attachment's payload. Both reads are the user's, so a document outside
 * their scope refuses at the first of them.
 */
export async function readDocumentFile(documentId: number): Promise<StoredFile | null> {
  const documents = await callKw<Array<{ attachment_id: Many2one; name: string }>>(
    'school.document',
    'read',
    [[documentId], ['attachment_id', 'name']],
  )

  const document = documents[0]
  if (!document) return null

  const attachmentId = m2oId(document.attachment_id)
  if (attachmentId === null) return null

  const attachments = await callKw<Array<{ datas: string | false; name: string; mimetype: string | false }>>(
    'ir.attachment',
    'read',
    [[attachmentId], ['datas', 'name', 'mimetype']],
  )

  const attachment = attachments[0]
  if (!attachment || typeof attachment.datas !== 'string' || !attachment.datas) return null

  const filename = attachment.name || document.name
  return {
    bytes: Buffer.from(attachment.datas, 'base64'),
    filename,
    // The attachment row knows its own type here, so no guessing is needed.
    mimetype: attachment.mimetype || mimetypeOf(filename),
  }
}
