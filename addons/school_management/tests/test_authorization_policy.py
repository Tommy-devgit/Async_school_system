"""ACL and record rules describe one policy, and this holds them to it.

Odoo checks `ir.model.access` first and `ir.rule` second, so a record rule whose
group holds no model-level ACL can never execute. Nothing raises, nothing is
logged: the rule simply sits in the database describing an intent the system
does not have. Twelve rules in this addon were in that state, and four of them
got there because a merge conflict resolution deleted the ACL rows a previous
fix had added — a change no test could see, because no test asserted the
relationship between the two halves.

`test_every_record_rule_can_fire` is that missing assertion. The rest prove the
policy the widened ACLs are supposed to express, in both directions: the role
reaches the records it should, and the record rules still keep it away from the
ones it should not. Granting `school.student` read to a Director is only correct
if it did not also hand a Teacher somebody else's class.

Everything here goes through `has_access` and real ORM reads as each user, so
it tests the permission Odoo actually enforces rather than the CSV that
configures it.
"""

import base64

from odoo.exceptions import AccessError
from odoo.tests.common import TransactionCase

YEAR = '2041'
DUMMY_FILE = base64.b64encode(b'fictional authorization test document')


class AuthorizationCase(TransactionCase):
    """Fixtures: one user per role, two classes, and a teacher owning only one."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()

        cls.roles = {
            name: cls._role_user(name)
            for name in (
                'admin', 'director', 'registrar', 'teacher',
                'frontoffice', 'exam_officer', 'hr',
            )
        }

        year = cls.env['school.academic.year'].search([('name', '=', YEAR)], limit=1) or \
            cls.env['school.academic.year'].create({
                'name': YEAR, 'date_start': '2049-01-01', 'date_end': '2049-12-31'})
        cls.year = year
        cls.term = cls.env['school.term'].create({
            'name': 'AUTH Term', 'academic_year_id': year.id,
            'date_start': '2049-01-01', 'date_end': '2049-12-31', 'sequence': 10,
        })
        cls.class_own = cls._class('AUTH Grade 1', 'section_a')
        cls.class_other = cls._class('AUTH Grade 2', 'section_b')
        cls.subject = cls.env['school.subject'].create({'name': 'AUTH Mathematics'})

        cls.teacher = cls._teacher('AUTH Teacher', cls.roles['teacher'])
        cls.assignment = cls._assign(cls.teacher, cls.subject, cls.class_own)

        cls.student_own = cls._student('AUTH Student Own', cls.class_own)
        cls.student_other = cls._student('AUTH Student Other', cls.class_other)

    # ------------------------------------------------------------ fixtures ---

    @classmethod
    def _role_user(cls, role):
        return cls.env['res.users'].create({
            'name': 'auth_%s' % role, 'login': 'auth_%s' % role,
            'group_ids': [(6, 0, [
                cls.env.ref('base.group_user').id,
                cls.env.ref('school_management.group_school_%s' % role).id,
            ])],
        })

    @classmethod
    def _class(cls, name, section_ref):
        return cls.env['school.class'].create({
            'name': name,
            'section_id': cls.env.ref('school_management.%s' % section_ref).id,
            'academic_year_id': cls.year.id,
            'is_entry_level': True,
        })

    @classmethod
    def _teacher(cls, name, user):
        job_title = cls.env['school.job.title'].search([
            ('name', '=', 'AUTH Classroom Teacher'),
        ], limit=1) or cls.env['school.job.title'].create({
            'name': 'AUTH Classroom Teacher', 'department': 'academic'})
        staff = cls.env['school.staff'].create({
            'first_name': 'Auth', 'last_name': 'Teacher', 'department': 'academic',
            'job_title_id': job_title.id, 'employment_status': 'active',
            'user_id': user.id, 'date_of_birth': '1990-01-15',
            'phone': '+2519117%05d' % cls.env['school.staff'].search_count([]),
        })
        cls.env['school.staff.responsibility'].create({
            'staff_id': staff.id, 'responsibility': 'teacher', 'is_primary': True,
            'start_date': '2026-07-01', 'department': 'academic',
        })
        staff.action_activate()
        return cls.env['school.teacher'].create({'staff_id': staff.id, 'user_id': user.id})

    @classmethod
    def _assign(cls, teacher, subject, school_class):
        cls.env['school.grade.subject'].create({
            'class_id': school_class.id, 'subject_id': subject.id,
        })
        return cls.env['school.teacher.assignment'].create({
            'teacher_id': teacher.id, 'subject_id': subject.id,
            'class_id': school_class.id, 'term_id': cls.term.id,
        })

    @classmethod
    def _student(cls, name, school_class):
        seq = cls.env['school.student'].search_count([])
        student = cls.env['school.student'].create({
            'name': name, 'class_id': school_class.id,
            'academic_year_id': school_class.academic_year_id.id,
            'date_of_birth': '2015-05-05',
            'guardian_name': 'AUTH Guardian',
            'guardian_phone': '+25191127%04d' % seq,
            'emergency_contact_name': 'AUTH Emergency',
            'emergency_contact_phone': '+25191128%04d' % seq,
            # Approval is refused without these two; see _missing_registration_fields.
            'fan_number': '10000000%08d' % seq,
            'birth_certificate': DUMMY_FILE,
            'registration_date': school_class.academic_year_id.date_start,
            'registration_status': 'approved',
        })
        student._ensure_enrollment()
        return student

    # ------------------------------------------------------------- helpers ---

    def perms(self, model, role):
        """The operations `role` may perform on `model`, as Odoo answers it."""
        user = self.roles[role]
        return ''.join(
            letter
            for letter, operation in (
                ('R', 'read'), ('W', 'write'), ('C', 'create'), ('U', 'unlink'))
            if self.env[model].with_user(user).has_access(operation)
        ) or '-'

    def as_role(self, role, model):
        return self.env[model].with_user(self.roles[role])


class TestRecordRulesCanFire(AuthorizationCase):

    def test_every_record_rule_can_fire(self):
        """No rule may govern an operation its group cannot reach.

        This is the assertion whose absence let four ACL rows disappear in a
        merge without a single test turning red. It asserts the relationship
        between the two halves of Odoo's authorization model rather than the
        contents of either one, so it stays true as the policy changes and
        fails the moment the halves drift apart.
        """
        cache = {}

        def granted(model, group):
            key = (model, group.id)
            if key not in cache:
                user = self.env['res.users'].create({
                    'name': 'probe_%s' % group.id, 'login': 'probe_%s_%s' % (group.id, model),
                    'group_ids': [(6, 0, [self.env.ref('base.group_user').id, group.id])],
                })
                cache[key] = {
                    operation
                    for operation in ('read', 'write', 'create', 'unlink')
                    if self.env[model].with_user(user).has_access(operation)
                }
            return cache[key]

        unreachable = []
        rules = self.env['ir.rule'].sudo().search([('model_id.model', 'like', 'school.%')])
        for rule in rules:
            governs = {
                operation
                for operation, flag in (
                    ('read', rule.perm_read), ('write', rule.perm_write),
                    ('create', rule.perm_create), ('unlink', rule.perm_unlink))
                if flag
            }
            if not governs:
                continue
            model = rule.model_id.model
            if model not in self.env:
                continue
            # A rule with no groups is global and applies to everyone.
            for group in rule.groups:
                if not governs & granted(model, group):
                    unreachable.append('%s on %s for %s (governs %s, ACL grants %s)' % (
                        rule.name, model, group.name,
                        sorted(governs), sorted(granted(model, group)) or 'nothing'))

        self.assertFalse(unreachable, 'Record rules that can never execute:\n  ' + '\n  '.join(unreachable))

    def test_no_model_and_group_is_declared_twice(self):
        """Odoo unions duplicate rows, so a second one only hides the real answer."""
        seen = {}
        duplicates = []
        for access in self.env['ir.model.access'].sudo().search([
            ('model_id.model', 'like', 'school.%'),
        ]):
            key = (access.model_id.model, access.group_id.name)
            if key in seen:
                duplicates.append('%s / %s' % key)
            seen[key] = access
        self.assertFalse(duplicates, 'Duplicate ACL declarations: %s' % duplicates)


class TestEffectiveAccessMatrix(AuthorizationCase):
    """The permission each role actually holds, model by model.

    Written out in full rather than derived, so widening an ACL has to be a
    deliberate edit here too. `-` means the role cannot touch the model at all.
    """

    MATRIX = {
        # model                        admin   director registrar teacher frontoffice exam_officer hr
        #
        # Nobody can delete a student, the Administrator included: no ACL row
        # grants unlink on school.student, so `rule_student_all_registrar`'s
        # unlink clause stays unreachable. That is left exactly as found. The
        # two unlink rows this change restores were provably lost in a merge;
        # this one was never granted, and whether a student record should be
        # deletable at all is a decision for the owner rather than a merge
        # repair. Recorded here so it is a stated position, not an oversight.
        'school.student':             ('RWC',  'R',  'RWC',  'R',   'R',  'R',    '-'),
        'school.mark':                ('RWCU', 'R',  'RWCU', 'RW',  '-',  'RWCU', '-'),
        'school.class':               ('RWCU', 'R',  'RWC',  'R',   '-',  'R',    '-'),
        'school.attendance':          ('RWCU', 'R',  'RWCU', 'RWC', '-',  '-',    '-'),
        'school.class.schedule':      ('RWCU', 'R',  'RWCU', 'R',   '-',  '-',    '-'),
        'school.teacher.assignment':  ('RWCU', 'R',  'RWC',  'R',   '-',  'R',    '-'),
        'school.teacher':             ('RWCU', 'R',  'RWC',  'RW',  '-',  'R',    '-'),
        'school.announcement':        ('RWCU', 'R',  'R',    'R',   'RWC', '-',   '-'),
        'school.program':             ('RWCU', 'R',  'RWCU', 'R',   '-',  '-',    '-'),
        'school.staff':               ('RWCU', 'R',  'RWCU', 'R',   'R',  '-',    'R'),
        'school.job.title':           ('RWCU', 'R',  'RWCU', 'R',   'R',  '-',    'R'),
        'school.grading.band':        ('RWCU', 'R',  'RWCU', '-',   '-',  'RWCU', '-'),
        'school.report.card':         ('RWCU', 'RW', 'RWCU', 'R',   '-',  'RWC',  '-'),
    }

    ROLES = ('admin', 'director', 'registrar', 'teacher', 'frontoffice', 'exam_officer', 'hr')

    def test_effective_access_matrix(self):
        wrong = []
        for model, expected in self.MATRIX.items():
            for role, want in zip(self.ROLES, expected):
                got = self.perms(model, role)
                if got != want:
                    wrong.append('%s / %s: expected %s, got %s' % (model, role, want, got))
        self.assertFalse(wrong, 'Effective access differs from policy:\n  ' + '\n  '.join(wrong))

    def test_director_never_holds_a_mutating_permission(self):
        """README: read-only on every academic model, no create, write or delete.

        The one documented exception is the report card, which a Director signs
        off, and the academic year correction they authorise.
        """
        allowed_to_write = {'school.report.card', 'school.academic.year.correction'}
        offenders = []
        for model in self.MATRIX:
            if model in allowed_to_write:
                continue
            for operation in ('write', 'create', 'unlink'):
                if self.env[model].with_user(self.roles['director']).has_access(operation):
                    offenders.append('%s: %s' % (model, operation))
        self.assertFalse(offenders, 'Director holds mutating access: %s' % offenders)


class TestRecordScopeSurvives(AuthorizationCase):
    """Widening a model-level ACL must not widen who sees which rows."""

    def test_director_reads_every_student_and_changes_none(self):
        students = self.as_role('director', 'school.student').search([
            ('id', 'in', (self.student_own | self.student_other).ids)])
        self.assertEqual(len(students), 2, 'Director oversight is unscoped')
        students.mapped('name')

        with self.assertRaises(AccessError):
            self.as_role('director', 'school.student').browse(
                self.student_own.id).write({'name': 'AUTH Renamed'})

    def test_front_office_reads_students_for_contact_lookup_only(self):
        students = self.as_role('frontoffice', 'school.student').search([
            ('id', 'in', (self.student_own | self.student_other).ids)])
        self.assertEqual(len(students), 2, 'contact lookup covers every student')

        with self.assertRaises(AccessError):
            self.as_role('frontoffice', 'school.student').browse(
                self.student_own.id).write({'name': 'AUTH Renamed'})

    def test_teacher_still_sees_only_their_own_class(self):
        """The over-exposure check: the Director's new ACL is on the same model."""
        visible = self.as_role('teacher', 'school.student').search([
            ('id', 'in', (self.student_own | self.student_other).ids)])
        self.assertEqual(visible, self.student_own,
                         'a teacher must not gain students from another class')

    def test_registrar_reaches_the_marks_its_record_rule_describes(self):
        """`rule_mark_all_registrar` grants every row; before this change no ACL
        row existed, so the rule could not fire and the model was unreadable.

        Row-level scoping of marks by teacher is already held by
        test_security.test_teacher_sees_marks_only_for_assigned_class_and_subject,
        which must stay green alongside this — that pair is what proves the
        widened ACL did not widen anyone's rows.
        """
        assessment = self.env['school.assessment'].create({
            'name': 'AUTH Test', 'assessment_type': 'test',
            'class_id': self.class_own.id, 'subject_id': self.subject.id,
            'term_id': self.term.id, 'date': '2049-02-01',
        })
        assessment.action_open()

        marks = self.as_role('registrar', 'school.mark').search([
            ('assessment_id', '=', assessment.id)])
        self.assertEqual(marks, assessment.mark_ids.with_user(self.roles['registrar']),
                         'the Registrar sees every mark on the assessment')
        self.assertEqual(self.perms('school.mark', 'registrar'), 'RWCU')

    def test_director_reads_marks_without_touching_them(self):
        self.assertEqual(self.perms('school.mark', 'director'), 'R')
        self.as_role('director', 'school.mark').search([])


class TestRegistrarTimetable(AuthorizationCase):
    """Registrar -> day builder -> action_build -> school.class.schedule.

    `action_build` creates schedule rows with no `sudo()`, deliberately. That
    makes the Registrar's ACL on `school.class.schedule` load-bearing: without
    it the wizard raises, which is why the timetable could not be built by the
    role whose job it is.
    """

    def test_registrar_builds_a_day_of_periods(self):
        builder = self.env['school.day.builder'].with_user(self.roles['registrar']).create({
            'class_id': self.class_own.id,
            'term_id': self.term.id,
            'day_of_week': '0',
            'first_start_time': 8.0,
            'period_minutes': 45,
            'line_ids': [(0, 0, {'subject_id': self.subject.id, 'sequence': 10})],
        })
        builder.action_build()

        built = self.as_role('registrar', 'school.class.schedule').search([
            ('class_id', '=', self.class_own.id), ('term_id', '=', self.term.id)])
        self.assertEqual(len(built), 1, 'the wizard created the period')
        self.assertEqual(built.subject_id, self.subject)
        self.assertEqual(built.teacher_id, self.teacher)
        # And the row is readable afterwards, not merely creatable.
        self.assertTrue(built.mapped('display_name'))

    def test_director_reads_the_timetable_without_changing_it(self):
        slot = self.env['school.class.schedule'].create({
            'class_id': self.class_own.id, 'term_id': self.term.id,
            'subject_id': self.subject.id, 'teacher_id': self.teacher.id,
            'teacher_assignment_id': self.assignment.id,
            'day_of_week': '1', 'start_time': 9.0, 'end_time': 9.75,
        })
        self.assertTrue(self.as_role('director', 'school.class.schedule').browse(slot.id).exists())
        with self.assertRaises(AccessError):
            self.as_role('director', 'school.class.schedule').browse(slot.id).write(
                {'start_time': 10.0})
