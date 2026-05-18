# Meta App Review submission — `ads_management`

This doc walks through what Peet needs to submit to Meta to get the `ads_management` permission approved for Live mode of the PiB Meta app (App ID `133722058771742`).

## Lead time

Typical Meta App Review for ads scopes: **1-3 weeks**. Submit early.

## What gets approved

The PiB Meta app currently has these scopes pending or granted:
- `ads_management` — write access to campaigns/adsets/ads/creatives/audiences
- `ads_read` — read insights (lighter scope)
- `business_management` — read business assets (ad accounts, pixels)
- `pages_read_engagement` — Engagement Custom Audiences

All four need approval before the app can flip to Live mode.

## Pre-submission checklist

- [ ] App is in Development mode in Meta App Dashboard
- [ ] Redirect URI is registered: `https://partnersinbiz.online/api/v1/ads/connections/meta/callback` and `http://localhost:3000/api/v1/ads/connections/meta/callback`
- [ ] Business verification complete in Meta Business Manager (status: Approved)
- [ ] Data Access Renewal in good standing (deadline tracker in [[meta-app-setup]])
- [ ] Test User (or real Meta account) granted Test User access in Meta App Dashboard
- [ ] PiB Vercel deploy is reachable from public internet (Meta reviewers need to access it)

## Screencast — what to record

Goal: show Meta reviewers the full end-to-end flow that needs each requested permission.

Recommended length: 3-5 minutes. Use Loom or QuickTime.

### Step 1 — connect (`ads_management` + `business_management`)
1. Log into `https://partnersinbiz.online` as admin
2. Navigate to `Admin → Org → <test client> → Ads → Connections`
3. Click **Connect Meta**
4. Show the Meta OAuth dialog — reviewer sees what scopes are requested
5. Approve in the dialog
6. Show the connection page after redirect: list of ad accounts pulled from `business_management`
7. Pick a default ad account

### Step 2 — create a campaign (`ads_management`)
1. Navigate to `Ads → Campaigns`
2. Click **New campaign**
3. Run through the 3-step wizard: Campaign (Traffic objective, $1 daily budget) → AdSet (US/UK, 25-54, feeds+stories) → Ad (paste a public image URL, simple copy)
4. Click **Create campaign (as draft)**
5. Show the campaign detail page with ad-set + ad nested

### Step 3 — launch + pause (`ads_management`)
1. From campaign detail, click **Launch** — note the campaign goes to PAUSED in Meta (PiB defaults Test User runs to PAUSED — no actual spend)
2. Show the Meta-side ID in the detail page after launch
3. Click **Pause** — show status flip
4. Click **Delete** — confirm + show it's archived in Meta

### Step 4 — Custom Audiences (`ads_management`)
1. Navigate to `Ads → Audiences`
2. Click **New audience**
3. Pick **Customer list** type
4. Upload a tiny test CSV (e.g. `email\ntest1@example.com\ntest2@example.com`)
5. Map the EMAIL column
6. Click **Create audience**
7. Show the audience appears in the list with BUILDING status
8. Click **Refresh size** — show it becomes READY or TOO_SMALL

### Step 5 — Pixel + CAPI (`ads_management`)
1. Navigate to `Ads → Pixel & CAPI`
2. Click **New pixel config**
3. Paste a test Pixel ID + CAPI access token
4. Save
5. Paste a `test_event_code` from Meta Events Manager → Test Events
6. Click **Send test event**
7. Open Meta Events Manager → Test Events tab in another window — show the event arrives

### Step 6 — Engagement audience (`pages_read_engagement`)
1. Navigate to `Ads → Audiences → New`
2. Pick **Engagement** type
3. Pick PAGE engagement source + paste a Facebook Page ID
4. Set lookback to 60 days
5. Click **Create audience**

## Reviewer instructions text

Paste this into Meta App Dashboard's "Tell us how you're using this permission" field:

```
Partners in Biz (https://partnersinbiz.online) is an agency platform that
manages paid ad campaigns on Meta for our clients. Admins log into our
internal dashboard and use the Ads module to:

1. Connect a Meta ad account via Login for Business (business_management).
2. Create + launch + pause + delete Meta campaigns, ad sets, and ads
   (ads_management).
3. Build custom audiences from customer lists (hashed client-side), website
   pixel rules, lookalikes, app events, and engagement (ads_management +
   pages_read_engagement for Engagement audiences).
4. Send server-side conversion events via Conversion API to improve
   attribution beyond browser pixel (ads_management for Pixel config).
5. Pull daily insights for cost/clicks/impressions/conversions reporting
   (ads_read).

Test user credentials and screencast attached. All campaigns in the screencast
launch in PAUSED status to avoid actual ad spend during review.
```

## Test User setup

In Meta App Dashboard → Roles → Test Users:
1. Click **Add Test User**
2. Set name (e.g. "PiB Reviewer")
3. Generate password — save it
4. Grant the test user a small Meta Business + an Ad Account with $1 test budget
5. Hand Meta reviewers these credentials in the review submission form

## Common rejection reasons + fixes

- **"Permission overreach"** — Make sure the screencast shows each scope being used. Don't request scopes you don't demo.
- **"Test user can't access app"** — Add the test user under Roles → Testers in App Dashboard.
- **"Cannot complete flow"** — Ensure Vercel prod is up and the redirect URI matches what's registered exactly (trailing slash matters).
- **"Data usage unclear"** — Add a Privacy Policy URL in App Dashboard pointing to https://partnersinbiz.online/privacy. Make sure it explains CAPI / hashing.

## After submission

Track status in Meta App Dashboard → App Review → Permissions. Status moves through: Submitted → In Review → Approved | Rejected. If rejected, the rejection email lists which scopes failed + why. Address each and resubmit.

Once **all four scopes** are approved, flip the app to Live mode (App Dashboard → App Mode toggle).

---

# Google Ads — Production Access Application

This section covers what Peet needs to submit to Google to get the PiB Google Ads developer token elevated from TEST to BASIC (and eventually STANDARD) access.

## Lead time

Google Ads API access elevation typically takes **3-10 business days** for BASIC and **2-4 weeks** for STANDARD. Apply well before a client go-live.

## Access levels

| Level | Operations/day | Use case |
|---|---|---|
| TEST | 10 | Development only — sandbox accounts, no real spend |
| BASIC | 15,000 | Production — up to ~15 client accounts active |
| STANDARD | Unlimited | Production — agency scale, no per-day ceiling |

Apply at: https://developers.google.com/google-ads/api/docs/access-levels

## Prerequisites

- Google Ads developer token (already applied for in Google Ads API Center)
- OAuth 2.0 Client ID + Secret registered in Google Cloud Console → APIs & Services → Credentials
- Authorized redirect URIs registered in the OAuth client:
  - `https://partnersinbiz.online/api/v1/ads/google/oauth/callback`
  - `https://partnersinbiz.online/api/v1/ads/google/merchant-center/oauth/callback`
- Google Cloud project: enable `Google Ads API` in APIs & Services → Library
- PiB Vercel deploy reachable from the public internet (Google reviewers access it)

## Required OAuth Scopes

| Scope | Purpose |
|---|---|
| `https://www.googleapis.com/auth/adwords` | Google Ads full access — campaigns, ad groups, ads, keywords, audiences, conversions, insights pull |
| `https://www.googleapis.com/auth/content` | Merchant Center — Shopping campaign feed management |

Both scopes are requested during the OAuth connect flow at `Admin → Org → <client> → Ads → Connections → Connect Google`.

## Developer Token Elevation

1. Log into your Google Ads Manager account (MCC)
2. Go to **Tools & Settings → API Center**
3. Under **Developer token**, click **Apply for Basic Access**
4. Fill in:
   - **Company name**: Partners in Biz
   - **Company website**: https://partnersinbiz.online
   - **Primary contact email**: peet.stander@partnersinbiz.online
   - **Application description** (see template below)
5. Submit and track status in API Center

### Application description template

```
Partners in Biz (https://partnersinbiz.online) is a white-label agency platform
that manages Google Ads campaigns on behalf of client businesses. Admins log into
our multi-tenant dashboard and use the Ads module to:

1. Connect a client Google Ads account via OAuth 2.0 (scope: adwords).
2. Create and manage Search, Display, and Shopping campaigns including ad groups,
   ads, keywords, audiences, and bidding strategies.
3. Build Customer Match audiences from client-uploaded contact lists (hashed
   client-side before transmission to Google).
4. Pull daily performance insights (cost, impressions, clicks, conversions, ROAS)
   via the searchStream GAQL endpoint for reporting dashboards.
5. Upload enhanced conversions to improve attribution beyond browser signals.
6. Manage Shopping campaigns linked to a Merchant Center account
   (scope: content).

All API calls are server-side; no end-user browsers touch the Google Ads API
directly. Credentials are encrypted at rest. See our Privacy Policy at
https://partnersinbiz.online/privacy for data handling details.
```

## MCC (Manager Account) Pre-Approval

Agency-managed client accounts sit under the PiB MCC. The `login-customer-id` header is sent on every API call to identify the MCC. No additional pre-approval is needed for BASIC access; for STANDARD access:

1. Go to your MCC → **Tools & Settings → Account access**
2. Verify the `login-customer-id` is set to the MCC's numeric customer ID (without dashes)
3. Env var `GOOGLE_ADS_LOGIN_CUSTOMER_ID` in Vercel must match

## Content Policy Compliance Checklist

- [ ] Ads comply with [Google Ads Policies](https://support.google.com/adspolicy)
- [ ] Restricted categories (gambling, alcohol, financial products, health) have separate Google approvals before enabling for those clients
- [ ] Personalized advertising features (Customer Match, remarketing) disclosed in the Privacy Policy at https://partnersinbiz.online/privacy
- [ ] No personally identifiable information stored unencrypted — all contact lists are SHA-256 hashed client-side before the API call
- [ ] Enhanced conversions data (email hash, phone hash) handled under Google's [Customer Data Policy](https://support.google.com/google-ads/answer/9888656)

## Sample API Requests

Provide these examples in the API Center application form. Use realistic but fully redacted tokens.

### Create Search campaign

```http
POST https://googleads.googleapis.com/v17/customers/1234567890/campaigns:mutate
Authorization: Bearer ACCESS_TOKEN_REDACTED
developer-token: DEV_TOKEN_REDACTED
login-customer-id: 9876543210
Content-Type: application/json

{
  "operations": [{
    "create": {
      "name": "PiB Demo — Search Traffic",
      "status": "PAUSED",
      "advertisingChannelType": "SEARCH",
      "campaignBudget": "customers/1234567890/campaignBudgets/~1",
      "biddingStrategyType": "MAXIMIZE_CLICKS",
      "networkSettings": {
        "targetGoogleSearch": true,
        "targetSearchNetwork": true
      },
      "startDate": "2026-06-01",
      "endDate": "2026-12-31"
    }
  }]
}
```

### Fetch daily insights (GAQL searchStream)

```http
POST https://googleads.googleapis.com/v17/customers/1234567890/googleAds:searchStream
Authorization: Bearer ACCESS_TOKEN_REDACTED
developer-token: DEV_TOKEN_REDACTED
login-customer-id: 9876543210
Content-Type: application/json

{
  "query": "SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc FROM campaign WHERE campaign.id = 111222333 AND segments.date BETWEEN '2026-05-01' AND '2026-05-17' ORDER BY segments.date ASC"
}
```

### Upload enhanced conversion click

```http
POST https://googleads.googleapis.com/v17/customers/1234567890:uploadClickConversions
Authorization: Bearer ACCESS_TOKEN_REDACTED
developer-token: DEV_TOKEN_REDACTED
login-customer-id: 9876543210
Content-Type: application/json

{
  "conversions": [{
    "gclid": "GCLID_REDACTED",
    "conversionAction": "customers/1234567890/conversionActions/987654321",
    "conversionDateTime": "2026-05-17 10:30:00+02:00",
    "conversionValue": 149.99,
    "currencyCode": "USD",
    "userIdentifiers": [{
      "hashedEmail": "SHA256_HASH_REDACTED"
    }]
  }],
  "partialFailure": true
}
```

## Screencast Script

3-5 minute video for Google's reviewers. Record with Loom or QuickTime. Show all flows that use the `adwords` scope.

1. **Connect Google Ads** — Admin → Org → [test client] → Ads → Connections → Connect Google → OAuth consent screen → redirect back → connection active, ad accounts listed
2. **Create Search campaign** — Ads → Campaigns → New → Search objective → budget → ad group with keyword → text ad → Create (status: PAUSED; no real spend)
3. **Build Customer Match audience** — Ads → Audiences → New → Customer Match → upload small test CSV (2-3 rows) → hashing happens client-side → show audience created in BUILDING status
4. **View insights chart** — Ads → Insights → select campaign → show daily ROAS/spend/clicks chart populated from the searchStream pull
5. **Submit a conversion** — Ads → Conversions → Upload → show the enhanced conversion POST with a test GCLID → show the success response

Add a narration note: "All campaigns created in the screencast remain PAUSED; no actual budget is spent during the demo."

## Common Rejection Reasons

- **"Insufficient use case justification"** — Be specific about which API methods each feature calls. Vague descriptions like "manage ads" are flagged.
- **"Privacy policy inadequate"** — The Privacy Policy must explicitly mention: Customer Match hashing, enhanced conversions, data retention periods, and user data deletion rights.
- **"Sample requests too simplistic"** — Use realistic GAQL queries and full mutate operation structures. The `create` operation above with all required fields is the right level of detail.
- **"Test account not accessible"** — Configure `pib-reviewer@partnersinbiz.online` as a test user before submitting (see below).
- **"App not reachable"** — Ensure Vercel prod is live and CRON_SECRET + all Google env vars are set so the reviewers can trigger the OAuth flow.

## Test User Setup

1. In the PiB Google Cloud project → IAM → Add `pib-reviewer@partnersinbiz.online` as a test user on the OAuth client
2. In the test Google Ads Manager account → Account access → invite `pib-reviewer@partnersinbiz.online` as Admin
3. Provide the reviewer with:
   - Login: `pib-reviewer@partnersinbiz.online`
   - Password: (generate and share via private Slack DM or 1Password Send)
   - Test client URL: `https://partnersinbiz.online` → log in as admin, then navigate to the test org
4. Document these credentials in the `#pib-google-review` private channel

## After Elevation

- Update `GOOGLE_ADS_DEVELOPER_TOKEN` in Vercel env (it changes after elevation)
- Run `vercel env pull` and verify no trailing newline corruption (see [[Vercel env trailing-newline gotcha]])
- Test a live insert from the daily cron: `POST https://partnersinbiz.online/api/v1/ads/cron/daily-insights-pull` with `Authorization: Bearer $CRON_SECRET`
- Monitor Firestore `metrics` collection for `source: 'google_ads'` documents

---

## LinkedIn — Marketing Developer Platform Application

### Products requested

| Product | Scopes | Purpose |
|---|---|---|
| Marketing Developer Platform | `r_ads`, `rw_ads`, `r_ads_reporting` | Read/write LinkedIn ad accounts, campaigns, creatives, audiences; pull insights via /rest/adAnalytics. |
| Conversions API | `rw_conversions` | Send server-side conversion events to /rest/conversionEvents, dedupe with Insight Tag client events via shared eventId. |

LinkedIn requires a **separate** OAuth app from PiB's existing social-posting LinkedIn app. Env vars are namespaced accordingly: `LINKEDIN_ADS_CLIENT_ID` / `LINKEDIN_ADS_CLIENT_SECRET`. Redirect URI: `https://partnersinbiz.online/api/v1/ads/linkedin/oauth/callback` (production) + the localhost equivalent for dev.

### Demo workflow

A LinkedIn reviewer can verify PiB's use of the platform end-to-end via these steps using PiB's demo org credentials:

1. **Connect a LinkedIn ad account** at `/admin/org/{slug}/ads/connections`. OAuth dialog grants all four scopes. The connection persists encrypted access + refresh tokens via `SOCIAL_TOKEN_MASTER_KEY` (AES-256-GCM).
2. **Pick a default ad account** from the list returned by `/rest/adAccounts?q=search`. The PATCH endpoint at `/api/v1/ads/linkedin/connections/[id]/account` persists the URN.
3. **Create a Campaign Group → Campaign → Creative** via the 3-step wizard at `/admin/org/{slug}/ads/campaigns/new` with `platform: 'linkedin'`. The wizard invokes `POST /rest/adAccounts/{id}/adCampaignGroups`, `/adCampaigns`, and `/creatives` in sequence, persisting the LinkedIn URNs in canonical doc `providerData.linkedin`.
4. **Create a Matched Audience** at `/admin/org/{slug}/ads/audiences/new` — choose LinkedIn tab, pick a subtype (Customer List / Website / Lookalike / Engagement). The Customer List path also exercises hashed-CSV upload via `/api/v1/ads/custom-audiences/[id]/upload-list`, which chunks SHA-256-hashed rows to `/rest/dmpSegments/{id}/users`.
5. **Refresh insights** by triggering `/api/v1/ads/insights?platform=linkedin` or waiting for the daily cron at 00:30 UTC (`/api/v1/ads/cron/daily-insights-pull`). PiB queries `/rest/adAnalytics` with pivot=CAMPAIGN_GROUP/CAMPAIGN/CREATIVE and chunked date ranges.
6. **Send a test conversion** by configuring the Insight Tag at `/admin/org/{slug}/ads/pixel-config` (Insight Tag Partner ID + rw_conversions CAPI token + optional test event code), then POST `/api/v1/ads/conversions/track` with the eventId. PiB fans out to LinkedIn's `/rest/conversionEvents` with SHA-256 hashed email/phone + raw `li_fat_id`.

### Data handling disclosure

- **Tokens at rest:** all LinkedIn access + refresh + CAPI tokens are encrypted via AES-256-GCM with a per-environment master key (`SOCIAL_TOKEN_MASTER_KEY`). Never logged.
- **Customer-list audience CSVs:** uploaded files are hashed (SHA-256 lowercase-trimmed) server-side, posted to LinkedIn DMP Segments, then the source CSV is purged from Firebase Storage within 24h via the existing lifecycle policy.
- **PII normalisation:** emails lowercase-trim → SHA-256 hex; phones strip non-digits (preserve leading `+`) → SHA-256 hex. Same normalisation used for the Meta CAPI module.
- **`li_fat_id`** (LinkedIn first-party tracking cookie) is sent raw to the Conversions API per LinkedIn's spec — it's an opaque token, not PII.
- **Disconnect:** `DELETE /api/v1/ads/connections/linkedin` revokes the connection locally; clients can also revoke directly from their LinkedIn account settings.
- **Tenant isolation:** every Firestore doc (`ad_connections`, `ad_campaigns`, `ad_sets`, `ads`, `custom_audiences`, `saved_audiences`, `ad_pixel_configs`, `ad_conversion_events`, `metrics`) carries `orgId` and is read-write gated by `withAuth('admin')` + header-resolved `orgId`. No cross-tenant data leakage.

### Reviewer access

LinkedIn requests a specific test member URN to grant `VIEWER` access on. Provide the PiB demo organisation's LinkedIn member URN (Peet to supply post-LMDP approval) so reviewers can log in via their own LinkedIn account and exercise the flow.

### Submission checklist

- [ ] Screencast (under 3 minutes) walking the demo workflow above
- [ ] LinkedIn member URN for VIEWER grant
- [ ] Verify all 4 scopes appear approved on the app's Products tab
- [ ] Verify Vercel env has `LINKEDIN_ADS_CLIENT_ID` + `LINKEDIN_ADS_CLIENT_SECRET` set for production + preview
- [ ] Confirm redirect URI registered: `https://partnersinbiz.online/api/v1/ads/linkedin/oauth/callback`
- [ ] Run all 5 phase smokes (`smoke-ads-sub3b-phase{1,2,3,4,5}.ts`) green against the test account
