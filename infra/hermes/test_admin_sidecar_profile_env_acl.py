import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException


MODULE_PATH = Path(__file__).with_name("admin_sidecar.py")
SPEC = importlib.util.spec_from_file_location("pib_admin_sidecar_profile_env", MODULE_PATH)
assert SPEC and SPEC.loader
SIDECAR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SIDECAR)


class ProfileEnvAuthTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env_root = Path(self.temp.name)
        self.env_file = self.env_root / "pip.env"
        self.env_file.write_text("API_SERVER_KEY=secret-key\n", encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_unreadable_profile_env_returns_503_not_500(self):
        def boom(_self, *args, **kwargs):
            raise PermissionError(13, "Permission denied")

        with patch.object(SIDECAR, "ENV_ROOT", self.env_root):
            with patch.object(Path, "read_text", boom):
                with self.assertRaises(HTTPException) as raised:
                    SIDECAR._require_auth("pip", None, "Bearer secret-key")

        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(raised.exception.detail, "profile env unreadable")

    def test_wrong_key_still_returns_401(self):
        with patch.object(SIDECAR, "ENV_ROOT", self.env_root):
            with self.assertRaises(HTTPException) as raised:
                SIDECAR._require_auth("pip", None, "Bearer wrong")
        self.assertEqual(raised.exception.status_code, 401)

    def test_valid_key_passes(self):
        with patch.object(SIDECAR, "ENV_ROOT", self.env_root):
            SIDECAR._require_auth("pip", None, "Bearer secret-key")


if __name__ == "__main__":
    unittest.main()
