import asyncio
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("admin_sidecar.py")
SPEC = importlib.util.spec_from_file_location("pib_admin_sidecar_oauth", MODULE_PATH)
assert SPEC and SPEC.loader
SIDECAR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SIDECAR)


class FakeRequest:
    def __init__(self, body):
        self.body = body

    async def json(self):
        return self.body


class XaiOauthSidecarTests(unittest.TestCase):
    def test_xai_accepts_access_only_and_omits_empty_refresh_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            auth_path = Path(directory) / "auth.json"
            with (
                patch.object(SIDECAR, "_require_auth"),
                patch.object(SIDECAR, "_auth_json_path", return_value=auth_path),
                patch.object(SIDECAR, "_share_oauth_provider_to_fleet", return_value=[]),
                patch.object(
                    SIDECAR,
                    "_restart_profile_detailed",
                    return_value={"restarted": True, "deferred": False, "busy": False},
                ),
            ):
                result = asyncio.run(SIDECAR.upsert_auth_provider(
                    "pip",
                    "xai-oauth",
                    FakeRequest({"access_token": "xai-access-token"}),
                ))

            saved = json.loads(auth_path.read_text())
            tokens = saved["providers"]["xai-oauth"]["tokens"]
            pool = saved["credential_pool"]["xai-oauth"][0]
            self.assertTrue(result["hermes_shape"])
            self.assertEqual(tokens["access_token"], "xai-access-token")
            self.assertNotIn("refresh_token", tokens)
            self.assertNotIn("refresh_token", pool)
            with (
                patch.object(SIDECAR, "_require_auth"),
                patch.object(SIDECAR, "_auth_json_path", return_value=auth_path),
            ):
                listed = SIDECAR.list_auth_providers("pip")
            self.assertTrue(listed["providers"]["xai-oauth"]["usable"])
            self.assertFalse(listed["providers"]["xai-oauth"]["has_refresh_token"])


if __name__ == "__main__":
    unittest.main()
