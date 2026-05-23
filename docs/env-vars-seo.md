# SEO Sprint Manager env vars

| Var | Required | Purpose |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | yes | Google OAuth client for GSC integration |
| `GOOGLE_OAUTH_CLIENT_SECRET` | yes | Google OAuth client secret |
| `GSC_REDIRECT_URI` | yes | OAuth callback URL: `${BASE_URL}/api/v1/seo/integrations/gsc/callback` |
| `BING_WMT_API_KEY` | yes (for Bing pulls) | Bing Webmaster Tools API key |
| `PAGESPEED_API_KEY` | optional | Raises PageSpeed quota from 25/day to 25K/day |
| `OPR_API_KEY` | yes (for backlink DR) | OpenPageRank API key (free, 1K req/day) |
| `COMMONCRAWL_INDEX` | optional | Override Common Crawl index URL (defaults to CC-MAIN-2025-12) |
| `CRON_SECRET` | yes | Already set — used by Vercel Cron auth |
| `AI_API_KEY` | yes | Already set — skill auth |
| `NEXT_PUBLIC_BASE_URL` | yes | Already set — used in OAuth callback redirect + share URLs |

## Setup steps

### Google Search Console OAuth
1. In Google Cloud Console, create an OAuth 2.0 client (Web application)
2. Add `https://partnersinbiz.online/api/v1/seo/integrations/gsc/callback` to authorized redirect URIs
3. Set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GSC_REDIRECT_URI` on Vercel
4. Per sprint: user clicks "Connect Search Console" in `/admin/seo/sprints/[id]/settings`

Gotcha: copied Google values can include trailing newlines. `GSC_REDIRECT_URI` must resolve exactly to the registered callback URL, with no whitespace, otherwise Google may reject the OAuth request before consent. The GSC OAuth helper trims these env values defensively, but keep Vercel values clean as well.

### Bing Webmaster Tools
1. Sign in to [Bing Webmaster](https://www.bing.com/webmasters), verify the site
2. In Settings → API access, generate an API key
3. Set `BING_WMT_API_KEY` on Vercel
4. Per sprint: POST `/api/v1/seo/integrations/bing/connect/[sprintId]` with `{ siteUrl }`

### PageSpeed (no auth required)
- API key optional. Without it: 25 requests/day quota is shared.
- With it: 25K requests/day per key. Strongly recommended.

### OpenPageRank
- Sign up at [openpagerank.com](https://openpagerank.com/) for a free key (1K req/day)
- Set `OPR_API_KEY` on Vercel

## Cron schedule

Both crons authenticate with `Bearer ${CRON_SECRET}`:

```
04:00 UTC daily   /api/cron/seo-daily       (= 06:00 SAST)
05:00 UTC Mondays /api/cron/seo-weekly      (= 07:00 SAST)
```
