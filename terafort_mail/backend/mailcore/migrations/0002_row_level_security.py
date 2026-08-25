"""Postgres row-level security: layer 3 of the four isolation layers.

This is the layer that makes the guarantee structural rather than
disciplinary. It holds when the Django code above it is wrong, when someone
writes a raw() query, and when a future contributor forgets `.for_session()`.

Two details do the work:

* ``FORCE ROW LEVEL SECURITY`` -- without it, the table owner is exempt, and
  in most deployments the app role owns the tables because it runs migrations.
  FORCE closes that.
* ``NULLIF(current_setting('app.mailbox_id', true), '')::uuid`` -- the second
  argument makes a missing setting return NULL rather than raise, and a NULL
  comparison matches no rows. An unscoped connection therefore sees nothing,
  which is the correct direction to fail in.

The app role must NOT be a superuser and must NOT have BYPASSRLS. Both bypass
all of this silently. `manage.py check_rls` verifies that at deploy time.
"""
from django.db import migrations

TABLES = [
    "mail_folder",
    "mail_message",
    "mail_search_token",
    "mail_attachment",
    "mail_pending_action",
    "mail_signature",
    "mail_template",
    "mail_shared_grant",
]

SCOPE = "NULLIF(current_setting('app.mailbox_id', true), '')::uuid"


def apply_rls(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        # SQLite (the test suite) has no RLS. The isolation harness still runs
        # its route sweep there; the RLS-specific test skips loudly.
        return
    with schema_editor.connection.cursor() as cur:
        for table in TABLES:
            cur.execute("ALTER TABLE %s ENABLE ROW LEVEL SECURITY" % table)
            cur.execute("ALTER TABLE %s FORCE ROW LEVEL SECURITY" % table)
            cur.execute(
                "CREATE POLICY mailbox_isolation ON {t} "
                "USING (mailbox_id = {scope}) "
                "WITH CHECK (mailbox_id = {scope})".format(t=table, scope=SCOPE)
            )


def drop_rls(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cur:
        for table in TABLES:
            cur.execute("DROP POLICY IF EXISTS mailbox_isolation ON %s" % table)
            cur.execute("ALTER TABLE %s NO FORCE ROW LEVEL SECURITY" % table)
            cur.execute("ALTER TABLE %s DISABLE ROW LEVEL SECURITY" % table)


class Migration(migrations.Migration):

    dependencies = [("mailcore", "0001_initial")]

    operations = [migrations.RunPython(apply_rls, drop_rls)]
