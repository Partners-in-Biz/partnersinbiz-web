---
type: Runbook
title: OKF incremental adoption runbook
description: Safe rollout plan for adding Google OKF v0.1 compatibility to the PiB Cowork/Obsidian knowledge system.
tags: [knowledge, okf, wiki, obsidian, governance]
timestamp: 2026-06-13T17:40:00Z
domain: knowledge
visibility: internal
status: active
source_of_truth: wiki:agents/partners/wiki/okf-adoption-assessment-2026-06-13.md
ownerAgent: pip
orgId: pib-platform-owner
---

# OKF incremental adoption runbook

This runbook implements Peet's OKF adoption decision as a safe compatibility layer. It does not replace Obsidian, Projects/Kanban, client documents, research records, CRM, or approval tasks.

## Decision

Adopt Google OKF v0.1 compatibility incrementally for new and meaningfully edited durable knowledge notes, validators, and internal generated exports.

Do not mass-convert or restructure the Cowork wiki yet.

## Phase 1 tooling

Use the dry-run validator/export script:

```bash
node scripts/okf-validate-export.mjs --root /var/lib/hermes/cowork-wiki --domain agents/partners --sections wiki,raw,logs --json
```

Default behavior is report-only:

- reads markdown only
- writes nothing
- exits 0 for expected legacy gaps
- exempts OKF reserved filenames `index.md` and `log.md`
- requires a non-empty `type` only when `--strict` is used as a gate
- treats unknown non-empty `type` values as OKF-compatible but non-canonical
- treats line-1 `---` blocks as frontmatter; later horizontal rules are content

Optional metadata export is local and internal only:

```bash
node scripts/okf-validate-export.mjs --write-export --export-dir tmp/okf-export --json
```

The export writes a validation report and JSONL metadata manifest under repo-local `tmp/`, which is gitignored. It does not publish, reindex, change source markdown, or write Firestore.

## Canonical PiB OKF types

Configured in `config/okf-taxonomy.json`:

- Decision
- Runbook
- Incident
- Project Note
- Client Knowledge
- Research Note
- Session Log
- Hot Cache
- Reference
- Source

Compatibility aliases are accepted for legacy/read-only scans, but new notes should use the exact canonical strings.

## Required and recommended metadata

OKF hard requirement for non-reserved concept notes:

- `type`: non-empty string

Recommended PiB fields for new/touched durable notes:

- `title`
- `description`
- `timestamp`
- `tags`
- `domain`
- `visibility`: `internal`, `restricted`, `client_visible`, `public`, or `sensitive`
- `status`: `draft`, `active`, `review`, `approved`, `superseded`, `deprecated`, or `archived`
- `source_of_truth`: stable pointer such as `wiki:<path>`, `project:<id>`, `task:<id>`, `client_document:<id>#<versionId>`, `research_item:<id>`, `repo:<path>@<sha>`, `api:<collection>/<id>`, or `external:<url>`

Useful PiB extension fields:

- `ownerAgent`
- `orgId`
- `clientOrgId`
- `companyId`
- `projectId`
- `taskId`
- `documentId`
- `documentVersionId`
- `researchItemId`
- `approvalTaskId`
- `approval_state`
- `confidence`
- `last_verified`
- `supersedes`
- `deprecated_by`
- `evidence`

Do not emit blank optional keys.

## Source-of-truth rules

Metadata improves portability. It does not authorize actions or override PiB access control.

- Projects/Kanban remains the execution and task source of truth.
- Client documents remain the presentation, versioning, and approval source of truth.
- Research records remain the research/evidence source of truth.
- CRM remains the company/contact/deal source of truth.
- Wiki notes cite those systems; they do not replace them.
- `orgId: pib-platform-owner` means the parent Partners platform workspace, not a client tenant.
- For PiB-created client work, use `orgId: pib-platform-owner` plus `clientOrgId` for the recipient/client org when needed.

## Approval gates

Peet approval is required before:

- bulk wiki rewrites, deletes, archives, folder renames, or source markdown normalization
- client-visible or public OKF exports
- permission, retrieval, memory indexer, or reindex behavior changes
- production deploys or release promotions
- secret/config/profile/cron changes
- paid spend, finance, billing, invoice, quote, or payment changes
- destructive data operations
- external sync or third-party OKF integrations

## Evidence packet for future rollout

Every meaningful OKF validation/export run should preserve:

- run timestamp and actor
- git SHA or script version
- OKF target and taxonomy version
- command and flags
- org/domain scope
- dry-run/write mode
- scanned, compatible, missing-type, parse-error, alias, unknown-type, sensitive, and skipped counts
- samples for warning buckets
- proof of zero source writes for dry-runs
- export path when generated
- approval task/document links for any gated action
- reviewer sign-off when moving from report-only to mutation

## Safe next increments

1. Use this validator for report-only baselines on `agents/partners`.
2. Update new-note templates and agent wiki instructions to include OKF frontmatter.
3. Backfill only small high-value platform notes with reviewed diffs.
4. Add OKF frontmatter to generated research markdown after validator review.
5. Run sample retrieval/reindex comparisons only after explicit approval.
