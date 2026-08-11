import importlib.util
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException


MODULE_PATH = Path(__file__).with_name("admin_sidecar.py")
SPEC = importlib.util.spec_from_file_location("pib_admin_sidecar_registration", MODULE_PATH)
assert SPEC and SPEC.loader
SIDECAR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SIDECAR)


class ExistingProfileRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.profiles_root = Path(self.temp.name) / "profiles"
        self.env_root = Path(self.temp.name) / "env"
        (self.profiles_root / "theo-fe").mkdir(parents=True)
        self.env_root.mkdir(parents=True)
        (self.env_root / "theo-fe.env").write_text(
            "API_SERVER_KEY=secret-key\nAPI_SERVER_PORT=8771\n",
            encoding="utf-8",
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_returns_the_existing_profile_registration_contract(self):
        payload = SIDECAR._existing_profile_registration(
            "theo-fe",
            profiles_root=self.profiles_root,
            env_root=self.env_root,
        )

        self.assertEqual(payload, {
            "agentId": "theo-fe",
            "baseUrl": "https://hermes-api.partnersinbiz.online/profiles/theo-fe",
            "apiKey": "secret-key",
            "port": 8771,
        })

    def test_fails_closed_when_the_profile_key_is_missing(self):
        (self.env_root / "theo-fe.env").write_text("API_SERVER_PORT=8771\n", encoding="utf-8")

        with self.assertRaises(HTTPException) as raised:
            SIDECAR._existing_profile_registration(
                "theo-fe",
                profiles_root=self.profiles_root,
                env_root=self.env_root,
            )

        self.assertEqual(raised.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
