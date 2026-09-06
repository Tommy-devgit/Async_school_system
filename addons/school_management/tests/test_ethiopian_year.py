"""The Ethiopian year of a Gregorian date, including the days that have none.

The Ethiopian calendar has thirteen months. The last, Pagumē, is the five or
six intercalary days that close the year, and `datetime.date` cannot hold a
month greater than twelve — so `EthiopianDateConverter.date_to_ethiopian`
raises `ValueError: month must be in 1..12` for roughly 6–10 September every
single year.

That is not a rare edge. It took the whole test suite down on 6 September 2026,
having passed the day before, and it would have done the same every year since
the addon was written. Nothing had ever converted a date in that window.

These tests are the ones that would have caught it: they sweep the boundary
rather than sampling a convenient date, and they check the fix agrees with the
library everywhere the library can answer at all.
"""

from datetime import date, timedelta

from ethiopian_date import EthiopianDateConverter
from odoo.exceptions import ValidationError
from odoo.tests.common import TransactionCase

from ..models.school_academic_year import ethiopian_year_of


class TestEthiopianYear(TransactionCase):

    def test_the_pagume_window_resolves(self):
        """The exact days that used to raise."""
        for day in range(6, 11):
            moment = date(2026, 9, day)
            with self.subTest(moment=moment):
                self.assertEqual(
                    ethiopian_year_of(moment), 2018,
                    'Pagumē closes the Ethiopian year it belongs to, so these '
                    'days are still 2018, not yet 2019',
                )

    def test_the_new_year_boundary_is_where_it_should_be(self):
        """One day either side of Meskerem 1, which is the whole point."""
        self.assertEqual(ethiopian_year_of(date(2026, 9, 5)), 2018, 'last of Nehase')
        self.assertEqual(ethiopian_year_of(date(2026, 9, 10)), 2018, 'last of Pagumē')
        self.assertEqual(ethiopian_year_of(date(2026, 9, 11)), 2019, 'Meskerem 1')

    def test_it_agrees_with_the_library_wherever_the_library_can_answer(self):
        """The fix must not quietly change any date that already worked.

        Seven years, day by day. Where the library returns a date the answers
        must match exactly; where it raises, the fix still has to produce one.
        """
        moment = date(2024, 1, 1)
        checked = disagreements = rescued = 0
        while moment <= date(2030, 12, 31):
            resolved = ethiopian_year_of(moment)
            try:
                expected = EthiopianDateConverter.date_to_ethiopian(moment).year
            except ValueError:
                rescued += 1
            else:
                checked += 1
                if resolved != expected:
                    disagreements += 1
            moment += timedelta(days=1)

        self.assertEqual(disagreements, 0, 'the fix changed a date that already worked')
        self.assertGreater(checked, 2500, 'the sweep actually ran')
        self.assertGreaterEqual(
            rescued, 35, 'seven years should contain about five Pagumē days each')

    def test_the_year_never_goes_backwards(self):
        """A calendar year is monotonic; a fix that guessed could break that."""
        moment = date(2025, 1, 1)
        previous = ethiopian_year_of(moment)
        while moment <= date(2029, 12, 31):
            current = ethiopian_year_of(moment)
            self.assertIn(
                current - previous, (0, 1),
                'the Ethiopian year jumped at %s: %s -> %s' % (moment, previous, current),
            )
            previous = current
            moment += timedelta(days=1)

    def test_an_academic_year_can_start_during_pagume(self):
        """The constraint this feeds used the crashing call directly.

        A school whose year starts in that window could not create it at all —
        the name check raised `ValueError` rather than validating anything.
        """
        # Far enough out that the seeded years cannot collide with it, and a
        # date the library still cannot express: Pagumē 3.
        start = date(2040, 9, 8)
        expected = ethiopian_year_of(start)

        year = self.env['school.academic.year'].create({
            'name': str(expected),
            'date_start': start,
            'date_end': date(2041, 6, 30),
        })
        self.assertEqual(year.name, str(expected))

        # And the constraint still rejects a genuinely wrong name — the fix
        # made it able to answer, not willing to agree with anything.
        with self.assertRaises(ValidationError):
            self.env['school.academic.year'].create({
                'name': str(expected + 1),
                'date_start': start,
                'date_end': date(2041, 6, 30),
            })
