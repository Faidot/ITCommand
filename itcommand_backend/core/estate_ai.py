"""Turn pasted notes into estate rows, using Gemini for the reading only.

The division of labour is the whole design:

* **the model reads** — it pulls provider, login, cost and dates out of prose
  that no parser could anticipate;
* **the importer decides** — everything it proposes goes through
  `estate_import.validate_records`, the same function an uploaded spreadsheet
  goes through. A hallucinated billing cycle is rejected exactly as a typo
  would be, and nothing is written until somebody presses Import.

It is told to ask rather than guess. A required field the text does not
support becomes a question on screen; the alternative is an invented renewal
date imported silently, which is the worst outcome available here.

What leaves the building: the text pasted in, plus the names of existing
providers and properties so the model matches rather than invents. No
credential, no vault entry, no cost history.
"""
import json

from core import estate, estate_import, gemini


#: The columns the model fills. The master sheet's, so its output goes through
#: the same validator as an uploaded file with no translation step.
SPEC_KEY = "master"

#: Enough context to match existing records; small enough to stay cheap.
MAX_CONTEXT_ROWS = 120


def _context():
    """Existing names, so "AWS" matches the AWS you already have."""
    from core.models import Property, Provider, User

    return {
        "providers": list(
            Provider.objects.order_by("name").values_list("name", flat=True)[:MAX_CONTEXT_ROWS]
        ),
        "properties": list(
            Property.objects.order_by("name").values_list("name", flat=True)[:MAX_CONTEXT_ROWS]
        ),
        "users": list(
            User.objects.filter(is_active=True)
            .order_by("email")
            .values_list("email", flat=True)[:MAX_CONTEXT_ROWS]
        ),
    }


def build_prompt(raw_text, answers=None):
    """The instruction sent to Gemini. No secrets, no ids — names only."""
    spec = estate_import.build_specs()[SPEC_KEY]
    context = _context()

    columns = []
    for column in spec.columns:
        entry = {"name": column.name, "required": column.required, "means": column.help}
        if column.choices:
            entry["one_of"] = [code for code, _ in column.choices]
        columns.append(entry)

    answered = ""
    if answers:
        # Answers are appended rather than merged into the rows, so the model
        # re-reads the notes with the clarification rather than being handed a
        # half-parsed result to trust.
        pairs = "\n".join(f"- {q}: {a}" for q, a in answers.items() if a)
        if pairs:
            answered = (
                "\n\nThe person has already answered these questions. Treat the "
                f"answers as fact and do not ask them again:\n{pairs}\n"
            )

    return f"""You are reading a colleague's rough notes about software and
infrastructure a company pays for, and turning them into rows for an import.

Return JSON of exactly this shape:
{{
  "rows": [ {{ "<column name>": "<value as text>" }} ],
  "questions": [ {{ "id": "short-slug", "ask": "A direct question", "why": "What it decides" }} ],
  "notes": [ "Anything you inferred that the reader should check" ]
}}

The columns, and what each means:
{json.dumps(columns, indent=1)}

Rules, in order of importance:

1. Never invent a value. If the notes do not support a REQUIRED column for a
   row, leave that cell empty and add a question asking for it. A wrong value
   imported silently is far worse than a question on screen.
2. Use only the codes listed in "one_of" for those columns. If the notes
   describe something with no matching code, ask rather than picking the
   nearest.
3. Match these existing records exactly when the notes mean one of them —
   spelling, case and all — rather than creating a near-duplicate:
   providers: {json.dumps(context['providers'])}
   properties: {json.dumps(context['properties'])}
   known user emails: {json.dumps(context['users'])}
4. One row per paid thing. A single provider paying for three services is
   three rows sharing a Provider and Account email.
5. Money: digits only, no currency symbol — the currency goes in its own
   column. Dates: YYYY-MM-DD.
6. If the notes contain anything that looks like a password, API key or card
   number, ignore it completely and add a note saying you did. It must never
   appear in a row.
7. Put anything you inferred rather than read — a guessed billing cycle, an
   assumed currency — in "notes" so the reader can check it.

Ask at most 6 questions. Prefer one question that unblocks several rows over
six narrow ones.{answered}

The notes:
---
{raw_text}
---"""


def parse(integration, raw_text, answers=None):
    """Read notes into rows. Returns (records, questions, notes). Writes nothing.

    Raises `gemini.GeminiError` — the caller turns that into a message. This
    function deliberately does no validation of its own: the records go
    straight to `estate_import.validate_records`, so there is one set of rules
    rather than two that can disagree.
    """
    text = (raw_text or "").strip()
    if not text:
        raise gemini.GeminiError("Paste some notes first.")
    if len(text) > gemini.MAX_INPUT_CHARS:
        raise gemini.GeminiError(
            f"That is longer than {gemini.MAX_INPUT_CHARS:,} characters. "
            "Paste it in a couple of batches."
        )

    body = gemini.generate_json(integration, build_prompt(text, answers))

    spec = estate_import.build_specs()[SPEC_KEY]
    known = {column.name for column in spec.columns}

    records = []
    for index, row in enumerate(body.get("rows") or [], start=1):
        if not isinstance(row, dict):
            continue
        # Only columns the spec defines. A model that invents a column would
        # otherwise have its value silently dropped further down, where it
        # would be much harder to notice.
        record = {"__row__": index}
        for key, value in row.items():
            if key in known:
                record[key] = "" if value is None else str(value)
        records.append(record)

    questions = []
    for item in body.get("questions") or []:
        if isinstance(item, dict) and item.get("ask"):
            questions.append({
                "id": str(item.get("id") or f"q{len(questions) + 1}")[:64],
                "ask": str(item["ask"])[:300],
                "why": str(item.get("why") or "")[:300],
            })

    notes = [str(n)[:300] for n in (body.get("notes") or []) if n][:12]
    return records, questions[:6], notes
