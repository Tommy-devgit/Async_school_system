import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/odoo/auth'
import { toOdooError } from '@/lib/odoo/errors'
import { fileSource, readDocumentFile, readStoredFile } from '@/lib/odoo/models/files'

/**
 * Serve one stored document to the person allowed to see it.
 *
 * `requireSession()` first, so an unauthenticated request is redirected rather
 * than answered. The read then happens as that user: Odoo evaluates the
 * field-level group and the record rules, and a role without them gets an
 * AccessError which is reported here as 403. Nothing is served that the same
 * user could not have read through the ORM.
 *
 * The URL names a kind and a field — `/api/files/student/12/birth_certificate`
 * — and both are resolved against the table in lib/odoo/models/files.ts. An
 * unknown pair is 404 before Odoo is contacted, so this cannot be pointed at an
 * arbitrary model, field or attachment id.
 *
 * `Content-Disposition: inline` so a PDF or an image opens in the browser
 * rather than landing in the downloads folder; the filename is still sent, so
 * saving it keeps the name it was uploaded under.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; id: string; field: string }> },
) {
  await requireSession()

  const { kind, id, field } = await params
  const recordId = Number(id)

  if (!Number.isInteger(recordId) || recordId <= 0) {
    return NextResponse.json({ error: 'Invalid record id.' }, { status: 400 })
  }

  /*
    `document` is the one kind that is a record rather than a field on a person,
    so it carries no field name — the URL keeps the same shape for every kind by
    passing `file`, and anything else is refused rather than quietly ignored.
  */
  const isDocument = kind === 'document'
  const source = isDocument ? null : fileSource(kind, field)

  if (!isDocument && !source) {
    return NextResponse.json({ error: 'Unknown document.' }, { status: 404 })
  }
  if (isDocument && field !== 'file') {
    return NextResponse.json({ error: 'Unknown document.' }, { status: 404 })
  }

  try {
    const stored = isDocument
      ? await readDocumentFile(recordId)
      : await readStoredFile(source!, recordId)

    if (!stored) {
      return NextResponse.json({ error: 'No file is attached.' }, { status: 404 })
    }

    return new NextResponse(new Uint8Array(stored.bytes), {
      status: 200,
      headers: {
        'Content-Type': stored.mimetype,
        'Content-Length': String(stored.bytes.length),
        'Content-Disposition': `inline; filename="${stored.filename.replace(/"/g, '')}"`,
        /*
          Personal records. A shared cache must never hold a birth certificate,
          and a browser re-checking is cheaper than a stale one showing the
          previous student's file after a Replace.
        */
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (cause) {
    const error = toOdooError(cause)
    return NextResponse.json({ error: error.message }, { status: error.status || 502 })
  }
}
