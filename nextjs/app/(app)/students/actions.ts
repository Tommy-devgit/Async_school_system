'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireSession } from '@/lib/odoo/auth'
import { readOne } from '@/lib/odoo/client'
import { toOdooError } from '@/lib/odoo/errors'
// Aliased: this module already has its own `submitted` over the student
// intake fields, which the shared helper should eventually replace.
import { submitted as submittedFields } from '@/lib/form-values'

import { saveAnswer } from '@/lib/odoo/models/registration'
import {
  createGuardian,
  createStudent,
  isUploadable,
  updateGuardian,
  updateStudent,
  uploadStudentDocument,
  type ClassScope,
  type GuardianIntake,
  type GuardianUpdate,
  type StudentIntake,
} from '@/lib/odoo/models/student'

export interface StudentFormState {
  error?: string
  fieldErrors?: Record<string, string>
  values?: Record<string, string>
}

// -------------------------------------------------------
// Upload configuration
// -------------------------------------------------------

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
]

// -------------------------------------------------------
// Student registration
// -------------------------------------------------------

const INTAKE_FIELDS = [
  'name',
  'date_of_birth',
  'gender',
  'place_of_birth',
  'primary_language',
  'national_id',
  'regional_id',
  'email',
  'guardian_name',
  'guardian_phone',
  'guardian_relationship',
  'guardian_occupation',
  'emergency_contact_name',
  'emergency_contact_phone',
  'fan_number',
  'class_id',
  'admission_type',
  'previous_school',
  'transfer_reference',
  'support_need',
  'registration_date',
] as const

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim()
}

function submitted(form: FormData): Record<string, string> {
  return Object.fromEntries(
    INTAKE_FIELDS.map((f) => [f, String(form.get(f) ?? '')]),
  )
}

/**
 * Register a student in Draft.
 *
 * The scope fields Odoo's `_onchange_class_id` would derive —
 * academic year, section, education level, stream — are read
 * back from the chosen class on the server rather than trusted
 * from the browser.
 */
export async function registerStudentAction(
  _previous: StudentFormState,
  form: FormData,
): Promise<StudentFormState> {
  await requireSession()

  const fieldErrors: Record<string, string> = {}

  // -------------------------------------------------------
  // Basic student information
  // -------------------------------------------------------

  const name = text(form, 'name')
  const dob = text(form, 'date_of_birth')
  const placeOfBirth = text(form, 'place_of_birth')
  const primaryLanguage = text(form, 'primary_language')
  const nationalId = text(form, 'national_id')
  const regionalId = text(form, 'regional_id')
  const email = text(form, 'email')
  const gender = text(form, 'gender')

  // -------------------------------------------------------
  // Guardian information
  // -------------------------------------------------------

  const guardianName = text(form, 'guardian_name')
  const guardianPhone = text(form, 'guardian_phone')
  const guardianRelationship = text(
    form,
    'guardian_relationship',
  )
  const guardianOccupation = text(
    form,
    'guardian_occupation',
  )

  // -------------------------------------------------------
  // Emergency contact
  // -------------------------------------------------------

  const emergencyName = text(
    form,
    'emergency_contact_name',
  )

  const emergencyPhone = text(
    form,
    'emergency_contact_phone',
  )

  // -------------------------------------------------------
  // Admission information
  // -------------------------------------------------------

  const classId = Number(text(form, 'class_id'))
  const admissionType = text(form, 'admission_type')
  const previousSchool = text(form, 'previous_school')
  const transferReference = text(
    form,
    'transfer_reference',
  )
  const registrationDate = text(
    form,
    'registration_date',
  )

  // -------------------------------------------------------
  // Other fields
  // -------------------------------------------------------

  const fan = text(form, 'fan_number')
  const supportNeed =
    form.get('support_need') === 'on'

  // -------------------------------------------------------
  // Basic validation
  // -------------------------------------------------------

  if (!name) {
    fieldErrors.name = 'Full name is required.'
  }

  if (!dob) {
    fieldErrors.date_of_birth =
      'Date of birth is required.'
  }

  if (!guardianName) {
    fieldErrors.guardian_name =
      'Parent or guardian name is required.'
  }

  if (!guardianPhone) {
    fieldErrors.guardian_phone =
      'Guardian phone is required.'
  }

  if (!guardianRelationship) {
    fieldErrors.guardian_relationship =
      'Guardian relationship is required.'
  }

  if (!emergencyName) {
    fieldErrors.emergency_contact_name =
      'Emergency contact name is required.'
  }

  if (!emergencyPhone) {
    fieldErrors.emergency_contact_phone =
      'Emergency contact phone is required.'
  }

  if (!classId) {
    fieldErrors.class_id =
      'Choose a grade or class.'
  }

  // FAN format
  if (fan && !/^[0-9]{16}$/.test(fan)) {
    fieldErrors.fan_number =
      'FAN must be exactly 16 digits.'
  }

  // Email format
  if (
    email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    fieldErrors.email =
      'Enter a valid email address.'
  }

  // -------------------------------------------------------
  // Transfer-specific fields
  // -------------------------------------------------------

  if (admissionType === 'transfer') {
    if (!previousSchool) {
      fieldErrors.previous_school =
        'Previous school is required for transfer admission.'
    }

    if (!transferReference) {
      fieldErrors.transfer_reference =
        'Transfer reference is required for transfer admission.'
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      fieldErrors,
      values: submitted(form),
    }
  }

  // -------------------------------------------------------
  // Get class scope from Odoo
  // -------------------------------------------------------

  let scope: ClassScope | null

  try {
    scope = await readOne<ClassScope>(
      'school.class',
      classId,
      [
        'name',
        'academic_year_id',
        'section_id',
        'stream_id',
        'education_level',
        'is_entry_level',
      ],
    )
  } catch (cause) {
    return {
      error: toOdooError(cause).message,
      values: submitted(form),
    }
  }

  if (!scope?.academic_year_id) {
    return {
      error:
        'That class has no academic year, so a student cannot be registered against it.',
      values: submitted(form),
    }
  }

  // -------------------------------------------------------
  // Read uploaded files
  // -------------------------------------------------------

  const birthCertificate = form.get(
    'birth_certificate',
  )

  const previousGradeDocument = form.get(
    'previous_grade_document',
  )

  const photoFile = form.get('photo')

  /*
    Documents are not required to *create* a student, only to submit the
    registration.

    Odoo draws that line itself: `_check_required_fields_for_submission`
    returns early unless `registration_status` is submitted or approved, so a
    draft student with no birth certificate is valid as far as the backend is
    concerned. Requiring one here was a rule the frontend invented, and it made
    registration impossible on a deployment with nowhere to put the files.

    The requirement is not gone — it moves to where Odoo puts it. Attempting to
    submit without the documents still fails, with Odoo's own message naming
    everything that is missing.
  */

  // -------------------------------------------------------
  // Photo validation
  // -------------------------------------------------------

  if (
    photoFile instanceof File &&
    photoFile.size > 0
  ) {
    if (photoFile.type !== 'image/png') {
      fieldErrors.photo =
        'Student photo must be a PNG image.'
    }

    if (photoFile.size > MAX_UPLOAD_BYTES) {
      fieldErrors.photo =
        'Student photo must be smaller than 8 MB.'
    }
  }

  // -------------------------------------------------------
  // Validate documents
  // -------------------------------------------------------

  const validateDocument = (
    file: FormDataEntryValue,
    field: string,
  ) => {
    if (
      !(file instanceof File) ||
      file.size === 0
    ) {
      return
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      fieldErrors[field] =
        'Only PDF, JPG and PNG files are accepted.'
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      fieldErrors[field] =
        'File must be smaller than 8 MB.'
    }
  }

  if (!birthCertificate) {
    return {
      error: 'Please upload a birth certificate.',
      fieldErrors,
      values: submitted(form),
    }
  }

  validateDocument(
    birthCertificate,
    'birth_certificate',
  )

  // Previous grade document is optional for
  // entry-level classes.
  if (
    previousGradeDocument instanceof File &&
    previousGradeDocument.size > 0
  ) {
    validateDocument(
      previousGradeDocument,
      'previous_grade_document',
    )
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      fieldErrors,
      values: submitted(form),
    }
  }

  // -------------------------------------------------------
  // Convert photo to base64
  // -------------------------------------------------------

  let photoBase64: string | undefined

  if (
    photoFile instanceof File &&
    photoFile.size > 0
  ) {
    photoBase64 = Buffer.from(
      await photoFile.arrayBuffer(),
    ).toString('base64')
  }

  // -------------------------------------------------------
  // Build Odoo student intake
  // -------------------------------------------------------

  const intake: StudentIntake = {
    name,
    date_of_birth: dob,

    // Student personal information
    place_of_birth:
      placeOfBirth || undefined,

    primary_language:
      primaryLanguage || undefined,

    national_id:
      nationalId || undefined,

    regional_id:
      regionalId || undefined,

    email:
      email || undefined,

    photo: photoBase64,

    gender:
      gender || undefined,

    // Guardian information
    guardian_name: guardianName,

    guardian_phone: guardianPhone,

    guardian_relationship:
      guardianRelationship || undefined,

    guardian_occupation:
      guardianOccupation || undefined,

    // Emergency contact
    emergency_contact_name:
      emergencyName,

    emergency_contact_phone:
      emergencyPhone,

    // Admission information
    class_id: classId,

    academic_year_id:
      scope.academic_year_id[0],

    section_id: scope.section_id
      ? scope.section_id[0]
      : undefined,

    stream_id: scope.stream_id
      ? scope.stream_id[0]
      : undefined,

    education_level:
      scope.education_level || undefined,

    admission_type:
      admissionType || undefined,

    previous_school:
      previousSchool || undefined,

    transfer_reference:
      transferReference || undefined,

    support_need: supportNeed,

    registration_date:
      registrationDate || undefined,

    fan_number:
      fan || undefined,
  }

  // -------------------------------------------------------
  // Create the student as Draft
  // -------------------------------------------------------

  let id: number

  try {
    id = await createStudent(intake)
  } catch (cause) {
    return {
      error: toOdooError(cause).message,
      values: submitted(form),
    }
  }

  // -------------------------------------------------------
  // Upload registration documents
  // -------------------------------------------------------

  try {
    // The birth certificate is optional at this point, so upload it only when
    // one was actually attached. Sending an empty file made Odoo reject the
    // upload on its extension check — and the student, already created, was
    // reported as a failure.
    if (birthCertificate instanceof File && birthCertificate.size > 0) {
      const birthBase64 = Buffer.from(
        await birthCertificate.arrayBuffer(),
      ).toString('base64')

      await uploadStudentDocument(
        id,
        'birth_certificate',
        birthCertificate.name,
        birthBase64,
      )
    }

    if (
      previousGradeDocument instanceof File &&
      previousGradeDocument.size > 0
    ) {
      const previousGradeBase64 =
        Buffer.from(
          await previousGradeDocument.arrayBuffer(),
        ).toString('base64')

      await uploadStudentDocument(
        id,
        'previous_grade_document',
        previousGradeDocument.name,
        previousGradeBase64,
      )
    }
  } catch (cause) {
    return {
      error:
        `Student was created, but the document upload failed: ` +
        toOdooError(cause).message,
      values: submitted(form),
    }
  }

  revalidatePath('/students')

  redirect(`/students/${id}`)
}

// =======================================================
// Student document upload
// =======================================================

export interface UploadState {
  error?: string
  ok?: string
}

/**
 * Attach a document to a student.
 *
 * The bytes travel Browser → Next.js → Odoo.
 */
export async function uploadStudentDocumentAction(
  _previous: UploadState,
  form: FormData,
): Promise<UploadState> {
  await requireSession()

  const studentId = Number(
    form.get('studentId'),
  )

  const field = String(
    form.get('field') ?? '',
  )

  const file = form.get('file')

  if (
    !Number.isFinite(studentId) ||
    !isUploadable(field)
  ) {
    return {
      error: 'That upload is not available.',
    }
  }

  if (
    !(file instanceof File) ||
    file.size === 0
  ) {
    return {
      error: 'Choose a file to upload.',
    }
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      error: 'That file is larger than 8 MB.',
    }
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      error:
        'Only PDF, JPG and PNG files are accepted.',
    }
  }

  const base64 = Buffer.from(
    await file.arrayBuffer(),
  ).toString('base64')

  try {
    await uploadStudentDocument(
      studentId,
      field,
      file.name,
      base64,
    )
  } catch (cause) {
    return {
      error: toOdooError(cause).message,
    }
  }

  revalidatePath(
    `/students/${studentId}`,
  )

  return {
    ok: `${file.name} attached.`,
  }
}

// =======================================================
// Guardian actions
// =======================================================

const GUARDIAN_EDIT_FIELDS = ['relationship', 'phone', 'occupation', 'is_primary'] as const

export interface GuardianFormState {
  error?: string
  fieldErrors?: Record<string, string>
  values?: Record<string, string>
}

/**
 * Add a guardian to a student.
 *
 * `_check_single_primary` is Odoo's — a second primary
 * contact is rejected by the model.
 */
export async function addGuardianAction(
  _previous: GuardianFormState,
  form: FormData,
): Promise<GuardianFormState> {
  await requireSession()

  const studentId = Number(
    form.get('studentId'),
  )

  const name = String(
    form.get('name') ?? '',
  ).trim()

  const phone = String(
    form.get('phone') ?? '',
  ).trim()

  const relationship = String(
    form.get('relationship') ?? '',
  ).trim()

  const occupation = String(
    form.get('occupation') ?? '',
  ).trim()

  const isPrimary =
    form.get('is_primary') === 'on'

  const values = {
    name,
    phone,
    relationship,
    occupation,
  }

  const fieldErrors: Record<string, string> = {}

  if (!Number.isFinite(studentId)) {
    return {
      error:
        'That student could not be found.',
      values,
    }
  }

  if (!name) {
    fieldErrors.name =
      'Name is required.'
  }

  if (!relationship) {
    fieldErrors.relationship =
      'Relationship is required.'
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      fieldErrors,
      values,
    }
  }

  const intake: GuardianIntake = {
    name,
    relationship,
    phone: phone || undefined,
    occupation:
      occupation || undefined,
    is_primary: isPrimary,
  }

  try {
    await createGuardian(
      studentId,
      intake,
    )
  } catch (cause) {
    return {
      error: toOdooError(cause).message,
      values,
    }
  }

  revalidatePath(
    `/students/${studentId}`,
  )

  return {
    values: {},
  }
}

/**
 * Edit an existing guardian link
 * (relationship, phone, occupation, primary).
 *
 * The contact identity itself (`partner_id`)
 * is not changed here.
 */
export async function editGuardianAction(
  _previous: GuardianFormState,
  form: FormData,
): Promise<GuardianFormState> {
  await requireSession()

  const guardianId = Number(
    form.get('guardianId'),
  )

  const studentId = Number(
    form.get('studentId'),
  )

  if (
    !Number.isFinite(guardianId) ||
    !Number.isFinite(studentId)
  ) {
    return {
      error:
        'That guardian could not be found.',
    }
  }

  const relationship = String(
    form.get('relationship') ?? '',
  ).trim()

  const phone = String(
    form.get('phone') ?? '',
  ).trim()

  const occupation = String(
    form.get('occupation') ?? '',
  ).trim()

  const isPrimary =
    form.get('is_primary') === 'on'

  const values: GuardianUpdate = {
    relationship:
      relationship || undefined,

    phone:
      phone || undefined,

    occupation:
      occupation || undefined,

    is_primary: isPrimary,
  }

  try {
    await updateGuardian(
      guardianId,
      values,
    )
  } catch (cause) {
    // Echoed back: the row re-renders from scratch after a refusal, and a
    // guardian Odoo turned down for a clashing primary should not also cost
    // the phone number that was just corrected.
    return {
      error: toOdooError(cause).message,
      values: submittedFields(form, GUARDIAN_EDIT_FIELDS),
    }
  }

  revalidatePath(
    `/students/${studentId}`,
  )

  return {}
}
// =======================================================
// Student edit
// =======================================================

/**
 * Every field the edit form may offer.
 *
 * Placement (`class_id`, `academic_year_id`, `section_id`, `stream_id`,
 * `education_level`) is absent on purpose — those five have to move together
 * or `_check_registration_scope` refuses the write, and moving a student
 * between classes belongs to the transfer wizard. `regno` and
 * `admission_number` are minted on approval, and the two status fields belong
 * to the workflow panel.
 */
const EDITABLE_STUDENT_FIELDS = [
  'first_name', 'middle_name', 'last_name', 'gender', 'date_of_birth',
  'place_of_birth', 'primary_language', 'email',
  'fan_number', 'national_id', 'regional_id',
  'guardian_name', 'guardian_phone', 'guardian_relationship', 'guardian_occupation',
  'emergency_contact_name', 'emergency_contact_phone',
  'admission_type', 'previous_school', 'transfer_reference',
  'registration_date', 'support_need',
] as const

const BOOLEAN_STUDENT_FIELDS = new Set<string>(['support_need'])

/**
 * A cleared checkbox posts nothing, which is indistinguishable from a field
 * the form never rendered. The edit form pairs each checkbox with a hidden
 * input of the same name, so the last value posted is the real one.
 */
function checked(form: FormData, key: string): boolean {
  return String(form.getAll(key).at(-1) ?? '') === 'true'
}

function submittedStudent(form: FormData): Record<string, string> {
  return Object.fromEntries(
    EDITABLE_STUDENT_FIELDS.map((f) => [
      f,
      BOOLEAN_STUDENT_FIELDS.has(f)
        ? String(checked(form, f))
        : String(form.get(f) ?? ''),
    ]),
  )
}

/** Mirrors school.student's own required fields so the user hears sooner. */
const REQUIRED_STUDENT_FIELDS: Record<string, string> = {
  first_name: 'First name is required.',
  date_of_birth: 'Date of birth is required.',
  registration_date: 'Registration date is required.',
  guardian_name: 'Parent or guardian name is required.',
  guardian_phone: 'Guardian phone is required.',
  emergency_contact_name: 'Emergency contact name is required.',
  emergency_contact_phone: 'Emergency contact phone is required.',
}

/**
 * Correct an existing registration.
 *
 * Only the fields the form actually rendered are written. The page builds that
 * list from `fields_get`, so a role without the registrar groups never posts
 * `fan_number` or `national_id` and the write never mentions them.
 */
export async function updateStudentAction(
  _previous: StudentFormState,
  form: FormData,
): Promise<StudentFormState> {
  await requireSession()

  const id = Number(text(form, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    return { error: 'That student could not be identified.' }
  }

  const fieldErrors: Record<string, string> = {}
  const values: Record<string, unknown> = {}

  for (const field of EDITABLE_STUDENT_FIELDS) {
    if (!form.has(field)) continue
    if (BOOLEAN_STUDENT_FIELDS.has(field)) {
      values[field] = checked(form, field)
      continue
    }
    const raw = text(form, field)
    if (!raw && REQUIRED_STUDENT_FIELDS[field]) {
      fieldErrors[field] = REQUIRED_STUDENT_FIELDS[field]
    }
    values[field] = raw || false
  }

  const fan = text(form, 'fan_number')
  if (form.has('fan_number') && fan && !/^[0-9]{16}$/.test(fan)) {
    fieldErrors.fan_number = 'FAN must be exactly 16 digits.'
  }

  const email = text(form, 'email')
  if (form.has('email') && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fieldErrors.email = 'Enter a valid email address.'
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, values: submittedStudent(form) }
  }

  try {
    await updateStudent(id, values)
  } catch (cause) {
    // The age-for-grade rule, the duplicate FAN, the phone format — Odoo's
    // own wording, which names the record and the rule.
    return { error: toOdooError(cause).message, values: submittedStudent(form) }
  }

  revalidatePath(`/students/${id}`)
  revalidatePath('/students')
  redirect(`/students/${id}`)
}

// =======================================================
// Registration questionnaire
// =======================================================

/*
  The questionnaire's field names are per question — `option-41`, `text-41` —
  so the echo cannot be a fixed tuple the way every other form's is. Whatever
  the form submitted under those two prefixes is what comes back.
*/
function submittedAnswers(form: FormData): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [key, value] of form.entries()) {
    if (typeof value !== 'string') continue
    if (key.startsWith('option-') || key.startsWith('text-')) values[key] = value
  }
  return values
}

export interface AnswerState {
  error?: string
  ok?: string
  /** Every answer as submitted, keyed `option-<id>` / `text-<id>`. */
  values?: Record<string, string>
}

/**
 * Record the student's questionnaire answers.
 *
 * `_validate_submission_requirements` refuses a submission naming every
 * applicable required question left unanswered, and an answer counts only when
 * `value_text` or `option_id` is set — a blank one does not clear the refusal.
 *
 * `unique(student_id, question_id)` means each answer is created once and
 * written thereafter, so the form posts the existing id when there is one.
 * Only questions the page rendered are touched.
 */
export async function saveAnswersAction(
  _previous: AnswerState,
  form: FormData,
): Promise<AnswerState> {
  await requireSession()

  const studentId = Number(String(form.get('studentId') ?? ''))
  if (!Number.isInteger(studentId) || studentId <= 0) {
    return { error: 'That student could not be found.' }
  }

  const questionIds = form
    .getAll('questionId')
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)

  let saved = 0
  for (const questionId of questionIds) {
    const existing = Number(String(form.get(`answerId-${questionId}`) ?? ''))
    const optionRaw = String(form.get(`option-${questionId}`) ?? '').trim()
    const textRaw = String(form.get(`text-${questionId}`) ?? '').trim()
    const wasOption = String(form.get(`was-option-${questionId}`) ?? '').trim()
    const wasText = String(form.get(`was-text-${questionId}`) ?? '').trim()

    // Only what actually moved is written, so re-saving an untouched form is
    // not a hundred pointless writes.
    if (optionRaw === wasOption && textRaw === wasText) continue

    try {
      await saveAnswer(studentId, questionId, {
        id: Number.isInteger(existing) && existing > 0 ? existing : undefined,
        value_text: textRaw || false,
        option_id: optionRaw ? Number(optionRaw) : false,
      })
      saved += 1
    } catch (cause) {
      /*
        Odoo refused one answer, and the ones before it in this loop are
        already written. So the whole roster is echoed back: without it the
        page re-renders from the record and every answer *after* the refusal
        silently reverts to what was stored, which reads as though it saved.
      */
      return { error: toOdooError(cause).message, values: submittedAnswers(form) }
    }
  }

  if (saved === 0) return { ok: 'Nothing had changed.' }

  revalidatePath(`/students/${studentId}`)
  return { ok: `Saved ${saved} ${saved === 1 ? 'answer' : 'answers'}.` }
}
