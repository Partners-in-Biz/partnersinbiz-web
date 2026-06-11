# Book Studio V1 Editorial Quality And Reader Experience Model

**Date:** 2026-06-08
**Status:** Design-only editorial quality model; not an implementation plan, manuscript editor, evaluator, route map, Firestore schema, UI design, Hermes runtime plan, or publishing instruction.
**Authoritative approval packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Authoritative dossier:** `docs/superpowers/specs/2026-06-07-book-studio-research-dossier.md`
**Market evidence model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-market-evidence-model.md`
**Production package QA model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-production-package-qa-model.md`
**Hermes skill contract pack:** `docs/superpowers/specs/2026-06-08-book-studio-v1-hermes-skill-contract-pack.md`
**Acceptance fixtures:** `docs/superpowers/specs/2026-06-08-book-studio-v1-acceptance-fixtures.md`
**Red-team register:** `docs/superpowers/specs/2026-06-08-book-studio-v1-red-team-risk-register.md`

## Purpose

Book Studio should not treat a complete manuscript, attractive cover, or confident Hermes output as proof that a book is worth publishing.

This model defines the editorial quality and reader-experience gate that sits between:

- market evidence and Book Brief,
- Hermes-generated or Hermes-assisted production work,
- internal proof/package review,
- portal promotion, and
- manual KDP/Google handoff.

The central rule is: a book is not quality-approved because it exists. It is quality-progressing only when the current version has reviewed evidence that the reader promise, structure, claims, language, usability, accessibility, originality, and format experience fit the selected book family and channel posture.

This model does not create runtime records, automated manuscript scoring, AI judges, route handlers, database collections, UI, skill files, direct publishing, or a Phase 1 task list.

## Editorial Quality States

| State | Meaning | Allowed next action | Not allowed |
| --- | --- | --- | --- |
| Quality intent captured | The project has reader promise, family, audience, use case, tone, and quality bar assumptions. | Create or refine Book Brief. | Draft manuscript or client promise. |
| Quality lanes open | Required quality lanes are assigned for the selected family. | Gather evidence, create review tasks, run bounded Hermes checks after approval. | Mark proof or packet ready. |
| Internal reviewable | A version can be reviewed internally with known warnings. | Editorial, claim, continuity, format, and reader-experience review. | Portal promotion or upload-ready claim. |
| Change requested | Quality review found issues that need revision. | Create revision tasks and invalidate dependent packet/proof state. | Hide issues behind formatting or cover polish. |
| Quality accepted with warnings | Reviewer accepts named warnings with owner, due date, waiver path, or accepted deferral. | Continue to package QA or client-safe summary if warnings are safe. | Present warnings as solved. |
| Quality blocked | A required quality lane failed or evidence is missing/stale. | Revise, narrow scope, park, or reject the project. | Book Brief promotion, proof approval, packet readiness, portal claim, or launch copy. |
| Quality approved for next stage | Current version passes required lanes for the next internal stage. | Move to package QA or reviewed portal artifact flow. | Claim store acceptance, sales potential, final publication quality, or future-version approval. |

Quality approval is version-bound. Any meaningful manuscript, structure, claim, title, metadata, proof, asset, or family change must invalidate the dependent quality state.

## Required Quality Lanes

| Lane | Pass evidence | Warning evidence | Block evidence |
| --- | --- | --- | --- |
| Reader promise fit | The book delivers the promise in the Book Brief for the named reader and use case. | Promise is useful but too broad, needs narrower scope, or needs client/product owner decision. | Book does not solve the stated reader job or promises outcomes the content cannot support. |
| Structure and flow | Chapters, sections, spreads, activities, or units have a coherent sequence and no missing critical path. | Structure works but needs better transitions, signposting, or volume split. | Content is a pile of generated sections, repeated filler, missing conclusion, broken navigation, or wrong family shape. |
| Originality and differentiation | The book has a defensible angle, voice, examples, exercises, dataset, commentary, client context, or production value beyond generic AI output. | Differentiation is present but thin or needs stronger examples. | It is a commodity AI book, competitor copy, public-domain duplicate, or generic shelf clone. |
| Claim and source integrity | Factual, legal, health, financial, technical, or business claims are source-linked, caveated, or removed. | Low-risk claims need refresh or reviewer note before launch/client summary. | Unsupported, stale, misleading, dangerous, or invented claims appear in proof, metadata, or client copy. |
| Editorial quality | Language is clear, coherent, consistent, and appropriate for the audience and brand. | Useful draft needs copyedit, proofread, style-guide cleanup, or tone alignment. | Raw AI prose, hallucinated references, contradictions, grammar issues, or inconsistent terminology are treated as final. |
| Continuity and series integrity | Names, concepts, examples, volumes, assets, and recurring structures are consistent. | Minor continuity issue needs owner and due date. | Series or book continuity breaks reader trust or external channel metadata. |
| Activity/usability correctness | Workbooks, puzzles, prompts, recipes, checklists, and activities are usable and answerable. | One section needs test-use, answer-key, or margin review. | Incorrect answer keys, impossible exercises, unsafe instructions, unusable worksheets, or filler repetition. |
| Accessibility and reader experience | Reading order, headings, alt/summary needs, visual clarity, print usability, and navigation are reviewed for the family. | Accessibility note is incomplete but safe for internal review. | Visual, fixed-layout, worksheet, audio, or navigation experience is unreviewed or unusable. |
| Rights-sensitive editorial content | Quotes, excerpts, adaptations, public-domain/companion material, trademarks, brand references, and contributor inputs have review state. | One low-risk item needs owner/date/waiver path. | Weak rights evidence is hidden in editorial text, title, subtitle, cover copy, or metadata. |
| Client-safe summary | The summary says what is ready, what is uncertain, and what is blocked without exposing raw internal notes. | Summary needs simpler wording or one approved caveat. | Portal/client copy hides warnings or exposes raw research, internal rights notes, raw Hermes output, or unreviewed claims. |

## Book-Family Quality Deltas

The shared lanes apply to every book, but each family has a different quality trap.

| Family | Extra quality emphasis | Typical blocker |
| --- | --- | --- |
| Business nonfiction | Claim integrity, examples, reader job, actionability, source age, client/brand authority. | Generic advice dressed as expertise or unsupported business outcomes. |
| Narrative/reflowable | Arc, pacing, voice consistency, chapter continuity, originality, series fit. | A complete but flat manuscript with copied tropes and no reason to read. |
| Activity/workbook/puzzle/coloring | Usability, answer keys, print proof, repetition honesty, physical page experience. | Incorrect or untested exercises, filler pages, unusable prompts, or hidden low-content risk. |
| Low-content print | Buyer use case, repetition transparency, cover/content match, margin, print proof. | A polished cover hiding undifferentiated blank/repeated pages. |
| Children/visual fixture | Age fit, image safety, asset rights, reading level, layout proof, accessibility summary. | Pretty spreads with weak rights, unsuitable content, or unproofed fixed layout. |
| Public-domain/companion | Originality, commentary, transformation, affiliation/trademark risk, edition/source evidence. | Assumed public-domain or companion safety from one source. |
| Cookbook/photo/portfolio future | Asset provenance, caption accuracy, recipe/test evidence, color proof, claims discipline. | Attractive visuals with untested instructions or weak asset rights. |
| Audiobook/narrated future | Script quality, pronunciation, narrator/voice rights, audio quality, adaptation fit. | Audio promised before voice rights and quality review exist. |
| Series overlay | Book-one standalone value, continuity bible, volume order, metadata consistency, rollup honesty. | Future volumes or series claims look approved because a scaffold exists. |

## Hermes Editorial Boundaries

Hermes may help quality work only as a bounded reviewer and task suggester.

Allowed Hermes output after the approval gate and future implementation planning:

- quality-lane checklist,
- source-linked claim issue list,
- structure and continuity warning report,
- style-guide drift notes,
- activity answer-key issue prompts,
- accessibility/reader-experience checklist,
- client-safe summary draft for human rewrite,
- revision task suggestions.

Forbidden Hermes output:

- marking a manuscript, proof, packet, or client artifact quality-approved,
- hiding warnings in polished copy,
- inventing citations or claims,
- replacing human editorial, legal, rights, accessibility, or publisher review,
- rewriting approved files without a new version and invalidation,
- creating client-visible copy from raw internal notes,
- making sales, rank, bestseller, or store-acceptance claims.

## Portal And Client Review Rules

Portal quality artifacts should be promoted, reviewed versions only.

Client-safe quality summaries may include:

- what the book is trying to help the reader do,
- which proof or brief version is under review,
- what feedback is needed from the client,
- safe accepted warnings,
- safe blockers and next decisions.

Client-safe quality summaries must not include:

- raw Hermes output,
- raw editorial notes,
- internal rights uncertainty,
- source dispute details,
- unsupported claim analysis,
- upload-account notes,
- unreconciled costs,
- parser or generation errors.

## Analytics Feedback Loop

Editorial quality should feed future decisions, but it must not become a sales-promise engine.

The future analytics loop can compare:

- quality warnings against review/change-request frequency,
- source/claim warnings against post-publication corrections,
- series continuity warnings against per-volume performance patterns,
- activity/usability warnings against client or reader feedback,
- market evidence assumptions against later confidence-labeled analytics.

The analytics loop must not:

- imply that quality review predicts sales,
- hide refunds, low engagement, poor reviews, or revisions,
- let revenue override rights, safety, or source blockers,
- turn reader feedback into automated review outreach.

## Acceptance Fixtures

Future fixture coverage should add one editorial quality scenario:

| Fixture | Scenario | Expected result |
| --- | --- | --- |
| `QUALITY-WARN-001` | A business nonfiction draft is useful but has unsupported examples, inconsistent terminology, and broad promise wording. | Internal reviewable with warnings; block portal proof and packet readiness until revision tasks are complete or warnings are accepted. |
| `QUALITY-BLOCK-001` | A generic AI-generated guide has no defensible angle, copied competitor structure, invented citations, and polished metadata. | Block Book Brief promotion, manuscript proof, packet readiness, and client-safe claims. |
| `QUALITY-PASS-001` | A narrowed business nonfiction draft has source-linked claims, coherent structure, clear reader promise, style-guide alignment, and no unresolved blocker lanes. | Proceed to package QA for the current version only; no store or sales claim. |

## Devil's Advocate

- A quality rubric can become theater if every lane is allowed to pass by default. Required lanes should be explicit by book family.
- A beautiful proof can make weak writing look finished. Quality state must be tied to content evidence, not presentation polish.
- Hermes can make mediocre content sound strategic. Preserve uncertainty and create revision tasks instead of smoothing warnings.
- Human review can become a bottleneck. That is acceptable in V1; weak books published faster are a worse failure.
- Quality approval can become stale. Any meaningful content, source, title, metadata, asset, or proof change should invalidate the dependent state.

## Current Approval Effect

This model does not change the recommended V1 approval posture:

- internal PiB production studio with optional client review,
- KDP and Google Play Books manual handoff first,
- business nonfiction, activity or low-content print, series scaffolding, and rights-first negative-control fixture first,
- no runtime implementation or Phase 1 plan until Peet approves or revises the V1 approval record.

It adds one rule future planning should preserve: Book Studio cannot move a generated or assisted manuscript/proof into package QA, portal review, or publishing packet readiness until the current version has an editorial quality state that is pass or accepted warning for the relevant lanes.
