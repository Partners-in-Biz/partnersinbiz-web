---
name: research-intelligence
description: Capture, review, share, and preserve PiB research findings for clients and internal strategy.
version: 1.0.0
---

# Research Intelligence

Use this skill whenever work produces reusable research: competitor audits, market scans, SEO/SERP/GEO findings, audience questions, content insights, ad inspiration, CRM/company intelligence, prospect research, brand/product discovery, onboarding notes, local/property research, or internal PiB strategy.

## Source-of-truth rule

- **Research** is the working evidence layer: findings, sources, recommendations, comments, status, confidence, and links to projects/campaigns/SEO/CRM.
- **Documents** are the polished output layer: client-ready reports, proposals, strategy docs, approvals, and sign-offs.
- **Obsidian/Knowledge** is the durable memory layer: export summaries and source indexes after meaningful research so future agents can reuse the learning.

Do not leave research only in chat, temporary files, local scratch notes, or private markdown.

## API workflow

1. Create or find a research item: `POST /api/v1/research` or `GET /api/v1/research?orgId=&kind=&status=&visibility=&q=`.
2. Attach evidence: `POST /api/v1/research/[id]/sources`.
3. Add findings and recommendations: `PATCH /api/v1/research/[id]`.
4. Use comments for review and handoff: `POST /api/v1/comments` with `resourceType: "research_item"`.
5. Export durable knowledge: `POST /api/v1/research/[id]/export-obsidian`.
6. Create polished client output only when needed: `POST /api/v1/research/[id]/create-document`.

## Minimum standard

Every substantial research item should include a client/org link, kind, status, visibility, summary, sources where possible, findings with confidence, recommendations with priority, and links to the relevant project, campaign, SEO sprint, deal, company, contact, or document.

Keep research `internal` while evidence is incomplete, disputed, sensitive, or only useful to PiB. Switch to `client_visible` when the client can safely review the working findings.
