"""Bulk import for the Digital Estate, from a spreadsheet people fill in.

The shape of this is deliberate: **download a template, fill it, validate it,
then commit it.** Validation is a separate step that writes nothing, because
the failure mode that matters is a 300-row sheet with a typo on row 147 — and
finding that out by having rows 1-146 imported and the rest abandoned is worse
than not importing at all.

So:

* the template carries the exact headers, an example row and a Reference sheet
  listing every code that will be accepted, because "what can I put in this
  column?" is otherwise a support question;
* validation reports every bad row at once, not the first one, since fixing a
  spreadsheet one error per round trip is miserable;
* commit runs in a single transaction and re-validates. Nothing lands unless
  all of it lands.

Lookups are by human-readable value (a provider's name, a person's email, a
property's name) rather than database id. Nobody filling in a spreadsheet
knows an id, and a template full of them would be unusable.
"""
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from io import BytesIO
from typing import Callable

from django.db import transaction

from core import estate


# ---------------------------------------------------------------------------
# Column specification
# ---------------------------------------------------------------------------

@dataclass
class Column:
    """One spreadsheet column and how to turn its text into a field value."""

    name: str
    help: str
    required: bool = False
    #: Accepted codes, shown on the Reference sheet. Empty means free text.
    choices: tuple = ()
    example: str = ""
    #: Resolves the cleaned string to a model value. Raises ValueError to
    #: reject the row with a message the person can act on.
    resolve: Callable | None = None


@dataclass
class ImportSpec:
    key: str
    label: str
    model_path: str
    columns: list[Column]
    #: Fields that identify an existing row, for update-instead-of-duplicate.
    match_on: tuple = ()
    #: Extra work after the field map is built, e.g. deriving one field from
    #: another. Receives (values dict) and may raise ValueError.
    finalise: Callable | None = None
    notes: str = ""

    def column(self, name):
        for c in self.columns:
            if c.name == name:
                return c
        return None


# ---------------------------------------------------------------------------
# Cell coercion
# ---------------------------------------------------------------------------

TRUE_WORDS = {"yes", "y", "true", "1", "on"}
FALSE_WORDS = {"no", "n", "false", "0", "off"}


def as_text(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        # openpyxl reads unformatted numbers as floats; "4242.0" is never what
        # somebody typed into a last-four or a quantity column.
        return str(int(value))
    return str(value).strip()


def as_bool(raw, column):
    text = raw.strip().lower()
    if text in TRUE_WORDS:
        return True
    if text in FALSE_WORDS:
        return False
    raise ValueError(f"{column}: use Yes or No, not {raw!r}.")


def as_date(raw, column):
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"{column}: {raw!r} is not a date. Use YYYY-MM-DD.")


def as_decimal(raw, column):
    try:
        # Thousands separators are what a spreadsheet produces when somebody
        # formats the column, and rejecting them would be pedantry.
        return Decimal(raw.replace(",", "").replace(" ", ""))
    except (InvalidOperation, AttributeError):
        raise ValueError(f"{column}: {raw!r} is not a number.")


def as_choice(raw, column, choices):
    upper = raw.strip().upper().replace(" ", "_")
    valid = {c[0] for c in choices}
    if upper in valid:
        return upper
    # Accept the human label too — somebody reading "Monthly" in the Reference
    # sheet will reasonably type "Monthly" rather than "MONTHLY".
    by_label = {str(c[1]).strip().upper(): c[0] for c in choices}
    if raw.strip().upper() in by_label:
        return by_label[raw.strip().upper()]
    raise ValueError(
        f"{column}: {raw!r} is not valid. Use one of: {', '.join(sorted(valid))}."
    )


# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------

def find_provider(raw, column):
    from core.models import Provider

    provider = (
        Provider.objects.filter(name__iexact=raw).first()
        or Provider.objects.filter(slug__iexact=raw).first()
    )
    if not provider:
        raise ValueError(f"{column}: no provider called {raw!r}. Add it first.")
    return provider


def find_user(raw, column):
    from core.models import User

    user = User.objects.filter(email__iexact=raw).first()
    if not user:
        raise ValueError(f"{column}: no user with email {raw!r}.")
    return user


def find_property(raw, column):
    from core.models import Property

    prop = Property.objects.filter(name__iexact=raw).first()
    if not prop:
        raise ValueError(f"{column}: no property called {raw!r}.")
    return prop


def find_department(raw, column):
    from core.models import Department

    dept = Department.objects.filter(name__iexact=raw).first()
    if not dept:
        raise ValueError(f"{column}: no department called {raw!r}.")
    return dept


# ---------------------------------------------------------------------------
# Specs
# ---------------------------------------------------------------------------

def build_specs():
    """Built lazily so model imports stay out of module import time."""
    kinds = tuple(estate.PROPERTY_KINDS)

    properties = ImportSpec(
        key="properties",
        label="Properties",
        model_path="core.Property",
        match_on=("name",),
        notes="A property is the thing you own — a domain, an app, a site.",
        columns=[
            Column("Name", "Unique. Existing names are updated, not duplicated.",
                   required=True, example="terafort.com"),
            Column("Kind", "What sort of property this is.", required=True,
                   choices=kinds, example=kinds[0][0] if kinds else "",
                   resolve=lambda raw, col: as_choice(raw, col, kinds)),
            Column("Owner email", "Must match an existing user.",
                   example="sam@example.com", resolve=find_user),
            Column("Department", "Must match an existing department name.",
                   example="IT", resolve=find_department),
            Column("Active", "Yes or No. Defaults to Yes.", example="Yes",
                   resolve=as_bool),
            Column("Notes", "Free text.", example=""),
        ],
    )

    accounts = ImportSpec(
        key="accounts",
        label="Provider accounts",
        model_path="core.ProviderAccount",
        match_on=("provider", "account_email"),
        notes=(
            "One login at a provider. Credentials are never imported — attach "
            "a vault entry from the account screen afterwards."
        ),
        columns=[
            Column("Provider", "Provider name or slug. Must already exist.",
                   required=True, example="Cloudflare", resolve=find_provider),
            Column("Account email", "The login. Unique per provider.",
                   required=True, example="ops@example.com"),
            Column("Auth type", "How you sign in.", choices=estate.AUTH_TYPES,
                   example="PASSWORD",
                   resolve=lambda raw, col: as_choice(raw, col, estate.AUTH_TYPES)),
            Column("MFA type", "Second factor, if any.", choices=estate.MFA_TYPES,
                   example="APP",
                   resolve=lambda raw, col: as_choice(raw, col, estate.MFA_TYPES)),
            Column("Owner email", "Must match an existing user.",
                   example="sam@example.com", resolve=find_user),
            Column("Console URL", "Where you log in.",
                   example="https://dash.cloudflare.com"),
            Column("Active", "Yes or No. Defaults to Yes.", example="Yes",
                   resolve=as_bool),
            Column("Notes", "Free text.", example=""),
        ],
    )

    def _derive_provider(values):
        # Service.provider is PROTECTed and non-null, and is always the
        # account's provider. Asking for it twice invites the two disagreeing.
        account = values.get("provider_account")
        if account is not None:
            values["provider"] = account.provider

    services = ImportSpec(
        key="services",
        label="Services",
        model_path="core.Service",
        match_on=("provider_account", "identifier"),
        notes=(
            "A billable thing. The provider is taken from the account, so it "
            "is not a column — it cannot disagree with the login that pays."
        ),
        columns=[
            Column("Provider", "Provider name or slug of the paying account.",
                   required=True, example="Cloudflare"),
            Column("Account email", "Which login at that provider pays for it.",
                   required=True, example="ops@example.com"),
            Column("Service type", "Its role in the stack.", required=True,
                   choices=estate.SERVICE_TYPES, example="DNS",
                   resolve=lambda raw, col: as_choice(raw, col, estate.SERVICE_TYPES)),
            Column("Identifier", "What it is called on the invoice or console.",
                   required=True, example="terafort.com DNS"),
            Column("Property", "What it keeps running. Blank means orphaned.",
                   example="terafort.com", resolve=find_property),
            Column("Status", "Current state.", choices=estate.SERVICE_STATUSES,
                   example="ACTIVE",
                   resolve=lambda raw, col: as_choice(raw, col, estate.SERVICE_STATUSES)),
            Column("Renewal date", "YYYY-MM-DD. Blank if it does not renew.",
                   example="2027-01-31", resolve=as_date),
            Column("Auto renew", "Yes or No.", example="Yes", resolve=as_bool),
            Column("Cost", "Per billing cycle. Numbers only.", example="1200",
                   resolve=as_decimal),
            Column("Currency", "Three-letter code.", example="PKR"),
            Column("Billing cycle", "How often it is charged.",
                   choices=estate.BILLING_CYCLES, example="YEARLY",
                   resolve=lambda raw, col: as_choice(raw, col, estate.BILLING_CYCLES)),
            Column("Console URL", "Where it is managed.", example=""),
            Column("Billing descriptor", "How it appears on the card statement.",
                   example=""),
            Column("Notes", "Free text.", example=""),
        ],
        finalise=_derive_provider,
    )

    return {s.key: s for s in (properties, accounts, services)}


#: Column name -> model field. Kept apart from the spec so the sheet can be
#: worded for people while the model keeps its own names.
FIELD_MAP = {
    "properties": {
        "Name": "name", "Kind": "kind", "Owner email": "owner",
        "Department": "department", "Active": "is_active", "Notes": "notes",
    },
    "accounts": {
        "Provider": "provider", "Account email": "account_email",
        "Auth type": "auth_type", "MFA type": "mfa_type", "Owner email": "owner",
        "Console URL": "console_url", "Active": "is_active", "Notes": "notes",
    },
    "services": {
        "Service type": "service_type", "Identifier": "identifier",
        "Property": "property", "Status": "status", "Renewal date": "renewal_date",
        "Auto renew": "auto_renew", "Cost": "cost", "Currency": "currency",
        "Billing cycle": "billing_cycle", "Console URL": "console_url",
        "Billing descriptor": "billing_descriptor", "Notes": "notes",
    },
}


# ---------------------------------------------------------------------------
# Template
# ---------------------------------------------------------------------------

def build_template(spec):
    """An .xlsx with headers, an example row, guidance and valid codes."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = spec.label[:31]

    header_fill = PatternFill("solid", fgColor="1F2937")
    required_fill = PatternFill("solid", fgColor="7F1D1D")

    for i, col in enumerate(spec.columns, start=1):
        cell = ws.cell(row=1, column=i, value=col.name)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = required_fill if col.required else header_fill
        cell.alignment = Alignment(vertical="center", wrap_text=True)

        # Row 2 explains the column, row 3 shows one filled-in example. Both
        # are removed on import, so the sheet can be handed back as-is.
        ws.cell(row=2, column=i, value=col.help).font = Font(italic=True, size=9, color="6B7280")
        ws.cell(row=3, column=i, value=col.example)

        width = max(len(col.name), min(38, len(col.help) // 2), 14)
        ws.column_dimensions[get_column_letter(i)].width = width + 2

    ws.freeze_panes = "A4"

    guide = wb.create_sheet("Reference")
    guide.append(["Read this first"])
    guide["A1"].font = Font(bold=True, size=13)
    for line in [
        spec.notes,
        "",
        "Row 1 is the header — do not rename or reorder it.",
        "Row 2 is guidance and row 3 is an example. Both are ignored on import;",
        "you may overwrite them or leave them in place.",
        "Columns shaded dark red are required.",
        "Blank cells are left at their default rather than cleared.",
        "",
        "Upload validates the whole sheet before writing anything. If any row",
        "fails, nothing is imported — fix the sheet and upload it again.",
        "",
    ]:
        guide.append([line])

    for col in spec.columns:
        if not col.choices:
            continue
        guide.append([])
        guide.append([f"{col.name} — accepted values"])
        guide.cell(row=guide.max_row, column=1).font = Font(bold=True)
        for code, label in col.choices:
            guide.append([code, str(label)])
    guide.column_dimensions["A"].width = 30
    guide.column_dimensions["B"].width = 46

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()


# ---------------------------------------------------------------------------
# Reading and validating
# ---------------------------------------------------------------------------

@dataclass
class RowResult:
    row: int
    values: dict = field(default_factory=dict)
    errors: list = field(default_factory=list)
    action: str = "create"  # or "update"


#: Row 1 headers, 2 guidance, 3 example. Data starts at 4 — but a sheet where
#: somebody deleted the guidance rows is still accepted, see `_first_data_row`.
HEADER_ROW = 1


def _first_data_row(ws, spec):
    """Skip the guidance and example rows if they are still present.

    People delete them, keep them, or overwrite the example with real data.
    All three have to work, so the rows are detected rather than assumed.
    """
    first_col = spec.columns[0].name
    for row_idx in (2, 3):
        value = as_text(ws.cell(row=row_idx, column=1).value)
        if value in (spec.columns[0].help, spec.columns[0].example) and value != "":
            continue
        return row_idx
    return 4


def read_rows(file_obj, spec, limit=2000):
    """Parse and validate. Returns (results, sheet_errors). Writes nothing."""
    from openpyxl import load_workbook

    try:
        wb = load_workbook(file_obj, data_only=True, read_only=True)
    except Exception:
        return [], ["That file could not be read as an .xlsx workbook."]

    ws = wb[wb.sheetnames[0]]
    headers = [as_text(c.value) for c in next(ws.iter_rows(min_row=1, max_row=1))]

    expected = [c.name for c in spec.columns]
    missing = [h for h in expected if h not in headers]
    if missing:
        return [], [
            "The header row does not match the template. Missing column(s): "
            + ", ".join(missing)
            + ". Download a fresh template rather than editing the headers."
        ]

    index = {h: i for i, h in enumerate(headers)}
    start = _first_data_row(ws, spec)
    field_map = FIELD_MAP[spec.key]

    results = []
    seen_keys = {}
    for row_idx, raw_row in enumerate(
        ws.iter_rows(min_row=start, values_only=True), start=start
    ):
        cells = [as_text(v) for v in raw_row]
        if not any(cells):
            continue  # blank spacer row
        if len(results) >= limit:
            return results, [
                f"That sheet has more than {limit} rows. Split it and import in batches."
            ]

        result = RowResult(row=row_idx)
        for col in spec.columns:
            pos = index[col.name]
            raw = cells[pos] if pos < len(cells) else ""

            if not raw:
                if col.required:
                    result.errors.append(f"{col.name} is required.")
                continue

            try:
                value = col.resolve(raw, col.name) if col.resolve else raw
            except ValueError as exc:
                result.errors.append(str(exc))
                continue

            target = field_map.get(col.name)
            if target:
                result.values[target] = value
            else:
                result.values[f"_{col.name}"] = value

        if spec.finalise and not result.errors:
            try:
                spec.finalise(result.values)
            except ValueError as exc:
                result.errors.append(str(exc))

        results.append(result)

    _resolve_service_accounts(spec, results)
    _mark_duplicates(spec, results, seen_keys)
    _mark_existing(spec, results)
    return results, []


def _resolve_service_accounts(spec, results):
    """Turn the service sheet's Provider + Account email into one account."""
    if spec.key != "services":
        return
    from core.models import ProviderAccount

    for result in results:
        provider_raw = result.values.pop("_Provider", None)
        email_raw = result.values.pop("_Account email", None)
        if result.errors and (provider_raw is None or email_raw is None):
            continue
        if not provider_raw or not email_raw:
            continue
        try:
            provider = find_provider(provider_raw, "Provider")
        except ValueError as exc:
            result.errors.append(str(exc))
            continue
        account = ProviderAccount.objects.filter(
            provider=provider, account_email__iexact=email_raw
        ).first()
        if not account:
            result.errors.append(
                f"Account email: {email_raw!r} is not an account at {provider.name}. "
                "Import the account first, or fix the spelling."
            )
            continue
        result.values["provider_account"] = account
        result.values["provider"] = provider


def _row_key(spec, values):
    parts = []
    for f in spec.match_on:
        value = values.get(f)
        parts.append(str(getattr(value, "pk", value)).lower() if value is not None else "")
    return tuple(parts)


def _mark_duplicates(spec, results, seen):
    """Two rows describing the same record is a mistake worth naming."""
    for result in results:
        if result.errors or not spec.match_on:
            continue
        key = _row_key(spec, result.values)
        if not any(key):
            continue
        if key in seen:
            result.errors.append(
                f"This is the same record as row {seen[key]}. Remove one of them."
            )
        else:
            seen[key] = result.row


def _mark_existing(spec, results):
    """Flag rows that will update rather than create."""
    from django.apps import apps

    if not spec.match_on:
        return
    model = apps.get_model(spec.model_path)
    for result in results:
        if result.errors:
            continue
        lookup = {}
        for f in spec.match_on:
            value = result.values.get(f)
            if value is None:
                lookup = {}
                break
            lookup[f] = value
        if not lookup:
            continue
        if model.objects.filter(**lookup).exists():
            result.action = "update"


# ---------------------------------------------------------------------------
# Commit
# ---------------------------------------------------------------------------

@transaction.atomic
def commit(spec, results):
    """Write every row, or none. Returns (created, updated).

    Atomic on purpose: a partial import leaves somebody reconciling a
    spreadsheet against a database by hand, which is worse than a failed
    upload.
    """
    from django.apps import apps

    if any(r.errors for r in results):
        raise ValueError("Refusing to import a sheet that has errors.")

    model = apps.get_model(spec.model_path)
    created = updated = 0

    for result in results:
        values = dict(result.values)
        lookup = {f: values.pop(f) for f in spec.match_on if f in values}
        if lookup and model.objects.filter(**lookup).exists():
            obj = model.objects.get(**lookup)
            for k, v in values.items():
                setattr(obj, k, v)
            obj.full_clean(exclude=[f.name for f in obj._meta.fields if f.name not in values])
            obj.save()
            updated += 1
        else:
            obj = model(**{**lookup, **values})
            obj.full_clean()
            obj.save()
            created += 1

    return created, updated
