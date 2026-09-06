"""Applying a promotion batch — the step that ends a school year.

`action_apply_promotion` could not complete on real data. It wrote the
enrolment and the student itself and got both subtly wrong, in ways that only
appear once a school has sections and a registration history:

  * it left the student's `section_id` pointing at the class they came from,
    so `_check_registration_scope` refused every student whose new class sits
    in a different section — "The section must match the selected Grade /
    Class";
  * it wrote `registration_status` on a graduating student, which is one of
    the fields `_check_required_fields_for_submission` watches, so the
    completeness check re-ran against a record approved long ago and failed
    for anybody approved before a requirement existed;
  * nothing stopped two unapplied batches covering the same students, and
    running both advanced them twice.

The fix is that promotion no longer carries the student across at all —
`school.enrollment.action_activate` already does, correctly and in one place.
These tests hold that, and hold the approval invariant it must not weaken.
"""

from odoo.exceptions import AccessError, ValidationError
from odoo.tests.common import TransactionCase

from .common import academic_year


class PromotionApplyCase(TransactionCase):
    """A grade with sections, a year to leave and a year to enter."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()

        cls.source_year = academic_year(cls.env, '2050-09-01', '2051-06-30')
        cls.target_year = academic_year(cls.env, '2051-09-01', '2052-06-30')

        cls.section_a = cls.env.ref('school_management.section_a')
        cls.section_b = cls.env.ref('school_management.section_b')

        cls.grade_from = cls.env['school.grade'].search([('level', '=', '7')], limit=1)
        cls.grade_to = cls.env['school.grade'].search([('level', '=', '8')], limit=1)

        # Grade 7 section A in the year that is ending.
        cls.class_from = cls._class('PRO Grade 7 A', cls.source_year, cls.grade_from, cls.section_a)
        # Grade 8 section B next year — a *different* section on purpose. This
        # is the case that used to fail: the student's old section survives the
        # write and no longer matches their new class.
        cls.class_to = cls._class('PRO Grade 8 B', cls.target_year, cls.grade_to, cls.section_b)
        # Somewhere for a retained student to stay.
        cls.class_retained = cls._class(
            'PRO Grade 7 A next', cls.target_year, cls.grade_from, cls.section_a)

        cls.registrar = cls._user('pro_registrar', 'group_school_registrar')
        cls.teacher_user = cls._user('pro_teacher', 'group_school_teacher')

    # ------------------------------------------------------------ fixtures ---

    @classmethod
    def _class(cls, name, year, grade, section):
        return cls.env['school.class'].create({
            'name': name,
            'academic_year_id': year.id,
            'grade_id': grade.id,
            'section_id': section.id,
            'capacity': 40,
            'is_entry_level': True,
        })

    @classmethod
    def _user(cls, login, group):
        return cls.env['res.users'].create({
            'name': login, 'login': login,
            'group_ids': [(6, 0, [
                cls.env.ref('base.group_user').id,
                cls.env.ref('school_management.%s' % group).id,
            ])],
        })

    @classmethod
    def _student(cls, name, school_class, **overrides):
        """An approved student, placed and enrolled, as registration leaves them."""
        seq = cls.env['school.student'].search_count([])
        values = {
            'name': name,
            'class_id': school_class.id,
            'academic_year_id': school_class.academic_year_id.id,
            'section_id': school_class.section_id.id,
            'date_of_birth': '2010-05-05',
            'guardian_name': 'PRO Guardian',
            'guardian_phone': '+25191140%04d' % seq,
            'emergency_contact_name': 'PRO Emergency',
            'emergency_contact_phone': '+25191141%04d' % seq,
            'fan_number': '20000000%08d' % seq,
            'birth_certificate': b'ZmljdGlvbmFs',
            'registration_date': school_class.academic_year_id.date_start,
            'registration_status': 'approved',
            'lifecycle_status': 'active',
        }
        values.update(overrides)
        student = cls.env['school.student'].with_context(
            skip_registration_completeness=True).create(values)
        student._ensure_enrollment()
        return student

    def _batch(self, **overrides):
        values = {
            'academic_year_id': self.source_year.id,
            'target_academic_year_id': self.target_year.id,
            'grade_id': self.grade_from.id,
            'minimum_pass_average': 50.0,
            'max_failed_subjects': 0,
        }
        values.update(overrides)
        return self.env['school.promotion.batch'].create(values)


class TestPromotionApply(PromotionApplyCase):

    # ------------------------------------------------------------- Test A ---

    def test_a_promoted_student_lands_in_the_next_grade_with_a_valid_section(self):
        """The defect this PR exists for: the section has to move with the class."""
        student = self._student('PRO Promoted', self.class_from)
        self.assertEqual(student.section_id, self.section_a)

        batch = self._batch()
        batch.action_calculate_outcomes()
        line = batch.line_ids.filtered(lambda item: item.student_id == student)
        self.assertTrue(line, 'the student was picked up by the calculation')

        # Force the outcome so the test is about applying, not about averages.
        line.write({'final_outcome': 'promoted', 'target_class_id': self.class_to.id})
        batch.action_approve()
        batch.action_apply_promotion()

        student.invalidate_recordset()
        self.assertEqual(batch.state, 'done')
        self.assertEqual(line.state, 'done')
        self.assertEqual(student.class_id, self.class_to)
        self.assertEqual(student.academic_year_id, self.target_year)
        self.assertEqual(
            student.section_id, self.section_b,
            'the section follows the new class rather than surviving from the old one')

        # The enrolment side of it, which is what actually carried the student.
        new_enrolment = self.env['school.enrollment'].search([
            ('student_id', '=', student.id),
            ('academic_year_id', '=', self.target_year.id),
        ])
        self.assertEqual(len(new_enrolment), 1, 'exactly one enrolment for next year')
        self.assertEqual(new_enrolment.state, 'active')
        self.assertEqual(new_enrolment.class_id, self.class_to)
        self.assertTrue(
            new_enrolment.placement_ids,
            'activation created the placement record, which the old code skipped')
        self.assertTrue(new_enrolment.roll_number, 'and allocated a roll number')

        old_enrolment = self.env['school.enrollment'].search([
            ('student_id', '=', student.id),
            ('academic_year_id', '=', self.source_year.id),
        ])
        self.assertEqual(old_enrolment.state, 'completed')
        self.assertEqual(old_enrolment.end_date, self.source_year.date_end)

    # ------------------------------------------------------------- Test F ---

    def test_f_the_promoted_student_passes_the_registration_scope_check(self):
        """The invariant the old code broke, asserted directly."""
        student = self._student('PRO Scope', self.class_from)
        batch = self._batch()
        batch.action_calculate_outcomes()
        batch.line_ids.filtered(lambda item: item.student_id == student).write(
            {'final_outcome': 'promoted', 'target_class_id': self.class_to.id})
        batch.action_approve()
        batch.action_apply_promotion()

        student.invalidate_recordset()
        # Raises if class, year, section or education level disagree.
        student._check_registration_scope()
        self.assertEqual(student.section_id, student.class_id.section_id)
        self.assertEqual(student.academic_year_id, student.class_id.academic_year_id)

    # ------------------------------------------------------------- Test B ---

    def test_b_retained_student_stays_in_the_grade_and_keeps_a_valid_section(self):
        student = self._student('PRO Retained', self.class_from)
        batch = self._batch()
        batch.action_calculate_outcomes()
        batch.line_ids.filtered(lambda item: item.student_id == student).write(
            {'final_outcome': 'retained', 'target_class_id': self.class_retained.id})
        batch.action_approve()
        batch.action_apply_promotion()

        student.invalidate_recordset()
        self.assertEqual(student.class_id, self.class_retained)
        self.assertEqual(student.class_id.grade_id, self.grade_from, 'still in the same grade')
        self.assertEqual(student.academic_year_id, self.target_year, 'but in the next year')
        self.assertEqual(student.section_id, self.class_retained.section_id)
        student._check_registration_scope()

    # ------------------------------------------------------------- Test C ---

    def test_c_a_student_approved_before_a_requirement_existed_can_still_be_promoted(self):
        """The FAN case.

        A record approved before FAN was required is still legitimately
        approved. Promotion must not re-litigate that — it is changing a
        placement, not an approval.
        """
        student = self._student('PRO Legacy', self.class_from, fan_number=False)
        self.assertEqual(student.registration_status, 'approved')
        self.assertFalse(student.fan_number)
        self.assertIn('FAN (National ID)', student._validate_submission_requirements())

        batch = self._batch()
        batch.action_calculate_outcomes()
        batch.line_ids.filtered(lambda item: item.student_id == student).write(
            {'final_outcome': 'promoted', 'target_class_id': self.class_to.id})
        batch.action_approve()
        batch.action_apply_promotion()

        student.invalidate_recordset()
        self.assertEqual(student.class_id, self.class_to)
        self.assertEqual(student.section_id, self.section_b)
        self.assertEqual(batch.state, 'done')

    def test_c2_a_graduating_student_approved_before_a_requirement_still_graduates(self):
        """The same false positive, on the other branch of apply."""
        student = self._student('PRO Legacy Grad', self.class_from, fan_number=False)
        batch = self._batch()
        batch.action_calculate_outcomes()
        batch.line_ids.filtered(lambda item: item.student_id == student).write(
            {'final_outcome': 'graduated', 'target_class_id': False})
        batch.action_approve()
        batch.action_apply_promotion()

        student.invalidate_recordset()
        self.assertEqual(student.lifecycle_status, 'graduated')
        self.assertEqual(student.registration_status, 'approved', 'still approved')

    # ------------------------------------------------------------- Test D ---

    def test_d_an_incomplete_student_still_cannot_be_approved(self):
        """The invariant the fix must not weaken.

        Approval completeness is enforced twice: directly in
        `action_mark_submitted`, which cannot be skipped, and as a constraint,
        which is the part promotion turns off. Only the second is a safety net;
        the first is the gate, and it is untouched.
        """
        incomplete = self.env['school.student'].with_context(
            skip_registration_completeness=True).create({
                'name': 'PRO Incomplete',
                'class_id': self.class_from.id,
                'academic_year_id': self.source_year.id,
                'date_of_birth': '2010-05-05',
                'guardian_name': 'PRO Guardian',
                'guardian_phone': '+251911429999',
                'emergency_contact_name': 'PRO Emergency',
                'emergency_contact_phone': '+251911439999',
                'registration_date': self.source_year.date_start,
                # No FAN, no birth certificate.
            })

        with self.assertRaises(ValidationError) as caught:
            incomplete.action_mark_submitted()
        self.assertIn('FAN (National ID)', str(caught.exception))
        self.assertEqual(incomplete.registration_status, 'draft')

        with self.assertRaises(ValidationError):
            incomplete.action_mark_approved()
        self.assertNotEqual(incomplete.registration_status, 'approved')

    # ------------------------------------------------------------- Test H ---

    def test_h_normal_approval_still_enforces_every_requirement(self):
        """The ordinary path, unchanged: a complete student approves cleanly."""
        seq = self.env['school.student'].search_count([])
        student = self.env['school.student'].create({
            'name': 'PRO Complete',
            'class_id': self.class_from.id,
            'academic_year_id': self.source_year.id,
            'date_of_birth': '2010-05-05',
            'guardian_name': 'PRO Guardian',
            'guardian_phone': '+25191144%04d' % seq,
            'emergency_contact_name': 'PRO Emergency',
            'emergency_contact_phone': '+25191145%04d' % seq,
            'fan_number': '30000000%08d' % seq,
            'birth_certificate': b'ZmljdGlvbmFs',
            'registration_date': self.source_year.date_start,
        })
        student.action_mark_submitted()
        self.assertEqual(student.registration_status, 'submitted')
        student.action_mark_approved()
        self.assertEqual(student.registration_status, 'approved')
        self.assertTrue(student.regno, 'approval still mints the student number')

        # And the safety-net constraint still bites on the fields it watches.
        # `birth_certificate` is one of them; `fan_number` is not, which is a
        # pre-existing gap between the constraint's trigger list and
        # `_validate_submission_requirements` and is noted in the pull request
        # rather than widened here.
        with self.assertRaises(ValidationError):
            student.write({'birth_certificate': False})

    # ------------------------------------------------------------- Test G ---

    def test_g_a_failure_partway_through_leaves_nobody_promoted(self):
        """Apply is all-or-nothing.

        Odoo rolls the cursor back when an exception leaves the call, so this
        needs no machinery of its own — but it does need proving, because a
        half-applied promotion is the worst outcome available: some students
        moved, the batch still says approved, and running it again moves the
        rest while the first group is advanced twice.
        """
        first = self._student('PRO Atomic One', self.class_from)
        second = self._student('PRO Atomic Two', self.class_from)

        batch = self._batch()
        batch.action_calculate_outcomes()
        for line in batch.line_ids:
            line.write({'final_outcome': 'promoted', 'target_class_id': self.class_to.id})
        batch.action_approve()

        # Break the second student's target after approval, so apply fails
        # partway rather than being caught by the approve gate.
        batch.line_ids.filtered(lambda item: item.student_id == second).write(
            {'target_class_id': False})

        # The savepoint is what makes this a test of atomicity rather than of
        # the ORM cache. Over RPC an escaping exception rolls the cursor back;
        # inside a test the same exception leaves the transaction open, so
        # without this the assertions below would be inspecting half-written
        # state that a real client would never see.
        with self.assertRaises(ValidationError):
            with self.cr.savepoint():
                batch.action_apply_promotion()

        # Nothing about the first student may have survived the failure.
        first.invalidate_recordset()
        batch.invalidate_recordset()
        self.assertEqual(first.class_id, self.class_from, 'the first student did not move')
        self.assertEqual(first.academic_year_id, self.source_year)
        self.assertEqual(batch.state, 'approved', 'the batch did not complete')
        self.assertFalse(
            self.env['school.enrollment'].search([
                ('student_id', '=', first.id),
                ('academic_year_id', '=', self.target_year.id),
            ]),
            'no enrolment was opened for next year')


class TestPromotionBatchUniqueness(PromotionApplyCase):
    """Test E — one unapplied batch per set of students."""

    def test_e_a_second_batch_over_the_same_grade_and_year_is_refused(self):
        self._batch()
        with self.assertRaises(ValidationError) as caught:
            self._batch()
        self.assertIn('already covers these students', str(caught.exception))

    def test_e2_the_constraint_holds_through_the_orm_not_only_the_frontend(self):
        """It is a model constraint, so any client hits it — RPC included."""
        first = self._batch()
        with self.assertRaises(ValidationError):
            self.env['school.promotion.batch'].with_user(self.registrar).create({
                'academic_year_id': self.source_year.id,
                'target_academic_year_id': self.target_year.id,
                'grade_id': self.grade_from.id,
                'minimum_pass_average': 50.0,
                'max_failed_subjects': 0,
            })
        self.assertTrue(first.exists())

    def test_e3_batches_over_different_classes_of_one_grade_are_allowed(self):
        """A school may promote 7A and 7B separately; those do not overlap."""
        other_class = self._class(
            'PRO Grade 7 B', self.source_year, self.grade_from, self.section_b)
        first = self._batch(class_ids=[(6, 0, [self.class_from.id])])
        second = self._batch(class_ids=[(6, 0, [other_class.id])])
        self.assertTrue(first.exists() and second.exists())

    def test_e4_a_batch_naming_no_classes_covers_the_grade_and_so_overlaps(self):
        self._batch(class_ids=[(6, 0, [self.class_from.id])])
        with self.assertRaises(ValidationError):
            self._batch()

    def test_e5_an_applied_batch_does_not_block_a_later_one(self):
        student = self._student('PRO Sequential', self.class_from)
        batch = self._batch()
        batch.action_calculate_outcomes()
        batch.line_ids.filtered(lambda item: item.student_id == student).write(
            {'final_outcome': 'promoted', 'target_class_id': self.class_to.id})
        batch.action_approve()
        batch.action_apply_promotion()
        self.assertEqual(batch.state, 'done')

        # A corrective batch for late arrivals is legitimate once the first is applied.
        self.assertTrue(self._batch().exists())

    def test_e6_a_class_from_another_grade_cannot_widen_the_batch(self):
        foreign = self._class(
            'PRO Grade 8 A source', self.source_year, self.grade_to, self.section_a)
        with self.assertRaises(ValidationError) as caught:
            self._batch(class_ids=[(6, 0, [foreign.id])])
        self.assertIn('do not belong to', str(caught.exception))


class TestPromotionAuthorisation(PromotionApplyCase):
    """The security model is unchanged — Registrar and Administrator only."""

    def test_a_registrar_can_run_the_whole_batch(self):
        student = self._student('PRO Authorised', self.class_from)
        batch = self._batch().with_user(self.registrar)
        batch.action_calculate_outcomes()
        batch.line_ids.filtered(lambda item: item.student_id == student).write(
            {'final_outcome': 'promoted', 'target_class_id': self.class_to.id})
        batch.action_approve()
        batch.action_apply_promotion()
        self.assertEqual(batch.state, 'done')

    def test_a_teacher_cannot_calculate_approve_or_apply(self):
        batch = self._batch()
        as_teacher = batch.with_user(self.teacher_user)
        for method in ('action_calculate_outcomes', 'action_approve', 'action_apply_promotion'):
            with self.assertRaises(AccessError, msg=method):
                getattr(as_teacher, method)()
        self.assertEqual(batch.state, 'draft')
