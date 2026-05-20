---
name: project-management
description: >
  Projects, tasks (project-nested AND standalone), time tracking, calendar events, and project docs
  on Partners in Biz. Use this skill whenever the user mentions anything about projects, tasks,
  todos, time, calendars, or meetings, including: "create a project", "project status", "project brief",
  "project doc", "project wiki", "kick off a project", "add a task", "personal todo", "todo list",
  "my tasks", "tasks due today", "overdue tasks", "assign task to", "reassign", "complete task",
  "mark done", "high priority task", "task for this deal", "task for this contact",
  "start a timer", "stop timer", "log time", "time entry", "billable hours", "non-billable",
  "running timer", "what am I working on", "bill time to invoice", "invoice for time",
  "hourly rate", "team utilization", "team capacity", "schedule a meeting", "calendar event",
  "all-day event", "RSVP", "accept meeting", "decline meeting", "reminder", "recurring event",
  "comment on task", "@mention team member", "project context for AI". If in doubt, trigger.
---

# Project Management — Partners in Biz Platform API

Projects, tasks (two systems — project-nested vs. standalone), time tracking with billing-to-invoice, calendar events with RSVP, and project docs. Plus a rich agent-context endpoint that gives AI agents everything they need about a project in one call.

## Base URL & Authentication

```
https://partnersinbiz.online/api/v1
```

```
Authorization: Bearer <AI_API_KEY>
```

## Two task systems — know the difference

- **Project-nested tasks** (`/projects/[projectId]/tasks`) — classic Scrum-style tasks that belong to a project. Have comments subcollection.
- **Standalone tasks** (`/tasks`) — personal todos, cross-project work, or tasks linked to a contact/deal without a project. Can still reference `projectId` if needed.

Pick the system that fits: use project-nested when a project is the clear container; use standalone for personal todos or deal-linked tasks.

## Cross-app handoff rule

Projects are the canonical task bus whenever work crosses module boundaries, agents,
Peet, Partners in Biz staff, or client action.

Domain modules still own their own progress records:

- SEO work must update the SEO sprint.
- Social work must update the campaign/social queue.
- Ads work must update the ads campaign/ad records.
- Documents work must update the document/review surface.
- CRM work must update the CRM record, activity, or automation state.

Projects carry the execution handoff: who needs to do what, by when, what it blocks,
which agent owns it, and where the evidence lives.

When an agent discovers human work it cannot complete:

1. First update the domain record with the finding, current status, and blocker.
2. Find the active client/workstream project.
3. If no suitable project exists, create one with `POST /projects`.
4. Create a project-nested task with enough context for the assignee to act without
   reading the whole chat.
5. Assign or mention the responsible person if their user id is known.
6. If the responsible person cannot be resolved, leave the task unassigned, add a
   clear owner prefix in the title (`Peet action:`, `Client action:`, `Team action:`),
   and include `needs-assignment` in `labels`.
7. Add labels that tie the ticket back to the source module and record id, for example
   `seo`, `seo-sprint:<id>`, `ads-campaign:<id>`, `document:<id>`, `crm:<entityId>`.
8. Link the project task id or URL back into the domain record's notes/blocker field
   where the API allows it.

If there is no project yet, create it first. Do not leave actionable blockers only in
the final chat response, repo PR, or wiki.

## Collaboration primitives

- **Idempotency** on `POST /projects`, `POST /tasks`, `POST /time-entries`, `POST /time-entries/start`, `POST /calendar/events`
- **Comments** (`resourceType: 'project' | 'task' | 'time_entry' | 'calendar_event'`)
- **Assignments** — `assignedTo: { type: 'user' | 'agent', id }` on tasks and events
- **Notifications** — auto on task assignment, event invite

---

## API Reference

### Projects

#### `GET /projects` — auth: admin
Filters: `orgId`, `status` (`active`|`completed`|`on_hold`|`cancelled`), `clientOrgId`, `page`, `limit`.

#### `POST /projects` — auth: admin (idempotent)
Body:
```json
{
  "orgId": "org_abc",
  "name": "Q2 Marketing Campaign",
  "description": "Launch new product line...",
  "brief": "# Background\n...\n## Goals\n...",
  "clientOrgId": "org_client",
  "status": "active",
  "startAt": "2026-04-01",
  "endAt": "2026-06-30",
  "assignedTo": { "type": "user", "id": "uid123" },
  "tags": ["campaign", "q2"]
}
```

Response (201): `{ id }`.

#### `GET /projects/[projectId]` — auth: admin
Full project.

#### `PUT /projects/[projectId]` — auth: admin
Update fields.

#### `DELETE /projects/[projectId]` — auth: admin
Soft-delete.

### Project-nested tasks

#### `GET /projects/[projectId]/tasks` — auth: admin
Filters: `status`, `priority`, `assignedTo`.

#### `POST /projects/[projectId]/tasks` — auth: admin
Body:
```json
{ "title": "...", "description": "...", "status": "todo", "priority": "high",
  "dueDate": "2026-04-20", "assignedTo": "uid123" }
```

##### Agent dispatch fields (optional — for assigning work to AI agents)

Tasks can be assigned to a named agent in the Partners-in-Biz team (Pip, Theo, Maya, Sage, Nora) by adding these fields to the POST or PATCH body:

```json
{
  "title": "Build /pricing page",
  "assigneeAgentId": "pip",
  "agentInput": { "spec": "Build a /pricing page using the existing design system" },
  "dependsOn": ["task_abc123"]
}
```

- **`assigneeAgentId`** — one of `pip` | `theo` | `maya` | `sage` | `nora` (or omit/null for a human task). Setting this auto-initialises `agentStatus` to `pending`.
- **`agentStatus`** — `pending` | `picked-up` | `in-progress` | `awaiting-input` | `done` | `blocked`. On reassignment, status resets to `pending` unless explicitly overridden.
- **`agentInput`** — `{ spec: string, context?: object, constraints?: string[] }`. `spec` is required.
- **`agentOutput`** — written when the agent completes: `{ summary: string, artifacts?: [{ type, ref, label? }], completedAt }`. `artifacts.type` is `url` | `file` | `commit` | `message-thread` | `doc`.
- **`dependsOn`** — array of task IDs that must reach `agentStatus='done'` before this one becomes eligible for pickup.
- **`agentHeartbeatAt: true`** — pass this sentinel on PATCH to bump the heartbeat to "now" (used while an agent is actively working).

### Self-dispatch pattern

When the user asks you to "do X and create a task for it" or "track this work", create the task **assigned to yourself** so it shows on the kanban:

1. `POST /projects/{projectId}/tasks` with `assigneeAgentId: 'pip'` and `agentInput.spec`
2. Immediately do the work
3. `PATCH /projects/{projectId}/tasks/{taskId}` with `agentStatus: 'in-progress'` then later `agentStatus: 'done'` and `agentOutput.summary`

This gives the human a real audit trail on the board without you needing to ask permission for each step.

#### `GET/PUT/DELETE /projects/[projectId]/tasks/[taskId]` — auth: admin

#### `GET /projects/[projectId]/tasks/[taskId]/comments` — auth: admin
List comments on a project task (pre-existing per-task comment collection — distinct from the unified `/comments`).

#### `POST /projects/[projectId]/tasks/[taskId]/comments` — auth: admin
Body: `{ text: string }`.

#### `DELETE /projects/[projectId]/tasks/[taskId]/comments/[commentId]` — auth: admin

### Project docs (wiki)

#### `GET /projects/[projectId]/docs` — auth: admin
List docs.

#### `POST /projects/[projectId]/docs` — auth: admin
Body: `{ title, content (markdown), type? }`.

#### `GET/PUT/DELETE /projects/[projectId]/docs/[docId]` — auth: admin

### Agent project context — **gold endpoint for AI**

#### `GET /agent/project/[projectId]` — auth: admin
Returns everything an agent needs to work on a project in one call:
```json
{
  "project": { "name": "...", "status": "...", "description": "...", "brief": "...", "orgId": "..." },
  "documents": [{ "title": "...", "content": "...", "type": "..." }],
  "tasks": [{ "title": "...", "status": "...", "assignedTo": "..." }],
  "recentComments": [...]
}
```

**Use this first** whenever an agent is asked to work on a project. Avoids multiple roundtrips.

### Standalone tasks

#### `GET /tasks` — auth: admin
Filters: `orgId` (required), `status` (`todo`|`in_progress`|`done`|`cancelled`), `priority` (`low`|`normal`|`high`|`urgent`), `assignedTo` (format `user:uid` or `agent:aid`), `projectId`, `contactId`, `dealId`, `dueBefore`, `dueAfter`, `tags`, `page`, `limit`.

#### `POST /tasks` — auth: admin (idempotent)
Body:
```json
{
  "orgId": "org_abc",
  "title": "Send proposal draft",
  "description": "...",
  "status": "todo",
  "priority": "high",
  "dueDate": "2026-04-20",
  "assignedTo": { "type": "user", "id": "uid123" },
  "projectId": "proj_xyz",
  "contactId": "contact_abc",
  "dealId": "deal_xyz",
  "tags": ["urgent", "client-facing"]
}
```

Required: `title`. Defaults: `status='todo'`, `priority='normal'`, `tags=[]`. If `assignedTo` set, notifies assignee.

**Agent dispatch fields also work on standalone tasks** — `assigneeAgentId`, `agentStatus`, `agentInput`, `agentOutput`, `dependsOn` all accepted with the same shape as project-nested tasks. See the "Agent dispatch fields" section under project-nested tasks for the full schema. Use standalone tasks when there's no specific project in scope (e.g. chatting from the org-level Agent tab); use project-nested tasks when working inside a specific project's Agent tab.

#### `GET/PUT/DELETE /tasks/[id]` — auth: admin
PUT updatable: `title`, `description`, `status`, `priority`, `dueDate`, `assignedTo`, `projectId`, `contactId`, `dealId`, `tags`, plus agent dispatch fields (`assigneeAgentId`, `agentStatus`, `agentInput`, `agentOutput`, `dependsOn`, `agentHeartbeatAt:true` sentinel). Transition to `done` sets `completedAt`.

#### `POST /tasks/[id]/complete` — auth: admin
Sets `status='done'`, `completedAt`. Dispatches `task.completed`.

#### `POST /tasks/[id]/assign` — auth: admin
Body: `{ assignedTo: { type: 'user'|'agent', id } }`. Notifies new assignee.

### Time tracking

#### `GET /time-entries` — auth: admin
Filters: `orgId` (required), `userId`, `projectId`, `taskId`, `clientOrgId`, `from`, `to`, `billable`, `billed` (has invoiceId), `running` (endAt null), `page`, `limit`.

#### `POST /time-entries` — auth: admin (idempotent)
Create a completed entry. Required: `description`, `startAt`. Either `endAt` or `durationMinutes`.
Body:
```json
{ "orgId": "org_abc", "description": "Client call", "startAt": "2026-04-10T10:00:00Z",
  "endAt": "2026-04-10T11:00:00Z", "billable": true, "hourlyRate": 850, "currency": "ZAR",
  "projectId": "proj_xyz", "clientOrgId": "org_client", "tags": ["call"] }
```

Defaults: `userId=current user`, `billable=true`, `currency='ZAR'`.

#### `GET/PUT/DELETE /time-entries/[id]` — auth: admin
PUT recomputes `durationMinutes` if start/end changes. Returns 409 if already billed.

#### `POST /time-entries/start` — auth: admin
Begins a timer. Body: `{ description, projectId?, taskId?, clientOrgId?, billable?, tags?, userId? }`.

**409 if a timer is already running** for this user — returns existing entry id.

Response: `{ id, startAt }`.

#### `POST /time-entries/[id]/stop` — auth: admin
Sets `endAt=now`, computes `durationMinutes`. Returns `{ id, endAt, durationMinutes }`.

#### `POST /time-entries/bill` — auth: admin
Attach time entries to an invoice as line items.

Body: `{ entryIds: string[], invoiceId: string }`.

Each entry becomes: `{ description, quantity: durationMinutes/60 (rounded 2dp), unitPrice: hourlyRate || 0, amount: quantity * unitPrice }`. Recomputes invoice totals. Atomic batch write. 409 if any entry already billed.

Response: `{ billed: count, invoiceId, newTotal }`.

#### `GET /time-entries/running` — auth: admin
Query: `orgId`, `userId?` (default: current). Returns `{ running: entry | null }`.

### Calendar events

#### `GET /calendar/events` — auth: admin
Filters: `orgId` (required), `from` (ISO), `to`, `relatedToType`, `relatedToId`, `assignedTo` (format `user:uid`), `limit` (default 200, max 500). Sorted `startAt asc`.

#### `POST /calendar/events` — auth: admin (idempotent)
Body:
```json
{
  "orgId": "org_abc",
  "title": "Acme Demo",
  "description": "Walkthrough of Pro features",
  "startAt": "2026-04-22T14:00:00Z",
  "endAt": "2026-04-22T15:00:00Z",
  "allDay": false,
  "timezone": "Africa/Johannesburg",
  "location": "Zoom",
  "meetingUrl": "https://zoom.us/j/...",
  "attendees": [
    { "name": "Jane Doe", "email": "jane@acme.com", "status": "pending" }
  ],
  "relatedTo": { "type": "contact", "id": "contact_abc" },
  "assignedTo": { "type": "user", "id": "uid123" },
  "reminderMinutesBefore": [60, 10]
}
```

Validates `startAt < endAt`. Defaults: `allDay=false`, `timezone='UTC'`, `attendees=[]`, `recurrence=null`. Notifies `assignedTo`.

Related-to types: `contact`, `deal`, `project`, `client_org`.

#### `GET/PUT/DELETE /calendar/events/[id]` — auth: admin

#### `POST /calendar/events/[id]/rsvp` — auth: admin
Body: `{ email: string, status: 'accepted'|'declined'|'tentative'|'pending' }`.

Updates the matching attendee's status (case-insensitive email match). 404 if attendee not on event.

### Comments on project resources

```json
POST /comments
{ "orgId": "org_abc", "resourceType": "task", "resourceId": "task_xyz",
  "body": "Blocked on client signoff. @user:uid_manager" }
```

### Team utilization report

#### `GET /reports/team-utilization?orgId=X&from=...&to=...`
```json
{ "users": [{ "userId": "uid123", "totalMinutes": 9600, "billableMinutes": 7200,
              "nonBillableMinutes": 2400, "utilizationPct": 0.75 }],
  "totalMinutes": 48000, "avgUtilizationPct": 0.7 }
```

---

## Workflow guides

### 1. Create a project + kick off

```bash
POST /projects
{ "orgId": "org_abc", "name": "Q2 Campaign", "brief": "# Goals...",
  "clientOrgId": "org_client", "status": "active", "assignedTo": { "type": "user", "id": "uid_pm" } }

# Add initial docs
POST /projects/proj_xyz/docs
{ "title": "Project Requirements", "content": "# Requirements...", "type": "requirements" }

# Break down into tasks
POST /projects/proj_xyz/tasks
{ "title": "Creative brief", "priority": "high", "dueDate": "2026-04-18", "assignedTo": "uid_creative" }
```

### 2. Agent picks up a project

```bash
# Single call — gets everything
GET /agent/project/proj_xyz
# Returns project + docs + tasks + recent comments
```

### 3. Personal todo workflow

```bash
# Create todo
POST /tasks
{ "orgId": "org_abc", "title": "Follow up with Acme", "priority": "high",
  "dueDate": "2026-04-17", "contactId": "contact_abc", "tags": ["sales"] }

# Filter: what's on my plate today?
GET /tasks?orgId=org_abc&assignedTo=user:uid_me&dueBefore=2026-04-18&status=todo

# Complete
POST /tasks/task_abc/complete
```

### 4. Timer workflow

```bash
# Start timer
POST /time-entries/start
{ "description": "Working on Acme deck", "projectId": "proj_xyz", "billable": true }
# → { id: "te_abc", startAt: "..." }

# ... work happens ...

# Stop
POST /time-entries/te_abc/stop
# → { id, endAt, durationMinutes }

# Check running
GET /time-entries/running?orgId=org_abc
```

### 5. Bill time to invoice

```bash
# Get billable unbilled entries
GET /time-entries?orgId=org_abc&clientOrgId=org_client&billable=true&billed=false

# Create invoice (billing-finance skill)
POST /invoices
{ "orgId": "org_client", "lineItems": [], "currency": "ZAR" }
# → { id: "inv_xyz", invoiceNumber: "CLI-042" }

# Attach time entries
POST /time-entries/bill
{ "entryIds": ["te_abc", "te_def"], "invoiceId": "inv_xyz" }
# Appends line items, recomputes invoice total
```

### 6. Schedule a meeting with a contact

```bash
POST /calendar/events
{ "orgId": "org_abc", "title": "Acme demo", "startAt": "2026-04-22T14:00:00Z",
  "endAt": "2026-04-22T15:00:00Z", "timezone": "Africa/Johannesburg",
  "meetingUrl": "https://zoom.us/j/...",
  "relatedTo": { "type": "contact", "id": "contact_abc" },
  "attendees": [{ "name": "Jane Doe", "email": "jane@acme.com", "status": "pending" }],
  "reminderMinutesBefore": [60, 10] }

# Attendee RSVPs
POST /calendar/events/evt_xyz/rsvp
{ "email": "jane@acme.com", "status": "accepted" }
```

### 7. Project brief via AI

```bash
# Fetch full context
GET /agent/project/proj_xyz
# Then feed the response into your AI prompt along with org brand profile:
GET /agent/brand/org_abc
```

### 8. Team utilization weekly report

```bash
GET /reports/team-utilization?orgId=org_abc&from=2026-04-07&to=2026-04-13
```

## Error reference

| HTTP | Error | Fix |
|------|-------|-----|
| 400 | `startAt must be before endAt` | Fix timestamps |
| 400 | `orgId is required` | Supply orgId query param |
| 404 | `Task not found` / `Event not found` | Verify IDs |
| 404 | `Attendee not found on this event` | Use an email that matches an attendee |
| 409 | `A timer is already running` | Stop existing timer first (response includes running id) |
| 409 | `Cannot modify a billed entry` | Unlink invoice or edit invoice directly |

## Agent patterns

1. **Start with `/agent/project/[id]`** — one call for full context.
2. **Use standalone tasks for personal work, project-nested for team sprint work.**
3. **Always stop timers** — running timers pile up. Check `/time-entries/running` when in doubt.
4. **Bill time before creating the next invoice** — the `/time-entries/bill` flow auto-appends line items so you don't need to manually compute totals.
5. **Relate calendar events** — set `relatedTo` so meetings show up in the contact/deal activity feed.
6. **Webhooks** — subscribe to `task.completed` to close loops (e.g., trigger review requests).
7. **Idempotency on creates** — pass `Idempotency-Key` on `POST /projects`, `/tasks`, `/time-entries`, `/calendar/events`.

## Client Document Handoff

Use the `client-documents` skill for specs, change requests, launch sign-offs, and handover packs. Link these documents with `linked.projectId` so Projects/Kanban remains the operational source of truth while `client_documents` handles presentation, comments, versions, and approvals.
