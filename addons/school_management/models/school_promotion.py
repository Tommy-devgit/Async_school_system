from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError


class SchoolPromotionBatch(models.Model):
    _name = 'school.promotion.batch'
    _description = 'End-of-Year Promotion Batch'
    _inherit = ['mail.thread']
    _order = 'academic_year_id desc, grade_id, id desc'

    name = fields.Char(
        string='Batch Name', compute='_compute_name', store=True, readonly=False
    )
    academic_year_id = fields.Many2one(
        'school.academic.year', string='Current Academic Year',
        required=True, ondelete='restrict', tracking=True
    )
    target_academic_year_id = fields.Many2one(
        'school.academic.year', string='Target Academic Year',
        required=True, ondelete='restrict', tracking=True
    )
    grade_id = fields.Many2one(
        'school.grade', string='Grade Level', required=True, ondelete='restrict', tracking=True
    )
    class_ids = fields.Many2many(
        'school.class', string='Classes Included',
        domain="[('academic_year_id', '=', academic_year_id), ('grade_id', '=', grade_id)]"
    )
    minimum_pass_average = fields.Float(
        string='Minimum Pass Average (%)', default=50.0, required=True, tracking=True
    )
    max_failed_subjects = fields.Integer(
        string='Max Allowed Failed Subjects', default=0, required=True,
        help='Maximum number of subjects below passing threshold allowed for promotion.'
    )
    state = fields.Selection([
        ('draft', 'Draft'),
        ('calculated', 'Calculated'),
        ('approved', 'Approved'),
        ('done', 'Completed'),
    ], default='draft', required=True, tracking=True)

    line_ids = fields.One2many(
        'school.promotion.line', 'batch_id', string='Promotion Decisions'
    )
    line_count = fields.Integer(compute='_compute_counts')
    promoted_count = fields.Integer(compute='_compute_counts')
    retained_count = fields.Integer(compute='_compute_counts')
    graduated_count = fields.Integer(compute='_compute_counts')
    conditional_count = fields.Integer(compute='_compute_counts')

    @api.depends('academic_year_id.name', 'target_academic_year_id.name', 'grade_id.name')
    def _compute_name(self):
        for rec in self:
            if rec.academic_year_id and rec.target_academic_year_id and rec.grade_id:
                rec.name = f"Promotion: {rec.grade_id.name} ({rec.academic_year_id.name} -> {rec.target_academic_year_id.name})"
            elif not rec.name:
                rec.name = "Promotion Batch"

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if not vals.get('name'):
                ay = self.env['school.academic.year'].browse(vals.get('academic_year_id')) if vals.get('academic_year_id') else False
                tay = self.env['school.academic.year'].browse(vals.get('target_academic_year_id')) if vals.get('target_academic_year_id') else False
                gr = self.env['school.grade'].browse(vals.get('grade_id')) if vals.get('grade_id') else False
                if ay and tay and gr:
                    vals['name'] = f"Promotion: {gr.name} ({ay.name} -> {tay.name})"
                else:
                    vals['name'] = "Promotion Batch"
        return super().create(vals_list)
    

    @api.depends('line_ids.final_outcome')
    def _compute_counts(self):
        for rec in self:
            lines = rec.line_ids
            rec.line_count = len(lines)
            rec.promoted_count = len(lines.filtered(lambda l: l.final_outcome == 'promoted'))
            rec.retained_count = len(lines.filtered(lambda l: l.final_outcome == 'retained'))
            rec.graduated_count = len(lines.filtered(lambda l: l.final_outcome == 'graduated'))
            rec.conditional_count = len(lines.filtered(lambda l: l.final_outcome == 'conditional'))

    @api.constrains('academic_year_id', 'target_academic_year_id')
    def _check_academic_years(self):
        for rec in self:
            if rec.academic_year_id == rec.target_academic_year_id:
                raise ValidationError("Target Academic Year must be different from Current Academic Year.")
            if rec.target_academic_year_id.date_start < rec.academic_year_id.date_end:
                raise ValidationError("Target Academic Year must start after the current Academic Year.")

    def _covered_class_ids(self):
        """The classes this batch will actually promote.

        An empty `class_ids` is not "no classes" — `action_calculate_outcomes`
        reads it as every class of the grade in that year, so that is what the
        batch covers.
        """
        self.ensure_one()
        if self.class_ids:
            return set(self.class_ids.ids)
        return set(self.env['school.class'].search([
            ('academic_year_id', '=', self.academic_year_id.id),
            ('grade_id', '=', self.grade_id.id),
        ]).ids)

    @api.constrains('class_ids', 'academic_year_id', 'grade_id')
    def _check_classes_in_scope(self):
        """`class_ids` carries this domain in the view; nothing enforced it.

        A class from another grade or year would silently widen the batch,
        because calculate trusts `class_ids` over its own grade and year.
        """
        for rec in self.filtered('class_ids'):
            stray = rec.class_ids.filtered(
                lambda item: item.academic_year_id != rec.academic_year_id
                or item.grade_id != rec.grade_id
            )
            if stray:
                raise ValidationError(
                    "These classes do not belong to %s in %s: %s"
                    % (rec.grade_id.name, rec.academic_year_id.name,
                       ', '.join(stray.mapped('display_name')))
                )

    @api.constrains('academic_year_id', 'grade_id', 'class_ids', 'state')
    def _check_no_overlapping_batch(self):
        """One unapplied batch per set of students.

        Two batches over the same students would advance them twice: the
        second finds the enrolment the first opened and moves it again. The
        rule is deliberately about *overlap* rather than equality, because a
        school may legitimately promote 7A and 7B as separate batches — those
        do not overlap — while a batch naming no classes covers the whole grade
        and therefore overlaps everything.

        Applied batches are excluded. Once a batch is `done` its students have
        moved, and a later corrective batch for the same grade and year is a
        legitimate thing to want. That is also why this is a Python constraint
        rather than a SQL unique index: neither "not done" nor "overlapping
        sets" can be expressed as one, and a unique index on (year, grade)
        would forbid both of those legitimate cases.
        """
        for rec in self.filtered(lambda item: item.state != 'done'):
            if not (rec.academic_year_id and rec.grade_id):
                continue
            others = self.search([
                ('id', '!=', rec.id),
                ('academic_year_id', '=', rec.academic_year_id.id),
                ('grade_id', '=', rec.grade_id.id),
                ('state', '!=', 'done'),
            ])
            if not others:
                continue
            covered = rec._covered_class_ids()
            for other in others:
                if covered & other._covered_class_ids():
                    raise ValidationError(
                        "%s already covers these students and has not been applied. "
                        "Finish or delete it before starting another promotion for "
                        "%s in %s — running both would advance the same students twice."
                        % (other.name, rec.grade_id.name, rec.academic_year_id.name)
                    )

    def _require_registrar_or_admin(self):
        if self.env.su:
            return
        if not (self.env.user.has_group('school_management.group_school_registrar')
                or self.env.user.has_group('school_management.group_school_admin')
                or self.env.user.has_group('base.group_system')):
            raise AccessError("Only a School Registrar or Administrator can manage promotion batches.")

    def action_calculate_outcomes(self):
        self._require_registrar_or_admin()
        for batch in self:
            if batch.state not in ('draft', 'calculated'):
                raise ValidationError("Outcomes can only be calculated in Draft or Calculated state.")

            source_classes = batch.class_ids or self.env['school.class'].search([
                ('academic_year_id', '=', batch.academic_year_id.id),
                ('grade_id', '=', batch.grade_id.id),
            ])
            if not source_classes:
                raise ValidationError(f"No classes found for {batch.grade_id.name} in {batch.academic_year_id.name}.")

            next_grade = self.env['school.grade'].search([
                ('sequence', '>', batch.grade_id.sequence)
            ], order='sequence asc', limit=1)

            is_terminal = not bool(next_grade) or (batch.grade_id.level == '12')

            # Look up active enrollments
            enrollments = self.env['school.enrollment'].search([
                ('class_id', 'in', source_classes.ids),
                ('academic_year_id', '=', batch.academic_year_id.id),
                ('state', '=', 'active'),
            ])

            existing_lines = {line.student_id.id: line for line in batch.line_ids}
            vals_to_create = []

            for enr in enrollments:
                student = enr.student_id

                report_cards = self.env['school.report.card'].search([
                    ('student_id', '=', student.id),
                    ('academic_year_id', '=', batch.academic_year_id.id),
                    ('state', '=', 'published'),
                ])

                if report_cards:
                    avg_score = sum(rc.overall_average for rc in report_cards) / len(report_cards)
                else:
                    marks = self.env['school.mark'].search([
                        ('student_id', '=', student.id),
                        ('academic_year_id', '=', batch.academic_year_id.id),
                        ('mark_status', 'in', ('recorded', 'transfer', 'makeup')),
                    ])
                    avg_score = (sum(m.percentage for m in marks) / len(marks)) if marks else 0.0

                if avg_score >= batch.minimum_pass_average:
                    calculated_outcome = 'graduated' if is_terminal else 'promoted'
                else:
                    calculated_outcome = 'retained'

                target_grade = batch.grade_id if calculated_outcome == 'retained' else next_grade

                target_class = False
                if target_grade:
                    # Match by section_id if available on school.class
                    section = getattr(enr.class_id, 'section_id', False)
                    if section:
                        target_class = self.env['school.class'].search([
                            ('academic_year_id', '=', batch.target_academic_year_id.id),
                            ('grade_id', '=', target_grade.id),
                            ('section_id', '=', section.id),
                        ], limit=1)

                    if not target_class:
                        target_class = self.env['school.class'].search([
                            ('academic_year_id', '=', batch.target_academic_year_id.id),
                            ('grade_id', '=', target_grade.id),
                        ], limit=1)

                if student.id in existing_lines:
                    line = existing_lines[student.id]
                    if not line.is_overridden:
                        line.write({
                            'annual_average': avg_score,
                            'calculated_outcome': calculated_outcome,
                            'final_outcome': calculated_outcome,
                            'target_grade_id': target_grade.id if target_grade else False,
                            'target_class_id': target_class.id if target_class else False,
                        })
                else:
                    vals_to_create.append({
                        'batch_id': batch.id,
                        'student_id': student.id,
                        'current_class_id': enr.class_id.id,
                        'annual_average': avg_score,
                        'calculated_outcome': calculated_outcome,
                        'final_outcome': calculated_outcome,
                        'target_grade_id': target_grade.id if target_grade else False,
                        'target_class_id': target_class.id if target_class else False,
                    })

            if vals_to_create:
                self.env['school.promotion.line'].create(vals_to_create)

            batch.state = 'calculated'

    def action_approve(self):
        self._require_registrar_or_admin()
        for batch in self:
            if not batch.line_ids:
                raise ValidationError("Cannot approve an empty promotion batch.")
            unassigned = batch.line_ids.filtered(
                lambda l: l.final_outcome in ('promoted', 'retained') and not l.target_class_id
            )
            if unassigned:
                raise ValidationError(
                    f"Please assign target classes for all promoted/retained students ({len(unassigned)} unassigned)."
                )
            batch.state = 'approved'

    def action_apply_promotion(self):
        """Advance every student in the batch into the next academic year.

        This used to write the enrolment and the student itself, and got both
        subtly wrong. `school.enrollment` already owns "a student's placement
        changed" — `action_activate` creates the placement record, allocates a
        roll number, derives the subject enrolments, checks the class capacity
        and calls `_sync_student_class`, which is the one place that knows a
        student's class, **section**, education level, stream and academic year
        have to move together.

        Promotion reimplemented a fragment of that: it created the enrolment
        already `active` (so none of the above ran) and then hand-wrote the
        student with only `class_id` and `academic_year_id`. Leaving the old
        `section_id` in place made the student fail
        `_check_registration_scope` — "The section must match the selected
        Grade / Class" — for anybody whose new class sits in a different
        section, which is most of a real promotion.

        So it no longer writes the student at all. It creates the enrolment in
        draft and activates it, and the enrolment carries the student across.
        """
        self._require_registrar_or_admin()
        Enrollment = self.env['school.enrollment']
        for batch in self:
            if batch.state != 'approved':
                raise ValidationError("Only approved promotion batches can be executed.")

            for line in batch.line_ids:
                student = line.student_id

                current_enr = Enrollment.search([
                    ('student_id', '=', student.id),
                    ('academic_year_id', '=', batch.academic_year_id.id),
                    ('state', '=', 'active'),
                ])
                if current_enr:
                    current_enr.write({
                        'state': 'completed',
                        'end_date': batch.academic_year_id.date_end,
                    })

                if line.final_outcome in ('promoted', 'retained'):
                    if not line.target_class_id:
                        raise ValidationError(
                            "%s has no target class, so they cannot be advanced. "
                            "Recalculate the batch after creating the classes for "
                            "%s." % (student.name, batch.target_academic_year_id.name)
                        )
                    existing_target = Enrollment.search([
                        ('student_id', '=', student.id),
                        ('academic_year_id', '=', batch.target_academic_year_id.id),
                    ], limit=1)
                    if existing_target:
                        # Already placed for next year — by an earlier partial
                        # run, a transfer, or by hand. Move it onto the target
                        # class rather than opening a second enrolment; the
                        # write syncs the student the same way activation does.
                        if existing_target.class_id != line.target_class_id:
                            existing_target.write({'class_id': line.target_class_id.id})
                        if existing_target.state == 'draft':
                            existing_target.action_activate()
                    else:
                        Enrollment.create({
                            'student_id': student.id,
                            'academic_year_id': batch.target_academic_year_id.id,
                            'class_id': line.target_class_id.id,
                            'enrollment_date': batch.target_academic_year_id.date_start,
                        }).action_activate()

                elif line.final_outcome == 'graduated':
                    # A graduating student keeps their approved registration and
                    # gains a finished lifecycle. `registration_status` is one of
                    # the fields `_check_required_fields_for_submission` watches,
                    # so writing it re-runs the completeness check against a
                    # record that was approved long ago — and fails for anyone
                    # approved before a requirement was added. Approval itself is
                    # unaffected: `action_mark_submitted` calls
                    # `_validate_submission_requirements` directly and cannot be
                    # skipped. This is the same context `_sync_student_class`
                    # uses for exactly the same reason.
                    student.with_context(skip_registration_completeness=True).write({
                        'lifecycle_status': 'graduated',
                    })

                line.state = 'done'

            batch.state = 'done'


class SchoolPromotionLine(models.Model):
    _name = 'school.promotion.line'
    _description = 'Student Promotion Decision'
    _order = 'current_class_id, student_id'

    batch_id = fields.Many2one(
        'school.promotion.batch', string='Promotion Batch',
        required=True, ondelete='cascade', index=True
    )
    student_id = fields.Many2one(
        'school.student', string='Student', required=True, ondelete='restrict'
    )
    regno = fields.Char(
        related='student_id.regno', string='Student ID', readonly=True
    )
    admission_number = fields.Char(
        related='student_id.admission_number', string='Admission No', readonly=True
    )
    current_class_id = fields.Many2one(
        'school.class', string='Current Class', required=True, ondelete='restrict'
    )
    annual_average = fields.Float(
        string='Annual Average (%)', readonly=True
    )
    calculated_outcome = fields.Selection([
        ('promoted', 'Promoted'),
        ('retained', 'Retained'),
        ('graduated', 'Graduated'),
        ('conditional', 'Conditional Review'),
    ], string='Calculated Outcome', readonly=True, required=True)

    final_outcome = fields.Selection([
        ('promoted', 'Promoted'),
        ('retained', 'Retained'),
        ('graduated', 'Graduated'),
        ('conditional', 'Conditional Review'),
    ], string='Final Decision', required=True)

    is_overridden = fields.Boolean(
        string='Manually Overridden', compute='_compute_is_overridden', store=True
    )
    override_reason = fields.Text(string='Override / Committee Reason')

    target_grade_id = fields.Many2one(
        'school.grade', string='Target Grade', ondelete='restrict'
    )
    target_class_id = fields.Many2one(
        'school.class', string='Target Class', ondelete='restrict',
        domain="[('academic_year_id', '=', parent.target_academic_year_id), ('grade_id', '=', target_grade_id)]"
    )
    target_stream_id = fields.Many2one(
        'school.stream', string='Assigned Stream', ondelete='restrict',
        help='Required when transitioning from Grade 10 into Grade 11.'
    )
    state = fields.Selection([
        ('draft', 'Pending'),
        ('done', 'Executed'),
    ], default='draft', readonly=True)

    _unique_student_per_batch = models.Constraint(
        'unique(batch_id, student_id)',
        'A student can only have one promotion decision per batch.'
    )

    @api.depends('calculated_outcome', 'final_outcome')
    def _compute_is_overridden(self):
        for rec in self:
            rec.is_overridden = bool(rec.calculated_outcome and rec.final_outcome and rec.calculated_outcome != rec.final_outcome)

    @api.onchange('final_outcome')
    def _onchange_final_outcome(self):
        for rec in self:
            if rec.final_outcome == 'retained':
                rec.target_grade_id = rec.batch_id.grade_id
            elif rec.final_outcome == 'promoted':
                next_grade = self.env['school.grade'].search([
                    ('sequence', '>', rec.batch_id.grade_id.sequence)
                ], order='sequence asc', limit=1)
                rec.target_grade_id = next_grade
            elif rec.final_outcome == 'graduated':
                rec.target_grade_id = False
                rec.target_class_id = False