"""Storage backend that exposes uploads through short-lived signed URLs."""

from django.core import signing
from django.core.files.storage import FileSystemStorage
from django.urls import reverse
from urllib.parse import urlencode


MEDIA_SIGNING_SALT = "itcommand.protected-media.v1"


class ProtectedMediaStorage(FileSystemStorage):
    """Keep files on disk while avoiding predictable public ``/media`` URLs."""

    def url(self, name):
        token = signing.dumps(
            {"path": name},
            salt=MEDIA_SIGNING_SALT,
            compress=True,
        )
        path = reverse("protected-media", kwargs={"path": name})
        return f"{path}?{urlencode({'token': token})}"
