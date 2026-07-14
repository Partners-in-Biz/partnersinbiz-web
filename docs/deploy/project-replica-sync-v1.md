# Project replica sync v1

Status: implemented in the current development worktree, but **not deployed or proven live**. The executor stays fail-closed until the runtime, Firestore TTL policies, and Storage lifecycle rule have all been deployed and verified. A recorded request or a green unit test is not evidence that files moved.

On 2026-07-14, production Firestore migration plan `3c4335e78c670aedd1f7d8c1606c3a2b12b80d4ed2484e4b2085a2fdf4aafd43` verified the Partners organisation, Workspace, Peet owner account, and active membership, then filled the two missing transport-identity bindings without replacing either existing location. Post-apply readback found the expected two locations and 78 project replicas across 39 projects, with 39 active replicas per location; both bindings matched the current compatibility targets and both targets were fresh, healthy, and selectable at readback time. This proves the organisation-owned VPS and private Peet-owned Mac legacy records, project linkage, and point-in-time transport health; it does **not** prove either legacy record has been adopted by an authenticated native runtime or completed a file-sync round trip.

## Product contract

- Messages is project-first. A project may link to several authenticated computers or VPS locations, and each project shows its linked machines as badges.
- A project may be linked to one or more client organisations. A conversation still speaks as the organisation currently selected in the app.
- A location may be private to its owner or shared with an organisation. Organisation-shared projects and conversations are available to every authorised user in that organisation.
- The default canonical replica is an organisation-owned VPS. A private computer cannot silently become the organisation source of truth.
- A disconnected runtime is shown as `Computer unavailable`; its project waits and inventories again after reconnecting.
- Pairing may adopt a legacy project location so existing project, mapping, and replica links survive the move to an authenticated `linked-device:<deviceId>` location.

## Implemented data path

The sync capability is `workspace.sync`, independently granted from `workspace.execute`, using protocol version 1.

1. `POST /api/v1/projects/:projectId/sync` records a manager-authorised reconciliation request. It marks the executor verified and permits file work only after every active replica has an eligible native runtime binding and retention proof is present.
2. A macOS or Linux runtime claims work at `POST /api/v1/linked-computers/:deviceId/sync/claim` using the signed device request protocol.
3. The runtime scans only the project-relative path under its approved workspace mapping and submits a deterministic manifest to `/sync/inventory`.
4. Source objects use create-only, object-specific V4 signed PUT URLs. The server streams and verifies SHA-256 and size before marking the CAS revision ready.
5. Targets receive object-specific V4 signed GET URLs. The runtime stages, verifies, rechecks the target revision, journals, preserves backups, and performs descriptor-relative atomic swaps.
6. `/sync/receipt` completes a transfer only when the freshly scanned destination manifest equals the desired revision.
7. `/sync/failure` releases retryable transport leases or records classified source drift, target drift, integrity failures, unsupported paths, scale limits, and non-destructive conflicts.
8. `DELETE /api/v1/projects/:projectId/sync` lets a project manager cancel a conflicted or failed request before starting clean inventory again.

The runtime polls sync separately from normal execution jobs and sends heartbeat independently. Receipts use a private, locked, atomic offline spool. Restart recovery processes unfinished apply journals before accepting new work.

Windows may still be paired for ordinary runtime work, but v1 does not advertise `workspace.sync` on Windows and the UI must show sync as unavailable.

## Safety and reconciliation rules

- Every request, lease, inventory, upload, failure, and receipt is bound to the exact device, credential generation, organisation, project, replica, location, and mapping.
- Every claim and receipt reloads the active project, its exact canonical `projectOrganizations` link, and—when the device is privately user-owned—the owner’s exact active `orgMembers` row. Removing the project share or owner membership revokes an already-issued request immediately.
- Manifests are stable-sorted and cover files plus empty directories. Paths must be NFC-normalised and portable across supported machines.
- The scanner rejects traversal, symlinks, special files, containment escapes, Git internals, dependency trees, runtime metadata, environment files, key material, and reserved/colliding portable paths.
- File hashing and upload snapshots use no-follow descriptors plus before/after identity checks. macOS uses `O_NOFOLLOW_ANY`; Linux attests descriptors through `/proc/self/fd`.
- Apply mutations use inherited directory descriptors through the packaged native helper. No untrusted absolute target path is reopened for mutation.
- Executable intent is preserved as a bounded executable bit (`0700` versus `0600`); arbitrary ownership, ACLs, extended attributes, and full POSIX modes are outside v1.
- Deletion and file/directory type changes are never propagated automatically. They become `non_destructive_apply_required` conflicts.
- If all manifests match, the request records a verified point-in-time sync without transferring bytes.
- If canonical and mirror revisions changed differently, multiple mirrors compete, or a target changes after planning, the request becomes a conflict and every version is preserved.
- Signed URL operations and response-body reads have a 15-minute total timeout. Retryable transport failure releases the exact deterministic lease for a new claim.

## V1 scale and retention limits

- Maximum manifest: 1,000 entries and 100 MiB total file content.
- Maximum file/CAS object: 100 MiB.
- Maximum one apply job: 500 changed objects and 100 MiB.
- Maximum upload batch: 16 unique objects, still bounded by the 100 MiB manifest.
- Signed URL lifetime: at most 15 minutes.
- Local apply retention: at most 3 backup sets, 300 MiB of backups, and 50 completion records per project state root.
- Firestore manifest heads/chunks, CAS readiness, and runtime jobs: `expiresAt` after 30 days.
- Firestore verified-object ledger: `expiresAt` after 35 days.
- Storage objects under `project-sync/`: delete 35 days after `customTime`. Successful verification/reuse refreshes `customTime`.

Larger projects fail with `unsupported_scale`; the runtime must not silently truncate a manifest or partially apply it.

## Required retention deployment

Deploy the `firestore.indexes.json` field overrides or run:

```sh
./scripts/setup-firestore-ttl.sh <gcp-project-id>
```

Read the deployed target configuration back and confirm that TTL is active on `expiresAt` for all five collections:

- `project_sync_manifest_chunks`
- `project_sync_manifest_heads`
- `project_sync_cas_readiness`
- `project_sync_objects`
- `project_sync_runtime_jobs`

The durable `project_sync_requests` and audit events intentionally do not use these ephemeral TTLs.

Merge the rule from `config/project-sync-storage-lifecycle-rule.json` into the bucket's existing lifecycle configuration. Do not replace unrelated lifecycle rules. Then read the bucket configuration back and prove it contains a `Delete` rule with both:

- `matchesPrefix: ["project-sync/"]`
- `daysSinceCustomTime: 35`

The environment variable keeps its original name for compatibility. Set this compatibility flag only after live readback of BOTH all five Firestore TTL policies and the Storage lifecycle rule:

```text
PROJECT_SYNC_STORAGE_LIFECYCLE_VERIFIED=true
```

`true` is the operator's combined attestation for both retention controls; neither the TTL readback nor the bucket readback is sufficient alone. Without this exact value, executor eligibility returns `storage_lifecycle_unverified`, `continuousExecutorVerified` remains false, and no file-transfer job starts.

## Live enablement checklist

Do not mark this feature complete until all checks pass in the target environment:

1. Deploy Firestore TTL configuration and read back all five policies as active in the target environment.
2. Merge the Storage lifecycle rule and read it back from the real bucket; only after both this readback and step 1 may `PROJECT_SYNC_STORAGE_LIFECYCLE_VERIFIED=true` be set.
3. Build and verify signed macOS/Linux runtime releases. Confirm the credential helper and descriptor-relative file helper are present and executable.
4. Install/restart the runtime on the current Partners in Biz VPS, pair or adopt it as an organisation-owned location, grant `workspace.sync`, and map its real workspace root.
5. Install/restart the runtime on Peet's Mac, pair or adopt it as a private user-owned location, grant `workspace.sync`, and map its real workspace root.
6. Read back both device records, current credential generations, grants, mappings, adopted replica locations, heartbeat timestamps, platform, `workspace.sync`, and `syncProtocolVersion: 1`.
7. Link both authenticated locations to a test project from Messages. Verify the project stays first in navigation and both machines appear as badges.
8. Create a harmless file on the canonical VPS, request sync, and verify exact content/hash plus executable intent on the Mac. Repeat in the safe reverse-reconciliation case.
9. Restart a runtime during a staged transfer and prove journal/spool recovery without corruption or duplicate completion.
10. Disconnect the Mac and prove the UI says `Computer unavailable`; reconnect and prove fresh inventory resumes.
11. Prove target drift, competing edits, deletion/type changes, path rejection, scale rejection, bad hashes, expired URLs, and transport retry all preserve data and surface the right conflict/retry state.
12. Use the manager reset action on a conflict and prove a new request begins with fresh inventory.
13. Deploy and read back `firestore.rules` before release; direct client reads/writes to conversation/message collections and project/nested task/comment collections must remain denied so current organisation access and path redaction stay server-only. This is an undeployed live-release blocker until verified.

Until those checks have live evidence, the honest status is: legacy first-class VPS/Mac ownership, project-replica linkage, and point-in-time compatibility transport health are verified; native `linked-device` adoption/heartbeat, deployment, and byte-level file transfer remain unverified.
