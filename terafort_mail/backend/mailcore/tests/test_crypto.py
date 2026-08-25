"""The key hierarchy, and the promises made about a stolen database."""
from __future__ import annotations

from django.test import SimpleTestCase, override_settings

from mailcore import crypto, totp


class SealTests(SimpleTestCase):
    def test_round_trip(self):
        key = crypto.new_key()
        blob = crypto.seal(key, b"hello")
        self.assertEqual(crypto.unseal(key, blob), b"hello")

    def test_ciphertext_is_not_the_plaintext(self):
        blob = crypto.seal(crypto.new_key(), b"invoice total 4218.40")
        self.assertNotIn(b"invoice", blob)

    def test_nonce_differs_every_time(self):
        key = crypto.new_key()
        a, b = crypto.seal(key, b"same"), crypto.seal(key, b"same")
        self.assertNotEqual(a, b, "identical plaintext produced identical bytes")

    def test_wrong_key_raises(self):
        blob = crypto.seal(crypto.new_key(), b"x")
        with self.assertRaises(crypto.SealError):
            crypto.unseal(crypto.new_key(), blob)

    def test_tampered_ciphertext_raises(self):
        key = crypto.new_key()
        blob = bytearray(crypto.seal(key, b"transfer 100"))
        blob[-1] ^= 0x01
        with self.assertRaises(crypto.SealError):
            crypto.unseal(key, bytes(blob))

    def test_aad_must_match(self):
        key = crypto.new_key()
        blob = crypto.seal(key, b"x", aad=b"mailbox-a")
        with self.assertRaises(crypto.SealError):
            crypto.unseal(key, blob, aad=b"mailbox-b")

    def test_truncated_blob_raises_rather_than_crashing(self):
        with self.assertRaises(crypto.SealError):
            crypto.unseal(crypto.new_key(), b"short")


class DekTests(SimpleTestCase):
    def test_wrap_and_unwrap(self):
        dek, salt = crypto.new_key(), crypto.new_salt()
        wrapped = crypto.wrap_dek(dek, "correct horse", salt)
        self.assertEqual(crypto.unwrap_dek(wrapped, "correct horse", salt), dek)

    def test_wrapped_dek_is_useless_without_the_password(self):
        """This is the whole 'a stolen database yields nothing' claim."""
        dek, salt = crypto.new_key(), crypto.new_salt()
        wrapped = crypto.wrap_dek(dek, "correct horse", salt)
        with self.assertRaises(crypto.SealError):
            crypto.unwrap_dek(wrapped, "wrong password", salt)

    def test_changed_password_makes_the_cache_unreadable(self):
        """The week-one case from the blueprint: unwrap fails, and the caller
        is expected to discard the cache rather than try to recover it."""
        dek, salt = crypto.new_key(), crypto.new_salt()
        wrapped = crypto.wrap_dek(dek, "old password", salt)
        with self.assertRaises(crypto.SealError):
            crypto.unwrap_dek(wrapped, "new password", salt)

    def test_kek_is_deterministic_for_the_same_inputs(self):
        salt = crypto.new_salt()
        self.assertEqual(crypto.derive_kek("pw", salt), crypto.derive_kek("pw", salt))

    def test_kek_differs_per_salt(self):
        self.assertNotEqual(crypto.derive_kek("pw", crypto.new_salt()),
                            crypto.derive_kek("pw", crypto.new_salt()))

    def test_salt_length_is_enforced(self):
        with self.assertRaises(ValueError):
            crypto.derive_kek("pw", b"tooshort")


class ServerSealTests(SimpleTestCase):
    def test_session_records_are_sealed(self):
        blob = crypto.seal_for_server(b'{"credential":"hunter2"}')
        self.assertNotIn(b"hunter2", blob)
        self.assertEqual(crypto.unseal_for_server(blob), b'{"credential":"hunter2"}')

    @override_settings(MAIL_SESSION_SEAL_KEY="too short")
    def test_a_bad_seal_key_fails_loudly_at_use(self):
        with self.assertRaises(ValueError):
            crypto.seal_for_server(b"x")


class TotpTests(SimpleTestCase):
    def test_generated_code_verifies(self):
        secret = totp.new_secret()
        self.assertTrue(totp.verify(secret, totp.code_at(secret)))

    def test_wrong_code_rejected(self):
        secret = totp.new_secret()
        bad = "000000" if totp.code_at(secret) != "000000" else "111111"
        self.assertFalse(totp.verify(secret, bad))

    def test_non_numeric_rejected(self):
        self.assertFalse(totp.verify(totp.new_secret(), "abcdef"))

    def test_wrong_length_rejected(self):
        self.assertFalse(totp.verify(totp.new_secret(), "12345"))

    def test_adjacent_step_accepted(self):
        import time
        secret = totp.new_secret()
        now = time.time()
        self.assertTrue(totp.verify(secret, totp.code_at(secret, now - 30), when=now))

    def test_distant_step_rejected(self):
        import time
        secret = totp.new_secret()
        now = time.time()
        self.assertFalse(totp.verify(secret, totp.code_at(secret, now - 600), when=now))

    def test_recovery_codes_are_hashed_not_stored(self):
        codes = totp.new_recovery_codes(4)
        self.assertEqual(len(codes), 4)
        hashes = [totp.hash_recovery_code(c) for c in codes]
        self.assertEqual(len(set(hashes)), 4)
        for c, h in zip(codes, hashes):
            self.assertNotIn(c, h)

    def test_recovery_code_matching_is_case_insensitive(self):
        code = totp.new_recovery_codes(1)[0]
        self.assertEqual(totp.hash_recovery_code(code.upper()),
                         totp.hash_recovery_code(code.lower()))

    def test_provisioning_uri_carries_the_secret(self):
        secret = totp.new_secret()
        uri = totp.provisioning_uri(secret, "alice@terafort.com")
        self.assertTrue(uri.startswith("otpauth://totp/"))
        self.assertIn(secret, uri)
