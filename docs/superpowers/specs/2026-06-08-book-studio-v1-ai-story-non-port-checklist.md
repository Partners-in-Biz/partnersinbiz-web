# Book Studio V1 ai-story Non-Port Checklist

**Date:** 2026-06-08
**Status:** Design-only migration guard; not an implementation plan.
**Authoritative dossier:** `docs/superpowers/specs/2026-06-07-book-studio-research-dossier.md`
**Decision packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Source refresh contract:** `docs/superpowers/specs/2026-06-08-book-studio-v1-source-refresh-contract.md`

## Purpose

Peet explicitly asked Book Studio to learn from `PMStander/ai-story`, but not to become another standalone app. This checklist turns that instruction into a future planning guard.

It does not import `ai-story`, create Book Studio runtime records, write Hermes skills, scaffold routes, define schemas, or approve a Phase 1 implementation plan.

## Source Baseline

`PMStander/ai-story` remains a design reference at this baseline:

```text
11ef473c94f977b1dbc487f8645c4711728b6095 HEAD
```

Verification command run on 2026-06-08:

```bash
git ls-remote https://github.com/PMStander/ai-story.git HEAD
```

The result matches the dossier's recorded `ai-story-head` source key. Future planning should rerun this command and record the commit it used. If the upstream commit changes, rerun the concept mapping before using any `ai-story` lesson in a Phase 1 plan.

## Product Lessons To Keep

| `ai-story` lesson | Keep because | PiB form |
| --- | --- | --- |
| Category-aware wizard | It helps operators start with book family, format, audience, style, and series intent instead of a blank prompt. | Admin intake that derives `bookTypeFamily`, gate profile, Research seed, Project/Kanban work, artifact expectations, and channel packet defaults. |
| Story Studio and outline flow | It makes creation feel progressive instead of one-shot generation. | Brief, outline, section/page plan, manuscript version, and proof states tied to approval gates. |
| Canvas/proof concept | It gives fixed-layout work a review surface. | Artifact-backed proofs with file identity, checksum, rights, accessibility, and package QA evidence. |
| Series manager and style guide | It captures continuity and repeatability. | `book_series`, continuity bible, volume map, style packet, channel-specific series warnings, and series analytics rollups. |
| Niche research tabs | They make source and market work visible. | PiB Research items with source lanes, findings, confidence labels, internal visibility, and reviewed promotion into briefs/tasks. |
| Asset library | It keeps generated or uploaded materials discoverable. | Workspace artifacts with provenance, rights metadata, source links, visibility, and package role. |
| Publishing checklist | It shows operators the next external action. | Channel-specific publishing packets, readiness reports, external IDs, upload evidence, and blocker states. |
| Agent action vocabulary | It proves creators want agent help across research, writing, images, series, KDP, ads, and analytics. | Narrow Hermes skills with manifests, fixtures, reviewer defaults, source contracts, and forbidden-action tests. |

## Architecture That Must Not Be Ported

| `ai-story` pattern | Do not port because | PiB replacement |
| --- | --- | --- |
| User-scoped Firestore paths such as `users/{uid}/projects`. | PiB work belongs to organisations and client workspaces, not one creator account. | Org-scoped Book Studio records with admin, portal, and Hermes authorization. |
| Browser-held model keys and browser-to-agent action application. | Production work cannot depend on client-held keys or unaudited browser mutation. | PiB-managed server/Hermes dispatch with audit logs, allowlisted skills, and server-side mutations. |
| One broad assistant that can create books, series, illustrations, KDP optimization, and ad keywords. | It mixes safe drafting with release-sensitive or commercial actions. | Skill-by-skill contracts: research, series, brief, outline, metadata, readiness, account, package QA, analytics. |
| A single wizard action that generates content, images, cover, uploads assets, and updates status. | It skips evidence gates and makes attractive output look publishable too early. | Project tasks, generation run ledger, artifact manifests, proof states, and human review gates. |
| Embedded research notes on project or series records. | Source evidence and client-safe findings need PiB's reusable Research model. | Research packets with source records, confidence, finding status, and reviewed promotion paths. |
| Publishing status as a checklist/dropdown. | A checklist cannot prove channel readiness or preserve why a packet was accepted or blocked. | Channel listing records with files, metadata, account authority, AI disclosure, source freshness, external evidence, and packet state. |
| Progress counts as analytics. | Word/chapter progress does not prove sales, royalties, refunds, ad impact, or settlement. | Manual import ledger with estimated/reported/settled separation and client-safe summaries only after reconciliation. |
| Large manuscripts, images, or layouts stored directly in ordinary records. | It creates performance, review, provenance, and versioning problems. | Client Documents, Google Docs, storage-backed artifacts, package manifests, and compact section/page metadata. |

## Future Planning Checklist

Before any future Phase 1 plan uses an `ai-story` concept, the plan must answer all of these:

1. Which `ai-story` concept is being reused?
2. Is it being kept, rewritten, or rejected?
3. Which PiB record or existing PiB surface becomes authoritative?
4. Which org-scope, portal-scope, and Hermes-scope guards apply?
5. Which evidence gate prevents the concept from becoming client-visible or upload-ready too early?
6. Which source key or local publisher evidence lane must be fresh?
7. Which pass, warning, and blocker fixture proves the behavior?
8. Which `ai-story` assumption is explicitly not being ported?

If any answer is missing, the plan should mark that slice `not_ready_for_phase_1` instead of treating the old standalone behavior as a shortcut.

## Acceptance Rules

Pass:

- The future plan reuses `ai-story` UX lessons while anchoring state in PiB org-scoped records, Research, Client Documents, Projects/Kanban, workspace artifacts, module switches, and Hermes skill contracts.
- Every reused concept has a clear review gate and client-safe promotion path.
- `ai-story-head` is rechecked at planning time.

Warn:

- A concept is useful but depends on layout, visual assets, audio, ads, or automated reporting. Keep it as a fixture or later-phase adapter unless Peet explicitly revises the approval record.
- A prototype constant such as trim size, category defaults, or pricing hints appears useful. Re-source it from official channel guidance before it can affect a packet.

Block:

- The future plan ports user-scoped storage, browser-held API keys, standalone agent actions, direct publishing, automated ads, raw portal output, or progress-count analytics.
- The future plan treats `ai-story` behavior as KDP, Google, legal, local publisher, or analytics policy evidence.
- The future plan starts with a polished "generate book" button before entitlement, records, gates, Research/Project/Document bridges, package evidence, and Hermes fixture controls exist.

## Devil's Advocate

- Over-porting `ai-story` would make Book Studio demo quickly but fail PiB's real operating requirements: tenant safety, client review, source evidence, publishing authority, and reconciliation.
- Under-learning from `ai-story` would make Book Studio too bureaucratic. The wizard, canvas/proof, series guide, research tabs, and action vocabulary are useful because they make book creation understandable.
- The right posture is selective adoption: keep the workflow affordances, rewrite the ownership and execution model, and reject shortcuts that bypass evidence.

## Current Review State

This checklist strengthens the existing V1 approval gate. It does not change the recommended V1 posture and does not authorize implementation planning without Peet approving or revising the approval record.
