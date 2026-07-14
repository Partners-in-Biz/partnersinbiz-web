import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException


MODULE_PATH = Path(__file__).with_name("admin_sidecar.py")
SPEC = importlib.util.spec_from_file_location("pib_admin_sidecar", MODULE_PATH)
assert SPEC and SPEC.loader
SIDECAR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SIDECAR)


class ProjectFolderProvisioningTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "Cowork"
        self.workspace = self.root / "Partners in Biz"
        self.workspace.mkdir(parents=True)
        (self.workspace / ".pib-workspace.json").write_text(json.dumps({
            "workspaceId": "partners",
            "orgId": "pib-org",
            "vpsPath": str(self.workspace),
        }))
        self.body = {
            "projectId": "project-1",
            "orgId": "pib-org",
            "workspaceId": "partners",
            "workspacePath": str(self.workspace),
        }

    def tearDown(self):
        self.temp.cleanup()

    def test_creates_the_standard_project_contract_idempotently(self):
        first = SIDECAR._provision_project_folder(self.body, cowork_root=self.root)
        second = SIDECAR._provision_project_folder(self.body, cowork_root=self.root)

        expected = {
            "docs", "briefs", "assets", "marketing", "research", "operations",
            "deliverables", "inbox", "archive",
        }
        project = self.workspace / "projects" / "project-1"
        self.assertEqual({entry.name for entry in project.iterdir() if entry.is_dir()}, expected)
        self.assertEqual(json.loads((project / ".pib-project.json").read_text())["projectId"], "project-1")
        self.assertEqual(first["relativePath"], "projects/project-1")
        self.assertEqual(first["folderStatus"], "provisioned")
        self.assertEqual(first["syncStatus"], "pending")
        self.assertTrue(first["manifestWritten"])
        self.assertTrue(second["manifestPreserved"])
        self.assertEqual(second["directoriesCreated"], [])

    def test_rejects_traversal_identifiers(self):
        with self.assertRaises(HTTPException) as raised:
            SIDECAR._provision_project_folder(
                {**self.body, "projectId": "../outside"},
                cowork_root=self.root,
            )
        self.assertEqual(raised.exception.status_code, 400)

    def test_rejects_a_projects_symlink_that_escapes_the_workspace(self):
        outside = Path(self.temp.name) / "outside"
        outside.mkdir()
        (self.workspace / "projects").symlink_to(outside, target_is_directory=True)

        with self.assertRaises(HTTPException) as raised:
            SIDECAR._provision_project_folder(self.body, cowork_root=self.root)
        self.assertEqual(raised.exception.status_code, 400)
        self.assertFalse((outside / "project-1").exists())

    def test_preserves_an_existing_manifest_and_rejects_identity_conflicts(self):
        project = self.workspace / "projects" / "project-1"
        project.mkdir(parents=True)
        (project / ".pib-project.json").write_text(json.dumps({
            "projectId": "some-other-project",
            "orgId": "pib-org",
            "workspaceId": "partners",
        }))

        with self.assertRaises(HTTPException) as raised:
            SIDECAR._provision_project_folder(self.body, cowork_root=self.root)
        self.assertEqual(raised.exception.status_code, 409)

    def test_requires_the_registered_workspace_manifest_to_match_tenant_and_path(self):
        manifest_path = self.workspace / ".pib-workspace.json"
        manifest_path.write_text(json.dumps({
            "workspaceId": "partners",
            "orgId": "another-org",
            "vpsPath": str(self.workspace),
        }))

        with self.assertRaises(HTTPException) as raised:
            SIDECAR._provision_project_folder(self.body, cowork_root=self.root)
        self.assertEqual(raised.exception.status_code, 409)
        self.assertFalse((self.workspace / "projects").exists())


if __name__ == "__main__":
    unittest.main()
