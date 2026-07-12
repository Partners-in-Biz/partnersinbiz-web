# Self-Service Linked Computers Design

Date: 2026-07-12
Status: Approved product direction, awaiting implementation plan

## Objective

Let every authorised Partners in Biz user securely pair, manage, and select their own macOS or Windows computer for Workspace-scoped agent execution without copying a permanent organisation-wide key or exposing filesystem paths to the browser.

## Delivery decomposition

This is a separate product programme from Workspace hardening and will ship in independently reviewable slices:

1. Device registry and pairing.
2. Organisation grants and folder mappings.
3. Presence, credentials, strict dispatch, and execution receipts.
4. Linked Computers product UI.
5. Signed macOS and Windows distribution/update lifecycle.

No slice may weaken the rule that the VPS Workspace remains canonical by default.

## Device identity and records

`linked_devices/{deviceId}` will hold browser-safe identity and lifecycle state:

- owner `userId`;
- stable `deviceId` and runtime target ID;
- machine public key/fingerprint;
- user-defined machine label;
- platform, architecture, runtime version, and capabilities;
- status, credential version, created/updated/last-seen timestamps;
- paused, revoked, and removed timestamps;
- no raw credential and no organisation-wide permanent secret.

Private credential material must be encrypted or hashed as appropriate and stored separately from public device metadata.

## Pairing protocol

An authenticated user creates a short-lived, single-use pairing challenge. The browser receives a human-friendly code and installation command containing only an opaque challenge identifier. The local runtime creates its own key pair, exchanges the code over TLS, and proves possession of its private key.

The server stores only a hash of the pairing secret, enforces expiry and attempt limits, consumes it atomically, rejects replay, binds the new device to the initiating user, and writes an audit event. Installation commands, browser storage, logs, and analytics must never contain the resulting device credential.

## Organisation grants

Device access is deny-by-default. A separate grant record binds `deviceId`, `orgId`, granting actor, capabilities, status, and timestamps. The owner must retain current organisation membership, and the organisation policy must permit the grant. Membership and grant state are revalidated on every discovery and dispatch.

An organisation administrator can approve, pause, or revoke access according to organisation policy. Sharing another user's device requires an explicit grant; runtime IDs alone confer no access.

## Folder mappings

A device maps a server-issued logical mapping ID to one local organisation Workspace root. The browser sees only mapping status and friendly labels. The local runtime stores/canonicalises the physical path and validates every requested relative folder beneath that root.

Mappings are keyed by device and Workspace, support multiple organisations per device, report stale/missing state, and can be paused or removed. The platform sends `workspaceId`, `projectId`, and mapping ID; it never sends a browser-supplied absolute path to the device.

## Presence and credential lifecycle

Authenticated heartbeats report device identity, runtime version, capabilities, health, and mapping summaries. Freshness windows are server-controlled. A device credential is scoped to the device, versioned, rotatable with a short overlap window, and immediately invalid after revocation. Pause blocks dispatch without deleting history; remove revokes credentials and mappings.

## Platform-owned outbound run queue

Messages lists only devices owned by or explicitly shared with the user and granted to the selected organisation. An explicit device selection never falls back. Dispatch revalidates user membership, device ownership/share, organisation grant, credential version, health/freshness, capability, and mapping state.

Linked computers do not expose a public listener, accept an inbound tunnel, or register a device-controlled runtime URL. PiB encrypts an authorised logical run into a platform-owned, per-device queue. The runtime makes outbound HTTPS requests only to fixed PiB endpoints, authenticates every claim/progress/completion request with its device credential and Ed25519 identity, and resolves the mapping ID locally. Queue claims use short leases, attempt counters, and opaque lease tokens; progress renews the current lease, while stale workers cannot complete a reclaimed job. Membership, grant, device, credential, and mapping state are revalidated atomically when work is claimed.

The runtime returns signed acceptance, progress, and terminal receipts bound to the exact job, request, device, mapping, credential version, attempt, lease token, output/error digests, machine label, runtime version, timestamps, and outcome. PiB verifies the receipt before updating conversation state and displays the accepted device rather than merely echoing the requested label. Prompts are encrypted at rest in the queue, terminal output is comprehensively redacted, and TTL cleanup is required for jobs and replay nonces.

## Product experience

Linked Computers settings supports:

- install and pair;
- name and inspect a computer;
- grant organisations;
- map organisation Workspaces;
- see online/offline, last seen, version, capabilities, and mapping health;
- pause, rotate, revoke, and remove;
- diagnose pairing expiry, stale runtime, missing mapping, revoked grant, and required update.

Messages shows only healthy/selectable targets, explains where files execute, and retains unavailable selected targets as explicit error states rather than silently changing them.

## macOS and Windows distribution

macOS ships as a signed/notarised package and managed background service. Windows ships as a signed installer and Windows service. Both support unattended startup, secure local credential storage, authenticated updates, minimum-version enforcement, rollback to the previous runtime, uninstall/revoke, and architecture-specific release channels.

Installer/update signing, release infrastructure, and security review are release blockers; shell snippets alone do not qualify as platform support.

## Security and privacy

- Pairing codes are hashed, short-lived, rate-limited, and single-use.
- Device private keys never leave the device.
- Runtime credentials are scoped, versioned, rotatable, and revocable.
- Linked computers use outbound-only access to fixed platform endpoints; no device endpoint, tunnel hostname, transport token, or listener is part of normal dispatch.
- Queue leases, attempt fencing, one-time request nonces, and signed receipts prevent replay and stale-worker completion.
- Every API enforces user, organisation, device, grant, and mapping scope.
- Raw paths, credentials, internal URLs, and SSH details are absent from browser APIs and user-visible logs.
- Audit events cover pairing, grants, mappings, rotation, pause, revoke, dispatch acceptance, and failures.
- Loss of organisation membership invalidates access immediately.

## Verification and acceptance

Each slice is test-first and requires emulator-backed tenancy tests. Final acceptance requires:

- two users and two organisations proving cross-user/cross-tenant denial;
- pairing expiry and replay rejection;
- grant/revoke and membership-loss enforcement;
- multiple mappings on one device;
- arbitrary-path and symlink-escape rejection on both operating systems;
- credential rotation overlap and old-version rejection;
- offline/stale/update-required errors with no fallback;
- signed execution receipts matching actual machines;
- queue claim, lease renewal, reclaim fencing, callback idempotency, and TTL cleanup;
- real macOS and Windows organisation/project `pwd` runs;
- installer, update, rollback, uninstall, and revoked-device tests;
- redaction and audit-log review;
- an explicit production release approval and rollback drill.

Until these gates pass, the product must be described as a Workspace/runtime-target foundation, not a complete world-class linked-PC system.
