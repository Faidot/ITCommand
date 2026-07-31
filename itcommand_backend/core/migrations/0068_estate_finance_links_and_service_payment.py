"""Prepare for retirement: move every remaining link onto `Service`.

Hand-written so the destructive part can live in its own migration. Left to
itself, `makemigrations` folds these additive changes and the eleven model
deletions into one file, which would make "drop the old modules" impossible to
review, roll back, or postpone independently. 0069 does the deleting.

Four fields are added to `Service` that are not in the estate spec's field
list. Each exists because retiring `Subscription` without it would have deleted
a working feature by omission:

* `budget_category` — the Cost Overview's budget-impact panel
* `vendor` — vendor annual-commitment reporting
* `billing_descriptor` — Brex's authoritative card-charge match
* `payment_card` — "which card is this on", the question Brex exists to answer

The `linked_*` columns on Expense and RecurringBill are dropped and re-added
rather than renamed. A rename would keep the column's contents, which are
`Subscription` primary keys; pointed at `Service` those become silent
mis-references to unrelated rows. All four columns are empty (verified in the
Phase 0 audit: 0 populated rows on every one), so nothing is lost by dropping
them, and correctness is provable rather than argued.
"""

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0067_estate_rbac_module"),
    ]

    operations = [
        # ── 1. Service gains the links the old model carried ────────────────
        migrations.AddField(
            model_name="service",
            name="budget_category",
            field=models.ForeignKey(
                blank=True,
                help_text="Rolls this service's cost into the budget view.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="estate_services",
                to="core.budgetcategory",
            ),
        ),
        migrations.AddField(
            model_name="service",
            name="vendor",
            field=models.ForeignKey(
                blank=True,
                help_text="Link when the provider is also invoiced as a vendor.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="estate_services",
                to="core.vendor",
            ),
        ),
        migrations.AddField(
            model_name="service",
            name="billing_descriptor",
            field=models.CharField(
                blank=True,
                default="",
                help_text="How this appears on the card statement, for payment matching.",
                max_length=160,
            ),
        ),
        migrations.AddField(
            model_name="service",
            name="payment_card",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="estate_services",
                to="core.paymentcard",
            ),
        ),
        # ── 2. The one subscription setting that outlives the module ────────
        migrations.AddField(
            model_name="estatesettings",
            name="create_expense_on_renewal",
            field=models.BooleanField(
                default=False,
                help_text=(
                    "Record an Expense against the budget category when a "
                    "service renews."
                ),
            ),
        ),
        # ── 3. SubscriptionPayment -> ServicePayment ────────────────────────
        migrations.RemoveIndex(
            model_name="subscriptionpayment",
            name="payment_sub_date_idx",
        ),
        migrations.RenameModel(
            old_name="SubscriptionPayment",
            new_name="ServicePayment",
        ),
        migrations.RemoveField(
            model_name="servicepayment",
            name="subscription",
        ),
        migrations.AddField(
            model_name="servicepayment",
            name="service",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="payments",
                to="core.service",
            ),
        ),
        migrations.AddIndex(
            model_name="servicepayment",
            index=models.Index(
                fields=["service", "-posted_at"], name="payment_svc_date_idx"
            ),
        ),
        # ── 4. Finance links repointed ──────────────────────────────────────
        migrations.RemoveField(
            model_name="expense",
            name="linked_license",
        ),
        migrations.RemoveField(
            model_name="expense",
            name="linked_subscription",
        ),
        migrations.AddField(
            model_name="expense",
            name="linked_service",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="expenses",
                to="core.service",
            ),
        ),
        migrations.RemoveField(
            model_name="recurringbill",
            name="linked_subscription",
        ),
        migrations.AddField(
            model_name="recurringbill",
            name="linked_service",
            field=models.ForeignKey(
                blank=True,
                help_text="The estate service this bill was raised from, if any.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="recurring_bills",
                to="core.service",
            ),
        ),
    ]
