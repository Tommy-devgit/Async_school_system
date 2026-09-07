"""Student ranking is on unless a school turns it off.

``school_ranking`` gates `_compute_rankings` on the report card: with it false
every card reports `class_rank` and `grade_rank` as 0, and the report card page
renders both as a dash. The field carried no default, so every database created
before this — including the ones already in use — sits at false, and the only
way to change it was Odoo's own back office. The ranking was built, tested and
correct, and nobody could see it.

The new default covers databases created from here on. This covers the ones
that already exist.

Only rows that are not already true are touched, so a school that deliberately
switched ranking on keeps its setting, and re-running the migration is a no-op.
A school that wants ranking off can still turn it off; nothing here forces it
back on afterwards, because this runs once at this version.
"""

import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    cr.execute("""
        UPDATE res_company
        SET school_ranking = TRUE
        WHERE school_ranking IS NOT TRUE
    """)
    if cr.rowcount:
        _logger.info('Enabled student ranking on %s company record(s).', cr.rowcount)
