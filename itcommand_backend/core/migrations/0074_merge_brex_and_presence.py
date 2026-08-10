"""Rejoin two migration branches that both numbered themselves 0070.

The Brex review and the RBAC/presence fix were developed in parallel off
0069, so each produced its own 0070 and the graph ended up with two leaves —
which Django refuses to run.

A merge migration rather than a renumber, deliberately: renaming
0070_user_presence would make Django treat it as unapplied on any database
that already has it, and try to add columns that are already there. This
carries no operations; it only records that both branches are now one line.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0070_user_presence'),
        ('core', '0073_payment_match_source_label'),
    ]

    operations = [
    ]
