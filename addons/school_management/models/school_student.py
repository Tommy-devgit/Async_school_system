import re
import math
import os
from dateutil.relativedelta import relativedelta

from odoo import api, fields, models  # type: ignore
from odoo.exceptions import ValidationError  # type: ignore


class SchoolStudent(models.Model):
    _name = 'school.student'
    _description = 'Student Registration'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'name'

    regno = fields.Char(string='Student ID', copy=False, readonly=True, index=True)
    admission_number = fields.Char(copy=False, readonly=True, index=True)
    name = fields.Char(string='Full Name', compute='_compute_name', inverse='_inverse_name', store=True, index=True)
    first_name = fields.Char()
    middle_name = fields.Char()
    last_name = fields.Char()
    photo = fields.Image(max_width=512, max_height=512)
    date_of_birth = fields.Date(string='Date of Birth', required=True)
    place_of_birth = fields.Char()
    age = fields.Integer(string='Age', compute='_compute_age', store=True)
    gender = fields.Selection([
        ('male', 'Male'),
        ('female', 'Female'),
        ('other', 'Other'),
    ], string='Gender')
    nationality_id = fields.Many2one('res.country', string='Nationality')
    primary_language = fields.Char()
    national_id = fields.Char(groups='school_management.group_school_registrar')
    fan_number = fields.Char(string='FAN (National ID)', groups='school_management.group_school_registrar,school_management.group_school_admin')
    regional_id = fields.Char(groups='school_management.group_school_registrar')
    email = fields.Char()

    guardian_name = fields.Char(string='Parent / Guardian Name', required=True)
    guardian_phone = fields.Char(string='Guardian Phone', required=True,
                                  help='Enter local number or include + with country code.')
    guardian_relationship = fields.Selection([
    ('father', 'Father'),
    ('mother', 'Mother'),
    ('guardian', 'Guardian'),
    ('other', 'Other'),
    ], string='Guardian Relationship', default='guardian')
    guardian_occupation = fields.Char(string='Guardian Occupation')
    address = fields.Text(string='Address')
    emergency_contact_name = fields.Char(string='Emergency Contact Name', required=True)
    emergency_contact_phone = fields.Char(string='Emergency Contact Phone', required=True,
                                       help='Enter local number or include + with country code.')
    education_level = fields.Selection([
        ('kindergarten', 'Kindergarten'),
        ('primary', 'Primary'),
        ('secondary', 'Secondary'),
        ('high_school', 'High School'),
    ], string='Education Level')

    admission_type = fields.Selection([
        ('new', 'New'),
        ('transfer', 'Transfer'),
        ('returning', 'Returning'),
        ('readmitted', 'Re-admitted'),
    ], string='Admission Type', default='new')

    class_id = fields.Many2one(
        'school.class',
        string='Grade / Class',
        required=True,
        domain="[('academic_year_id', '=', academic_year_id), '|', ('education_level', '=', False), ('education_level', '=', education_level)]"
    )
    class_grade_level = fields.Selection(
        related='class_id.grade_id.level', string='Grade Level', readonly=True,
    )
    academic_year_id = fields.Many2one(
            'school.academic.year',
            string="Academic Year",
            required=True,
            default=lambda self: self.env['school.academic.year'].search([('is_current', '=', True)], limit=1)
        )
    section_id = fields.Many2one(
        'school.section',
        string="Section",
        readonly=True,
    )
    registration_status = fields.Selection([
        ('draft', 'Draft'),
        ('pending_verification', 'Pending Verification'),
        ('incomplete', 'Incomplete (Legacy)'),
        ('submitted', 'Submitted'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ], string='Registration Status', default='draft')
    registration_date = fields.Date(string='Registration Date', default=lambda self: fields.Date.context_today(self), required=True)
    responsible_staff_id = fields.Many2one('res.users', string='Responsible Staff', default=lambda self: self.env.user)
    previous_school = fields.Char(string='Previous School')
    transfer_reference = fields.Char(string='Transfer Evidence Reference')
    support_need = fields.Boolean(string='Requires Learning / Medical Support')
    stream_id = fields.Many2one('school.stream', ondelete='restrict')
    candidate_number = fields.Char(string='Grade 12 Candidate Number')
    candidate_registration_date = fields.Date(string='Candidate Registration Date')
    lifecycle_status = fields.Selection([
        ('applicant', 'Applicant'), ('active', 'Active'), ('withdrawn', 'Withdrawn'),
        ('transferred_out', 'Transferred Out'), ('completed', 'Completed'),
        ('graduated', 'Graduated'), ('inactive', 'Inactive'),
    ], default='applicant', required=True, tracking=True)
    notes = fields.Text(string='Notes')

    birth_certificate = fields.Binary(
        string='Birth Certificate', attachment=True,
        groups='school_management.group_school_registrar')
    birth_certificate_filename = fields.Char(string='Birth Certificate Filename')
    previous_grade_document = fields.Binary(
        string='Previous Grade Document', attachment=True,
        groups='school_management.group_school_registrar')
    previous_grade_document_filename = fields.Char(string='Previous Grade Document Filename')

    active = fields.Boolean(string='Active', default=True)

    enrollment_ids = fields.One2many('school.enrollment', 'student_id', string='Enrollments')
    enrollment_count = fields.Integer(compute='_compute_enrollment_count')
    guardian_ids = fields.One2many('school.student.guardian', 'student_id', string='Guardians')
    registration_answer_ids = fields.One2many(
        'school.registration.answer', 'student_id', string='Questionnaire')

    _regno_unique = models.Constraint(
        'unique(regno)',
        'Registration number must be unique.',
    )
    _admission_number_unique = models.Constraint(
        'unique(admission_number)',
        'Admission number must be unique.',
    )
    _fan_number_unique = models.Constraint(
    'unique(fan_number)',
    'This FAN (National ID) is already registered to another student.',
)

    @api.onchange('academic_year_id', 'education_level')
    def _onchange_registration_scope(self):
        for rec in self:
            if rec.class_id and (
                    rec.class_id.academic_year_id != rec.academic_year_id
                    or (rec.education_level and rec.class_id.education_level
                        and rec.class_id.education_level != rec.education_level)):
                rec.class_id = False
                rec.section_id = False

    @api.onchange('class_id')
    def _onchange_class_id(self):
        for rec in self.filtered('class_id'):
            rec.academic_year_id = rec.class_id.academic_year_id
            rec.section_id = rec.class_id.section_id
            if rec.class_id.education_level:
                rec.education_level = rec.class_id.education_level
            if rec.class_id.stream_id:
                rec.stream_id = rec.class_id.stream_id

    @api.constrains('class_id', 'academic_year_id', 'section_id', 'education_level')
    def _check_registration_scope(self):
        for rec in self.filtered('class_id'):
            if rec.class_id.academic_year_id != rec.academic_year_id:
                raise ValidationError(
                    'The Grade / Class must belong to the selected academic year.')
            if rec.section_id and rec.section_id != rec.class_id.section_id:
                raise ValidationError('The section must match the selected Grade / Class.')
            if rec.education_level and rec.class_id.education_level \
                    and rec.education_level != rec.class_id.education_level:
                raise ValidationError(
                    'The education level must match the selected Grade / Class.')

    @api.constrains('class_id', 'stream_id')
    def _check_stream_grade(self):
        for rec in self.filtered('stream_id'):
            if not rec.class_id.grade_id \
                    or rec.class_id.grade_id.level not in ('11', '12'):
                raise ValidationError(
                    'Academic streams are only available for Grades 11 and 12.')
            if rec.class_id.stream_id and rec.stream_id != rec.class_id.stream_id:
                raise ValidationError('The student stream must match the selected class stream.')

    _FAN_RE = re.compile(r'^\d{16}$')
    _EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
    _PHONE_CHARS_RE = re.compile(r'^\+?[\d\s\-]+$')

    @api.constrains('fan_number')
    def _check_fan_format(self):
        for rec in self.filtered('fan_number'):
            if not self._FAN_RE.match(rec.fan_number):
                raise ValidationError("FAN (National ID) must be exactly 16 digits.")
    @api.constrains('email')
    def _check_email_format(self):
        for rec in self.filtered('email'):
            if not self._EMAIL_RE.match(rec.email.strip()):
                raise ValidationError("Please enter a valid email address.")
                

    @api.constrains('emergency_contact_phone')
    def _check_emergency_contact_phone(self):
        for rec in self.filtered('emergency_contact_phone'):
            raw = rec.emergency_contact_phone.strip()
            if not self._PHONE_CHARS_RE.match(raw):
                raise ValidationError(
                    "Emergency Contact Phone must contain only numbers "
                    "(optionally with +, spaces, or dashes) — no letters."
                )
            if not rec._is_valid_phone(raw):
                raise ValidationError(
                    "Emergency Contact Phone is invalid — set Nationality for automatic "
                    "country code, or include + code manually."
                )
                        
    BASE_GRADE1_AGE = 6
    ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png']

    @api.constrains('date_of_birth')
    def _check_date_of_birth(self):
        today = fields.Date.context_today(self)
        for rec in self:
            if rec.date_of_birth:
                if rec.date_of_birth >= today:
                    raise ValidationError("Date of birth must be in the past.")
                if rec.date_of_birth.year < 1900:
                    raise ValidationError("Date of birth cannot be before 1900.")

    @api.constrains('date_of_birth', 'class_id')
    def _check_min_age_for_grade(self):
        today = fields.Date.context_today(self)
        for rec in self:
            if rec.date_of_birth and rec.class_id and rec.class_id.grade_id:
                grade_level = int(rec.class_id.grade_id.level or 0)
                if grade_level:
                    age = relativedelta(today, rec.date_of_birth).years
                    min_age = self.BASE_GRADE1_AGE + math.ceil((grade_level - 1) / 2)
                    if age < min_age:
                        raise ValidationError(
                            f"Student registering for Grade {grade_level} must be at least "
                            f"{min_age} years old (age given: {age})."
                        )

    @api.constrains('birth_certificate_filename', 'previous_grade_document_filename')
    def _check_file_extensions(self):
        for rec in self:
            for field_name in ('birth_certificate_filename', 'previous_grade_document_filename'):
                filename = getattr(rec, field_name)
                if filename:
                    ext = os.path.splitext(filename)[1].lower()
                    if ext not in self.ALLOWED_EXTENSIONS:
                        label = field_name.replace('_filename', '').replace('_', ' ').title()
                        raise ValidationError(
                            f"Invalid file type for {label}: '{ext}'. "
                            f"Allowed types: {', '.join(self.ALLOWED_EXTENSIONS)}"
                        )
    

   

    @api.depends('enrollment_ids')
    def _compute_enrollment_count(self):
        for rec in self:
            rec.enrollment_count = len(rec.enrollment_ids)

    @api.depends('date_of_birth')
    def _compute_age(self):
        today = fields.Date.context_today(self)
        for rec in self:
            rec.age = relativedelta(today, rec.date_of_birth).years if rec.date_of_birth else 0

    @api.depends('first_name', 'middle_name', 'last_name')
    def _compute_name(self):
        for rec in self:
            parts = [rec.first_name, rec.middle_name, rec.last_name]
            rec.name = ' '.join(p for p in parts if p) or False

    def _inverse_name(self):
        pass
    def _get_full_phone(self, phone):
        """Combine the nationality's country code with a locally-entered phone number."""
        if not phone:
            return False
        phone = phone.strip()
        if phone.startswith('+'):
            return phone
        if self.nationality_id and self.nationality_id.phone_code:
            digits = re.sub(r'\D', '', phone)
            return '+%s%s' % (self.nationality_id.phone_code, digits)
        return phone

    def _is_valid_phone(self, phone):
        full_phone = self._get_full_phone(phone)
        if not full_phone:
            return False
        digits = re.sub(r'\D', '', full_phone)
        return len(digits) >= 7

    def _validate_submission_requirements(self):
        missing = []
        if not self.name:
            missing.append('Full Name')
        if not self.date_of_birth:
            missing.append('Date of Birth')
        if not self.guardian_name:
            missing.append('Parent / Guardian Name')
        if not self._is_valid_phone(self.guardian_phone):
            missing.append('Guardian Phone (invalid number — set Nationality for automatic country code, or include + code manually)')
        if not self.class_id:
            missing.append('Grade / Class')
        if not self.academic_year_id:
            missing.append('Academic Year')
        if not self.fan_number:
            missing.append('FAN (National ID)')
        if not self.emergency_contact_name:
            missing.append('Emergency Contact Name')
        if not self._is_valid_phone(self.emergency_contact_phone):
            missing.append('Emergency Contact Phone (invalid number — set Nationality for automatic country code, or include + code manually)')
        if not self.birth_certificate:
            missing.append('Birth Certificate')
        if self.class_id and not self.class_id.is_entry_level and not self.previous_grade_document:
            missing.append('Previous Grade Document (required unless class is entry-level)')
        if self.admission_type == 'transfer':
            if not self.previous_school:
                missing.append('Previous School')
            if not self.transfer_reference and not self.previous_grade_document:
                missing.append('Transfer Evidence')
        grade_level = int(self.class_id.grade_id.level or 0) if self.class_id.grade_id else 0
        if grade_level in (11, 12) and not (self.stream_id or self.class_id.stream_id):
            missing.append('Academic Stream (required for Grade 11/12)')
        questions = self.env['school.registration.question'].search([
            ('active', '=', True), ('required', '=', True),
            ('grade_from', '<=', grade_level or 12), ('grade_to', '>=', grade_level or 1),
            ('admission_type', 'in', ('all', self.admission_type)),
            '|', ('stream_id', '=', False),
                 ('stream_id', '=', (self.stream_id or self.class_id.stream_id).id),
        ])
        answered = self.registration_answer_ids.filtered(
            lambda answer: answer.value_text or answer.option_id).question_id
        for question in questions - answered:
            missing.append('Questionnaire: %s' % question.name)
        document_rules = self.env['school.document.rule'].search([
            ('active', '=', True), ('required', '=', True),
            ('grade_from', '<=', grade_level or 12), ('grade_to', '>=', grade_level or 1),
            ('admission_type', 'in', ('all', self.admission_type)),
            '|', ('stream_id', '=', False),
                 ('stream_id', '=', (self.stream_id or self.class_id.stream_id).id),
        ])
        supplied_types = self.env['school.document'].search([
            ('student_id', '=', self.id), ('state', 'in', ('uploaded', 'verified')),
        ]).document_type_id
        for rule in document_rules.filtered(lambda item: item.document_type_id not in supplied_types):
            missing.append('Document: %s' % rule.document_type_id.name)
        return missing

    @api.constrains('registration_status', 'name', 'date_of_birth', 'guardian_name',
                     'guardian_phone', 'class_id', 'birth_certificate', 'previous_grade_document')
    def _check_required_fields_for_submission(self):
        if self.env.context.get('skip_registration_completeness'):
            return
        for rec in self:
            if rec.registration_status not in ('submitted', 'approved'):
                continue
            missing = rec._validate_submission_requirements()
            if missing:
                raise ValidationError(
                    "Cannot mark the student as %s while the following issues exist: %s"
                    % (rec.registration_status.title(), ', '.join(missing))
                )

    def action_pending_verification(self):
        for rec in self:
            if rec.registration_status not in ('draft', 'incomplete'):
                raise ValidationError('Only draft registrations can enter verification.')
            rec.registration_status = 'pending_verification'

    def action_mark_submitted(self):
        for rec in self:
            if rec.registration_status not in ('draft', 'pending_verification', 'incomplete'):
                raise ValidationError('Only registrations under verification can be submitted.')
            missing = rec._validate_submission_requirements()
            if missing:
                raise ValidationError(
                    "Cannot submit: %s" % ', '.join(missing)
                )
            rec.registration_status = 'submitted'

    def action_mark_approved(self):
        for rec in self:
            if rec.registration_status != 'submitted':
                raise ValidationError("Only submitted registrations can be approved.")
            values = {'registration_status': 'approved', 'lifecycle_status': 'active'}
            if not rec.regno:
                values['regno'] = self.env['ir.sequence'].next_by_code('school.student')
            if not rec.admission_number:
                values['admission_number'] = self.env['ir.sequence'].next_by_code(
                    'school.student.admission') or values.get('regno')
            rec.write(values)
            rec._ensure_enrollment()
            rec._ensure_guardian()

    def action_reject(self):
        for rec in self:
            if rec.registration_status not in ('pending_verification', 'submitted'):
                raise ValidationError('Only registrations under review can be rejected.')
            rec.registration_status = 'rejected'

    def _ensure_enrollment(self):
        """Approval is the moment a registration becomes an academic placement:
        create and activate the enrollment for the class chosen at registration."""
        self.ensure_one()
        Enrollment = self.env['school.enrollment']
        existing = Enrollment.search([
            ('student_id', '=', self.id),
            ('academic_year_id', '=', self.class_id.academic_year_id.id),
            ('state', 'in', ('draft', 'active')),
        ], limit=1)
        if existing:
            if existing.state == 'draft':
                existing.action_activate()
            return existing
        enrollment = Enrollment.create({
            'student_id': self.id,
            'class_id': self.class_id.id,
            'enrollment_date': self.registration_date,
        })
        enrollment.action_activate()
        return enrollment

    def _ensure_guardian(self):
        """Turn the intake guardian chars into a partner-backed guardian link.
        Reuses an existing contact when the same name and phone already exist,
        so one parent serves several students as a single record."""
        self.ensure_one()
        if self.guardian_ids:
            return self.guardian_ids
        phone = self._get_full_phone(self.guardian_phone)
        Partner = self.env['res.partner']
        partner = Partner.search([
            ('name', '=', self.guardian_name),
            ('phone', '=', phone),
        ], limit=1)
        if not partner:
            partner = Partner.create({
                'name': self.guardian_name,
                'phone': phone,
                'type': 'contact',
            })
        return self.env['school.student.guardian'].create({
            'student_id': self.id,
            'partner_id': partner.id,
            'is_primary': True,
            'relationship': self.guardian_relationship or 'guardian',
            'occupation': self.guardian_occupation,
        })

    def action_view_enrollments(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': 'Enrollments',
            'res_model': 'school.enrollment',
            'view_mode': 'list,form',
            'domain': [('student_id', '=', self.id)],
            'context': {'default_student_id': self.id},
        }

    def action_print_student_report(self):
        return self.env.ref('school_management.action_report_school_student').report_action(self)

    def unlink(self):
        if any(student.registration_status == 'approved' or student.enrollment_ids
               for student in self):
            raise ValidationError(
                'Student identities with academic history cannot be deleted. Archive them instead.')
        return super().unlink()
