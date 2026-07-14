#!/usr/bin/env bash
#
# One-time Firestore TTL policy setup.
#
# Firestore TTL policies auto-delete docs N days after a timestamp field.
# They're not configurable via firestore.indexes.json — only via the
# Admin API or gcloud. Run this script once per environment (prod, dev)
# after deploying the collection-creating code for the first time.
#
# Requires: gcloud CLI authenticated against the target project.
#
# Usage:
#   ./scripts/setup-firestore-ttl.sh <gcp-project-id>
#
# Example:
#   ./scripts/setup-firestore-ttl.sh partnersinbiz-prod

set -euo pipefail

PROJECT="${1:-}"
if [[ -z "$PROJECT" ]]; then
  echo "usage: $0 <gcp-project-id>" >&2
  exit 1
fi

echo "Setting TTL policies on project: $PROJECT"
echo ""

# Firestore TTL deletes a doc when the value at the TTL field is <= now.
# The app writes explicit `expiresAt` timestamps; TTL is configured
# against that field for each collection below.

# idempotency_keys — `expiresAt = createdAt + 24h` (written by lib/api/idempotency.ts)
echo "→ idempotency_keys.expiresAt"
gcloud firestore fields ttls update expiresAt \
  --collection-group=idempotency_keys \
  --enable-ttl \
  --project="$PROJECT" \
  --async

# form_rate_limits — `expiresAt = createdAt + 1h` (written by lib/forms/ratelimit.ts)
echo "→ form_rate_limits.expiresAt"
gcloud firestore fields ttls update expiresAt \
  --collection-group=form_rate_limits \
  --enable-ttl \
  --project="$PROJECT" \
  --async

# webhook_queue — 7d TTL via expiresAt for delivered/failed items.
# Requires worker to stamp expiresAt on status transition to delivered/failed.
echo "→ webhook_queue.expiresAt (requires worker updates to stamp expiresAt)"
gcloud firestore fields ttls update expiresAt \
  --collection-group=webhook_queue \
  --enable-ttl \
  --project="$PROJECT" \
  --async

# webhook_deliveries — 90d audit retention via expiresAt.
echo "→ webhook_deliveries.expiresAt (requires worker to stamp expiresAt on write)"
gcloud firestore fields ttls update expiresAt \
  --collection-group=webhook_deliveries \
  --enable-ttl \
  --project="$PROJECT" \
  --async

# Project replica sync — bounded coordinator/runtime working state. The durable
# request/audit rows are intentionally excluded. Writers stamp expiresAt at 30d
# for manifests/readiness/jobs and 35d for the verified CAS object ledger.
for collection in \
  project_sync_manifest_chunks \
  project_sync_manifest_heads \
  project_sync_cas_readiness \
  project_sync_objects \
  project_sync_runtime_jobs
do
  echo "→ ${collection}.expiresAt"
  gcloud firestore fields ttls update expiresAt \
    --collection-group="$collection" \
    --enable-ttl \
    --project="$PROJECT" \
    --async
done

echo ""
echo "TTL policies enqueued. Firestore applies them asynchronously (minutes to hours)."
echo "Check status in GCP Console → Firestore → TTL."
echo ""
echo "Do not set PROJECT_SYNC_STORAGE_LIFECYCLE_VERIFIED from this script alone."
echo "Set it only after all five project-sync TTL policies AND the Storage lifecycle rule have both been read back live."
echo ""
echo "Each collection's writer is responsible for stamping expiresAt on create."
echo "See docs/firestore-indexes.needed.md for per-collection retention and the code refs."
