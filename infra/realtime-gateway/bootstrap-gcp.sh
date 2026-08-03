#!/usr/bin/env bash
set -euo pipefail

# Creates the GCP-native realtime transport. It is deliberately opt-in: run
# without --apply for inventory only. The app remains on bounded SSE until the
# shadow/canary gates have passed.

PROJECT_ID="${PROJECT_ID:-partners-in-biz-85059}"
REGION="${REGION:-us-central1}"
NETWORK="${PIB_REALTIME_NETWORK:-}"
SUBNET_RANGE="${PIB_REALTIME_SUBNET_RANGE:-}"
REDIS_RANGE="${PIB_REALTIME_REDIS_RANGE:-}"
APPLY=false

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

require() { command -v "$1" >/dev/null || { echo "Missing required command: $1" >&2; exit 1; }; }
require gcloud

echo "Realtime GCP preflight: project=$PROJECT_ID region=$REGION"
gcloud firestore databases list --project="$PROJECT_ID"
gcloud run services list --project="$PROJECT_ID" --region="$REGION"
gcloud pubsub topics list --project="$PROJECT_ID"
gcloud redis instances list --project="$PROJECT_ID" --region="$REGION"
gcloud compute networks list --project="$PROJECT_ID"
gcloud compute networks subnets list --project="$PROJECT_ID" --regions="$REGION"

if [[ "$APPLY" != true ]]; then
  echo "Preflight only. Re-run with --apply plus PIB_REALTIME_NETWORK, PIB_REALTIME_SUBNET_RANGE and PIB_REALTIME_REDIS_RANGE after confirming the VPC/CIDRs."
  exit 0
fi

[[ -n "$NETWORK" ]] || { echo "PIB_REALTIME_NETWORK is required with --apply" >&2; exit 2; }
[[ -n "$SUBNET_RANGE" ]] || { echo "PIB_REALTIME_SUBNET_RANGE is required with --apply" >&2; exit 2; }
[[ -n "$REDIS_RANGE" ]] || { echo "PIB_REALTIME_REDIS_RANGE is required with --apply" >&2; exit 2; }

GATEWAY_SERVICE="pib-realtime-gateway-v1"
GATEWAY_SA="pib-realtime-gateway@$PROJECT_ID.iam.gserviceaccount.com"
PUBLISHER_SA="pib-realtime-publisher@$PROJECT_ID.iam.gserviceaccount.com"
PUSH_SA="pib-realtime-push@$PROJECT_ID.iam.gserviceaccount.com"
TOPIC="pib-realtime-events-v1"
DLQ_TOPIC="pib-realtime-events-dlq-v1"
SUBSCRIPTION="pib-realtime-gateway-v1"
REDIS_INSTANCE="pib-realtime-v1"
SUBNET="pib-realtime-subnet"
REDIS_SECRET="pib-realtime-redis-url-v1"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

gcloud services enable run.googleapis.com pubsub.googleapis.com redis.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com cloudfunctions.googleapis.com eventarc.googleapis.com secretmanager.googleapis.com --project="$PROJECT_ID"
gcloud artifacts repositories describe pib-realtime --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud artifacts repositories create pib-realtime --repository-format=docker --location="$REGION" --project="$PROJECT_ID"
for account in pib-realtime-gateway pib-realtime-publisher pib-realtime-push; do
  gcloud iam service-accounts describe "$account@$PROJECT_ID.iam.gserviceaccount.com" --project="$PROJECT_ID" >/dev/null 2>&1 || \
    gcloud iam service-accounts create "$account" --project="$PROJECT_ID"
done
gcloud pubsub topics describe "$TOPIC" --project="$PROJECT_ID" >/dev/null 2>&1 || gcloud pubsub topics create "$TOPIC" --project="$PROJECT_ID"
gcloud pubsub topics describe "$DLQ_TOPIC" --project="$PROJECT_ID" >/dev/null 2>&1 || gcloud pubsub topics create "$DLQ_TOPIC" --project="$PROJECT_ID"
gcloud pubsub subscriptions describe "$DLQ_TOPIC" --project="$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud pubsub subscriptions create "$DLQ_TOPIC" --topic="$DLQ_TOPIC" --message-retention-duration=7d --project="$PROJECT_ID"

gcloud compute networks subnets describe "$SUBNET" --network="$NETWORK" --region="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud compute networks subnets create "$SUBNET" --network="$NETWORK" --range="$SUBNET_RANGE" --region="$REGION" --project="$PROJECT_ID"
gcloud redis instances describe "$REDIS_INSTANCE" --region="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud redis instances create "$REDIS_INSTANCE" --tier=standard --size=1 --region="$REGION" --network="$NETWORK" --redis-version=redis_7_2 --enable-auth --connect-mode=DIRECT_PEERING --reserved-ip-range="$REDIS_RANGE" --project="$PROJECT_ID"

REDIS_HOST="$(gcloud redis instances describe "$REDIS_INSTANCE" --region="$REGION" --project="$PROJECT_ID" --format='value(host)')"
REDIS_AUTH="$(gcloud redis instances describe "$REDIS_INSTANCE" --region="$REGION" --project="$PROJECT_ID" --format='value(authString)')"
gcloud secrets describe "$REDIS_SECRET" --project="$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud secrets create "$REDIS_SECRET" --replication-policy=automatic --project="$PROJECT_ID"
printf 'redis://:%s@%s:6379' "$REDIS_AUTH" "$REDIS_HOST" | gcloud secrets versions add "$REDIS_SECRET" --data-file=- --project="$PROJECT_ID"

gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$PUBLISHER_SA" --role="roles/pubsub.publisher"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$GATEWAY_SA" --role="roles/secretmanager.secretAccessor"
gcloud iam service-accounts add-iam-policy-binding "$PUSH_SA" --member="serviceAccount:service-$PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com" --role="roles/iam.serviceAccountTokenCreator" --project="$PROJECT_ID"

IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/pib-realtime/realtime-gateway-v1:$(git rev-parse --short HEAD)"
gcloud builds submit services/realtime-gateway --tag="$IMAGE" --project="$PROJECT_ID"
gcloud run deploy "$GATEWAY_SERVICE" --image="$IMAGE" --region="$REGION" --project="$PROJECT_ID" --allow-unauthenticated \
  --service-account="$GATEWAY_SA" --min=1 --max=100 --concurrency=80 --timeout=3600 \
  --network="$NETWORK" --subnet="$SUBNET" --vpc-egress=private-ranges-only \
  --set-env-vars="PUBSUB_PUSH_SERVICE_ACCOUNT=$PUSH_SA,PUBSUB_AUDIENCE=https://placeholder.invalid,ALLOWED_ORIGINS=https://partnersinbiz.online" \
  --set-secrets="REDIS_URL=$REDIS_SECRET:latest"
GATEWAY_URL="$(gcloud run services describe "$GATEWAY_SERVICE" --region="$REGION" --project="$PROJECT_ID" --format='value(status.url)')"
gcloud run services update "$GATEWAY_SERVICE" --region="$REGION" --project="$PROJECT_ID" --update-env-vars="PUBSUB_AUDIENCE=$GATEWAY_URL"
gcloud run services add-iam-policy-binding "$GATEWAY_SERVICE" --member="serviceAccount:$PUSH_SA" --role="roles/run.invoker" --region="$REGION" --project="$PROJECT_ID"

gcloud pubsub subscriptions describe "$SUBSCRIPTION" --project="$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud pubsub subscriptions create "$SUBSCRIPTION" --topic="$TOPIC" --push-endpoint="$GATEWAY_URL/internal/events/pubsub" \
    --push-auth-service-account="$PUSH_SA" --push-auth-token-audience="$GATEWAY_URL" --dead-letter-topic="$DLQ_TOPIC" --max-delivery-attempts=10 --project="$PROJECT_ID"
echo "Gateway deployed at $GATEWAY_URL. Next: deploy the Firebase outbox publisher, then set the app transport to shadow for one canary user only."
