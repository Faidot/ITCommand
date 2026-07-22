import tempfile
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

from django.core.files.base import ContentFile
from django.core.files.storage import storages
from django.test import TestCase, override_settings


TEST_STORAGES = {
    'default': {'BACKEND': 'core.storage.ProtectedMediaStorage'},
    'staticfiles': {
        'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'
    },
}


class ProtectedMediaTests(TestCase):
    def setUp(self):
        self.media_dir = tempfile.TemporaryDirectory()
        self.settings_override = override_settings(
            MEDIA_ROOT=self.media_dir.name,
            STORAGES=TEST_STORAGES,
            PROTECTED_MEDIA_URL_TTL=60,
            PROTECTED_MEDIA_USE_X_ACCEL=False,
        )
        self.settings_override.enable()
        self.storage = storages['default']
        self.name = self.storage.save(
            'contracts/private agreement.txt', ContentFile(b'classified')
        )

    def tearDown(self):
        self.settings_override.disable()
        self.media_dir.cleanup()

    def test_generated_signed_url_serves_the_file(self):
        response = self.client.get(self.storage.url(self.name))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(b''.join(response.streaming_content), b'classified')
        self.assertEqual(response['X-Content-Type-Options'], 'nosniff')
        self.assertTrue(response['Cache-Control'].startswith('private'))

    def test_signature_cannot_be_reused_for_another_path(self):
        url = urlsplit(self.storage.url(self.name))
        tampered_path = url.path.replace('private%20agreement.txt', 'other.txt')
        response = self.client.get(urlunsplit(url._replace(path=tampered_path)))

        self.assertEqual(response.status_code, 404)

    def test_tampered_token_is_rejected(self):
        url = urlsplit(self.storage.url(self.name))
        query = parse_qs(url.query)
        query['token'] = [query['token'][0] + 'tampered']
        response = self.client.get(
            urlunsplit(url._replace(query=urlencode(query, doseq=True)))
        )

        self.assertEqual(response.status_code, 404)

    @override_settings(PROTECTED_MEDIA_USE_X_ACCEL=True)
    def test_production_delivery_uses_internal_nginx_redirect(self):
        response = self.client.get(self.storage.url(self.name))

        self.assertEqual(response.status_code, 200)
        self.assertTrue(
            response['X-Accel-Redirect'].startswith('/_protected_media/contracts/')
        )
