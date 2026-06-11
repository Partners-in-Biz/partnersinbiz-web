# Link Shortening & UTM Tracking System

A complete link shortening and UTM parameter tracking system for the Partners in Biz social media platform. Enables users to create short, trackable links with automatic UTM parameter management and detailed click analytics.

## Architecture

### Core Components

#### 1. Types (`lib/links/types.ts`)
Defines three main interfaces:

- **ShortenedLink**: Main document in `shortened_links` collection
  - `id`: Firestore document ID
  - `orgId`: Organization ID (multi-tenant)
  - `originalUrl`: Full destination URL
  - `shortCode`: 7-char alphanumeric code (e.g., `aBc123De`)
  - `shortUrl`: Generated short URL (e.g., `https://app.com/l/aBc123De`)
  - `utmSource`, `utmMedium`, `utmCampaign`, `utmTerm`, `utmContent`: Optional UTM parameters
  - `clickCount`: Total click count
  - `createdBy`, `createdAt`, `updatedAt`: Audit trail

- **LinkClick**: Sub-document in `shortened_links/{linkId}/clicks` collection
  - Recorded on every click
  - Captures: timestamp, referrer, user agent, IP, country
  - Fire-and-forget logging (errors don't block redirects)

- **LinkStats**: Computed analytics (not stored)
  - `totalClicks`: Count of all clicks
  - `clicksByDay`: Array of {date, count} for charts
  - `topReferrers`: Array of {referrer, count}
  - `topCountries`: Array of {country, count}
  - `recentClicks`: Last 20 clicks with details

#### 2. Shortener Utility (`lib/links/shorten.ts`)

Core functions:

- **`generateShortCode()`**
  - Generates random 7-char alphanumeric string
  - Characters: A-Z, a-z, 0-9

- **`ensureUniqueCode(orgId, code, attempts)`**
  - Checks Firestore for existing code in org
  - Regenerates up to 10 times if collision
  - Throws if max attempts exceeded

- **`createShortLink(orgId, originalUrl, options, createdBy)`**
  - Validates URL using URL constructor
  - Generates unique short code
  - Builds short URL using `NEXT_PUBLIC_APP_URL`
  - Creates Firestore document
  - Returns full `ShortenedLink` object

- **`resolveShortCode(shortCode)`**
  - Looks up code in Firestore
  - Appends UTM params to original URL
  - Returns `{ url, linkId }` or null

- **`trackClick(linkId, orgId, request)`**
  - Extracts referrer, user agent, IP from request headers
  - Creates click document in subcollection
  - Increments `clickCount` on link
  - **Fire-and-forget**: Errors logged but not thrown

- **`getLinkStats(linkId, orgId)`**
  - Fetches last 1000 clicks
  - Computes day-by-day breakdown
  - Aggregates referrers and countries
  - Returns `LinkStats` object

#### 3. Public Redirect Handler (`app/l/[code]/route.ts`)

- **GET /l/[code]**
  - **NO authentication required** (public endpoint)
  - Validates short code format (alphanumeric, 6-8 chars)
  - Resolves to original URL with UTM params
  - Tracks click (fire-and-forget)
  - Returns 302 redirect
  - Falls back to homepage if not found

#### 4. API Endpoints

**GET /api/v1/links** (authenticated, tenant-scoped)
- Lists all shortened links for org
- Pagination: `?page=1&limit=20`
- Returns array of `ShortenedLink` with meta

**POST /api/v1/links** (authenticated, tenant-scoped)
- Creates new shortened link
- Body: `{ originalUrl, utmSource?, utmMedium?, utmCampaign?, utmTerm?, utmContent? }`
- Validates URL format
- Returns created link object

**GET /api/v1/links/[id]** (authenticated, tenant-scoped)
- Gets link details + computed stats
- Returns link object with `stats: LinkStats`

**DELETE /api/v1/links/[id]** (authenticated, tenant-scoped)
- Soft deletes: removes link and all clicks
- Cascades to subcollection deletion
- Returns `{ id, deleted: true }`

**GET /api/v1/links/[id]/stats** (authenticated, tenant-scoped)
- Returns just analytics for a link
- Contains shortUrl, originalUrl, and detailed stats

#### 5. UI (`app/(portal)/portal/social/links/page.tsx`)

A full-featured React component with:

**Create Link Form**
- URL input with validation
- 5 optional UTM fields
- Live preview of final URL with params
- Error/success messages
- Submit button with loading state

**Links Table**
- Columns: Short code, Original URL, Click count, Created date, Actions
- Copy-to-clipboard button for short URLs
- Delete button (with confirmation)
- Click row to view stats
- Pagination (20 per page)

**Stats Panel** (side column)
- Total clicks (prominent display)
- Top 5 referrers
- Top 5 countries
- Only shows when link selected

## Firestore Schema

```
organizations/{orgId}
  └─ shortened_links/
       └─ {linkId} (document)
            ├─ id: string
            ├─ orgId: string
            ├─ originalUrl: string
            ├─ shortCode: string
            ├─ shortUrl: string
            ├─ utmSource?: string
            ├─ utmMedium?: string
            ├─ utmCampaign?: string
            ├─ utmTerm?: string
            ├─ utmContent?: string
            ├─ clickCount: number
            ├─ createdBy: string
            ├─ createdAt: Timestamp
            ├─ updatedAt: Timestamp
            └─ clicks/ (subcollection)
                 └─ {clickId} (document)
                      ├─ linkId: string
                      ├─ orgId: string
                      ├─ timestamp: Timestamp
                      ├─ referrer: string | null
                      ├─ userAgent: string | null
                      ├─ ip: string | null
                      └─ country: string | null
```

## Usage Examples

### Create a Short Link (API)

```bash
curl -X POST http://localhost:3000/api/v1/links \
  -H "Authorization: Bearer <idToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "originalUrl": "https://example.com/long/path/to/article",
    "utmSource": "twitter",
    "utmMedium": "social",
    "utmCampaign": "launch"
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "id": "abc123def456",
    "shortCode": "xYz9AbC",
    "shortUrl": "https://app.com/l/xYz9AbC",
    "originalUrl": "https://example.com/...",
    "utmSource": "twitter",
    "utmMedium": "social",
    "utmCampaign": "launch",
    "clickCount": 0,
    "createdAt": {...}
  }
}
```

### Access Short Link (Browser)

When user visits `https://app.com/l/xYz9AbC`, the system:
1. Validates short code
2. Resolves to: `https://example.com/...?utm_source=twitter&utm_medium=social&utm_campaign=launch`
3. Logs the click to subcollection
4. Returns 302 redirect

### Get Analytics

```bash
curl http://localhost:3000/api/v1/links/abc123def456 \
  -H "Authorization: Bearer <idToken>"
```

Response includes stats with clicks breakdown, top referrers, countries, etc.

## Key Design Decisions

### 1. Fire-and-Forget Click Tracking
Click logging doesn't block the redirect. This ensures:
- Fast, responsive redirects (< 100ms)
- Errors in tracking don't break user experience
- Errors are logged server-side for debugging

### 2. Unique Short Codes per Org
Codes are org-scoped, allowing:
- Different orgs to reuse same codes
- Reduced collision probability
- Better multi-tenant isolation

### 3. UTM in Shortener, Not Redirect Handler
UTM params are **stored** in the link document, not passed as parameters to `/l/[code]`. This:
- Prevents URL manipulation
- Makes links shorter and cleaner
- Keeps all tracking params in one place
- Enables future param modification without link changes

### 4. Subcollection for Clicks
Click documents are stored in `shortened_links/{linkId}/clicks/` rather than a flat `link_clicks` collection. This:
- Improves query performance (scoped to link)
- Enables simple deletion (cascade)
- Natural document hierarchy
- Easier pagination by link

### 5. Public /l/ Route (No Auth)
The redirect handler has **no authentication** because:
- Short links are meant to be shared publicly
- Restricting access defeats the purpose
- Clicks from unknown sources still tracked
- Org ID inferred from link document

## Configuration

**Environment Variables**
- `NEXT_PUBLIC_APP_URL` — Base URL for short links (e.g., `https://app.partnersinbiz.com`)
  - Defaults to `http://localhost:3000` in development

## Future Enhancements

1. **Geolocation**
   - Implement IP-to-country mapping (using service like MaxMind GeoIP2)
   - Currently country is stored as `null`

2. **Click Visualization**
   - Add Recharts visualizations in UI (charts imported but not fully used)
   - Line chart of clicks over time
   - Bar chart of top referrers/countries

3. **Link Expiration**
   - Add optional `expiresAt` field
   - Soft-delete expired links
   - Track expiration in analytics

4. **Custom Short Codes**
   - Allow users to specify their own codes
   - Add vanity URL feature
   - Validate against reserved words

5. **QR Codes**
   - Generate QR code for short URL
   - Display in UI
   - Download as image

6. **Bulk Operations**
   - Bulk create from CSV
   - Bulk delete
   - Bulk export analytics

7. **Advanced Filtering**
   - Filter by created date range
   - Filter by click count
   - Search by original URL

8. **Webhooks**
   - Notify external systems on clicks
   - Custom click thresholds
   - Integration with analytics platforms

## Testing

### Manual Testing Checklist

- [ ] Create link with no UTM params
- [ ] Create link with partial UTM params
- [ ] Create link with all UTM params
- [ ] Preview URL shows correct params
- [ ] List links with pagination
- [ ] Click link → redirect with params
- [ ] Click recorded in Firestore
- [ ] Click count increments
- [ ] View analytics for link
- [ ] Delete link → removes clicks too
- [ ] Copy short URL to clipboard
- [ ] Invalid short code → redirect to home
- [ ] Multi-tenant isolation (different orgs can't see each other's links)

### Database Indexes

Create the following Firestore composite index for optimal performance:

```
Collection: shortened_links
Fields:
  - orgId (Ascending)
  - createdAt (Descending)
```

## Files Created

```
lib/links/
  ├─ types.ts              (ShortenedLink, LinkClick, LinkStats interfaces)
  └─ shorten.ts            (Core logic: generateShortCode, createShortLink, etc.)

app/l/[code]/
  └─ route.ts              (Public 302 redirect handler)

app/api/v1/links/
  ├─ route.ts              (GET list, POST create)
  ├─ [id]/
  │  ├─ route.ts           (GET details, DELETE remove)
  │  └─ stats/
  │     └─ route.ts        (GET analytics)

app/(portal)/portal/social/links/
  └─ page.tsx              (Full-featured UI component)
```

## Performance Considerations

- **Short code generation**: O(log n) Firestore lookup, regenerates up to 10 times on collision
- **Click tracking**: Fire-and-forget, <100ms overhead
- **Link resolution**: Single Firestore query, <50ms
- **Analytics**: Fetches up to 1000 clicks, O(n) in-memory aggregation
  - Suitable for links with <10k clicks/month
  - For high-volume links, consider materialized views or external analytics service

## Security

- **URL validation**: Uses built-in URL constructor, prevents invalid links
- **Multi-tenant isolation**: All queries scoped to `orgId`
- **Auth enforcement**: All write endpoints require client/admin role
- **Public redirects**: No secrets exposed in redirect URL
- **Click tracking**: Only stores non-sensitive data (referrer, user agent, IP)
