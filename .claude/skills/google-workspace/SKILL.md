---
name: google-workspace
description: >
  Store, retrieve, share, and manage binary artifacts (images, videos, PDFs, brand kits, ad creatives,
  reports, contracts, and any non-text file) using Google Drive, Google Docs, and Google Sheets through
  the Partners in Biz platform. Use this skill whenever the user or another agent mentions anything
  related to binary file storage or sharing, including but not limited to: "upload to drive",
  "save to drive", "save this to Drive", "put it in Drive", "share with client", "send the report",
  "create a Google Doc", "open a Google Doc", "save the video", "upload the brand kit",
  "client deliverable", "send the deliverable", "drive folder", "shared drive", "ad creative",
  "marketing asset", "where do I save this image", "store this PDF", "upload this file",
  "save the brand kit", "brand folder", "upload the creative", "save the ad", "where does this go",
  "give the client access", "share a link", "viewer link", "download the report", "export to Drive",
  "save to Google", "google sheet", "append to sheet", "update the spreadsheet", "log this to sheets",
  "read from sheets", "brand kit folder", "client folder", "deliverables folder", "raw sources folder",
  "find that file in Drive", "search Drive", "Drive search", "Drive link", "get the Drive URL",
  "artifact", "generate and save", "produce and deliver", "produce a report", "marketing deliverable",
  "save the social pack", "upload the social pack", "send the video to the client",
  "share the images", "share the PDF", "where do binary files go", "asset storage". If in doubt,
  trigger — this skill governs ALL binary artifact storage across the Cowork ecosystem.
---

# Google Workspace — Binary Artifact Storage

This skill governs how agents store, retrieve, and share **binary artifacts** — images, videos, PDFs,
brand kits, ad creatives, reports, contracts, and any other non-text file generated during client
work. Text knowledge (specs, briefs, research, plans) lives in Obsidian. Code lives in GitHub.
Everything else lives in Google Drive.

## The Three-Tier Rule

Get the file type right or it ends up invisible to other agents and to the client.

| File type | Canonical location | Why |
|---|---|---|
| Specs, plans, briefs, research dumps, architecture docs | `~/Cowork/Cowork/agents/<domain>/wiki/` | Obsidian syncs to VPS + mobile; searchable by all agents |
| Code, READMEs, ADRs, in-tree config, skill files | Project git repo | Version-controlled; not synced to Obsidian or Drive |
| **Binary artifacts** — images, videos, PDFs, brand kits, ad creatives, signed contracts, invoices, renders, exports | **Google Drive** (`My Drive/Clients/<Client>/...`) | Drive is the canonical binary store; shareable directly with clients |

The full table and symlink rules live in `/Users/peetstander/Cowork/CLAUDE.md` under "Where to put agent-generated files". Read that if you're unsure about a file type.

**Rule of thumb:** if the file would corrupt in a markdown editor or break in a git diff, it goes to Drive.

---

## Per-Client Folder Convention

Every client gets a root folder under `My Drive/Clients/`. Use this structure exactly — the numbered
prefixes ensure stable sort order and predictable paths for programmatic access.

```
My Drive/
└── Clients/
    └── <Client Name>/          e.g. "Loyalty Plus", "AHS Law", "Lumen"
        ├── 01_brand/           logo files, font licences, brand kit PDF, colour palettes
        ├── 02_marketing/       ad creatives, video edits, social images, campaign packs
        │   └── <campaign>/     sub-folder per campaign, e.g. "black-friday-2026"
        ├── 03_deliverables/    final reports, signed contracts, invoices, strategy docs as PDF
        └── 04_raw-sources/     clipped PDFs, screenshots, datasets, reference files
```

### Discovering or creating a client folder

1. Call `drive_search` with `q: "name='<Client Name>' and mimeType='application/vnd.google-apps.folder'"` to find the root.
2. If it exists, use the returned folder ID for all child operations.
3. If it doesn't exist, call `drive_upload` with `mimeType: 'application/vnd.google-apps.folder'` to create the root, then repeat for each of the four sub-folders.
4. Always use the folder **ID** (not the path string) for subsequent operations — paths are not stable across renames.

---

## Operations

These are the tool contracts agents call once the Google Workspace integration is wired. Each
operation maps to a future endpoint under `https://partnersinbiz.online/api/v1/google/`. Until the
endpoints are implemented (see Operator Setup below), operations return `501 Not Implemented`.

---

### `drive_list` — list files in a folder

```bash
curl -X GET \
  -H "Authorization: Bearer $AI_API_KEY" \
  "https://partnersinbiz.online/api/v1/google/drive/list?folderId=<FOLDER_ID>&pageSize=50"
```

Query params:
- `folderId` (required) — Drive folder ID, or `root` for top-level
- `mimeType` — filter by MIME type (e.g. `image/png`, `video/mp4`)
- `pageSize` — default 50, max 200
- `pageToken` — cursor for next page

Response:
```json
{
  "files": [
    { "id": "1abc...", "name": "logo-v3.png", "mimeType": "image/png",
      "size": 204800, "webViewLink": "https://drive.google.com/...",
      "modifiedTime": "2026-05-13T10:00:00Z" }
  ],
  "nextPageToken": "token_abc"
}
```

---

### `drive_upload` — upload a local file to Drive

```bash
curl -X POST \
  -H "Authorization: Bearer $AI_API_KEY" \
  -F "file=@/path/to/file.png" \
  -F "folderId=<FOLDER_ID>" \
  -F "name=logo-v3.png" \
  "https://partnersinbiz.online/api/v1/google/drive/upload"
```

Fields (multipart/form-data):
- `file` (required) — binary file, max 5 GB
- `folderId` (required) — destination folder ID
- `name` — override filename; defaults to original filename
- `description` — optional Drive file description

Response (201):
```json
{
  "id": "1abc...",
  "name": "logo-v3.png",
  "webViewLink": "https://drive.google.com/file/d/1abc.../view",
  "webContentLink": "https://drive.google.com/uc?id=1abc..."
}
```

Use `webViewLink` for sharing with humans. Use `webContentLink` for programmatic download.

---

### `drive_download` — download a file by ID

```bash
curl -X GET \
  -H "Authorization: Bearer $AI_API_KEY" \
  "https://partnersinbiz.online/api/v1/google/drive/download?fileId=<FILE_ID>" \
  -o output.png
```

Query params:
- `fileId` (required)
- `mimeType` — for Google Workspace files (Docs/Sheets/Slides), specify export MIME: `application/pdf`, `text/plain`, etc.

Response: raw binary stream with appropriate `Content-Type`.

---

### `drive_share` — share a file or folder with an email address

```bash
curl -X POST \
  -H "Authorization: Bearer $AI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "fileId": "1abc...",
    "email": "client@example.com",
    "role": "reader",
    "sendNotification": true,
    "message": "Here is your brand kit — let me know if anything needs adjusting."
  }' \
  "https://partnersinbiz.online/api/v1/google/drive/share"
```

Body fields:
- `fileId` (required)
- `email` (required) — recipient email
- `role` (required) — `reader` | `commenter` | `writer`
- `sendNotification` — default `true`; set `false` to share silently
- `message` — optional email message body

Response:
```json
{ "permissionId": "perm_abc", "webViewLink": "https://drive.google.com/file/d/1abc.../view" }
```

Return `webViewLink` to the user or attach to the kanban task as an artifact.

---

### `drive_search` — full-text + filename search across Drive

```bash
curl -X GET \
  -H "Authorization: Bearer $AI_API_KEY" \
  "https://partnersinbiz.online/api/v1/google/drive/search?q=brand+kit&clientFolder=Loyalty+Plus"
```

Query params:
- `q` (required) — search string (searches filename and full text)
- `clientFolder` — restrict to a client's root folder by name
- `mimeType` — filter results by MIME type
- `pageSize` — default 20, max 100

Response: same shape as `drive_list`.

The `q` param is forwarded to the Drive API's `fullText contains` + `name contains` operator, OR'd together.

---

### `docs_create` — create a new Google Doc from markdown

```bash
curl -X POST \
  -H "Authorization: Bearer $AI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Q3 Strategy Report — Loyalty Plus",
    "markdown": "# Q3 Strategy\n\n## Goals\n...",
    "folderId": "<FOLDER_ID>"
  }' \
  "https://partnersinbiz.online/api/v1/google/docs/create"
```

Body:
- `title` (required)
- `markdown` (required) — converted server-side to Docs native format
- `folderId` — where to place the Doc; defaults to root

Response (201):
```json
{ "docId": "1xyz...", "title": "Q3 Strategy Report — Loyalty Plus",
  "webViewLink": "https://docs.google.com/document/d/1xyz.../edit" }
```

Use this when a deliverable is best consumed as a living Google Doc rather than a PDF. For
static exports, generate the Doc then use `drive_download` with `mimeType: application/pdf`.

---

### `sheets_append` — append a row to a Google Sheet

```bash
curl -X POST \
  -H "Authorization: Bearer $AI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "spreadsheetId": "1abc...",
    "range": "Sheet1",
    "values": [["2026-05-13", "Loyalty Plus", "Black Friday Pack", "Done", "https://drive.google.com/..."]]
  }' \
  "https://partnersinbiz.online/api/v1/google/sheets/append"
```

Body:
- `spreadsheetId` (required)
- `range` (required) — sheet name or A1 range (e.g. `Sheet1`, `Deliverables!A:E`)
- `values` (required) — 2D array; each inner array is one row

Response:
```json
{ "updatedRange": "Sheet1!A10:E10", "updatedRows": 1 }
```

---

### `sheets_read` — read a range from a Google Sheet

```bash
curl -X GET \
  -H "Authorization: Bearer $AI_API_KEY" \
  "https://partnersinbiz.online/api/v1/google/sheets/read?spreadsheetId=1abc...&range=Sheet1!A1:E20"
```

Query params:
- `spreadsheetId` (required)
- `range` (required)

Response:
```json
{
  "values": [
    ["Date", "Client", "Asset", "Status", "Drive URL"],
    ["2026-05-13", "Loyalty Plus", "Black Friday Pack", "Done", "https://drive.google.com/..."]
  ]
}
```

---

## Auth Model

**Current state: NOT YET WIRED.** See Operator Setup at the bottom of this file.

When implemented, auth flows as follows:

- **Mac / Claude Code sessions:** service account JSON at `~/.config/gcloud/workspace-sa.json` is picked up by the PiB API. Agents never hold Drive credentials directly.
- **VPS (Hermes):** service account JSON at `/etc/hermes/google-drive-sa.json` (mode 600), used by `rclone` for direct Drive mounts and by the PiB API proxy when the VPS calls platform endpoints.
- **All agent calls go through the PiB platform:** `Bearer $AI_API_KEY` → `https://partnersinbiz.online/api/v1/google/...` → PiB API authenticates to Drive using the stored service account. Agents never handle OAuth tokens directly.
- **Env var:** `GOOGLE_WORKSPACE_CREDS_JSON_PATH` — absolute path to the service account JSON. Set in `.env.local` on Mac and in Vercel environment variables for the `partnersinbiz-web` project.

The service account must be granted access to specific client folders only — never the entire Drive. Share each `My Drive/Clients/<Client>/` root folder with the service account email. This is the least-privilege posture.

---

## When NOT to Use This Skill

| Situation | Use instead |
|---|---|
| Writing a spec, plan, brief, research dossier, or architecture doc | Obsidian — `~/Cowork/Cowork/agents/<domain>/wiki/` |
| Writing code, configs, or skill files | Git — commit to the project repo |
| Creating a short text summary of work done | Include inline in the kanban task's `agentOutput.summary` |
| Uploading a social post image to the PiB platform (not Drive) | `POST /api/v1/social/media/upload` via the social-media-manager skill |

Drive is for artifacts that need to be **shared with clients as files** or that are too large/binary for git or Obsidian. If it's text and it fits in a markdown file, it does not belong in Drive.

---

## Kanban Artifact Embed Pattern

When an agent generates a binary artifact and stores it in Drive, the Drive URL must be written back
to the kanban task so the Agent Board UI can surface it. Use the `agentOutput.artifacts` array on
the task PATCH:

```bash
PATCH /api/v1/projects/{projectId}/tasks/{taskId}
{
  "agentOutput": {
    "summary": "Generated 5 Black Friday social image variants and uploaded to Drive.",
    "artifacts": [
      { "type": "url", "ref": "https://drive.google.com/file/d/1abc.../view", "label": "Black Friday — Square v1" },
      { "type": "url", "ref": "https://drive.google.com/file/d/1xyz.../view", "label": "Black Friday — Stories v1" }
    ],
    "completedAt": "2026-05-13T10:00:00Z"
  },
  "agentStatus": "done"
}
```

Artifact schema: `{ type: 'url' | 'file' | 'commit' | 'message-thread' | 'doc', ref: string, label?: string }`.

The Agent Board UI renders `type: 'url'` artifacts as clickable links. Always label them clearly —
"Brand kit v3", "Q3 Report PDF", "Black Friday — Square 1024x1024" — so the human knows what
they're clicking before they open Drive.

---

## End-to-End Example — Social Pack for a Client

Maya is asked to "create a Black Friday social pack for Loyalty Plus":

1. **Generate assets** — Maya calls `higgsfield-generate` or `higgsfield-product-photoshoot` to produce 5 image variants.

2. **Find the client folder** — call `drive_search` with `q: "name='Loyalty Plus' and mimeType='application/vnd.google-apps.folder'"`. If none found, create the folder hierarchy under `My Drive/Clients/Loyalty Plus/`.

3. **Upload each image** — call `drive_upload` once per image, targeting `Clients/Loyalty Plus/02_marketing/black-friday-2026/` by folder ID.

4. **Share with client** — call `drive_share` on the campaign sub-folder (not individual files) with `email: <client email>`, `role: 'reader'`, `sendNotification: true`. One share link covers the whole campaign folder.

5. **Write back to kanban** — PATCH the task with `agentStatus: 'done'` and `agentOutput.artifacts` containing all 5 Drive view URLs. Include the folder share link as an additional artifact labeled "Campaign folder — Loyalty Plus Black Friday".

6. **Brief Peet or the operator** — surface the folder URL in your response so the human can see it without opening the kanban.

---

## VPS-Side Access (when wired)

Hermes agents on `hermes-vps-01` (Helsinki, Hetzner CX23) access the same Drive via two paths:

- **`rclone` mount** — service account JSON at `/etc/hermes/google-drive-sa.json`; provides a filesystem-like interface to Drive. Use for bulk operations or when an agent needs to read Drive content without going through the PiB API.
- **PiB API proxy** — agents call `https://partnersinbiz.online/api/v1/google/...` with `Bearer $AI_API_KEY` exactly as Mac-side agents do. Same auth, same endpoints. Preferred for all standard operations.

Both paths give the same view of `My Drive/Clients/`. The service account JSON is the credential in both cases.

---

## Operator Setup — Wire Drive When Ready

**Not yet implemented.** Follow these steps when Peet is ready to activate the integration.

### Step 1 — GCP project

Use the existing GCP project `partners-in-biz-85059` or create a new one. If reusing, check that Drive/Docs/Sheets APIs are not already enabled before enabling them (avoids duplicate billing).

### Step 2 — Enable APIs

In the GCP console (or via `gcloud`):
```bash
gcloud services enable drive.googleapis.com docs.googleapis.com sheets.googleapis.com \
  --project=partners-in-biz-85059
```

### Step 3 — Create a service account

```bash
gcloud iam service-accounts create workspace-agent \
  --display-name="Hermes Workspace Agent" \
  --project=partners-in-biz-85059

gcloud iam service-accounts keys create workspace-sa.json \
  --iam-account=workspace-agent@partners-in-biz-85059.iam.gserviceaccount.com
```

Note the service account email — you will use it to share Drive folders.

### Step 4 — Place the key securely

- **Mac:** `cp workspace-sa.json ~/.config/gcloud/workspace-sa.json && chmod 600 ~/.config/gcloud/workspace-sa.json`
- **VPS:** `scp workspace-sa.json hermes-vps-01:/etc/hermes/google-drive-sa.json && ssh hermes-vps-01 chmod 600 /etc/hermes/google-drive-sa.json`
- Delete the local `workspace-sa.json` after copying — do not leave it in any git-tracked path.

### Step 5 — Share client folders with the service account

For each client, share their root Drive folder with the service account email and grant **Editor** role. Do this in the Google Drive web UI (or via the Drive API). Never share the entire Drive — folder-level sharing only.

Example:
```
Share "My Drive/Clients/Loyalty Plus" → workspace-agent@partners-in-biz-85059.iam.gserviceaccount.com → Editor
Share "My Drive/Clients/AHS Law"      → same email → Editor
```

### Step 6 — Set the env var

On Mac (`.env.local`):
```
GOOGLE_WORKSPACE_CREDS_JSON_PATH=/Users/peetstander/.config/gcloud/workspace-sa.json
```

On Vercel (use `printf` — avoid trailing newline):
```bash
printf "%s" "/etc/hermes/google-drive-sa.json" | vercel env add GOOGLE_WORKSPACE_CREDS_JSON_PATH production
```

### Step 7 — Implement the API endpoints

Create `app/api/v1/google/` route handlers in `partnersinbiz-web`:
- `drive/list/route.ts`
- `drive/upload/route.ts`
- `drive/download/route.ts`
- `drive/share/route.ts`
- `drive/search/route.ts`
- `docs/create/route.ts`
- `sheets/append/route.ts`
- `sheets/read/route.ts`

Each handler authenticates the caller via `Bearer $AI_API_KEY` (existing `resolveUser` middleware),
then forwards to the Drive/Docs/Sheets API using the `GOOGLE_WORKSPACE_CREDS_JSON_PATH` credential.
Use the `googleapis` npm package (`google-auth-library` + `@googleapis/drive`).

### Step 8 — Configure rclone on VPS (optional but recommended)

```bash
# On hermes-vps-01
rclone config create gdrive drive \
  service_account_file=/etc/hermes/google-drive-sa.json \
  scope=drive
```

Test: `rclone ls gdrive:Clients/Loyalty\ Plus/01_brand/`

### Step 9 — Smoke test

```bash
# Upload a test file
curl -X POST -H "Authorization: Bearer $AI_API_KEY" \
  -F "file=@/tmp/test.txt" \
  -F "folderId=root" \
  -F "name=drive-integration-test.txt" \
  "https://partnersinbiz.online/api/v1/google/drive/upload"

# List root
curl -H "Authorization: Bearer $AI_API_KEY" \
  "https://partnersinbiz.online/api/v1/google/drive/list?folderId=root"
```

If both return 200, the integration is live. Delete the test file and update this section.

---

## Agent Patterns

1. **Search before creating** — always call `drive_search` to check if a client folder exists before creating a new one. Duplicate folders are hard to clean up at scale.
2. **Share folders, not files** — when giving a client access to a campaign, share the campaign sub-folder. Individual file shares create noise in Drive and are harder to revoke.
3. **Name files with version and date** — `brand-kit-v3-2026-05.pdf` not `brand-kit-final-FINAL.pdf`. Clients rename things; the version in the filename is the source of truth.
4. **Always write artifacts to kanban** — a Drive URL that isn't in `agentOutput.artifacts` is invisible to Peet and to other agents. Never skip this step.
5. **Binary artifacts = Drive; text knowledge = Research/Obsidian** — if you're tempted to put a markdown file in Drive, stop. Working client research belongs in the Research module first, then selected durable summaries can be exported to the wiki.
