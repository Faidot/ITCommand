"""Authorization-aware delivery for user-uploaded files."""

import mimetypes
from pathlib import Path
from urllib.parse import quote

from django.conf import settings
from django.core import signing
from django.core.files.storage import default_storage
from django.http import FileResponse, Http404, HttpResponse
from django.utils.crypto import constant_time_compare
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny

from core.storage import MEDIA_SIGNING_SALT


@api_view(["GET"])
@permission_classes([AllowAny])
def protected_media(request, path):
    """Serve a file only when its serializer-generated signature is valid."""

    token = request.query_params.get("token", "")
    try:
        payload = signing.loads(
            token,
            salt=MEDIA_SIGNING_SALT,
            max_age=settings.PROTECTED_MEDIA_URL_TTL,
        )
    except (signing.BadSignature, signing.SignatureExpired):
        raise Http404

    signed_path = payload.get("path") if isinstance(payload, dict) else None
    if not signed_path or not constant_time_compare(str(signed_path), str(path)):
        raise Http404
    if not default_storage.exists(path):
        raise Http404

    content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"

    if settings.PROTECTED_MEDIA_USE_X_ACCEL:
        response = HttpResponse(content_type=content_type)
        response["X-Accel-Redirect"] = f"/_protected_media/{quote(path, safe='/')}"
    else:
        try:
            response = FileResponse(
                default_storage.open(path, "rb"),
                content_type=content_type,
                filename=Path(path).name,
            )
        except (FileNotFoundError, OSError):
            raise Http404

    response["Cache-Control"] = "private, max-age=300"
    response["X-Content-Type-Options"] = "nosniff"
    return response
