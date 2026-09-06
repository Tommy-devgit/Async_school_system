"""Shared academic-year helpers for the test suite.

`school.academic.year` names a year by the Ethiopian year of its Gregorian
`date_start`, and the name is unique. Two consequences shape every fixture here:

* a fixture cannot hardcode a Gregorian label like ``2048/2049`` — the name has
  to be derived from the dates it actually uses;
* the database holds at most one academic year per Ethiopian year, and the
  seeded years already occupy the ones around today, so a test needing a year
  that contains today adjusts the seeded current year instead of creating a
  second year for the same Ethiopian year.
"""

from dateutil.relativedelta import relativedelta
from ethiopian_date import EthiopianDateConverter
from odoo import fields

from ..models.school_academic_year import ethiopian_year_of

# `to_gregorian` is still the library's, and safely so: it builds a Gregorian
# date, which can always be represented. Only the other direction can produce
# the thirteenth month that `datetime.date` refuses.

SEEDED_CURRENT_YEAR = 'school_management.academic_year_2026_2027'


def ethiopian_year_name(date_start):
    """The name `school.academic.year` expects for a year starting on this date.

    Deliberately the model's own `ethiopian_year_of` rather than a second call
    into the library: a fixture that names a year differently from the way the
    constraint checks it would fail for reasons that have nothing to do with
    the test. It also means these fixtures survive Pagumē, which the library
    cannot represent.
    """
    if isinstance(date_start, str):
        date_start = fields.Date.to_date(date_start)
    return str(ethiopian_year_of(date_start))


def academic_year(env, date_start, date_end, **values):
    """Create an academic year named after the Ethiopian year of its start date."""
    return env['school.academic.year'].create(dict(
        values,
        name=ethiopian_year_name(date_start),
        date_start=date_start,
        date_end=date_end,
    ))


def year_spanning_today(env, months_ahead=12):
    """The seeded current year, widened so that it contains today.

    Its start moves to the first day of the Ethiopian year its name refers to,
    which keeps the name valid while putting the start safely in the past.
    """
    year = env.ref(SEEDED_CURRENT_YEAR)
    today = fields.Date.context_today(year)
    year.write({
        'date_start': EthiopianDateConverter.to_gregorian(int(year.name), 1, 1),
        'date_end': today + relativedelta(months=months_ahead),
    })
    return year
