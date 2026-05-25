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

## Research report differentiation standard

A `research_item` is the source-of-truth evidence ledger. A `research_report` client document is only the polished presentation/decision-support layer. Do not turn every research item into a document.

Keep work as a `research_item` when evidence is still draft/in_review, sources are weak or sensitive, the audience is internal agents/Peet, or the research will feed a proposal/spec directly without needing a separate review artifact.

Create a `research_report` document when Peet or the client needs a readable review artifact, multiple research items must be synthesized, comments/suggestions/acknowledgement are needed, or findings must be approved before becoming a proposal/spec/task chain.

Every research report must stay evidence-led and visibly different from sales proposals/build specs:
1. Research question or decision to support.
2. Context/hypothesis and methodology.
3. Source ledger with source IDs, type, publisher/date, confidence, verified flag, and URL/media when safe.
4. Findings with confidence, status, and source IDs.
5. Confidence/assumptions/contradictions/unknowns, including low-confidence or disputed evidence.
6. Recommendations grouped by priority (`urgent`, `high`, `medium`, `low`) with source basis and routing target.
7. Decision gate: keep as research, request more evidence, convert to proposal/spec/campaign/SEO/GEO workflow, or create gated tasks.

Use purpose-specific report patterns instead of one generic rhythm:
- Market/category scan: market map, opportunity lanes, risks, decision path.
- Competitor/SEO/local audit: competitor/SERP matrix, verification status, priority fixes/opportunities.
- Technical/product/platform research: options matrix, constraints, approval gates, convert-to-spec decision.
- Audience/prospect/CRM intelligence: segment map, privacy/sensitivity flags, message/offer angles.
- Operational/onboarding/internal strategy: prerequisites, access/assets, blockers, owner matrix, readiness gate.

Client visibility rules: keep the document internal if evidence is incomplete, sensitive, private, or could imply unapproved spend/publishing/implementation. Before client review/publish, sanitize internal notes and private paths, check linked research item visibility, keep publish-blocking assumptions open, and never publish without Peet approval.

Canonical detailed standard: `/var/lib/hermes/cowork-wiki/agents/partners/wiki/research-document-differentiation-2026-05-25.md`.
