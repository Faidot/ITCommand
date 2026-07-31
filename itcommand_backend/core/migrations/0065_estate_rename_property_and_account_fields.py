"""Rename the estate models and account columns to the Phase 1 vocabulary.

Written by hand rather than generated. `makemigrations` cannot tell a rename
from a drop-plus-add without being asked, and answering one of those four
prompts wrongly would silently discard a populated column. Every operation here
is a rename or an in-place alter: no column is dropped, no row is rewritten
except the MFA code remap, which is reversible.

Order matters in one place. `unique_login_per_provider` covers `login_email`,
so the constraint is removed before the field it names is renamed and re-added
afterwards against the new name. Renaming underneath a live constraint is not
portable across backends.
"""

from django.db import migrations, models
import django.db.models.deletion


def key_to_security_key(apps, schema_editor):
    """`KEY` became `SECURITY_KEY` so the stored code matches its label."""
    ProviderAccount = apps.get_model("core", "ProviderAccount")
    ProviderAccount.objects.filter(mfa_type="KEY").update(mfa_type="SECURITY_KEY")


def security_key_to_key(apps, schema_editor):
    """Reverse of the above. Exact inverse: the two codes map one-to-one."""
    ProviderAccount = apps.get_model("core", "ProviderAccount")
    ProviderAccount.objects.filter(mfa_type="SECURITY_KEY").update(mfa_type="KEY")


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0064_subscription_finance_links"),
    ]

    operations = [
        # ── 1. DigitalProperty -> Property ────────────────────────────────
        migrations.RenameModel(
            old_name="DigitalProperty",
            new_name="Property",
        ),
        migrations.AlterModelOptions(
            name="property",
            options={
                "ordering": ["name"],
                "verbose_name_plural": "properties",
            },
        ),
        migrations.AlterField(
            model_name="property",
            name="owner",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="owned_properties",
                to="core.user",
            ),
        ),
        migrations.AlterField(
            model_name="property",
            name="department",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="properties",
                to="core.department",
            ),
        ),
        # ── 2. ProviderAccount column renames ─────────────────────────────
        # The constraint names login_email; drop it before the rename.
        migrations.RemoveConstraint(
            model_name="provideraccount",
            name="unique_login_per_provider",
        ),
        migrations.RenameField(
            model_name="provideraccount",
            old_name="login_email",
            new_name="account_email",
        ),
        migrations.RenameField(
            model_name="provideraccount",
            old_name="auth_method",
            new_name="auth_type",
        ),
        migrations.RenameField(
            model_name="provideraccount",
            old_name="mfa_method",
            new_name="mfa_type",
        ),
        migrations.AddConstraint(
            model_name="provideraccount",
            constraint=models.UniqueConstraint(
                fields=("provider", "account_email"),
                name="unique_login_per_provider",
            ),
        ),
        migrations.AlterModelOptions(
            name="provideraccount",
            options={"ordering": ["provider__name", "account_email"]},
        ),
        # ── 3. New choice sets on the renamed columns ─────────────────────
        migrations.AlterField(
            model_name="provideraccount",
            name="auth_type",
            field=models.CharField(
                choices=[
                    ("PASSWORD", "Password"),
                    ("SSO", "Single sign-on"),
                    ("API_KEY", "API key"),
                    ("IAM", "IAM / identity centre"),
                    ("OTHER", "Other"),
                ],
                default="PASSWORD",
                max_length=16,
            ),
        ),
        migrations.AlterField(
            model_name="provideraccount",
            name="mfa_type",
            field=models.CharField(
                choices=[
                    ("SECURITY_KEY", "Security key"),
                    ("APP", "Authenticator app"),
                    ("SMS", "SMS"),
                    ("NONE", "None"),
                    ("UNKNOWN", "Not recorded"),
                ],
                default="UNKNOWN",
                help_text=(
                    "'Not recorded' is not the same as 'none' — leave it until "
                    "someone checks."
                ),
                max_length=16,
            ),
        ),
        # Runs after the choices are widened, so the new code is already legal.
        migrations.RunPython(key_to_security_key, security_key_to_key),
        migrations.AddIndex(
            model_name="provideraccount",
            index=models.Index(fields=["mfa_type"], name="estate_acct_mfa_idx"),
        ),
    ]
