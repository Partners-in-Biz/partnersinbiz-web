# Hermes session-persistence resilience release disposition

Status: development evidence only. This note authorises no deployment, fleet rollout, installer publication, secret change, configuration change, or public announcement.

## Change being prepared

The Hermes session-compression path must preserve an unpersisted current-turn tail when it acquires the compression lease and discovers that the durable parent session has advanced. A holder-qualified append is allowed only while the same valid compression lease is active. After that append succeeds, the compressor reloads the durable parent and adopts that canonical continuation. If the append is rejected, returns no success result, throws, or the local/durable boundary is divergent or invalid, compression aborts without creating a child session.

The rebased implementation source revisions are `196674f3e487e64042f4f957e93f9f8d4a223de7` (`fix(session): preserve live tail during compression adoption`) and `e1b1da87bd1a83ed9263434a7ebd43dcd76d6435` (`fix(session): reject boolean persistence boundaries`). The source project currently declares Hermes version 0.20.0; no signed Hermes release containing this hardening has been approved or published by this task.

## Evidence contract before any release decision

The release candidate must prove all of the following:

1. A valid lease-holder append preserves concurrent durable rows and the live user tail exactly once in the continuation input.
2. A rejected, exhausted, or exception-throwing append leaves the parent session live, produces no summary or child session, and releases the holder lease.
3. A cold stale snapshot can still adopt a newer durable parent only when the durable transcript already covers the caller snapshot in order.
4. The source suite covers the compression-lock and persistence retry paths and reports content-free diagnostics. It must never log transcript content or credentials.

## Managed PiB Mac and VPS disposition

Managed Mac and VPS Hermes hosts do not receive this change from the PiB linked-runtime package alone. The linked runtime discovers and calls an already installed local Hermes gateway; it is not a Hermes updater.

Before a separately approved managed rollout:

1. Build or install a signed Hermes release that contains the reviewed source revision.
2. Select one managed Mac and one VPS as canaries. Preserve their current verified package/version and rollback path.
3. On each canary, run the deterministic valid-holder collision probe and the invalid/exhausted-holder probe against a disposable session database.
4. Record the source revision, installed Hermes version, probe command, pass/fail output, session lineage result, and lease-release readback in the release evidence.
5. Stop on any failed append, unbounded retry, leaked lease, child publication after a failed preflush, or transcript mismatch. Do not roll the change to another host.

This task has not performed those host updates or canaries. The existing watcher-only safe-recovery canary is not evidence of this source change being installed.

## Public PiB runtime bootstrap disposition

The public macOS, Linux, and Windows bootstrap scripts install Hermes only when the `hermes` executable is absent. Their current flows then create/configure profiles and install the signed PiB runtime. They do not compare an installed Hermes version against a PiB-required version and do not update an existing Hermes installation.

Consequently, public bootstrap users do not receive this prerequisite automatically from this development change. Before a public runtime/installer release can claim this hardening, an explicitly approved release must do one of the following:

- publish a Hermes installer/update release containing the reviewed source revision and add an authenticated minimum-version check plus update path to each PiB bootstrap; or
- declare an explicit minimum Hermes version in signed runtime release metadata and fail closed with a clear operator update instruction until the installed Hermes version meets it.

The release must test and read back the behavior for macOS, Windows, and Linux. It must preserve the existing package-signature, checksum, publisher, and channel verification rules. Do not add a silent download, bypass signed metadata, or publish a package from this task.

## Release-note wording for the future approved release

"Improves Hermes session persistence during a temporary compression collision. Valid in-flight transcript appends are adopted into the canonical continuation; invalid or expired leases stop safely without rotating the session. Managed and public installations receive the change only through the approved Hermes/runtime update path for their platform."

This wording is release-ready documentation only. It is not a publication instruction.
