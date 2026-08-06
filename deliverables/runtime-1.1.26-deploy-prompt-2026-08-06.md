# Deploy prompt — pib-runtime 1.1.26 (MAX_SNAPSHOT_REFS fix) to VPS + Mac

Given to Peet 2026-08-06 for the agent holding root/install access (Theo / Mac-side agent).
Code state: main = development = 0baacaa29. Fix commit 0baacaa29 (cap workbench snapshot refs at MAX_SNAPSHOT_REFS).
Reason: 1.1.25 went blind on dense pages (HN 1,634 AX nodes -> >400 refs rejected by server validator, device swallowed error).
Acceptance: both installed binaries report 1.1.26 and contain MAX_SNAPSHOT_REFS + supervisor symbols; live smoke test on a dense page returns a valid snapshot.

See wiki logs/2026-08-06.md for the deployment record.
