"""Corporate cards and the charges made on them.

Synced from a spend provider (Brex today) so a subscription can answer the
question people actually ask: *which card does this renew on, and what did we
last pay?*

Charges are stored whether or not they match a subscription. An unmatched
charge is a finding — it may be a service nobody recorded — so it is kept
visible rather than dropped.
"""
from decimal import Decimal

from django.db import models

from .users import User


class PaymentCard(models.Model):
    """A corporate card, identified to people by its last four digits."""

    PROVIDER_CHOICES = (
        ("BREX", "Brex"),
        ("MANUAL", "Entered manually"),
    )
    STATUS_CHOICES = (
        ("ACTIVE", "Active"),
        ("LOCKED", "Locked"),
        ("TERMINATED", "Terminated"),
        ("UNKNOWN", "Unknown"),
    )

    provider = models.CharField(max_length=16, choices=PROVIDER_CHOICES, default="BREX")
    external_id = models.CharField(max_length=128, blank=True, default="", db_index=True)
    last_four = models.CharField(max_length=4, db_index=True)
    nickname = models.CharField(max_length=160, blank=True, default="")
    holder_name = models.CharField(max_length=160, blank=True, default="")
    holder = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="payment_cards",
        help_text="Matched to a person by email where the provider gives one.",
    )
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="ACTIVE")
    last_synced_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["last_four"]
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "external_id"],
                condition=~models.Q(external_id=""),
                name="unique_provider_card",
            ),
        ]

    def __str__(self):
        label = self.nickname or self.holder_name or self.get_provider_display()
        return f"{label} •••• {self.last_four}"

    @property
    def display(self):
        return f"•••• {self.last_four}"


class ServicePayment(models.Model):
    """One charge on a card, optionally tied to an estate service.

    Renamed from `SubscriptionPayment` in Phase 5 along with the module it was
    named after. Model and column renames, so no row moves.

    `match_source` records *how* the link was made, so an automatic guess can
    be told apart from a human decision and corrected without being re-guessed.
    """

    MATCH_CHOICES = (
        ("AUTO", "Matched automatically"),
        ("MANUAL", "Linked by a person"),
        ("NONE", "Not matched"),
    )

    provider = models.CharField(max_length=16, default="BREX")
    external_id = models.CharField(max_length=128, db_index=True)

    merchant = models.CharField(max_length=255, blank=True, default="")
    description = models.CharField(max_length=255, blank=True, default="")
    amount = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    currency = models.CharField(max_length=3, default="USD")
    posted_at = models.DateField(db_index=True)

    card = models.ForeignKey(
        PaymentCard, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="payments",
    )
    service = models.ForeignKey(
        "Service", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="payments",
    )
    match_source = models.CharField(max_length=8, choices=MATCH_CHOICES, default="NONE")
    match_score = models.FloatField(default=0.0)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-posted_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "external_id"], name="unique_provider_payment"
            ),
        ]
        indexes = [
            models.Index(fields=["service", "-posted_at"], name="payment_svc_date_idx"),
        ]

    def __str__(self):
        return f"{self.merchant} {self.currency} {self.amount} on {self.posted_at}"
