"""Bulk import endpoints for the Digital Estate.

Three steps, deliberately separate:

* ``GET  /estate/import/template/?resource=services`` — the blank sheet
* ``POST /estate/import/validate/`` — checks a filled sheet, writes nothing
* ``POST /estate/import/commit/``   — imports it, all rows or none

Splitting validate from commit is the whole point. A 300-row sheet with a typo
on row 147 should tell you about row 147 *before* rows 1-146 are in the
database, and the only way to promise that is to check everything first and
write inside one transaction.

Admin-only. Bulk creation across a whole module is not the same authority as
editing one record, so it sits behind IsAdminOrSuperadmin rather than the
estate module's `add` permission — a role can be granted estate editing
without being handed the ability to write a thousand rows in one request.
"""
from django.http import HttpResponse
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from core import estate_ai, estate_import, gemini
from core.mixins import AuditLogMixin
from core.permissions import IsAdminOrSuperadmin


#: Uploads are held in memory while openpyxl reads them, so the ceiling is
#: about protecting the worker rather than the disk.
MAX_UPLOAD_BYTES = 5 * 1024 * 1024


def _spec_or_400(request):
    specs = estate_import.build_specs()
    key = (request.query_params.get("resource") or request.data.get("resource") or "").strip()
    if key not in specs:
        return None, Response(
            {"detail": f"Unknown resource. Choose one of: {', '.join(specs)}."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return specs[key], None


def _file_or_400(request):
    upload = request.FILES.get("file")
    if not upload:
        return None, Response(
            {"detail": "Attach the filled-in template as `file`."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if upload.size > MAX_UPLOAD_BYTES:
        return None, Response(
            {"detail": f"That file is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)}MB. Split it into batches."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not upload.name.lower().endswith(".xlsx"):
        return None, Response(
            {"detail": "Upload the .xlsx template. .csv and .xls are not read."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return upload, None


def _report(results, sheet_errors):
    """The shape the UI renders: a per-row verdict plus a summary."""
    rows = [
        {
            "row": r.row,
            "action": r.action,
            "errors": r.errors,
            "plan_new": r.plan_new,
            # A short human summary of the row, so the report is readable
            # without cross-referencing the spreadsheet.
            "summary": " · ".join(
                str(getattr(v, "name", None) or getattr(v, "email", None) or v)
                for v in list(r.values.values())[:3]
            ),
        }
        for r in results
    ]
    bad = [r for r in results if r.errors]
    # Deduplicated across the sheet: twenty services at one new provider is
    # one provider to create, and saying so twenty times would bury the point.
    will_create = []
    for r in results:
        for item in r.plan_new:
            if item not in will_create:
                will_create.append(item)

    return {
        "sheet_errors": sheet_errors,
        "will_create": will_create,
        "rows": rows,
        "total": len(results),
        "valid": len(results) - len(bad),
        "invalid": len(bad),
        "to_create": sum(1 for r in results if not r.errors and r.action == "create"),
        "to_update": sum(1 for r in results if not r.errors and r.action == "update"),
        "can_commit": bool(results) and not bad and not sheet_errors,
    }


class EstateImportOptionsView(APIView):
    """What can be imported, and what each sheet expects."""

    permission_classes = [permissions.IsAuthenticated, IsAdminOrSuperadmin]

    def get(self, request):
        specs = estate_import.build_specs()
        return Response({
            "resources": [
                {
                    "key": s.key,
                    "label": s.label,
                    "notes": s.notes,
                    "creates": list(s.creates),
                    "columns": [
                        {
                            "name": c.name,
                            "help": c.help,
                            "required": c.required,
                            "choices": [code for code, _ in c.choices],
                        }
                        for c in s.columns
                    ],
                }
                for s in specs.values()
            ]
        })


class EstateImportTemplateView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminOrSuperadmin]

    def get(self, request):
        spec, error = _spec_or_400(request)
        if error:
            return error
        content = estate_import.build_template(spec)
        response = HttpResponse(
            content,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="estate-{spec.key}-template.xlsx"'
        return response


class EstateImportValidateView(APIView):
    """Check a sheet and report every problem. Writes nothing."""

    permission_classes = [permissions.IsAuthenticated, IsAdminOrSuperadmin]

    def post(self, request):
        spec, error = _spec_or_400(request)
        if error:
            return error
        upload, error = _file_or_400(request)
        if error:
            return error

        results, sheet_errors = estate_import.read_rows(upload, spec)
        return Response(_report(results, sheet_errors))


class EstateImportCommitView(AuditLogMixin, APIView):
    """Import a sheet: every row, or none of them."""

    permission_classes = [permissions.IsAuthenticated, IsAdminOrSuperadmin]

    def post(self, request):
        spec, error = _spec_or_400(request)
        if error:
            return error
        upload, error = _file_or_400(request)
        if error:
            return error

        # Re-read and re-validate rather than trusting the client to have
        # called validate first, or to have sent back the same file.
        results, sheet_errors = estate_import.read_rows(upload, spec)
        report = _report(results, sheet_errors)
        if not report["can_commit"]:
            return Response(
                {**report, "detail": "Nothing was imported. Fix the sheet and upload it again."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            created, updated = estate_import.commit(spec, results)
        except Exception as exc:
            # A model-level failure that row validation could not foresee, e.g.
            # a constraint across rows. The transaction is already rolled back.
            return Response(
                {
                    **report,
                    "detail": f"Nothing was imported — the database rejected the sheet: {exc}",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        self.log_action("CREATE", request.user, {
            "action": "estate_bulk_import",
            "resource": spec.key,
            "created": created,
            "updated": updated,
            "file": upload.name,
        })
        return Response({**report, "created": created, "updated": updated})


class EstateAiParseView(AuditLogMixin, APIView):
    """Read pasted notes into rows, using Gemini. Writes nothing.

    The model only reads. Its rows go through the same
    `estate_import.validate_records` an uploaded spreadsheet goes through, so
    an invented provider or billing cycle is rejected by the same rules — and
    the answer is the identical report shape, which means the review UI and
    the commit path are shared rather than duplicated.

    Committing is still the normal import: the reviewed rows come back as a
    file or as records through the existing endpoints. Nothing here writes.
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminOrSuperadmin]

    def post(self, request):
        from core.models import Integration

        integration = Integration.objects.filter(provider=gemini.PROVIDER).first()
        if not integration or not integration.has_api_key:
            return Response(
                {"detail": "Add a Gemini API key under Settings → Integrations first."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not integration.is_enabled:
            return Response(
                {"detail": "The Gemini integration is switched off."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_text = request.data.get("text") or ""
        answers = request.data.get("answers") or {}
        if not isinstance(answers, dict):
            answers = {}

        try:
            records, questions, notes = estate_ai.parse(integration, raw_text, answers)
        except gemini.GeminiError as exc:
            return Response(
                {"detail": str(exc), "code": exc.code},
                status=status.HTTP_400_BAD_REQUEST,
            )

        spec = estate_import.build_specs()[estate_ai.SPEC_KEY]
        results, sheet_errors = estate_import.validate_records(spec, records)

        # Audited because it sends company text to a third party. The text
        # itself is not stored — only that it happened, and how much.
        self.log_action("UPDATE", integration, {
            "action": "estate_ai_parse",
            "characters": len(raw_text),
            "rows_returned": len(records),
            "questions": len(questions),
        })

        return Response({
            **_report(results, sheet_errors),
            "questions": questions,
            "assumptions": notes,
            # Echoed so the review step can submit exactly what was validated
            # rather than re-asking the model and getting something else.
            "records": records,
        })


class EstateAiCommitView(AuditLogMixin, APIView):
    """Import rows the AI produced, after a person has reviewed them.

    Takes the records back rather than re-prompting: the reader approved what
    they saw, and a second call to the model could return something different.
    Re-validated here regardless, so an edited payload cannot skip the rules.
    """

    permission_classes = [permissions.IsAuthenticated, IsAdminOrSuperadmin]

    def post(self, request):
        records = request.data.get("records")
        if not isinstance(records, list) or not records:
            return Response(
                {"detail": "Nothing to import."}, status=status.HTTP_400_BAD_REQUEST
            )

        spec = estate_import.build_specs()[estate_ai.SPEC_KEY]
        results, sheet_errors = estate_import.validate_records(spec, records)
        report = _report(results, sheet_errors)
        if not report["can_commit"]:
            return Response(
                {**report, "detail": "Nothing was imported. Fix the rows and try again."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            created, updated = estate_import.commit(spec, results)
        except Exception as exc:
            return Response(
                {**report, "detail": f"Nothing was imported — {exc}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        self.log_action("CREATE", request.user, {
            "action": "estate_ai_import",
            "created": created,
            "updated": updated,
        })
        return Response({**report, "created": created, "updated": updated})
