# Org dashboard aggregate contract

Endpoint: `GET /api/v1/org-dashboard?orgId=<orgId>` or `GET /api/v1/org-dashboard?orgSlug=<slug>`

Auth: `withAuth('client')` plus `resolveOrgScope`/`canAccessOrg`.

Org scoping:
- Admins and AI agents must scope explicitly with `orgId` or `orgSlug`.
- Restricted admins are limited by `allowedOrgIds`.
- Client users can only resolve an org they belong to.
- A missing org returns 404; missing scope returns the shared org-scope 400/403 response.

Response shape:
- `org`: id, slug, name, admin/portal links.
- `deepLinks`: canonical admin links for dashboard, projects, social, social queue/calendar, tasks, inbox/messages, approvals, documents.
- `projects`: total, active, recent project links.
- `social`: total, counts by status, pending approval count, upcoming scheduled count, upcoming post links.
- `tasks`: open/overdue counts, by status, by agent status, upcoming standalone and project-task links.
- `inbox`: total attention count, unread notification count, approval count, recent notification links.
- `documents`: total, counts by status, open review count, pending approval count, recent document links.
- `generatedAt`: ISO timestamp.

Mapped data sources:
- `organizations/{orgId}` for org identity and slug.
- `projects` filtered by `orgId`.
- `social_posts` filtered by `orgId` for scheduling and social approvals.
- Top-level `tasks` filtered by `orgId` for standalone tasks.
- Collection-group `tasks` filtered by `orgId` for project-nested tasks.
- `notifications` filtered by `orgId` for unread inbox attention.
- `expenses` filtered by `orgId,status=submitted` for approval attention.
- `client_documents` filtered by `orgId` for document status/review attention.

Deep-link policy:
All aggregate list items include `resourceType`, `id`, human title/status fields, and `href` so the dashboard can render without re-deriving routes. Project task links include the parent project id when available: `/admin/org/[slug]/projects/[projectId]?task=[taskId]`.
