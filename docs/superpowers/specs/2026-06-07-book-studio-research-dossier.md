# Book Studio Research Dossier

**Status:** draft discovery dossier, not an approved implementation spec.
**Date:** 2026-06-07.
**Owner:** Pip.
**Product area:** Partners in Biz admin, client portal, Hermes skills, publishing operations.

## Purpose

Partners in Biz should support a new module for creating, managing, packaging, publishing, and analysing books that can be sold through Amazon KDP, Google Play Books, and other book channels. The module should learn from `PMStander/ai-story`, but be integrated into the PiB platform instead of becoming another standalone app.

The module should not start as a generic "AI writes a book" toy. It should be a production operating system for book projects: market research, series strategy, manuscript planning, AI-assisted drafting, editorial workflow, visual production, quality gates, export packages, publishing checklists, post-launch analytics, and repeatable Hermes skills.

## Current Evidence

### PiB Platform Context

The app already has primitives that should be reused:

- **Research:** source-backed evidence, findings, recommendations, and exportable knowledge.
- **Client Documents:** structured review/approval documents with versions, comments, suggestions, assumptions, and formal acceptance.
- **Projects/Kanban:** approval gates, task ownership, agent status, and production workflows.
- **Hermes agent skill policy:** role-bound skills, approval gates, and reviewer agents.
- **Portal module switches:** organisation-level toggles for client-visible modules.
- **Analytics/integrations:** existing patterns for dashboards, external reports, and attribution surfaces.

The book module should reuse these rather than create a parallel research/document/task system.

### Lessons From `PMStander/ai-story`

The referenced standalone repo is a Vite/Firebase app with a separate TypeScript agent service. It includes useful product patterns:

- Book wizard with category, genre, age, format, trim size, page count, style, and series selection.
- KDP-oriented trim sizes, interior type presets, page counts, and price estimates.
- Book categories beyond children's books: comics, fiction, Christian/faith, humor, puzzle/activity, non-fiction-like formats.
- Series manager with book grouping, style guides, characters, research notes, consistency checks, and next-book suggestions.
- Canvas/page layout editor with image and text placement.
- Niche research page with keywords, bestseller-style analysis, competition, trends, and start-book actions.
- Publishing tracker with stages from research through publish.
- Agent tools for outline generation, illustration generation, niche research, metadata improvement, series creation, and KDP optimization.

The architecture itself should not be ported directly because PiB is a Next/Firebase multi-tenant platform with admin/portal surfaces, shared auth, Firestore admin APIs, client documents, Projects/Kanban, and Hermes policy controls.

## External Publishing Constraints

### Amazon KDP

KDP supports Kindle eBooks, paperbacks, and hardcovers. It does not support every physical publication format; KDP explicitly excludes magazines, periodicals, calendars, and spiral-bound books. Source: [KDP start publishing](https://kdp.amazon.com/en_US/help/topic/GHKDSCW2KQ3K4UU4).

KDP AI policy requires the publisher to disclose AI-generated text, images, or translations when publishing or republishing. AI-assisted content, where a human creates the content and uses AI for brainstorming, editing, refinement, or checking, does not require disclosure. The publisher remains responsible for rights, policy compliance, and customer experience. Source: [KDP content guidelines](https://kdp.amazon.com/en_US/help/topic/G200672390).

KDP metadata is a policy surface, not just marketing copy. Categories and keywords must match the book. KDP allows up to three categories during setup and warns against misleading/manipulative keywords or irrelevant categories. Cover text, title, subtitle, author name, and series details should match metadata. Source: [KDP metadata guidelines](https://kdp.amazon.com/en_US/help/topic/G201097560).

KDP ISBN handling matters:

- KDP eBooks do not require ISBNs.
- Paperback and hardcover books require ISBNs unless they fall into low-content exceptions.
- KDP can provide free ISBNs for print formats, but the imprint becomes "Independently published".
- If using an externally registered ISBN, title, author, binding, and imprint details must match registration.

Source: [KDP ISBN and imprint](https://kdp.amazon.com/en_US/help/topic/G7DMSKCM9DVS65TC).

KDP series can be created before all books are complete. Linked formats are automatically included in the series. Public domain and low-content books are not eligible for KDP series pages. Source: [KDP start a book series](https://kdp.amazon.com/en_US/help/topic/GMFKBUS43QQ5AJ5A).

KDP reporting has lag and format differences. KDP Reports includes dashboard, orders, KENP reads, promotions, pre-orders, month-to-date, prior-month royalties, royalty estimator, and payments. Depending on format, an order may take days to appear. Source: [KDP reports](https://kdp.amazon.com/en_US/help/topic/GKEPUW32CTE6LFDA).

Amazon Ads can promote books and Amazon Attribution can support KDP authors for non-Amazon ads, with reporting available through Amazon Ads surfaces/API for eligible accounts. Sources: [KDP advertising](https://kdp.amazon.com/en_US/help/topic/G201499010), [Amazon Attribution for KDP](https://advertising.amazon.com/resources/whats-new/amazon-attribution-kdp-authors).

### Google Play Books

Google Play Books accepts PDF and EPUB for sale. If both are uploaded, readers can choose original-layout PDF or reflowable EPUB. Source: [How to sell books on Google Play](https://support.google.com/books/partner/answer/1079107).

Google metadata requires title, language, genre/subject, and identifier handling. If the book has no ISBN, Google assigns an internal identifier. Changing identifiers creates a duplicate and reviews/ratings do not carry over. Google recommends up to three genres from one subject standard, with the first as the most relevant. Source: [Google book metadata](https://support.google.com/books/partner/answer/3237055).

Google series metadata is strict. Series name spelling and punctuation must match across books, volume numbers should not skip or repeat, and designated series pages may become eligible for series-related promotions. Source: [Google Play Books series](https://support.google.com/books/partner/answer/11069638).

Google reports include earnings, sales summary, sales transactions, and Google Books preview traffic. Custom reports can be exported as tab-separated files, and sales reports are generally available 1-2 days after the transaction. Source: [Google reports overview](https://support.google.com/books/partner/answer/9266485).

Bulk upload supports content files from the Partner Center. Files must be under 2 GB and follow filename rules based on identifiers. Source: [Google add multiple books](https://support.google.com/books/partner/answer/3289689).

### Wider Channels To Consider

V1 should design for KDP and Google first, but not close the door on:

- Apple Books.
- Kobo Writing Life.
- Draft2Digital as ebook aggregator.
- IngramSpark for wider print distribution and bookstore/library ordering.
- ACX or KDP Virtual Voice for audio variants.
- Direct PiB storefront or landing page sales later.

These channels have different royalty timing, file requirements, return policies, ISBN implications, and reporting sources. The module should use a channel adapter model so KDP and Google are not hardcoded into the core book record.

### Wider Channel Adapter Research

The module should model each publishing destination as a channel adapter with channel-specific requirements, because each store has different upload paths, reporting timing, exclusivity rules, file formats, and tax/payment behavior.

| Channel | What the module should know | Design implication |
| --- | --- | --- |
| **Apple Books** | Direct publishing requires an iTunes Connect account and Apple Books supports EPUB publishing through its Publishing Portal. Apple directs PDF/KF8 and partner delivery through preferred partners rather than treating those as the normal direct upload path. Source: [Apple Books publish](https://authors.apple.com/publish). | Treat Apple as an ebook/audiobook channel where EPUB readiness, cover, sample, description, author, release/pre-order dates, and partner-delivery state are stored per listing. Do not assume print support. |
| **Kobo Writing Life** | Kobo setup includes title/author/description/category, cover, EPUB or manuscript conversion, DRM choice, territory, price, and publish action. Kobo also supports territorial rights. Dashboard earnings are estimates and monthly finance reports are authoritative. Source: [Kobo Writing Life FAQ](https://www.kobo.com/kobo-writing-life/blog/frequently-asked-questions). | Store DRM, territory rights, price overrides, and estimated-vs-report royalty state separately. Analytics should reconcile dashboard estimates against monthly reports. |
| **Draft2Digital** | Draft2Digital sends book files and metadata to selected partner stores. Store review times vary, library retailers can take longer, and print listing can take around weeks. D2D warns against overlapping D2D Print with KDP Expanded Distribution or IngramSpark. Partner payments can lag 30-90 days depending on ebook/audio/print. Source: [Draft2Digital FAQ](https://draft2digital.com/faq/). | Model D2D as an aggregator channel with downstream destinations, not as a single store. Track selected retailers, downstream review status, duplicate-distribution conflicts, and delayed payment windows. |
| **IngramSpark** | IngramSpark requires cover and interior files; distributed books need an ISBN for each format. It can assign a non-distributable SKU for print-only use, and it is non-exclusive if the publisher owns the ISBN. It warns against pairing its print distribution with KDP Expanded Distribution. Source: [IngramSpark FAQ](https://www.ingramspark.com/faqs). | Treat IngramSpark as print/wide-distribution infrastructure with ISBN ownership, print file readiness, distribution conflict checks, SKU-only mode, and wholesale/retail economics. |
| **Audiobook via ACX/KDP Virtual Voice** | ACX supports audiobook production and distribution across Audible, Amazon, and iTunes, with requirements around an Amazon-listed book, audio rights, manuscript, and cover art. KDP Virtual Voice is a beta path for eligible KDP eBooks in the U.S. marketplace, with generated narration clearly labeled and different royalty/reporting behavior. Sources: [ACX for KDP authors](https://www.acx.com/landing/kdp), [KDP Virtual Voice](https://kdp.amazon.com/en_US/help/topic/G3QRL9HQNF273Q2H). | Model audiobook editions separately from ebook/print editions. Track narrator/source, voice disclosure, audio rights, sample, per-finished-hour cost or royalty share, royalty model, and channel eligibility. |
| **ISBN registries** | ISBNs identify a specific title/product and the publisher responsible in the supply chain. ISBNs bought from a source other than an official agency may not identify the publisher accurately. Source: [ISBN.org](https://www.isbn.org/about_ISBN_standard). | Store ISBN ownership, agency/source, imprint, format binding, and whether a free platform ISBN creates imprint or distribution constraints. Do not treat ISBN as just an optional string. |
| **EPUB validation** | EPUBCheck is the official conformance checker for EPUB publications. Source: [W3C EPUBCheck](https://w3c.github.io/epubcheck/docs/). | Add a future artifact validator step for EPUB files and store validation results as release-gate evidence before Apple/Kobo/Google/D2D export. |

Channel adapter records should separate:

- **Core book identity:** title, author/brand, series, audience, genre, language, rights owner, and content rating.
- **Edition identity:** ebook, paperback, hardcover, audiobook, workbook, low-content, or special format.
- **File package:** manuscript source, EPUB/PDF/interior/cover/audio files, validation results, and upload-ready version.
- **Channel listing:** channel, downstream retailer if aggregator, metadata, pricing, territory rights, ISBN/imprint, publication status, and external IDs.
- **Financial state:** estimated dashboard metrics, report-import metrics, settled payments, tax/withholding notes, refunds/returns/credits, and report source.
- **Risk state:** exclusivity conflicts, duplicate distribution conflicts, AI disclosure, public-domain/low-content rules, rights uncertainties, and manual-review blockers.

This prevents false simplicity. A "book" is not one record with one price and one status; it is a product family with editions, files, listings, and financial ledgers that can disagree across channels.

## Recommended Product Position

Recommended V1: **Internal PiB Book Studio with optional client review**.

This means:

- Admin/PiB/Hermes users create and operate book projects.
- Clients can review and approve selected artifacts through portal surfaces when the module is enabled.
- Publishing remains an export-and-handoff workflow first.
- Automation focuses on research, generation, validation, packaging, metadata, checklists, and analytics ingestion.
- Direct store upload or API publishing is a later enhancement only where sanctioned and stable.

The alternatives are weaker:

- A fully client-facing self-serve book generator increases quality, policy, copyright, and reputation risk before the workflow is mature.
- A public SaaS would require billing, abuse prevention, public onboarding, separate support, and aggressive content moderation that PiB does not need for V1.

## Product Positioning Options

This module has three credible product positions. The implementation should not begin until one is chosen, because the choice changes permissions, workflow design, Hermes skill gates, analytics, and legal exposure.

| Option | What it means | Advantages | Risks | Fit for V1 |
| --- | --- | --- | --- | --- |
| Internal PiB production studio with optional client review | PiB admins and Hermes agents create books; clients review selected artifacts and approve decisions through portal/documents. | Reuses existing PiB strengths; keeps risky actions behind staff review; easiest to integrate with Research, Documents, Projects, and Hermes approvals; protects quality. | Less self-serve; Peet/PiB remains responsible for production throughput. | Best fit. |
| Client-facing self-serve module | Clients log into the portal and generate books themselves with guided AI workflows. | More scalable per client; visible product value; could become a premium client module. | High risk of poor output, copyright issues, policy mistakes, AI disclosure errors, and support burden. Needs strong moderation and limits. | Later, after internal workflow proves itself. |
| Public/productized AI-book SaaS | A public product where anyone signs up, pays, generates, exports, and possibly publishes books. | Larger market; standalone revenue stream; clear marketing story. | Requires billing, abuse prevention, public onboarding, public support, moderation, content policy enforcement, and separate growth engine. Distracts from PiB platform integration. | Not a V1 unless PiB explicitly pivots into this product. |

Recommendation: approve the internal production studio first, then add client self-serve controls only after the production workflow has reliable quality gates and analytics.

## Draft V1 Operating Model

If V1 is approved as the internal production studio, the module should behave like a controlled publishing workspace rather than a document editor with AI buttons.

### Personas

- **PiB operator:** creates book projects, assigns Hermes work, reviews outputs, controls publishing readiness, and owns public submission decisions.
- **Hermes specialist:** performs bounded tasks such as niche research, brief creation, outline drafting, metadata optimization, readiness checks, and analytics import.
- **Client reviewer:** reviews approved briefs, drafts, covers, proofs, and publishing packets when the portal module is enabled.
- **QA/release reviewer:** verifies policy, file package, metadata, AI disclosure, and approval gates before public publishing.
- **Data analyst:** imports and reconciles reports after launch.

### V1 Workflow

1. Create a book project under a client organisation.
2. Link or create a Book Research item.
3. Generate a structured Book Brief as a client document when approval is needed.
4. Create or attach a series record if the book belongs to a sequence.
5. Build an outline and manuscript/page plan.
6. Track manuscript, visual, layout, metadata, and publishing tasks through Projects/Kanban.
7. Produce a Publishing Packet with metadata, file checklist, AI disclosure, channel plan, ISBN/imprint decision, and launch checklist.
8. Export files and metadata for manual KDP/Google setup.
9. Track each channel listing through status changes: metadata ready, files ready, uploaded, in review, live, blocked, revision required.
10. Import reports manually at first and reconcile sales, reads, royalties, ad spend, and launch traffic.

### V1 Screens

- Admin Book Studio index: filters by org, status, series, channel, and risk.
- Admin book project detail: overview, research, brief, manuscript, assets, publishing packet, channel listings, analytics.
- Admin series detail: ordered/unordered books, style guide, continuity notes, volume gaps, channel series links.
- Portal Book Studio index: reviewable client-safe projects only.
- Portal book detail: approved brief/proof/cover/publishing packet, comments, approvals, change requests.
- Analytics view: book, series, channel, format, reporting period, and estimated/reported/settled financial separation.

### Workspace Route Blueprint

Book Studio should follow the PiB shared-workspace pattern used by Projects, Documents, Mobile Apps, and the YouTube Studio placeholder: route files resolve auth/org/surface context, while shared workspace components own the actual product UI. Do not build separate admin and portal implementations that drift.

Recommended route wrappers:

| Route | Surface | Purpose |
| --- | --- | --- |
| `/admin/org/[slug]/book-studio` | Admin | Client-scoped Book Studio index, command center, filters, create action, and risk queue. |
| `/admin/org/[slug]/book-studio/[bookId]` | Admin | Book project detail with production, gates, publishing, and analytics tabs. |
| `/admin/org/[slug]/book-studio/series/[seriesId]` | Admin | Series workspace, continuity bible, volume map, and channel-series status. |
| `/admin/book-studio` | Admin/global optional | Cross-client view for PiB operators, useful only after client-scoped routes exist. |
| `/portal/book-studio` | Portal | Client-safe book project index, hidden when `settings.portalModules.bookStudio === false`. |
| `/portal/book-studio/[bookId]` | Portal | Client-safe review detail for approved briefs, proofs, publishing packets, comments, and approvals. |

Recommended shared components:

- `BookStudioWorkspaceShell`: shared header, stats, risk rail, module status, surface-specific actions, and empty/unavailable states.
- `BookProjectList`: reusable list/table/cards for admin and portal with surface-specific columns.
- `BookProjectDetailWorkspace`: tabbed project workspace that receives `mode: 'admin' | 'portal'`, org scope, book ID, and optional source company/workspace scope.
- `BookSeriesWorkspace`: series-level plan, ordered/unordered volume map, continuity bible, and channel series warnings.
- `BookPublishingPacketPanel`: KDP/Google readiness packets, channel listing states, blockers, approvals, and manual upload evidence.
- `BookQualityGatePanel`: required gates, warnings, blockers, waivers, reviewer, and approval task links.
- `BookHermesTasksPanel`: task packet status, assigned agent, expected artifacts, reviewer, risk, and approval gate.
- `BookAnalyticsPanel`: estimated/reported/settled metrics, import ledger, reconciliation queue, and confidence labels.

Admin book detail tabs should be:

1. **Overview:** project summary, book type, stage, owner, series, target channels, risk, next action, and linked Project/Kanban state.
2. **Research:** linked Research items, findings, recommendations, source coverage, and gaps.
3. **Brief:** Book Brief client document, approval state, assumptions, scope, success criteria, and source links.
4. **Manuscript:** outline, section/page plan, manuscript versions, editorial status, and AI provenance.
5. **Assets:** covers, illustrations, interiors, audio, source files, rights/provenance, and artifact visibility.
6. **Gates:** book-type gate profile, compliance flags, rights/AI/ISBN/content warnings, and waivers.
7. **Publishing:** KDP/Google packets, channel listings, blocker notes, manual upload evidence, external IDs, and live URLs.
8. **Analytics:** imports, reconciliation, estimated/reported/settled performance, launch attribution, and cost recovery.
9. **Hermes:** queued/running/completed skill tasks, artifacts, reviews, and approval handoffs.

Portal book detail should be intentionally narrower:

- **Summary:** approved book/project summary, current status, next client action, and safe timeline.
- **Review:** client-visible Book Brief, manuscript/proof excerpts, cover directions, publishing packet, comments, approvals, and change requests.
- **Publishing:** client-safe channel status, blockers only when marked client-visible, approved launch dates, and live links.
- **Analytics:** client-safe performance summaries with source/confidence labels, not internal reconciliation queues.

Portal must not expose internal Research notes, unapproved Hermes outputs, raw rights blockers, competitor analysis, internal risk notes, unpublished metadata drafts, report import errors, or operator-only upload evidence unless an admin explicitly marks the item client-visible.

Critical UI states:

- `module_disabled`: portal route/API returns disabled-module state and the nav item is hidden.
- `no_projects`: admin shows create/onboarding actions; portal shows no reviewable projects.
- `needs_brief_approval`: show Book Brief approval as the primary next action.
- `blocked`: show blocker owner, severity, evidence links, and whether client visibility is allowed.
- `approved_for_upload`: show manual upload checklist and final internal approval summary.
- `live`: show external URLs, analytics-import next step, and launch follow-up actions.
- `analytics_unmatched`: show reconciliation queue and task creation, not misleading totals.

### Workspace Experience And Review Lanes

Book Studio should feel like a production cockpit, not a blank manuscript editor or an AI chat window. At any point, a PiB operator should be able to answer five questions without digging through unrelated records:

1. What stage is this book in?
2. What is the next decision or action?
3. What evidence supports the current state?
4. Who owns each blocker?
5. Which artifacts are safe for client review?

The primary project journey should be a stage rail that is derived from real state, not manually typed status text:

1. **Intake:** client org, owner, book type, audience, channel targets, format, series posture, budget posture, and first decision notes.
2. **Research:** linked Research item, source coverage, competitor/category notes, target reader, commercial risk, and factual gaps.
3. **Brief:** internal or client-visible Book Brief with assumptions, scope, success criteria, channel plan, and approval state.
4. **Series/outline:** series record, volume order, style/continuity bible, outline, chapter/page plan, and missing continuity decisions.
5. **Manuscript/assets:** draft versions, page/spread plans, cover and interior assets, audio or visual work, provenance, and human review state.
6. **Quality gates:** rights, AI disclosure, metadata, accessibility, file, link/TOC, book-type, commercial, client-approval, and reviewer gates.
7. **Export package:** source archive, EPUB/PDF/KPF/print/audio package, manifest, checksums, validation evidence, and preview evidence.
8. **Publishing packet:** store metadata, pricing, territories, ISBN/imprint, AI disclosure answers, channel checklist, and approval state.
9. **Manual upload/review:** operator upload evidence, external listing IDs, store review status, revision requests, and client/client-account dependencies.
10. **Launch/lifecycle:** live links, launch tasks, post-publication quality feedback, revision queue, promotion tasks, and client communication.
11. **Analytics/reconciliation:** imported reports, estimates vs reported vs settled revenue, unmatched rows, cost recovery, and next reporting task.

The admin create flow should start with the client organisation and a small set of decisions: book type family, target outcome, target channels, formats, series choice, expected client involvement, and publishing account model. Before creation, the form should show the derived mandatory gate profile. For example, a coloring book aimed at KDP print and Google Play Books should immediately show print package, DRM/printing, image rights, and Kindle-unsuitable-format warnings. A nonfiction ebook should show fact-checking, metadata/content match, source citation, link/TOC, AI disclosure, and accessibility gates. Creation should link or create a Book Project, Research item, and optional Book Brief document, but Hermes generation should not start until the brief/research/gate profile exists.

The admin project detail layout should be optimized for repeated operator work:

- **Header:** project title, client org, series/volume, book type family, stage, risk level, portal visibility, owner, and next action.
- **Main panel:** the active artifact for the selected tab: research summary, brief, outline, manuscript version, asset set, gate profile, publishing packet, upload evidence, or analytics.
- **Right rail:** evidence links, active gates, Hermes tasks, blockers, approvals, waiver requests, and client visibility.
- **Decision drawer:** convert a recommendation into a task, document, gate, approval request, client-visible blocker, waiver request, or Hermes task packet.

Every artifact should live in an explicit lane:

| Lane | Default visibility | Operator purpose | Portal behavior |
| --- | --- | --- | --- |
| Research | Internal | Market, audience, category, competitor, pricing, and policy evidence. | Hidden unless a reviewed summary is promoted into a brief or client document. |
| Brief | Internal until reviewed | Scope, assumptions, success criteria, book type, channel plan, and approval state. | Client-visible when the brief document is published for review. |
| Manuscript/proof | Internal until proofed | Drafts, versions, editorial review, excerpts, page/spread proofs, and change history. | Only approved excerpts/proofs are visible; raw generation output stays hidden. |
| Covers/assets | Internal until rights reviewed | Cover options, images, fonts, audio, source files, license/provenance, and approval state. | Client sees approved options/proofs plus rights-safe summaries. |
| Gates | Internal by default | Quality, rights, AI disclosure, metadata, accessibility, commercial, and file-package blockers. | Only client-actionable blockers are shown with safe wording. |
| Publishing packet | Internal until approved | KDP/Google metadata, pricing, territories, disclosure answers, file checklist, and manual upload steps. | Client can approve or request changes on reviewed packet versions. |
| Analytics | Internal until reconciled | Import ledger, unmatched rows, estimated/reported/settled splits, and cost recovery. | Client sees safe summaries with source and confidence labels. |

The portal review surface should be narrower than admin. Its job is to let clients review, comment, approve, request changes, view safe blockers, see launch status, and inspect live links or performance summaries. It should not expose internal research, unresolved rights notes, raw Hermes outputs, unpublished metadata drafts, reconciliation errors, operator-only upload evidence, competitor analysis, or internal risk notes unless an admin explicitly marks a specific summary client-visible. If the future `settings.portalModules.bookStudio` switch is disabled, the portal nav should hide Book Studio and direct portal access should return the same disabled-module pattern used by Mobile Apps and YouTube Studio.

Quality gates should be UI objects, not hidden checklist text. Each gate should show:

- Status: `not_started`, `in_review`, `passed`, `warning`, `blocked`, `waived`, or `not_applicable`.
- Owner and due date.
- Evidence links or missing-evidence prompts.
- Source/policy reason where relevant.
- Client visibility state.
- Waiver request/approval state.
- Dependent tasks or Hermes task packets.

The quality gate panel should make the source-backed risk visible without overloading the operator. KDP's quality guide should drive gates for metadata/content mismatch, broken TOC or links, missing content, wrong content, image/formatting/table accessibility problems, disappointing duplicate or reused content, and book types that are unsuitable for Kindle because their main purpose is writing or coloring. Google Play Books policies should drive gates for misleading metadata, account/content authorization, poor-quality or low-utility files, copyright/licensing risk, and policy review. These sources should appear as evidence links on the relevant gate, not as generic footnotes buried in the dossier.

State labels should be conservative:

- Use `packet ready for manual upload`, not `ready to publish`, until store upload/review is complete.
- Use `approved for this package version`, not `approved`, because file checksum changes invalidate approval.
- Use `blocked by rights`, `blocked by missing file preview`, `blocked by client publishing-account dependency`, or `blocked by policy review`, not a generic `blocked`.
- Use `estimated`, `reported`, `settled`, or `reconciled` on every money metric.
- Use `client review requested`, `client changes requested`, `client approved packet`, and `client approval superseded` for portal approvals.

Devil's advocate:

- A polished dashboard can create false confidence. The workspace must not make generated books look upload-ready just because the stage rail advanced.
- The portal can become either too opaque or too frightening. It should show client-safe context and decisions, not the raw internal risk ledger.
- Intake that is too open-ended will let operators bypass gates and create low-quality books. Intake that is too rigid will break unusual book types. Gate profiles should be defaulted by book type, with add-on gates and approval-backed waivers.
- Hermes task output should never become a client-visible artifact by default. A human reviewer must promote it into a brief, proof, asset packet, publishing packet, or safe blocker summary.
- A book can be creatively strong and commercially weak. The workspace must keep margin, royalties, file costs, print costs, ads, refunds, and payment lag visible before launch approval.

Phase 1 should test the experience, not only the data model:

- The stage rail and next action are derived from project, gate, package, listing, approval, and analytics state.
- Admin create flow displays mandatory gates before the project is created.
- Portal review routes hide internal-only lanes and return disabled-module states when the module switch is off.
- Quality gate UI shows source/evidence/blocker ownership and cannot mark a gate passed without required evidence.
- Client approval supersedes correctly when a brief, proof, export package, or publishing packet version changes.

### V1 Non-Negotiable Guardrails

- No direct public publishing submission without an approval task.
- No paid ad launch or budget change without an approval task.
- No claim that KDP/Google acceptance is guaranteed by PiB validation.
- No untracked AI-generated text/image/translation in a publishing packet.
- No metadata recommendation that uses competitor author names, unrelated keywords, or misleading category placement.
- No client-visible publishing packet until rights, AI disclosure, ISBN/imprint, and mature-content flags are explicitly reviewed.
- No large manuscript or image payloads embedded directly in core Firestore records; store large files as artifacts/assets.

### V1 Success Criteria

- PiB can create a book project, link research, create a brief, manage a series, track production tasks, prepare a publishing packet, and track KDP/Google status without leaving the platform for project management.
- Hermes skills produce bounded artifacts that can be reviewed, revised, and approved rather than directly publishing content.
- Clients can review and approve selected book artifacts without seeing internal-only research or risk notes.
- KDP/Google readiness is clear enough that a PiB operator can execute the manual store setup consistently.
- Analytics can ingest early reports even when the data is delayed, partial, or inconsistent across store and ad platforms.

## PiB Integration Architecture

Book Studio should be a PiB module, not a port of `ai-story`. The `ai-story` repo has useful product ideas, but its architecture is built around a standalone Vite/Firebase app with browser routes such as `BookWizard`, `StoryStudio`, `BookCanvas`, `SeriesManager`, `NicheResearch`, `AssetLibrary`, `Publishing`, `Analytics`, and a separate `agent/` service. Its Firestore shape is user-scoped (`users/{uid}/projects`, nested chapters/assets/characters, `users/{uid}/series`, and user campaigns), and its agent tools cover broad actions such as `auto_generate_book`, `create_book`, `create_series`, `generate_illustration`, `deep_research`, `optimize_for_kdp`, and `create_ad_keywords`. Source: [PMStander/ai-story](https://github.com/PMStander/ai-story).

PiB should reuse the workflow ideas, not the ownership model. Book Studio records must be org-scoped, approval-gated, and linked to existing PiB surfaces.

### Concept Mapping From `ai-story` To PiB

| `ai-story` concept | What to keep | PiB-native implementation |
| --- | --- | --- |
| Book Wizard | Guided intake for category, concept, format, style, series, and generation plan. | Admin Book Studio create flow that sets `bookTypeFamily`, gate profile, linked org, series, Research item, Project/Kanban workspace, and optional Book Brief client document. |
| Story Studio / Story Outline | Assisted drafting, continuation, outline, and section-level editing. | Manuscript/version workspace backed by book sections and client documents, with Hermes draft/editor tasks and explicit AI disclosure/provenance. |
| Book Canvas / Preview | Page/spread review for fixed-layout books. | Fixed-layout proof workspace that links page/spread metadata to workspace artifacts, cover/interior files, and proofing tasks. |
| Series Manager / Style Guide | Series grouping, research notes, style guide, characters, and consistency checks. | `book_series` records plus PiB Research links, style/continuity bibles, ordered volume map, KDP/Google series warnings, and Hermes series-strategy tasks. |
| Niche Research | Topic/category/competitor discovery and recommendations. | PiB Research items with source records, findings, recommendations, internal visibility by default, and promotion into briefs/tasks only after review. |
| Asset Library | Images, covers, generated artwork, puzzle files, answer keys. | `workspace_artifacts` for files and export packages, with `resourceType: 'book_project'`, source research/document/task IDs, approval gate, agent owner, visibility, provenance, and rights metadata. |
| Publishing Hub | Workflow status tracking from research to publish. | Channel listing tracker with per-channel KDP/Google/Apple/Kobo/D2D/Ingram status, readiness reports, external IDs, blockers, and approval-gated public submission steps. |
| Analytics | Writing progress and simple published counts. | Book/series/channel analytics ledger that imports store/ad/PiB reports and separates estimated, reported, and settled metrics. |
| Single story assistant | Conversational help for writing, illustrations, research, KDP, ads, and series. | Multiple Hermes skills owned by Sage, Iris, Maya, Quinn, Theo, Pip, Vera, and Ari, dispatched through Projects/Kanban with provenance and approval gates. |

### `ai-story` Source Inventory And Migration Delta

Inspection target: [`PMStander/ai-story`](https://github.com/PMStander/ai-story), `main` at commit `11ef473` on 2026-06-07. The repo is useful as a working product sketch, but it should be treated as reference material rather than source code to port directly.

Observed implementation:

- **Runtime:** standalone Vite/React app with protected routes in `src/App.jsx` and a persistent `AgentChat` mounted beside the app shell.
- **Book creation:** `src/pages/BookWizard.jsx` performs category, concept, format, style, generation, image, cover, Firestore, and Storage writes inside one browser flow.
- **Book categories:** `src/lib/bookGenres.js` supports children, comic, fiction, Christian/faith, humor, and puzzle/activity categories with genre/tone/art-style defaults.
- **Format helpers:** `src/lib/kdpFormats.js` stores trim-size, page-count, interior, art-style, and rough KDP pricing reference data.
- **Editing:** `src/pages/StoryStudio.jsx` and `src/pages/BookCanvas.jsx` provide page/spread editing, layout presets, text/image element controls, and debounced canvas layout saves.
- **Series:** `src/pages/SeriesManager.jsx` keeps series descriptions, research notes, book IDs, recurring characters, and style-guide checks.
- **Research:** `src/pages/NicheResearch.jsx` calls Gemini research helpers with Google Search grounding, then renders keywords, bestsellers, analytics, gaps, and series tabs.
- **Publishing:** `src/pages/Publishing.jsx` is a status checklist and table, not a real channel adapter, file validator, or store-submission ledger.
- **Analytics:** `src/pages/Analytics.jsx` calculates local book/chapter/word progress and placeholder AI usage, not sales, royalty, ad, or review reconciliation.
- **Data ownership:** `src/lib/firestore.js` stores projects, chapters, assets, campaigns, series, and chats under `users/{uid}/...`.
- **AI execution:** `src/lib/gemini.js` creates browser-side Gemini clients with the user's API key; `agent/server.ts` receives the key over HTTP, creates an in-memory ADK session, and returns action payloads; `src/contexts/AgentProvider.jsx` then applies those actions in the browser.
- **Embeddings:** `functions/index.js` generates chapter and character embeddings from user-scoped document writes and stores vectors back on the same records.

Migration deltas:

| Source pattern in `ai-story` | PiB decision | Reason |
| --- | --- | --- |
| User-owned Firestore paths such as `users/{uid}/projects` and `users/{uid}/series`. | Use org-scoped `book_projects`, `book_series`, editions, sections/pages, channel listings, quality gates, and workspace artifacts. | PiB work is tenant/client owned, not individual creator owned. Admin, portal, and agent access must resolve the same org scope. |
| Browser flow generates content, images, cover, uploads assets, writes chapters, and updates project status in one action. | Split into explicit Project/Kanban tasks, artifacts, manifests, and approval gates. | Book generation is high-risk because text, images, rights, disclosure, and files need review before client or channel exposure. |
| BYOK Gemini API key stored/read from user settings and sent to a standalone agent HTTP endpoint. | Use PiB-managed server/Hermes capability dispatch with allowlisted skill contracts and org audit trails. | Client secrets and agent actions should not cross an unaudited browser-to-agent boundary. |
| Agent action payloads directly create series/books, update series research, and mutate style guides in the current browser session. | Hermes actions create bounded artifacts or task outputs; a PiB API records mutations after authorization and review checks. | Conversational help is valuable, but autonomous mutation must be auditable and reversible. |
| Category-aware wizard asks for category, topic, genre, audience, format, style, and series link. | Reuse the intake shape, but make the selected category load a PiB `bookTypeFamily` gate profile and required packet checklist. | This is the strongest UX lesson from `ai-story`; PiB needs it tied to validators and operations, not only prompt selection. |
| Canvas layout stores fixed-layout text/image rectangles directly on chapter records. | Keep page/spread layout metadata compact, but store source files, proofs, and export packages as artifacts with checksums and provenance. | Fixed-layout work needs inspectable proofs and upload-ready package records, not only browser layout state. |
| Series style guide and research notes are embedded on the series record. | Store concise series bible fields on `book_series`, and link substantial research, evidence, style packets, and client approvals to PiB Research/Documents. | Series continuity is core, but evidence and approvals should stay in PiB's existing source-of-truth systems. |
| Publishing status is a manually editable workflow step. | Store channel-specific listing states, package requirements, upload package IDs, external IDs, rejection/review notes, blockers, and preview evidence. | A checklist cannot prove KDP/Google readiness or preserve why a package was approved. |
| Analytics is progress-oriented and mostly local. | Use the analytics reconciliation model already defined in this dossier: reported, settled, estimated, imported, and disputed rows per book/series/channel/listing. | Sales, royalties, ad spend, reviews, and PiB funnel data will arrive late, partially, and with mismatched identifiers. |
| The repo includes useful prototype helpers such as trim-size data, category defaults, layout presets, and puzzle rendering. | Treat these as product references; re-source channel constraints from official KDP/Google docs and rewrite code in PiB patterns. | Prototype constants can drift and may encode assumptions that are not valid for every channel, territory, or format. |

Devil's-advocate conclusion: over-porting `ai-story` would make Book Studio feel fast early but weak operationally. PiB would inherit a solo-creator tool that can generate attractive artifacts without proving rights, margins, file validity, client approval, or channel readiness. Under-learning from it would also be a mistake: the category-aware wizard, canvas/proof workflow, series style guide, agent action vocabulary, and research tabs are concrete UX patterns that can make the PiB module usable from day one.

### Canonical Records And Ownership

V1 should introduce small, org-scoped Book Studio records while using existing PiB primitives for evidence, review, work, and files:

- `book_projects`: core identity, status, type family, gate profile, creative brief summary, compliance state, linked PiB records, and current risk state.
- `book_series`: series identity, order mode, style/continuity bible, volume map, shared channel-series metadata, and release cadence.
- `book_editions` or `book_project_editions`: ebook, paperback, hardcover, audiobook, workbook, low-content, or fixed-layout edition records. Each edition stores format decisions, file requirements, identifiers, and readiness state.
- `book_manuscript_versions`: version metadata, authorship/AI provenance, section map, approval state, and document/artifact links. Large manuscript content should live in client documents, Google Docs, or storage-backed artifacts, not as a large Firestore blob.
- `book_sections` or `book_pages`: semantic chapters/sections for reflowable books and pages/spreads/panels for fixed-layout books. These should stay concise and link to artifacts for large images/files.
- `book_channel_listings`: KDP, Google, and future channel state with metadata, pricing, territory rights, identifiers, upload status, blockers, and readiness report links.
- `book_quality_gates`: required checks, source task/document/research evidence, reviewer, pass/warn/block state, waiver state, and approval task link.
- `book_launch_plans`, `book_promotion_windows`, `book_review_compliance_records`, and `book_lifecycle_events`: governed sell-through, review hygiene, attribution, promotion, price-change, revision, and postmortem records.
- `book_skill_evaluations`: fixture and dry-run evidence proving Book Studio Hermes skills meet their contracts before runtime or client-visible enablement.
- `book_analytics_imports` and normalized analytics rows/snapshots: import ledger and reconciliation evidence.

Existing PiB primitives remain authoritative where they are already stronger:

- **Research:** market evidence, competitor analysis, category/keyword findings, rights research, policy notes, and recommendations.
- **Client Documents:** Book Briefs, manuscript/proof review packets, cover option packets, Publishing Packets, final client acceptance, and versioned comments/suggestions.
- **Projects/Kanban:** work orchestration, approval gates, agent dispatch, reviewer assignment, dependencies, and release-sensitive decisions.
- **Workspace artifacts:** generated or uploaded files such as EPUB, PDF interior, full-wrap cover, audio files, screenshots, validation reports, exported metadata packets, and source files.
- **Portal module switches:** `settings.portalModules.bookStudio` should gate client-visible Book Studio nav/API surfaces later, matching the Mobile Apps pattern.

### End-To-End Data Flow

1. **Create project:** PiB operator creates a `book_project` under an org, chooses `bookTypeFamily`, selects or creates `book_series`, and creates/links a Project/Kanban workspace.
2. **Research:** Sage creates an internal Research item and sources. Recommendations can be promoted into a Book Brief or Kanban tasks only after review.
3. **Brief:** Iris turns approved research and client/business goals into a Book Brief client document when approval is needed. The `book_project` stores only summary fields and document IDs.
4. **Production tasks:** Pip or the operator creates Hermes-ready Project/Kanban tasks with `agentInput.context.bookProjectId`, `bookStudioSkillKey`, `bookSeriesId`, `sourceResearchItemId`, `sourceDocumentId`, validator-safe `requiredCapability`, `riskLevel`, `reviewerAgentId`, `approvalGateTaskId`, and `expectedArtifacts`.
5. **Manuscript and assets:** Maya/Iris/Quinn tasks create or revise sections, style guides, covers, illustrations, and proof reports. File outputs are linked as workspace artifacts with provenance and visibility state.
6. **Quality gates:** `book_quality_gates` aggregate evidence from tasks, documents, research, and artifacts. Blockers stay internal until resolved or waived through an approval task.
7. **Publishing packet:** Quinn/Pip assemble channel-specific metadata, files, AI disclosure, ISBN/imprint choice, rights/territory state, and upload checklist into a client document or internal packet.
8. **Manual channel execution:** Operator uploads externally to KDP/Google and records external IDs, status, review notes, blockers, and live URLs in `book_channel_listings`.
9. **Analytics import:** Vera imports reports/ad data/PiB launch funnel rows, matches them to book/series/edition/channel listings, and creates reconciliation tasks for mismatches.

### Series Operating Model

Series support should be more than grouping books under one name. For Book Studio, a series is a commercial, editorial, metadata, and analytics object that controls continuity, release cadence, volume order, channel rules, and future production decisions.

Series modes:

| Mode | Use case | PiB behavior |
| --- | --- | --- |
| `ordered` | Fiction arcs, children's sequences, instructional courses, multi-volume nonfiction, comic issues. | Requires volume numbers, no gaps without a waiver, continuity checks, and channel series metadata checks. |
| `unordered` | Topical nonfiction, brand authority books, devotional collections, companion guides, standalone books in the same universe. | Allows recommended reading order and related-content grouping without claiming strict volume sequence. |
| `collection` | Box sets, omnibus editions, bundles, collected volumes, seasonal compilations. | Modeled as a separate book project linked to source volumes; channel support differs by platform and format. |
| `spin_off` | Character/topic spin-offs or sub-series. | Links back to a parent series but maintains its own style guide, channel metadata, and analytics rollups. |

The series record should own:

- **Identity:** series name, subtitle/tagline, description, owner org, author/brand, language, audience, genre, and parent series if any.
- **Order model:** ordered/unordered/collection/spin-off mode, volume numbers, recommended reading order, release cadence, planned-but-unpublished slots, and gap warnings.
- **Continuity bible:** recurring characters, places, timeline, terminology, visual style, tone, content rules, canon status, recurring offers/CTAs, and forbidden contradictions.
- **Research links:** market evidence, comparable series, reader expectations, review-mining patterns, category/keyword research, and release-cadence evidence.
- **Production defaults:** default book type family, gate profile, trim/layout defaults, cover style system, metadata rules, Hermes skill defaults, and review requirements.
- **Channel series state:** KDP series ID/page URL, Google series metadata, channel-specific warnings, live titles, related content, unsupported features, and external page status.
- **Analytics rollup:** per-volume performance, series sell-through, launch order, reader acquisition source, read-through/drop-off, refund patterns, production cost recovery, and next-book recommendations.

Series lifecycle:

1. **Concept:** Research validates whether a series helps the audience/commercial goal or creates unnecessary production debt.
2. **Bible draft:** Sage/Iris create a series strategy and continuity bible from Research, client goals, and existing books.
3. **Approved bible:** Operator approves the bible before multiple volumes or repeated visual assets are generated.
4. **Volume planning:** PiB creates planned book slots with `planned`, `in_production`, `ready_for_packet`, `published`, `paused`, or `cancelled` status.
5. **Production:** Each book inherits series defaults but can override details with explicit notes and reviewer approval.
6. **Channel setup:** KDP/Google series metadata is checked before manual upload, and each channel listing stores external series status.
7. **Live monitoring:** Analytics tracks per-volume and aggregate performance and creates next-book or revision tasks when read-through, reviews, or refunds expose a problem.

Series gates:

- `series_strategy_approved`: required before creating more than one production book under the series.
- `continuity_bible_current`: required before outline or draft tasks for any later volume.
- `volume_order_validated`: required for ordered series and Google/KDP channel packets.
- `channel_series_eligibility_checked`: required before any KDP/Google series metadata is sent to a publishing packet.
- `series_metadata_consistency_checked`: title, subtitle, contributor, series name, punctuation, capitalization, volume number, and linked-format checks.
- `series_analytics_reviewed`: required before approving a new follow-up volume after earlier volumes are live.

KDP implications:

- A KDP series can start before every book is complete, books can be added or removed, and linked formats on the Bookshelf are automatically added when one linked format is added to the series.
- Public-domain and low-content books are not eligible for KDP series creation, so PiB should block KDP series packets for those book type families unless the channel rules change.
- Kindle box sets can be added as related content, but KDP does not provide the same bundled/boxed-set creation path for paperbacks.
- Amazon series pages and features vary by marketplace. PiB should store marketplace-specific series page URLs and support warnings instead of assuming one universal series page.
- KDP series 1-click/bulk-buy has limits such as title count, unavailable Kindle items, pre-orders, multiple editions, fewer than two live titles, and paperback/hardcover-only sets. PiB should treat it as an observed channel capability, not a promised feature.

Google implications:

- Series name spelling, punctuation, capitalization, and volume numbering must be consistent across books.
- Ordered series should use whole-number volume values without skipped or duplicate numbers unless the operator records a deliberate exception.
- Google can model special relationships such as bundle, omnibus, box set, and special edition, so PiB should store relationship type separately from ordinary volume order.
- Report imports must map sales/preview rows back to both book and series because Google identifiers can differ from ISBN handling and internal Google IDs.

Hermes series tasks should never invent canon. They should propose continuity bible changes, flag contradictions, draft next-volume briefs, and recommend release cadence, but the operator owns final canon approval. If a later book contradicts an approved bible, the task should produce a `continuity_change_request` artifact rather than silently rewriting the series bible.

Series design sources: [KDP Start a Book Series](https://kdp.amazon.com/en_US/help/topic/GMFKBUS43QQ5AJ5A), [KDP Amazon Series Page](https://kdp.amazon.com/en_US/help/topic/G83483M7NAQMBX46), and [Google Play Books series](https://support.google.com/books/partner/answer/11069638).

### Non-Port Rules

- Do not use `users/{uid}/projects` style ownership. Every Book Studio record is `orgId` scoped and must pass admin/portal/agent org authorization.
- Do not store or rely on a user's browser-held Gemini key for production workflows. Hermes skills should use PiB-managed agent credentials and policy-controlled capabilities.
- Do not keep one catch-all book assistant with broad write/publish/spend powers. Split capabilities into owned Hermes skills with reviewer defaults.
- Do not treat a status dropdown as publishing evidence. KDP/Google statuses need external IDs, upload notes, screenshots or reports where relevant, and reviewer evidence.
- Do not show writing-progress counts as commercial analytics. Store/ad/PiB report imports must be reconciled and labeled by confidence.
- Do not save large data URLs or full manuscripts in core records. Use storage-backed artifacts, Google Docs, client documents, or purpose-built version records.
- Do not expose internal research, risk notes, or unresolved rights issues in the portal. Portal surfaces should show only approved/client-visible records.

## Book Types To Support

The module should not be limited to children's books. It should define a structured taxonomy with format-specific gates.

### Story And Narrative

- Children's picture books.
- Early readers.
- Middle-grade chapter books.
- Young adult fiction.
- Adult fiction novels.
- Novellas.
- Short story collections.
- Serialized fiction.
- Poetry collections.
- Christian/faith fiction and devotionals.

### Visual And Sequential

- Comic books.
- Graphic novels.
- Manga-inspired books.
- Illustrated gift books.
- Photo books.

### Non-Fiction

- Business books.
- How-to guides.
- Memoirs.
- Biographies.
- Cookbooks.
- Educational books.
- Textbook/workbook hybrids.
- Local history or community books.
- Research-backed industry reports adapted into books.

### Activity And Utility

- Workbooks.
- Journals.
- Devotionals.
- Guided planners.
- Puzzle books.
- Coloring books.
- Word-search/crossword/sudoku collections.
- Low-content notebooks.

Important: Low-content books may be valid commercially, but they should be treated as a separate risk class because some platform features, ISBN needs, and series eligibility differ.

### Book-Type Gate Matrix

The taxonomy above should drive the workflow. Each project should choose a `bookTypeFamily` and inherit default production, file, rights, and review gates. The operator can add extra gates, but should not be able to remove mandatory gates without an approval record.

| Book family | Default production model | Required gates | Channel-specific warnings |
| --- | --- | --- | --- |
| **Narrative fiction, novellas, short stories, poetry** | Reflowable manuscript first, with EPUB as the primary ebook artifact and print PDF as a later edition. | Brief approval, outline approval, developmental edit, copyedit, proofread, metadata review, AI disclosure review. | KDP and Google metadata must accurately represent the book; avoid misleading subtitles, category stuffing, and claims that the book is part of a set if the set is not complete. |
| **Children's picture books and early readers** | Fixed-layout/page-spread model for illustrated editions; simple reflowable only when the book is mostly text. | Reading-level review, age-fit review, illustration/style bible, asset rights audit, bleed/margin check, proof review. | KDP fixed-layout guidance treats children's ebooks and comics as specialized formats with Guided View/panel behavior. The module should not assume a normal chapter EPUB is acceptable for picture-heavy children's books. |
| **Comics, graphic novels, manga, illustrated gift books** | Fixed-layout edition with page/panel records, high-resolution artwork, panel navigation metadata, and print-ready PDF package. | Panel/page continuity review, image quality review, asset rights audit, cover/wrap proof, fixed-layout validation. | KDP notes that graphic novels, manga, comics, and some children's ebooks are common fixed-layout cases, and recommends image quality suitable for high-resolution devices. These projects need their own file validator and cannot share the basic manuscript-only exporter. |
| **Business, how-to, memoir, biography, educational, local history, research-backed reports** | Structured long-form manuscript with source ledger, citations/notes where needed, and optional companion worksheets. | Fact-check, source review, claims review, permissions review for quotes/images, copyedit, proofread. | Non-fiction claims create reputation and liability risk for PiB. Unsupported claims should block publishing packets until removed, qualified, or linked to evidence. |
| **Cookbooks and instructional books** | Structured recipe/instruction records plus narrative manuscript. | Safety/common-sense review, ingredient/unit consistency, image rights audit, accessibility/print usability review. | The module should track units, ingredients, allergens or warnings when provided, and image provenance. It should not let a recipe/instruction book be treated as ordinary prose if users need precise steps. |
| **Workbooks, puzzle books, coloring books, pattern books, activity books** | Print/fixed-layout first. Each page is a usable activity, puzzle, worksheet, or colorable spread; ebook export is optional and channel-specific. | Page completeness, answer key where relevant, duplicate/repetition check, print usability check, DRM/printing setting review for Google, Kindle suitability review. | KDP's Kindle quality guide says puzzle books, blank journals, pattern books, coloring books, and facing-page translations are generally not suited to Kindle. Google says books meant to be written on, cut, or printed must allow printing by disabling DRM or they can be removed. |
| **Low-content journals, planners, notebooks, logbooks** | Print-only product family with template/interior generator, cover/wrap package, and metadata risk review. | Low-content classification review, ISBN option decision, duplication check, metadata honesty check, print proof. | KDP low-content books do not require ISBNs, are not eligible for free KDP ISBNs, do not support release dates, are not eligible for KDP series, and do not support Expanded Distribution. ISBN choice is locked after publication. |
| **Public-domain editions, translations, annotations, companion books, summaries, study guides** | High-risk rights workflow, not a normal generation workflow. Requires rights evidence before any outline or metadata work. | Rights proof, differentiation proof, territory review, title/description compliance, human legal/business approval. | KDP may require proof of public-domain status and only allows differentiated public-domain versions in specific ways. Google says public-domain books are no longer accepted except from select partners. KDP also restricts companion books based on copyrighted works, and the Kindle quality guide warns companion guides are generally not allowed except limited cases. |
| **Audiobooks and auto-narrated editions** | Separate audiobook edition linked to the ebook/print project, with narrator/source, audio files, cover, sample, and optional supplemental PDF. | Audio rights review, narration disclosure/provenance, audio quality check, cover check, channel eligibility review. | Google accepts audiobook files separately from ebooks and has duration, bitrate, format, cover, and supplemental PDF requirements. ACX/KDP Virtual Voice should be modeled as an audiobook channel adapter, not as a property of the text edition. |

Source-backed gate implications:

- KDP AI disclosure is mandatory for AI-generated text, images, or translations when publishing or republishing. AI-assisted brainstorming, editing, refinement, or checking does not require disclosure, but PiB should still track it internally for provenance. Source: [KDP content guidelines](https://kdp.amazon.com/en_US/help/topic/G200672390).
- KDP quality review can remove or investigate books with misleading metadata, duplicate/missing/wrong content, content not suited to Kindle, disappointing content, or companion-guide problems. Source: [Guide to Kindle Content Quality](https://kdp.amazon.com/en_US/help/topic/G200952510).
- KDP low-content rules affect ISBN, series, release date, Expanded Distribution, read sample, and transparency-code behavior. Source: [KDP low-content books](https://kdp.amazon.com/en_US/help/topic/GGE5T76TWKA85DJM).
- KDP public-domain publishing requires proof and differentiation when a free version exists, and formatting improvements, collections, price, sales rank, or freely available internet content do not count as differentiation. Source: [KDP public-domain content](https://kdp.amazon.com/en_US/help/topic/G200743940).
- Google Play Books prefers EPUB, also accepts PDF, requires complete files rather than sample excerpts, requires EPUBCheck validation for EPUB, expects at least four pages, limits files to under 2 GB, and uses identifier-specific filename rules for bulk/file matching. Source: [Google book file guidelines](https://support.google.com/books/partner/answer/3424254).
- Google publisher policies treat repetitive/low-utility content, misleading metadata, impersonation, technical defects, duplicate/non-exclusive deliveries, public-domain submissions, copyright, trademark, and content-safety issues as enforcement surfaces. Sources: [Google publisher program policies](https://support.google.com/books/partner/answer/166501), [Google publisher content policies](https://support.google.com/books/partner/answer/1067634).
- U.S. copyright registration is a separate rights risk from store disclosure. The Copyright Office requires human authorship; prompt-only AI output is not protected by copyright, while human selection, arrangement, and substantial modification may support a claim only for human-authored aspects. AI-generated material that is more than de minimis should be disclosed and excluded from the copyright claim. Source: [U.S. Copyright Office AI registration guidance](https://www.copyright.gov/ai/ai_policy_guidance.pdf).

Design implication: the Book Studio UI should never ask only "what genre is this?" It should ask what kind of product this is, then load a production gate profile. A low-content planner, a children's picture book, a Kindle novella, a public-domain annotated edition, and an audiobook need different artifact models, validators, approval gates, and analytics expectations.

## Core Module Capabilities

### 1. Book And Series Workspace

Entities:

- Book project.
- Book series.
- Edition/format.
- Manuscript version.
- Page/spread.
- Asset.
- Publishing channel listing.
- Launch campaign.
- Analytics import.
- Quality gate.

Series should track:

- Name, subtitle, description.
- Ordered vs unordered series.
- Main books vs related content.
- Volume numbers and gaps.
- Shared audience, genre, and promise.
- Shared style guide.
- Shared character bible or concept bible.
- Shared metadata rules.
- Shared launch calendar.
- Cross-book consistency notes.

### 2. Market And Niche Research

Use PiB Research as the source of truth.

Research templates should cover:

- Niche opportunity.
- Competing books.
- Bestseller positioning.
- Reader audience.
- Category and keyword fit.
- Pricing bands.
- Review mining.
- Content gaps.
- Series viability.
- Rights/copyright red flags.
- AI/disclosure sensitivity.

Research records should link to the book project and series. Generated recommendations can be promoted into tasks or documents.

### 3. Creative Brief And Editorial Plan

Every book should start with a structured brief:

- Book type.
- Audience and reading age.
- Category/genre.
- Core promise.
- Tone.
- Length/page count.
- Trim size candidates.
- Required formats.
- Author/imprint.
- AI usage plan.
- Source material.
- Competitor references.
- Quality bar.
- Publishing channels.
- Launch target date.

The brief should become a client document when approval is needed.

### 4. Manuscript Production

The writing workflow should support:

- Outline.
- Chapter/page plan.
- Drafting.
- Section rewrites.
- Continuity checks.
- Reading-level checks.
- Fact checks for non-fiction.
- Theological or specialist review where relevant.
- Plagiarism/similarity checks where available.
- Sensitivity and policy checks.
- Human editorial pass.
- Final proofread.

For illustrated or fixed-layout books, the module needs a page/spread model. For reflowable fiction/non-fiction, it needs a manuscript model with semantic structure.

The production model should store editable manuscript units and release snapshots separately. A section can move through drafting, internal review, client review, approval, and revision without mutating the already-approved manuscript version. Editorial passes, claim reviews, accessibility reviews, and generation runs should attach to the exact unit or version they reviewed.

### 5. Visual And Cover Production

Capabilities:

- Cover concept brief.
- Front cover.
- Full wrap cover for print with spine/back where page count and trim are known.
- Interior illustration prompts.
- Character/style consistency guide.
- Asset library.
- Rights/licensing metadata per asset.
- AI-generated asset disclosure tracking.
- Alt text and accessibility metadata.
- Review workflow for visual consistency and policy issues.

For V1, generated images should be saved as assets with provenance and review state, not silently embedded into final books.

### 6. Layout, Formatting, And Export

Required outputs:

- EPUB for reflowable ebooks.
- PDF interior for print/fixed-layout.
- Cover image for ebook.
- Full wrap PDF for paperback/hardcover where possible.
- Metadata packet.
- Channel checklist.
- AI disclosure packet.
- Proofing checklist.

The module should support at least two rendering paths:

- **Reflowable book renderer:** chapters/sections to EPUB and manuscript preview.
- **Fixed-layout renderer:** pages/spreads to print PDF and possibly fixed-layout EPUB later.

Every export should create or update a file package manifest. The renderer creates files, but the package validator decides whether those files are assembled, validated, previewed, approved, uploaded, superseded, or blocked.

Do not promise full KDP acceptance in-app. KDP Print Previewer and store review remain external gates.

### 7. Publishing Operations

V1 should track manual publishing with export packages:

- KDP eBook setup.
- KDP print setup.
- Google Play Books setup.
- Future channel slots for Apple/Kobo/D2D/IngramSpark.
- Publishing account profile and operating authority.
- Account identity, tax, payment, access, report, and territory readiness.
- ISBN decision.
- Imprint.
- Rights territory.
- DRM choice.
- Price per format/channel.
- Categories and keywords.
- Description.
- Contributor credits.
- AI content disclosure.
- Mature content flags.
- Upload status.
- Previewer status.
- Submitted.
- In review.
- Live.
- Blocked/rejected.
- Revision required.

Each channel listing should store external IDs such as ASIN, ISBN, Google identifier, product URL, status, and last checked date.

#### Publishing Packet Runbook

Every channel listing should generate a channel-specific Publishing Packet. This is the operator's source of truth for manual upload, review, and post-upload status. The packet should be a structured record plus a client-document view when client approval is required.

Core packet sections:

- **Book identity:** title, subtitle, contributors, publisher/imprint, language, audience, mature-content flags, book type family, edition type, and linked series.
- **Metadata proof:** cover/title/subtitle/author/series consistency check, description, keywords, categories/genres, audience/reading-age rules, and metadata-policy warnings.
- **Rights and disclosure:** rights owner, territories, public-domain/companion-work status, copyrighted-source dependencies, AI-generated-vs-assisted disclosure, translation disclosure, image rights, and approval evidence.
- **File package:** manuscript/interior artifact, cover artifact, EPUB/PDF/audio variant, validation/previewer result, file checksum, export version, and upload-ready filename.
- **Commercial setup:** channel, format, royalty model, list price, currency, KDP Select or exclusivity state, DRM/copy-print choice where supported, pre-order or release date, and payment/reporting notes.
- **Account readiness:** selected account profile, legal publisher/imprint owner, access model, identity/tax/payment/report/territory readiness, service-provider consent when relevant, and account-level blockers.
- **Manual upload evidence:** operator, upload timestamp, external account, screenshots or notes, external IDs, product URL, review state, blocker reason, and next action.
- **Approval state:** internal reviewer, client-visible reviewer if any, approval task ID, waiver IDs, and final release decision.

KDP packet fields should be split by format:

- **eBook:** title setup fields, contributors, description, keywords, up to three categories, primary audience, primary marketplace, AI disclosure, manuscript file, cover file, Kindle Online Previewer/quality-check result, rights/territories, price/royalty option, KDP Select decision, ASIN/product URL, and publication status.
- **Paperback/hardcover:** title setup fields, ISBN/imprint decision, print options, publication date, interior file, full-wrap cover file, Print Previewer result, proof-copy decision, price/royalty/printing-cost summary, ASIN/ISBN/product URL, and publication status.
- **Series:** KDP series eligibility, series name, series order, linked formats, public-domain/low-content exclusion warnings, and Amazon series page status.

KDP hard blockers:

- Metadata on title, subtitle, author name, series information, and ISBN does not match the uploaded manuscript/cover where KDP expects it.
- AI-generated text, images, or translations are present but disclosure is unset or contradicted by provenance.
- Paperback or hardcover ISBN/imprint does not match the registered ISBN/imprint decision.
- Categories or keywords are irrelevant, misleading, competitor-author-driven, promotional, or policy-sensitive.
- Print Previewer or Online Previewer has unresolved quality issues that affect customer experience.
- Public-domain, companion, low-content, children's, mature-content, or rights-sensitive flags do not have review evidence.
- KDP account readiness is missing, tax/identity/payment setup is incomplete, upload authority is undocumented, or the workflow depends on shared credentials.

KDP design sources: [Create a Book](https://kdp.amazon.com/help?topicId=G202172740), [Upload Book Resources](https://kdp.amazon.com/en_US/help/topic/G202175860), [Upload and Preview Book Content](https://kdp.amazon.com/en_US/help/topic/G200641240/), [Metadata Guidelines](https://kdp.amazon.com/help?topicId=G201953870), and [Content Guidelines](https://kdp.amazon.com/en_US/help/topic/G200672390).

Google Play Books packet fields:

- **Book metadata:** ISBN or Google identifier, title, contributors, language, genre, description, publisher/imprint, release date, series name, series relationship, and volume number.
- **Files:** EPUB artifact, PDF artifact, cover artifact, EpubCheck result for EPUB, PDF password/bookmark check, file size check, filename convention state for bulk/identifier-based upload, and full-book-not-sample confirmation.
- **Sales settings:** countries/territories, price/currency, DRM/copy-print choices, preview settings, pre-order/release behavior, payment profile, and tax/payment readiness.
- **Account setup:** Partner Center access model, user/access type or service-provider consent, payment/report access, collection code where applicable, and payment-profile linkage.
- **Series:** series name exact-match check, capitalization/punctuation check, whole-number volume check, no skipped/repeated numbers for ordered series, book type, and special type label such as box set, bundle, omnibus, or special edition when applicable.
- **Reporting setup:** expected report type, identifier mapping, earnings report timing, transaction report timing, preview traffic report mapping, and unmatched-row reconciliation rules.

Google hard blockers:

- Missing EPUB/PDF content file, invalid file type, password-protected PDF, incomplete split-file set, or EPUB not validated.
- Cover file missing or below required dimensions.
- Identifier mismatch between the book record and file naming where identifier-based upload is used.
- Series name, punctuation, capitalization, or volume numbers are inconsistent across books.
- Sales territories, payment profile, or pricing are incomplete.
- Partner Center access, service-provider consent, payment/report access, or account/collection-code mapping is missing where PiB is expected to operate or reconcile reports.
- Report identifiers cannot be mapped back to `bookProjectId`, `editionId`, and `channelListingId`.

Google design sources: [How to sell books on Google Play](https://support.google.com/books/partner/answer/1079107), [Book metadata and information](https://support.google.com/books/partner/answer/3237055), [Book file guidelines](https://support.google.com/books/partner/answer/3424254), [Get started with series](https://support.google.com/books/partner/answer/11069638), and [Report overview](https://support.google.com/books/partner/answer/9266485).

Recommended channel listing states:

| State | Meaning | Allowed next states |
| --- | --- | --- |
| `draft` | Listing exists but packet is incomplete. | `packet_ready`, `blocked`, `archived` |
| `packet_ready` | Required fields and files exist, but not yet approved for upload. | `approved_for_upload`, `blocked`, `draft` |
| `approved_for_upload` | Internal release approval passed. | `uploaded`, `blocked`, `packet_ready` |
| `uploaded` | Operator uploaded files/metadata externally and recorded evidence. | `in_review`, `revision_required`, `live`, `blocked` |
| `in_review` | Store/channel review is pending. | `live`, `revision_required`, `rejected`, `blocked` |
| `revision_required` | Channel or reviewer requested changes. | `packet_ready`, `uploaded`, `blocked` |
| `live` | Listing is publicly available and URL/external IDs are recorded. | `revision_required`, `archived` |
| `rejected` | Channel rejected the submission. | `packet_ready`, `blocked`, `archived` |
| `blocked` | PiB cannot proceed until a rights, file, policy, metadata, approval, or account issue is resolved. | `draft`, `packet_ready`, `archived` |
| `archived` | Listing is no longer active in PiB workflow. | none |

The app should require blocker notes and an owner whenever a listing enters `blocked`, `revision_required`, or `rejected`. The portal should show client-safe summaries only after an admin marks the blocker client-visible.

### 8. Analytics And Reporting

Analytics should combine:

- KDP orders, KENP reads, royalties, refunds, promotions, and payments.
- Google earnings, sales summary, transactions, and preview traffic.
- Amazon Ads and Amazon Attribution where available.
- PiB campaign analytics for launch pages, email, social, ads, and links.
- Manual royalty/import CSVs where APIs are missing or unsuitable.

Important design principle: separate **estimated**, **reported**, and **settled** money. KDP/Google/aggregators update at different times, and ad dashboards can disagree with royalty dashboards.

Source-backed constraints:

- KDP Reports expose dashboard estimates, orders, KENP reads, promotions, pre-orders, month-to-date, prior-month royalties, royalty estimator, and payments. KDP dashboard data can update at different cadences, KENP finalization can happen later, and estimated royalties can differ from actual payments. Sources: [KDP Reports](https://kdp.amazon.com/en_US/help/topic/G201723280), [KDP orders and payments](https://kdp.amazon.com/en_US/help/topic/GKEPUW32CTE6LFDA).
- Google Partner Center reports include earnings, sales summary, sales transaction, and Google Books preview traffic reports. Custom reports can export tab-separated files; sales and transaction records include refunds, countries, identifiers, list price, publisher revenue, payment amount, and currency conversion fields. Source: [Google Play Books reports](https://support.google.com/books/partner/answer/9266485).
- Amazon Attribution can be used by eligible KDP authors to measure non-Amazon ads and Amazon sales impact; KDP authors can access it through the advertising console or supported API integrations. Sources: [Amazon Attribution for KDP authors](https://advertising.amazon.com/resources/whats-new/amazon-attribution-kdp-authors), [Amazon Attribution overview](https://advertising.amazon.com/en-us/solutions/products/amazon-attribution/).
- Kobo Writing Life explicitly treats dashboard data as live estimates and points authors to monthly reports for definitive sales data. Promotions, discounts, refunds, credit memos, and Kobo Plus can make dashboard totals differ from final reports. Sources: [Kobo dashboard](https://kobowritinglife.zendesk.com/hc/en-us/articles/4412366365211-Understanding-Your-New-Dashboard), [Kobo FAQ](https://www.kobo.com/kobo-writing-life/blog/frequently-asked-questions).
- Draft2Digital partner payments can lag by store and format: ebook/audiobook payments commonly arrive after store payment windows, and print can lag longer. Source: [Draft2Digital FAQ](https://draft2digital.com/faq/).

Analytics model:

- **Estimated metrics:** near-real-time dashboards, royalty estimators, ad attribution dashboards, KENP estimates, Kobo dashboard estimates, and PiB launch funnel data.
- **Reported metrics:** downloaded/imported channel reports for orders, transactions, reads, refunds, preview traffic, attribution, and ad spend.
- **Settled metrics:** payment reports, monthly earnings reports, credit memos, tax/withholding notes, and actual payment receipts.
- **PiB-owned metrics:** landing-page visits, UTM clicks, campaign source, email opens/clicks, short-link events, social campaign posts, ad set spend, and client approval timeline.
- **Derived metrics:** net units, net royalties, contribution margin, cost per purchase, cost per attributed sale, ROAS by confidence level, KENP royalty estimate vs finalized royalty, refund rate, review velocity, series sell-through, launch-to-first-sale time, and production cost recovery.

Analytics ingestion should use a ledger pattern:

- Store every import as an immutable `book_analytics_imports` record with source, channel, period, importedBy, importedAt, file checksum, parser version, currency, and confidence.
- Normalize rows into `book_analytics_events` or equivalent snapshots without deleting the raw import evidence.
- Link each row to `bookProjectId`, `seriesId`, `editionId`, `channelListingId`, and external identifiers where possible.
- Keep unmatched rows in a reconciliation queue rather than dropping them.
- Allow superseding/re-importing a period, but preserve the previous import and mark the new import as the current source of truth.
- Separate accounting currency from purchase/list-price currency and record conversion rate when the report provides it.
- Mark source confidence explicitly: `dashboard_estimate`, `channel_report`, `payment_report`, `ad_attribution`, `pib_tracking`, or `manual_adjustment`.

Reconciliation workflow:

1. Import or manually record source data.
2. Parse and validate expected columns for the channel/report type.
3. Match rows to book, series, edition, format, and listing.
4. Flag missing identifiers, unknown titles, unexpected currencies, negative/refund rows, and duplicate rows.
5. Produce a reconciliation summary: new rows, changed rows, unmatched rows, total estimated, total reported, total settled, and confidence.
6. Update dashboard snapshots only after validation.
7. Create Project/Kanban tasks for unresolved mismatches when money, attribution, or channel status is materially affected.

Dashboard views:

- Book performance.
- Series performance.
- Channel comparison.
- Format comparison.
- Launch funnel.
- Ad spend vs attributed sales.
- Reads vs sales.
- Refunds.
- Royalties by period.
- Publishing blockers.
- Quality/review status.
- Import/reconciliation queue.
- Production cost recovery.
- Series sell-through.
- Attribution confidence.

The dashboard should never present dashboard estimates as settled revenue. It should label the source and confidence of every money number.

### 9. Commercial Pricing And Margin Model

Book Studio should treat pricing as an operational model with evidence, not as a single `price` field. A client can approve a beautiful book that is commercially weak if print costs, delivery fees, refunds, currency conversion, KDP Select exclusivity, payment lag, and ad spend are not visible before launch.

Source-backed commercial constraints:

- KDP eBooks have two royalty choices. The 35% option is calculated from list price excluding VAT, while the 70% option subtracts delivery costs and applies only in eligible territories; Brazil, Japan, Mexico, and India require KDP Select for 70% eligibility when other requirements are met. Public-domain eBooks are not eligible for the 70% option. Sources: [KDP Digital Book Pricing Page](https://kdp.amazon.com/en_US/help/topic/G200634500), [KDP Price Your Book](https://kdp.amazon.com/en_US/help/topic/G200641280).
- KDP paperback royalties are now 50% or 60% on Amazon distribution depending on list-price thresholds by marketplace, then printing costs are subtracted. Expanded Distribution uses 40% of list price minus printing costs and has slower reporting/payment timing. Source: [KDP Paperback Royalty](https://kdp.amazon.com/en_US/help/topic/G201834330).
- KDP hardcover royalties are 60% of list price minus printing costs, and printing costs depend on page count, ink type, and marketplace. Source: [KDP Hardcover Pricing and Royalties](https://kdp.amazon.com/en_US/help/topic/GTTMJWM4H3BLQA9A).
- KDP print pricing uses fixed cost plus page-count multiplied by per-page cost, rounds calculations by currency, and pays print royalties about 60 days after standard Amazon distribution sales or about 90 days after Expanded Distribution sales. Source: [KDP Print Book Pricing Page](https://kdp.amazon.com/en_US/help/topic/G8BKPU9AGVZSF9QF).
- KDP Select is a 90-day Kindle eBook-only program. It adds Kindle Unlimited and promotion eligibility but requires the Kindle eBook to be exclusive to the Kindle Store during the enrollment period; print, video, audio, and other formats can still be distributed elsewhere. Source: [KDP Select enrollment](https://kdp.amazon.com/help/topic/GD9PMU58BV24QFZ7).
- Google Play Books has no cost to sell books through Google Play, bases revenue share on the publisher-provided list price, and requires file/settings/DRM/country/list-price setup in Partner Center. Source: [How to sell books on Google Play](https://support.google.com/books/partner/answer/1079107).
- Google Play Books offers a 70% ebook revenue split in most supported countries for partners who accepted the updated 2019 Terms of Service; default split can be 52% for older terms or certain countries, and the effective split should be checked per book in Partner Center. Source: [Google Play Books Revenue Split FAQs](https://support.google.com/books/partner/answer/9331459).
- Google price setup requires each book to have a price and account-level payment settings, supports currency conversion and country-specific/fixed-price-law settings, and allows effective dates for price changes. Sources: [Google book prices](https://support.google.com/books/partner/answer/3238849), [Google sales territories](https://support.google.com/books/partner/answer/3157463).
- Google requires a payment profile before selling books; the profile country determines payment currency, and multiple profiles can be used for different bank accounts. Source: [Google payment profile setup](https://support.google.com/books/partner/answer/4490848).
- Google reports expose monthly earnings, sales summary, transaction, refund, revenue percentage, publisher revenue, payment amount, currency conversion, and preview-traffic fields. Source: [Google report overview](https://support.google.com/books/partner/answer/9266485).

Commercial records should separate:

- **Price plan:** target channel, format, marketplace/territory, list price, currency, tax-included flag, fixed-price-law flag, price effective window, royalty/revenue-share option, KDP Select state, DRM/copy-print choice, and approval status.
- **Cost model:** KDP delivery cost estimate for eBooks, print cost estimate for paperback/hardcover, file-size estimate, page count, ink type, trim family, cover/interior package, ISBN/imprint cost, human production cost, Hermes/generation cost, cover/art/audio cost, ads/launch budget, and miscellaneous platform/vendor fees.
- **Revenue expectation:** estimated royalty per unit, estimated publisher revenue share, expected refunds/returns, expected ad-attributed sales, expected KENP/read revenue if KDP Select, expected settlement window, and confidence label.
- **Actual ledger:** report-import rows, payment rows, refunds/returns, ad spend, production cost entries, manual adjustments, exchange rates, and reconciliation state.
- **Decision evidence:** pricing calculator screenshot/file, Partner Center effective-price evidence, KDP pricing-grid evidence, approval document, owner, reviewer, and last checked timestamp.

Recommended derived metrics:

- `grossListRevenue`: units times list price, never treated as publisher income.
- `channelGrossRevenue`: channel-reported sale value before publisher share where available.
- `estimatedPublisherRevenue`: royalty/revenue-share estimate before settlement.
- `reportedPublisherRevenue`: imported sales/transaction report revenue.
- `settledPublisherRevenue`: payment or earnings report revenue.
- `directUnitCost`: delivery cost, print cost, platform fees, and return/refund adjustments where known.
- `productionCost`: PiB/internal time, Hermes task cost, editing, artwork, ISBN/imprint, narration, file validation, and outside vendors.
- `launchCost`: ads, email/social promotion, landing pages, influencer/review activity, and paid assets.
- `contributionMargin`: settled or reported publisher revenue minus direct unit cost and launch cost.
- `costRecovery`: settled or reported publisher revenue minus production cost and launch cost.
- `marginConfidence`: `estimate`, `reported`, `settled`, or `reconciled`.

Pricing governance:

- No price or royalty/revenue-share recommendation should be treated as approved until a human reviewer approves the pricing plan.
- No KDP Select enrollment should be approved if the ebook is also planned for Google/Apple/Kobo/D2D during the same 90-day period.
- No print book should be approved for launch until the packet shows a positive per-unit margin at the selected list price or records an explicit loss-leader waiver.
- No illustrated/comic/picture-heavy ebook should use the 70% KDP royalty option blindly; the delivery-cost estimate can make 35% economically better.
- No ad launch budget should be approved until the dashboard can show break-even units, expected refund drag, and the confidence level of attributed sales.
- No client-facing dashboard should show "profit" unless production cost, launch cost, refunds, and settled/reported royalty source are clear.

The devil's-advocate position is that many book projects are vanity projects unless the economics are visible. Book Studio should make the weak-margin case obvious early: low-content books under print royalty thresholds, color-heavy workbooks, illustrated children's books, broad-distribution paperbacks with returns, and paid-ad launches without reviews can all look attractive creatively while failing commercially.

### 10. Rights, Provenance, And Version Governance

Book Studio needs a rights and provenance ledger from day one. This is separate from store metadata and separate from editorial status. Store disclosure, copyright registration, client approval, and internal risk are related but not interchangeable.

Source-backed constraints:

- KDP requires publishers to disclose AI-generated text, images, or translations when publishing or republishing, but does not require disclosure for AI-assisted work such as brainstorming, editing, refinement, or checking. KDP also says the publisher remains responsible for verifying AI-generated or AI-assisted content against content guidelines and intellectual-property rights. Source: [KDP content guidelines](https://kdp.amazon.com/en_US/help/topic/G200672390).
- U.S. Copyright Office guidance says copyright protects human-authored contributions, not material where the traditional elements of authorship were produced by a machine. If AI-generated material is more than de minimis, applicants should disclose it and exclude that material from the claim while identifying the human-authored contribution. Source: [U.S. Copyright Office AI registration guidance](https://www.copyright.gov/ai/ai_policy_guidance.pdf).
- The Copyright Office's 2025 AI report page confirms the office is continuing to treat copyrightability as a human-authorship analysis and is maintaining AI-specific registration guidance and decisions. Source: [U.S. Copyright Office AI initiative](https://www.copyright.gov/ai/).
- Google Play Books can disapprove an account if it cannot confirm that the account is authorized to upload the content, and it may disable preview while reviewing potential policy violations. Source: [Google Play Books content policies](https://support.google.com/books/partner/answer/1067634).
- Google publisher program policies make copy/paste, printing, DRM, refund, content-policy, revenue-share, and report fields part of the operational evidence for books on sale. For workbook/activity content, Google requires DRM to be disabled when physical-page use is needed so users can print. Source: [Google Play Books publisher program policies](https://support.google.com/books/partner/answer/166501).

The module should track provenance at four levels:

- **Project provenance:** creator/client brief, original idea owner, source Research IDs, client-provided materials, rights owner, imprint/publisher identity, and intended copyright-registration posture.
- **Version provenance:** outline/manuscript/proof version, human authors/editors, Hermes tasks, AI tools used, prompts or prompt summaries where retention is safe, model/vendor, generated-vs-assisted classification, and human modification summary.
- **Asset provenance:** cover, illustration, photo, icon, template, font, audio, puzzle/workbook file, source URL/file, creator, license, terms, expiration, attribution requirement, derivative-work warning, and approved-use scope.
- **Channel provenance:** AI disclosure answers, copyright/public-domain/companion evidence, territory rights, DRM/copy-print settings, ISBN/imprint source, price/royalty evidence, manual upload evidence, review notes, and live URL.

Recommended governance records:

- `book_provenance_events`: immutable timeline of generation, edit, import, approval, waiver, export, upload, and report-import actions. It should store actor, source object, target object, event type, summary, risk level, and evidence links.
- `book_version_manifests`: per manuscript/proof/export version, listing sections/pages, artifacts, checksums, Hermes tasks, human contributors, AI usage classification, release status, and replacement lineage.
- `book_rights_reviews`: review state for copyrighted source material, public-domain claims, companion/summary projects, image/audio/font licenses, AI disclosure posture, copyright-registration posture, territory rights, and blocker/waiver state.
- `book_asset_rights`: asset-level license/provenance metadata linked to `workspace_artifacts`, not duplicated as large blobs inside book records.

Required gate behavior:

- A publishing packet cannot be marked `packet_ready` unless every included manuscript version and asset has a provenance record.
- A KDP packet cannot be marked `approved_for_upload` unless AI-generated-vs-assisted answers are explicit for text, images, and translation.
- A copyright-registration-ready state cannot be shown unless human-authored contributions and excluded AI-generated material are described separately.
- A public-domain or companion project cannot enter production without rights/differentiation evidence and a human approval task.
- A Google workbook/activity packet cannot be approved while DRM/printing settings conflict with the book's physical-page use.
- A client-visible proof cannot hide unresolved internal rights blockers; either resolve the blocker or expose a client-safe blocker summary before asking for approval.

Versioning rules:

- Treat outlines, manuscript sections, page/spread proofs, cover concepts, final interiors, EPUB/PDF packages, and publishing packets as versioned artifacts.
- Store large text and files in client documents, Google Docs, storage-backed artifacts, or export packages. Core book records store references, checksums, summaries, and state.
- Do not overwrite a previously approved version. Supersede it with a new version and preserve the approval history.
- Every export package should include a manifest with file names, checksums, version IDs, source artifacts, validation results, disclosure state, and manual upload instructions.

Devil's advocate: provenance work feels heavy until the first store review, rights complaint, AI disclosure mistake, or client dispute. The module should make provenance capture routine and low-friction so operators are not reconstructing who created what after a book is already live.

### 11. Export, Validation, And File Package Model

Book Studio should treat every upload-ready file set as a versioned package with a manifest, not as an informal folder of exports. This is where many book projects fail: the manuscript can be approved, the cover can look good, and the metadata can read well, while the actual EPUB, print interior, full-wrap cover, or audiobook bundle still fails store processing or manual review.

Source-backed constraints:

- KDP eBook uploads should be tested in Kindle Previewer or KDP Online Previewer. KDP's Online Previewer can surface quality issues, but books still go through the regular publishing review process. For fixed-layout books with Guided View or interactive textbook features, Amazon points authors to Kindle Create previewer or Kindle Previewer rather than relying only on Online Previewer. Source: [KDP upload and preview book content](https://kdp.amazon.com/en_US/help/topic/G200641240/).
- KDP reflowable eBook uploads should now use EPUB, KPF, or DOC/DOCX; Amazon no longer accepts MOBI for new or updated fixed-layout eBooks from March 18, 2025. KDP accepts EPUB 2.0 and 3.0 when files meet Kindle Publishing Guidelines. Source: [KDP MOBI support FAQ](https://kdp.amazon.com/en_US/help/topic/GULSQMHU5MNH4EZM).
- KDP print files have strict requirements around bleed, page size, margins, cover PDF dimensions, embedded fonts/images, flattened transparency/layers, file size, unsupported filename characters, no crop marks/comments/metadata, and 300 DPI images. Source: [KDP paperback submission guidelines](https://kdp.amazon.com/en_US/help/topic/G201857950).
- KDP print preview is an external gate. Print Previewer checks paperback/hardcover files for issues before submission, and Amazon manually checks interior and cover files after submission. Source: [KDP upload and preview book content](https://kdp.amazon.com/en_US/help/topic/G200641240/).
- KDP trim, bleed, and margins depend on book size, bleed state, and page count; if one interior page requires bleed, the whole interior file should be set up with bleed. Source: [KDP trim, bleed, and margins](https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6/).
- Google Play Books accepts ebook content as EPUB or PDF, recommends providing both, rejects DOC/HTML and other file types, requires complete books rather than sample excerpts, requires files under 2 GB, requires cover dimensions, blocks password-protected PDFs, and requires EPUB files to be validated by EpubCheck. Source: [Google book file guidelines](https://support.google.com/books/partner/answer/3424254).
- EPUBCheck is the official conformance checker for EPUB publications. Source: [W3C EPUBCheck](https://w3c.github.io/epubcheck/docs/).
- Kindle Create comic/kids workflows can import PDF, PNG, or JPEG page files, add Guided View panels, save editable KCB projects, and export publishable KPF files. The KCB source project should be preserved for future updates; KPF is the publishing file. Source: [KDP Prepare Comic and Kids' eBooks with Kindle Create](https://kdp.amazon.com/en_US/help/topic/GJMRD9F78MS9F43R).

Package types:

| Package type | Primary use | Required files | Validation/evidence |
| --- | --- | --- | --- |
| `source_archive` | Preserve editable source inputs for future revisions. | Google Doc export, DOCX, InDesign/Affinity/Sigil source, Kindle Create KCB, layered artwork, source images, font/license notes. | Checksums, rights/provenance links, source app/version notes, visibility restrictions. |
| `kdp_ebook_reflowable` | KDP Kindle eBook for fiction/nonfiction text-first books. | EPUB, KPF, or DOCX; ebook cover image; metadata packet. | EPUBCheck when EPUB is used, Kindle Previewer/Online Previewer evidence, AI disclosure state, quality issue notes. |
| `kdp_ebook_fixed_layout` | Children's, comic, manga, graphic, image-heavy, or interactive Kindle projects. | KPF or fixed-layout EPUB; page images/PDF source; cover; Guided View or panel metadata when relevant. | Kindle Create/Previewer evidence, panel/page order check, image quality check, source KCB preservation. |
| `kdp_print_paperback` | Paperback edition. | PDF interior or accepted manuscript file; full-wrap cover PDF; print options; barcode/ISBN decision. | Page-count/trim/bleed/margin checks, cover size formula/template evidence, embedded-font/image check, Print Previewer evidence. |
| `kdp_print_hardcover` | Hardcover edition. | PDF interior or accepted manuscript file; full-wrap cover PDF; hardcover print options; ISBN/imprint decision. | Same as print paperback plus hardcover trim/page-count eligibility checks. |
| `google_ebook` | Google Play Books ebook listing. | EPUB and/or PDF, cover file, metadata/price/territory packet. | EpubCheck result, PDF password/bookmark/full-book check, under-2GB check, identifier filename check when bulk/identifier upload is used. |
| `audiobook_package` | Google audiobook, ACX, Virtual Voice, or future audio channel. | Audio files or zip, square cover, sample where required, supplemental PDF if used, narrator/source notes. | Audio rights/provenance, format/bitrate/duration checks per channel, cover check, narration disclosure. |
| `metadata_only_packet` | Early publishing readiness before final files exist. | Metadata, price plan, disclosure answers, ISBN/imprint choice, territory plan, checklist. | Cannot become `approved_for_upload`; used only for review and planning. |

Recommended package state machine:

| State | Meaning | Gate behavior |
| --- | --- | --- |
| `draft` | Package record exists but files or source versions are incomplete. | Cannot be attached to `packet_ready`. |
| `assembled` | Files have been exported/attached and manifest is complete. | Can enter validation. |
| `validated` | Automated/static checks passed or warnings are recorded with owner. | Can enter preview/proof workflow. |
| `previewed` | External preview evidence exists: Kindle Previewer, KDP Online Previewer, Print Previewer, physical proof, Google file check, or equivalent. | Can be considered for upload approval. |
| `approved_for_upload` | Internal reviewer approved this exact package version for a specific channel listing. | Can be uploaded manually; any file/checksum change invalidates approval. |
| `uploaded` | Operator uploaded the package externally and recorded evidence. | Channel listing can move to review/live tracking. |
| `superseded` | A newer package replaces this one. | Cannot be uploaded unless explicitly restored through approval. |
| `blocked` | File, validation, preview, rights, metadata, or channel issue prevents progress. | Requires blocker owner, evidence, and next action. |

Manifest rules:

- Every package stores `bookProjectId`, `editionId`, optional `channelListingId`, `packageType`, `state`, `manifestVersion`, source version IDs, source artifact IDs, file roles, filenames, MIME types, sizes, SHA-256 checksums, generated/exported timestamps, and the export tool/version where known.
- Every package stores validation results as structured records with `validatorKey`, `validatorVersion`, `scope`, `status`, `severity`, `checkedAt`, `summary`, `reportArtifactId`, and `blockingIssueIds`.
- Every package stores preview/proof evidence separately from automated validation. KDP/Google acceptance cannot be inferred from EPUBCheck or a local PDF check alone.
- Every package stores upload instructions for the operator: channel, account/context, exact file roles, upload order, filenames, fields to copy, expected preview steps, and where to record screenshots or notes.
- Every package stores disclosure and rights snapshots: AI-generated text/images/translation answers, rights review IDs, asset-rights IDs, territory rights, ISBN/imprint choice, DRM/copy-print decision where relevant, and client approval IDs where applicable.
- Large files remain in workspace artifacts, Google Drive, storage-backed exports, or external source folders. Firestore stores manifests, checksums, state, and references only.

Validator layers:

- **Static manifest validation:** required file roles are present, checksums exist, source versions are current, filenames are upload-safe, file sizes are within channel limits, and the package references approved rights/provenance records.
- **Format validation:** EPUBCheck for EPUB; PDF preflight checks for encrypted/password-protected PDFs, page count, page box size, embedded fonts, image resolution evidence, and KDP/Google-specific file roles; audio checks for duration, format, bitrate/sample-rate evidence where a channel requires it.
- **Channel validation:** KDP packet check, Google packet check, series/identifier consistency, pricing/exclusivity conflict check, AI disclosure check, rights/territory check, and manual-upload checklist.
- **Preview/proof validation:** KDP Online Previewer/Kindle Previewer evidence for ebooks, KDP Print Previewer and optional physical proof evidence for print, Google upload/file processing notes, or a recorded waiver when a preview step is unavailable.
- **Human release validation:** Quinn/operator approval for `approved_for_upload`, with exact package ID and checksum list in the approval task.

Package approval must be checksum-bound. If any included file changes, the package should move out of `approved_for_upload` and require revalidation. If only metadata changes, the affected channel listing should record whether the existing package approval still applies.

Devil's advocate: PiB can build impressive manuscript and image workflows and still lose trust if file packaging is casual. A package that "opens on my machine" is not a store-ready package. The module should make final file proof boring, repeatable, and auditable, with every exception visible before a client or channel sees the book.

### 12. Client Portal Surface

Portal access should be module-gated like Mobile Apps:

- Portal nav item visible only when enabled.
- Portal API blocked when disabled.
- Clients can view approved book projects, briefs, drafts, cover options, proofs, and launch status.
- Clients can comment, approve, request changes, or accept publishing packets depending on permissions.
- Clients should not directly trigger publishing, paid ads, or public release without approval gates.

### 13. Publisher Account, Access, And Operating Authority

Book Studio needs an account-governance layer before any upload-ready package can be treated as operationally ready. The publishing account is not just a login. It controls legal identity, payment destination, tax posture, territories, reports, account-level permissions, and who can make irreversible public changes.

Current source-backed constraints:

- KDP account setup requires author/publisher information, payment information, tax information, and sometimes identity verification. KDP warns not to enter a pen name in account details because payments and tax forms use the legal account name. Source: [KDP account setup](https://kdp.amazon.com/en_US/help/topic/G202187760) and [Create a KDP Account](https://kdp.amazon.com/en_US/help/topic/G200620010).
- KDP account management stores personal, tax, and financial information in the account. Amazon says tax identity must be received and validated before updating or publishing books in the Kindle store, and KDP does not recommend multiple people sharing the same login credentials. Source: [Manage Your KDP Account](https://kdp.amazon.com/en_US/help/topic/G200634350).
- KDP may require identity verification during setup or later; publishing features can be restricted until verification is completed. Source: [Verify your identity](https://kdp.amazon.com/en_US/help/topic/GH7TYHP6FR9QAUM9).
- KDP explicitly says it will not ask for Amazon passwords or full bank details outside Amazon/KDP/Author Central, and recommends two-step verification and strong unique passwords. Source: [KDP account security and avoiding scams](https://kdp.amazon.com/en_US/help/topic/GWAJ6TKCFEA6D8SL).
- Google Play Books Partner Center supports additional users with separate credentials and access types for Book Catalog, Analytics and Reports, Payment Center, and Administrative Access. Payment Center access includes bank account information and earnings reports, which are the report type to use for financial reconciliation. Source: [Manage additional Partner Center users](https://support.google.com/books/partner/answer/3157480?hl=en).
- Google supports Client Service Provider workflows. Service providers can access client accounts, need Publisher Consent Form approval for payments and reports, and client collection codes identify books for a client or imprint. Source: [Google Play Books service providers](https://support.google.com/books/partner/answer/3323299?hl=en).
- Google sales territories must be linked to payment profiles, cannot overlap except for `WORLD` exclusions, should exclude countries where the publisher lacks rights, and require both an active territory and price for the book to sell. Source: [Google sales territories](https://support.google.com/books/partner/answer/3157463?hl=en).

PiB design implication: Book Studio should record account readiness and operating authority, but it should not store passwords, bank account numbers, tax IDs, full identity documents, or raw payment credentials. Sensitive account setup stays inside KDP, Google Partner Center, or the client's secure systems. PiB stores status, owner, access model, evidence artifacts, expiry/recheck dates, and approval tasks.

Account operating models:

| Model | Use when | PiB behavior |
| --- | --- | --- |
| `client_owned_manual_handoff` | Client owns the KDP/Google account and does not grant PiB direct access. | PiB prepares files/metadata/instructions; client uploads or screenshares; PiB records evidence and status only after client confirmation. |
| `client_owned_pib_assisted` | Client owns the account but invites PiB users where the platform supports it. | Google can use user/access-type or service-provider patterns; KDP should avoid shared credentials and may require live client participation for 2FA/account steps. |
| `pib_owned_imprint` | PiB publishes under a PiB-owned imprint or account by explicit commercial agreement. | Requires legal/commercial approval, rights assignment or license evidence, payment/revenue-share model, imprint disclosure, and stronger internal approval gates. |
| `aggregator_or_provider` | A distributor/service-provider account routes work to downstream stores. | Store provider name, client collection/imprint code, downstream channel map, report access state, and duplicate-distribution conflicts. |

Account readiness gates:

- **Identity and legal owner:** account owner, legal publisher name, imprint/pen-name separation, authorized representative, and whether identity verification is complete or pending.
- **Payment and tax:** payment profile/bank setup status, tax profile status, report access status, payment profile/territory linkage, and evidence that the client or authorized owner completed sensitive setup outside PiB.
- **Access and security:** access model, named PiB operators, two-step/credential constraints, Google access types, service-provider consent, and no shared-password storage.
- **Territory and rights alignment:** channel sales territories, country exclusions, fixed-price-law flags, rights territory map, and payment profile linkage.
- **Report access:** whether PiB can download KDP/Google reports, whether earnings reports are available for reconciliation, and who must supply missing reports.
- **Account-level blockers:** unverified identity, incomplete tax profile, missing payment profile, missing Google territory, no report access, duplicate account conflicts, platform review holds, or client has not granted operating authority.

Channel listings, publishing packets, and file packages should reference an account profile. `approved_for_upload` is blocked when the selected channel account profile is missing, stale, has unresolved account-level blockers, or lacks the operating authority needed for the planned upload. For KDP especially, PiB should assume the operator may need the client/account owner present for account-sensitive steps unless there is a documented, permitted access method.

Devil's advocate: the easiest operational shortcut is to ask a client for a KDP password or to publish under whichever account is convenient. That creates security, tax, payment, rights, and ownership risk. Book Studio should make this friction visible early: a strong book is not publishable if the account owner, tax profile, payment profile, territories, and upload authority are unresolved.

### 14. Hermes Generation Run Runtime And Safety Governance

Book Studio needs a generation-run ledger before any long manuscript, image, layout, validation, or analytics job can become reliable. A Project/Kanban task is the orchestration and review surface; a generation run is the durable execution record that proves what was requested, which model/tool ran, what sources were allowed, what it cost, what safety checks fired, what artifacts were produced, and whether the output is still current.

Current source-backed constraints:

- OpenAI's moderation endpoint can classify text and image inputs, returns per-category flags/scores, and the docs warn that score-based custom policies may need recalibration as the moderation model changes. Source: [OpenAI moderation guide](https://platform.openai.com/docs/guides/moderation).
- OpenAI Batch API is intended for asynchronous work that does not need immediate responses, offers a separate high-throughput/cost-discounted path, has a 24-hour completion window, writes outputs/errors to files, and says output order is not guaranteed so callers should map results by `custom_id`. Source: [OpenAI Batch API](https://platform.openai.com/docs/guides/batch).
- OpenAI background mode exists for long-running model responses and is polled asynchronously, but response data is retained briefly for polling and is not compatible with Zero Data Retention guarantees. Source: [OpenAI background mode](https://platform.openai.com/docs/guides/background).
- Gemini safety settings are configurable per request across harassment, hate speech, sexually explicit, and dangerous content; built-in child-safety protections cannot be adjusted; safety feedback can appear on prompt and candidate responses. Source: [Gemini safety settings](https://ai.google.dev/gemini-api/docs/safety-settings).
- Gemini Batch API supports inline or JSONL/file-backed batch jobs, asynchronous status polling, cancellation/deletion, and terminal states such as succeeded, failed, cancelled, and expired. Source: [Gemini Batch API](https://ai.google.dev/gemini-api/docs/batch-api).

PiB design implication: Book Studio should not call a model directly from a route or browser interaction and then write the result into a manuscript. It should create a `BookGenerationRun`, attach it to the Project/Kanban task, record the approved source set and budget, execute through a Hermes skill or approved backend worker, then expose only reviewed artifacts.

Run governance rules:

- **One active run per target by default:** only one active run may target the same manuscript section, page/spread, cover concept, package, or analytics import unless the operator explicitly creates a branch. Newer runs supersede older draft output rather than overwriting approved versions.
- **Idempotency required:** every run stores an idempotency key derived from org, book, target scope, skill key, source manifest, prompt spec version, and requested output type. Retries reuse the same run unless the source or prompt contract changes.
- **Prompt/input manifest:** store approved source IDs, prompt spec version, prompt summary, model/provider, parameters, tool/skill version, policy profile, budget, and retained prompt only when safe. Do not store raw secrets, full client private documents, API keys, account credentials, or unnecessarily large manuscript blobs in the run record.
- **Budget controls:** runs carry token, image, audio, page, request, time, and money budgets. Repeated retries, high-cost models, large batches, or budget overruns create an approval/blocker task instead of continuing automatically.
- **Safety preflight and postflight:** risky prompts and produced outputs get moderation/safety review before becoming client-visible or publishing-facing. A failed or inconclusive safety review creates a blocker and stores the category, provider feedback, reviewer, and required next action.
- **Rights and derivative-risk hooks:** safety review is not enough. Runs that generate manuscript, image, cover, translation, public-domain, companion, or children's content must link to rights/provenance gates before approval.
- **Recoverable execution:** queued, running, failed, cancelled, blocked, and expired states are first-class. Operators can retry, cancel, branch, or supersede a run, but each action creates provenance.
- **No unreviewed publish path:** a completed run creates draft artifacts, version manifests, reports, or task output only. It cannot mark a publishing packet ready, approve a channel listing, message a client, upload files, or spend money without separate approval evidence.

The ledger should make model/provider details useful without making PiB dependent on one provider. OpenAI background or batch jobs, Gemini batch jobs, a local validation worker, or Hermes-side synthesis all become external execution backends behind one PiB run record.

Devil's advocate: without this layer, the Book Studio module will feel fast in demos and become brittle in production. A stale run can overwrite a better draft, a failed safety check can disappear into a chat transcript, a model bill can grow invisibly, a prompt can use the wrong source packet, and a reviewer will not be able to prove which exact output was approved.

### 15. Manuscript, Editorial, And Accessibility Production Model

Book Studio also needs a manuscript production ledger. A book is not one blob of generated text; it is a structured publication with front matter, body matter, back matter, sections, pages or spreads, navigation, citations, assets, accessibility notes, editorial passes, and client-safe review packets.

Current source-backed constraints:

- EPUB 3.3 defines EPUB publications through package documents, navigation documents, EPUB content documents, fixed layouts, media overlays, and container rules. Source: [W3C EPUB 3.3](https://www.w3.org/publishing/epub3/).
- EPUB Accessibility 1.1 defines accessibility conformance and discoverability requirements, including accessibility metadata, evaluation/certification information, and re-evaluation after changes. Source: [W3C EPUB Accessibility 1.1](https://www.w3.org/TR/epub-a11y-11/).
- Google Play Books recommends submitting both PDF and EPUB where relevant, prefers EPUB 3.3, warns that not all EPUB 3 features are supported, supports the `toc nav` rendering path, recommends EPUBCheck validation, and advises fixed-layout review in Web Reader/tablet before going live. Source: [Google EPUB files](https://support.google.com/books/partner/answer/3316879).
- KDP's quality guide flags broken or misleading links, TOC problems, unlinked footnotes, missing logical TOC, confusing hyperlinks, inaccessible tables, and poor reader experience as quality issues that can trigger action. Source: [KDP Kindle Content Quality](https://kdp.amazon.com/en_US/help/topic/G200952510).
- KDP's TOC guidance expects a working table of contents and styled chapter headings for a good ebook navigation experience. Source: [KDP Create a Table of Contents](https://kdp.amazon.com/en_US/help/topic/G201605700).

Design implication: Book Studio should model manuscript structure separately from manuscript versions. Sections/pages are editable units; versions are release snapshots. Hermes can draft or edit a unit, but a version manifest decides which units, assets, editorial passes, rights reviews, accessibility checks, and generation runs are included in an approved manuscript or proof.

Production rules:

- **Structured units, not blobs:** store front matter, chapters, sections, pages/spreads, captions, exercises, answer keys, glossary entries, references, and back matter as addressable units with order, parent/child relationships, and target format hints.
- **Version snapshots:** an approved manuscript/proof is a manifest over unit revisions and artifacts. Editing a section after approval creates a new draft revision and cannot silently mutate the approved manifest.
- **Navigation is a gate:** each exportable version records TOC inclusion, navigation label, EPUB semantic type where known, reading order, footnote/reference link state, and start-of-content/body-matter marker.
- **Editorial passes are first-class:** developmental edit, copyedit, proofread, fact check, reading-level review, accessibility review, link/TOC review, and specialist review each create pass records with scope, findings, blockers, reviewer, and output artifacts.
- **Claims and citations:** non-fiction, instructional, local history, business, health/legal/financial, public-domain/companion, and education projects need a claim ledger. Unsupported, disputed, stale, or uncited claims block client-visible publishing packets unless waived by an approval task.
- **Accessibility metadata:** image alt text, reading order, table usability, captions, audio/video alternatives, language direction, accessibility summary, and evaluator/date/report evidence should be captured before EPUB/PDF package approval.
- **Client review is curated:** clients should review a Book Brief, selected manuscript/proof packet, cover/proof packet, or Publishing Packet. They should not see raw generation outputs, unstable section drafts, internal fact-check notes, or unresolved rights/safety blockers unless explicitly marked client-visible.

For implementation, the manuscript workspace should feel like a production board: outline tree on the left, selected section/page in the center, and right-side panels for sources, claims, editorial passes, comments, generation runs, accessibility, and gates. That keeps Hermes output anchored to a specific unit and review state.

Devil's advocate: if Book Studio treats manuscript work as one long AI chat, the team will lose track of what changed, which draft the client approved, whether a footnote still points to the right source, whether the TOC works, and whether a later generated paragraph invalidated accessibility, claims, rights, or publishing evidence.

### 16. Launch, Reviews, Promotions, And Lifecycle Operations

Book Studio should treat launch as a governed operating phase, not a final checkbox after upload. A book can be live and still commercially weak if the launch plan has no reader segment, no approved messaging, no review hygiene, no attribution, no promotion calendar, no budget control, and no lifecycle loop for revisions or future series entries.

Current source-backed constraints:

- KDP tells authors they can promote books with email, websites, outreach, Author Central, Amazon Advertising, Free Promotions, Kindle Countdown Deals, pre-orders, gifting, Kindle previews, and sample chapters, but warns that authors remain responsible for third-party tactics that manipulate Kindle publishing services or programs. Source: [KDP Promote Your Book](https://kdp.amazon.com/en_US/help/topic/G201723090).
- Amazon Ads for KDP supports Sponsored Products and Sponsored Brands for books, requires detail-page readiness and ad moderation, and explicitly notes that Amazon Ads reports attribute only ad-driven sales while KDP reports show all book sales. Source: [KDP Advertising for books](https://kdp.amazon.com/en_US/help/topic/G201499010).
- Kindle Countdown Deals are KDP Select-only, marketplace-limited, require pricing stability before/after the promotion, must be scheduled in advance, and can only be used once per KDP Select term instead of a Free Book Promotion. Source: [KDP Kindle Countdown Deals](https://kdp.amazon.com/en_US/help/topic/G201293780).
- Free Book Promotions are KDP Select-only for Kindle eBooks, allow up to 5 free days per 90-day term, do not pay royalties during the free period, and shift rank behavior between free and paid lists. Source: [KDP Free Book Promotions](https://kdp.amazon.com/en_US/help/topic/G201298240).
- Google Play Books supports promo codes, promotional pricing, series bundles, and series subscription discounts, with different eligibility, distribution, and series behavior. Sources: [Google promotions overview](https://support.google.com/books/partner/answer/11098571) and [Google promotional pricing](https://support.google.com/books/partner/answer/4566728).
- Amazon says its community guidelines prohibit incentivized reviews unless facilitated through Amazon Vine, and the FTC final rule prohibits fake reviews, buying sentiment-conditioned reviews, undisclosed insider testimonials, review suppression, and fake social indicators. Sources: [Amazon review update](https://www.aboutamazon.com/news/innovation-at-amazon/update-on-customer-reviews) and [FTC fake reviews rule](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials).

Design implication: Book Studio should model a launch plan with campaign activities, tracking links, promotion windows, review-compliance state, lifecycle events, and attribution evidence. It should not let an operator go from "book is live" to "spend money" or "ask for reviews" without a reviewed plan.

Launch operations records should cover:

- **Launch strategy:** target reader, positioning, channel mix, launch window, target territories, expected margin, break-even units, series/read-through assumption, and whether this is a first release, sequel, revised edition, promotion, or reactivation.
- **Campaign activities:** PiB landing page, email sequence, social posts, short links, Amazon Ads, non-Amazon paid ads, Amazon Attribution links, Google promotion, KDP Select promotion, Author Central checklist, sample/preview link, newsletter/outreach, and client-owned channels.
- **Promotion windows:** KDP Select term, Free Promotion day usage, Countdown Deal timing, Google promo pricing/codes/series promotions, territories, currency, list price before/after, and overlap/conflict checks.
- **Review hygiene:** permitted review request copy, no compensation or sentiment condition, no insider/family/staff review request without disclosure review, no review gating/suppression, third-party service risk, ARC/free-copy disclosure requirements, and FTC/Amazon blocker state.
- **Attribution and measurement:** UTM source/medium/campaign, short-link IDs, Amazon Attribution tag/campaign where available, Amazon Ads campaign ID, Google promotion ID, PiB email/social/ad IDs, landing-page events, channel report imports, and confidence labels.
- **Lifecycle events:** launch, promotion, ad start/stop, price change, revised edition, metadata update, file revision, store rejection/reinstatement, unpublish/archive, series follow-up, rights/account recheck, analytics review, and postmortem.

Governance rules:

- Paid ads, public sends, review requests, promotion scheduling, KDP Select enrollment changes, price changes, and lifecycle actions that affect public listings need approval tasks.
- Launch copy must use the approved metadata packet and cannot invent bestseller rank, review count, ratings, awards, or platform promises.
- Amazon Ads and KDP reports should be reconciled rather than treated as contradictory; ad dashboards show attribution windows while KDP reports show broader sales/royalties.
- Free/discount promotions should not be presented as profit unless the dashboard separates zero-royalty downloads, paid sales, ad cost, read-through, refunds, and later settled royalties.
- Third-party promotion or review services should be treated as high-risk until their tactics are recorded and reviewed; "guaranteed ROI" and review-generation claims should create blockers.

Devil's advocate: a launch layer can become performative marketing admin if it does not control spend, review risk, and attribution confidence. Book Studio should help PiB avoid the common failure mode where a book is technically live, social posts go out, ads spend money, a promotion is consumed, reviews are requested badly, and no one can prove which activity created sales or whether the launch was economically worth repeating.

## Proposed Data Model

Names are draft interface names for discussion.

```ts
type BookProjectStatus =
  | 'idea'
  | 'research'
  | 'briefing'
  | 'outline'
  | 'drafting'
  | 'editing'
  | 'illustrating'
  | 'layout'
  | 'proofing'
  | 'ready_to_publish'
  | 'publishing'
  | 'live'
  | 'revision_required'
  | 'archived'

type BookFormat = 'ebook' | 'paperback' | 'hardcover' | 'audiobook'
type BookLayoutMode = 'reflowable' | 'fixed_layout' | 'print_pdf'
type BookChannel = 'kdp' | 'google_play_books' | 'apple_books' | 'kobo' | 'draft2digital' | 'ingramspark' | 'direct'
type BookPublishingAccountModel =
  | 'client_owned_manual_handoff'
  | 'client_owned_pib_assisted'
  | 'pib_owned_imprint'
  | 'aggregator_or_provider'
type BookTypeFamily =
  | 'narrative'
  | 'children_early_reader'
  | 'visual_sequential'
  | 'nonfiction'
  | 'instructional'
  | 'activity_workbook'
  | 'low_content'
  | 'public_domain_or_companion'
  | 'audiobook'

type BookGenerationRunState =
  | 'queued'
  | 'running'
  | 'needs_review'
  | 'partially_completed'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked'
  | 'expired'
  | 'superseded'

type BookGenerationRunType =
  | 'research'
  | 'outline'
  | 'draft'
  | 'edit'
  | 'fact_check'
  | 'image_direction'
  | 'cover'
  | 'layout'
  | 'export'
  | 'validation'
  | 'analytics_import'

type BookGenerationProvider = 'openai' | 'gemini' | 'hermes' | 'local_worker' | 'manual'

type BookManuscriptUnitType =
  | 'front_matter'
  | 'body_matter'
  | 'back_matter'
  | 'chapter'
  | 'section'
  | 'page'
  | 'spread'
  | 'caption'
  | 'exercise'
  | 'answer_key'
  | 'glossary_entry'
  | 'reference_entry'

type BookManuscriptUnitStatus =
  | 'planned'
  | 'drafting'
  | 'internal_review'
  | 'client_review'
  | 'approved'
  | 'revision_required'
  | 'superseded'
  | 'blocked'

type BookEditorialPassType =
  | 'outline_review'
  | 'developmental_edit'
  | 'copyedit'
  | 'proofread'
  | 'fact_check'
  | 'reading_level_review'
  | 'accessibility_review'
  | 'link_toc_review'
  | 'specialist_review'
  | 'client_review'

type BookClaimReviewStatus = 'unreviewed' | 'supported' | 'unsupported' | 'disputed' | 'stale' | 'waived'
type BookLaunchPlanState = 'draft' | 'needs_review' | 'approved' | 'active' | 'paused' | 'completed' | 'blocked' | 'archived'
type BookLaunchActivityType =
  | 'pib_landing_page'
  | 'email_sequence'
  | 'social_campaign'
  | 'amazon_ads'
  | 'non_amazon_paid_ads'
  | 'amazon_attribution'
  | 'google_play_promotion'
  | 'kdp_free_promotion'
  | 'kindle_countdown_deal'
  | 'author_central'
  | 'sample_or_preview'
  | 'newsletter_outreach'
  | 'third_party_promotion'
  | 'manual_outreach'
type BookPromotionWindowType =
  | 'kdp_free_promotion'
  | 'kindle_countdown_deal'
  | 'google_promo_code'
  | 'google_promotional_pricing'
  | 'google_series_bundle'
  | 'google_series_subscription'
  | 'manual_price_drop'
type BookLifecycleEventType =
  | 'launch'
  | 'promotion_started'
  | 'promotion_ended'
  | 'ad_campaign_started'
  | 'ad_campaign_paused'
  | 'price_changed'
  | 'metadata_updated'
  | 'file_revision_uploaded'
  | 'revised_edition_started'
  | 'store_rejection'
  | 'store_reinstatement'
  | 'unpublished'
  | 'archived'
  | 'series_follow_up_started'
  | 'analytics_reviewed'
  | 'postmortem_completed'
type BookStudioSkillReadinessLevel =
  | 'proposed'
  | 'skill_doc_drafted'
  | 'manifest_allowlisted'
  | 'fixture_tested'
  | 'sandbox_dry_run_verified'
  | 'internal_project_enabled'
  | 'client_visible_enabled'

interface BookStudioSkillEvaluation {
  id: string
  orgId: string
  skillKey: string
  skillPolicyVersion: string
  catalogVersion: string
  readinessLevel: BookStudioSkillReadinessLevel
  fixtureKey: string
  fixtureType:
    | 'market_niche_research'
    | 'public_domain_companion_risk'
    | 'children_fixed_layout'
    | 'low_content_workbook'
    | 'nonfiction_claims'
    | 'launch_review_compliance'
    | 'analytics_import_reconciliation'
    | 'export_package_validation'
  inputManifest: {
    sourceResearchItemIds: string[]
    sourceDocumentIds: string[]
    sourceArtifactIds: string[]
    sourceSpecVersion?: string
    bookTypeFamily?: BookTypeFamily
    channel?: BookChannel
    safetyPolicyKey?: string
    expectedArtifacts: string[]
  }
  result: {
    state: 'passed' | 'warning' | 'blocked' | 'failed'
    summary: string
    missingArtifacts: string[]
    forbiddenActionsRequested: string[]
    followUpTaskIds: string[]
    outputArtifactIds: string[]
  }
  reviewerAgentId: string
  approvalGateTaskId?: string
  createdAt: string
  reviewedAt?: string
}

interface BookProject {
  id: string
  orgId: string
  title: string
  subtitle?: string
  workingTitle?: string
  seriesId?: string
  seriesVolume?: number
  status: BookProjectStatus
  bookTypeFamily: BookTypeFamily
  bookType: string
  productionGateProfile: {
    requiredGateIds: string[]
    waivedGateIds?: Array<{ gateId: string; approvalTaskId: string; reason: string }>
    channelWarnings: Array<{ channel: BookChannel; message: string; severity: 'info' | 'warning' | 'blocker' }>
  }
  visibility: {
    portalVisible: boolean
    clientReviewEnabled: boolean
    internalRiskNotesVisibleToClient: false
  }
  audience: {
    ageRange?: string
    readingLevel?: string
    primaryMarket?: string
  }
  creativeBrief: {
    premise: string
    promise: string
    tone: string
    sourceMaterial?: string
    aiUsagePlan: 'none' | 'assisted' | 'generated'
  }
  production: {
    pageCountTarget?: number
    wordCountTarget?: number
    trimSize?: string
    layoutMode: BookLayoutMode
    interiorType?: 'black_white' | 'standard_color' | 'premium_color'
  }
  linked: {
    researchItemIds: string[]
    clientDocumentIds: string[]
    workspaceArtifactIds: string[]
    taskIds: string[]
    approvalGateTaskIds: string[]
    publishingAccountProfileIds: string[]
    manuscriptUnitIds: string[]
    editorialPassIds: string[]
    generationRunIds: string[]
    launchPlanIds: string[]
    reviewComplianceRecordIds: string[]
    lifecycleEventIds: string[]
    skillEvaluationIds: string[]
    projectId?: string
    campaignId?: string
    companyId?: string
  }
  provenance: {
    originalIdeaSource?: 'client' | 'pib' | 'research' | 'hermes' | 'other'
    rightsOwner?: string
    imprintOwner?: string
    currentManuscriptVersionId?: string
    currentExportPackageId?: string
    provenanceEventIds: string[]
    rightsReviewIds: string[]
  }
  compliance: {
    aiGeneratedText: boolean
    aiGeneratedImages: boolean
    aiGeneratedTranslation: boolean
    aiAssistedOnly?: boolean
    publicDomainClaim?: boolean
    companionOrSummaryWork?: boolean
    lowContentClassification?: boolean
    rightsConfirmed: boolean
    copyrightNotes?: string
    policyRisk: 'low' | 'medium' | 'high'
  }
}
```

```ts
interface BookManuscriptUnit {
  id: string
  orgId: string
  bookProjectId: string
  bookSeriesId?: string
  parentUnitId?: string
  unitType: BookManuscriptUnitType
  order: number
  title?: string
  slug?: string
  status: BookManuscriptUnitStatus
  targetFormatHints: Array<'epub' | 'print_pdf' | 'fixed_layout' | 'audiobook' | 'portal_review'>
  content: {
    sourceDocumentId?: string
    sourceDocumentSectionId?: string
    latestDraftRevisionId?: string
    approvedRevisionId?: string
    editableArtifactId?: string
    latestDraftArtifactId?: string
    approvedArtifactId?: string
    wordCount?: number
    pageCount?: number
    readingLevel?: string
    locale?: string
  }
  navigation: {
    includeInToc: boolean
    tocLabel?: string
    epubType?: string
    linearReadingOrder: boolean
    startsBodyMatter?: boolean
    footnoteIds: string[]
    outboundLinkIds: string[]
  }
  sourceLedger: {
    researchItemIds: string[]
    sourceDocumentIds: string[]
    sourceArtifactIds: string[]
    generationRunIds: string[]
    provenanceEventIds: string[]
  }
  reviewState: {
    requiredEditorialPassTypes: BookEditorialPassType[]
    completedEditorialPassIds: string[]
    claimIds: string[]
    accessibilityReviewIds: string[]
    blockerCount: number
    reviewerAgentId?: string
    approvalGateTaskId?: string
  }
  visibility: 'internal' | 'client_reviewable' | 'approved_publication_source'
  createdAt: string
  updatedAt: string
}
```

```ts
interface BookManuscriptUnitRevision {
  id: string
  orgId: string
  bookProjectId: string
  manuscriptUnitId: string
  revisionLabel: string
  status: 'draft' | 'in_review' | 'approved' | 'superseded' | 'blocked'
  contentArtifactId: string
  source: {
    previousRevisionId?: string
    taskId?: string
    generationRunId?: string
    sourceDocumentIds: string[]
    sourceArtifactIds: string[]
  }
  reviewCoverage: {
    editorialPassIds: string[]
    claimReviewIds: string[]
    accessibilityReviewIds: string[]
    provenanceEventIds: string[]
  }
  createdBy: { type: 'user' | 'agent' | 'system'; id: string }
  createdAt: string
  approvedAt?: string
}
```

```ts
interface BookEditorialPass {
  id: string
  orgId: string
  bookProjectId: string
  manuscriptVersionId?: string
  manuscriptUnitIds: string[]
  passType: BookEditorialPassType
  state: 'queued' | 'in_progress' | 'needs_review' | 'passed' | 'warning' | 'blocked' | 'waived'
  assigneeAgentId?: string
  reviewerAgentId?: string
  source: {
    taskId?: string
    generationRunId?: string
    sourceDocumentIds: string[]
    sourceArtifactIds: string[]
  }
  findings: Array<{
    id: string
    unitId?: string
    severity: 'info' | 'warning' | 'blocker'
    title: string
    recommendation: string
    clientVisible: boolean
    resolvedAt?: string
  }>
  gates: {
    approvalGateTaskId?: string
    waiverTaskId?: string
    blocksClientVisibility: boolean
    blocksExportApproval: boolean
  }
  outputArtifactIds: string[]
  createdAt: string
  completedAt?: string
}
```

```ts
interface BookClaimReview {
  id: string
  orgId: string
  bookProjectId: string
  manuscriptUnitId: string
  claimTextSummary: string
  claimType: 'factual' | 'legal' | 'financial' | 'health' | 'historical' | 'technical' | 'quote' | 'other'
  status: BookClaimReviewStatus
  sourceResearchItemIds: string[]
  sourceDocumentIds: string[]
  researchSourceIds: string[]
  reviewerAgentId?: string
  notes?: string
  approvalGateTaskId?: string
  createdAt: string
  updatedAt: string
}
```

```ts
interface BookAccessibilityReview {
  id: string
  orgId: string
  bookProjectId: string
  manuscriptVersionId?: string
  packageId?: string
  scope: 'manuscript' | 'epub' | 'pdf' | 'fixed_layout' | 'audiobook'
  state: 'not_started' | 'in_review' | 'passed' | 'warning' | 'blocked' | 'waived'
  checks: {
    readingOrder: 'unknown' | 'passed' | 'warning' | 'blocked'
    tocNavigation: 'unknown' | 'passed' | 'warning' | 'blocked'
    linkTargets: 'unknown' | 'passed' | 'warning' | 'blocked'
    altText: 'not_applicable' | 'missing' | 'partial' | 'complete' | 'blocked'
    tables: 'not_applicable' | 'passed' | 'warning' | 'blocked'
    languageDirection: 'unknown' | 'passed' | 'warning' | 'blocked'
    audioVideoAlternatives: 'not_applicable' | 'missing' | 'partial' | 'complete' | 'blocked'
  }
  metadata: {
    accessibilitySummary?: string
    conformsTo?: string
    evaluatedBy?: string
    evaluatedAt?: string
    reportArtifactId?: string
  }
  blockerTaskIds: string[]
  createdAt: string
  updatedAt: string
}
```

```ts
interface BookLaunchPlan {
  id: string
  orgId: string
  bookProjectId: string
  bookSeriesId?: string
  channelListingIds: string[]
  state: BookLaunchPlanState
  launchType: 'new_release' | 'sequel_release' | 'revised_edition' | 'promotion' | 'reactivation'
  strategy: {
    readerSegment: string
    positioningSummary: string
    launchWindowStart?: string
    launchWindowEnd?: string
    targetTerritories: string[]
    targetChannels: BookChannel[]
    breakEvenUnits?: number
    marginConfidence: 'estimate' | 'reported' | 'settled' | 'unknown'
    seriesReadThroughAssumption?: string
  }
  activities: Array<{
    id: string
    type: BookLaunchActivityType
    ownerId?: string
    status: 'planned' | 'needs_review' | 'approved' | 'active' | 'paused' | 'completed' | 'blocked' | 'cancelled'
    scheduledStart?: string
    scheduledEnd?: string
    sourceCampaignId?: string
    sourceTaskId?: string
    sourceDocumentId?: string
    approvalGateTaskId?: string
    budget?: { amount: number; currency: string; approved: boolean }
    blockers: Array<{ title: string; severity: 'warning' | 'blocker'; nextAction: string }>
  }>
  tracking: {
    landingPageUrl?: string
    shortLinkIds: string[]
    utmCampaign?: string
    amazonAttributionTagIds: string[]
    amazonAdsCampaignIds: string[]
    googlePromotionIds: string[]
    emailCampaignIds: string[]
    socialCampaignIds: string[]
  }
  reviewComplianceRecordIds: string[]
  promotionWindowIds: string[]
  lifecycleEventIds: string[]
  approvedBy?: string
  approvedAt?: string
  createdAt: string
  updatedAt: string
}
```

```ts
interface BookPromotionWindow {
  id: string
  orgId: string
  bookProjectId: string
  launchPlanId?: string
  channelListingId: string
  promotionType: BookPromotionWindowType
  status: 'draft' | 'needs_review' | 'approved' | 'scheduled' | 'active' | 'ended' | 'cancelled' | 'blocked'
  schedule: {
    startsAt: string
    endsAt: string
    marketplaceTimeZone?: string
    kdpSelectTermId?: string
  }
  pricing: {
    listPriceBefore?: { amount: number; currency: string }
    promotionPrice?: { amount: number; currency: string }
    listPriceAfter?: { amount: number; currency: string }
    countries: string[]
  }
  eligibility: {
    kdpSelectRequired?: boolean
    kdpSelectConfirmed?: boolean
    selectPromotionDaysUsed?: number
    selectPromotionDaysAvailable?: number
    priceStabilityChecked?: boolean
    googleSeriesEligibilityChecked?: boolean
  }
  evidence: {
    approvalTaskId?: string
    scheduledEvidenceArtifactId?: string
    resultImportIds: string[]
    notes?: string
  }
  createdAt: string
  updatedAt: string
}
```

```ts
interface BookReviewComplianceRecord {
  id: string
  orgId: string
  bookProjectId: string
  launchPlanId?: string
  state: 'draft' | 'needs_review' | 'approved' | 'warning' | 'blocked' | 'waived'
  requestContext: 'none' | 'client_list' | 'arc_reader' | 'newsletter' | 'social' | 'third_party_service' | 'post_purchase_followup' | 'manual'
  checks: {
    noCompensationForSentiment: boolean
    noInsiderOrFamilyRequestWithoutDisclosureReview: boolean
    noReviewGatingOrSuppression: boolean
    noFakeSocialProof: boolean
    amazonGuidelineReviewed: boolean
    ftcGuidelineReviewed: boolean
    thirdPartyTacticsRecorded: boolean
  }
  approvedRequestCopyArtifactId?: string
  blockerTaskIds: string[]
  reviewerAgentId?: string
  approvalGateTaskId?: string
  createdAt: string
  updatedAt: string
}
```

```ts
interface BookLifecycleEvent {
  id: string
  orgId: string
  bookProjectId: string
  bookSeriesId?: string
  launchPlanId?: string
  channelListingId?: string
  eventType: BookLifecycleEventType
  status: 'planned' | 'recorded' | 'needs_review' | 'approved' | 'blocked' | 'superseded'
  summary: string
  evidence: {
    sourceTaskIds: string[]
    sourceDocumentIds: string[]
    sourceArtifactIds: string[]
    analyticsImportIds: string[]
    externalUrl?: string
  }
  impact: {
    affectsPublicListing: boolean
    affectsPricing: boolean
    affectsFiles: boolean
    affectsAdsOrSpend: boolean
    clientVisible: boolean
  }
  approvalGateTaskId?: string
  createdAt: string
}
```

```ts
interface BookPublishingAccountProfile {
  id: string
  orgId: string
  channel: BookChannel
  accountModel: BookPublishingAccountModel
  accountOwner: {
    ownerType: 'client' | 'pib' | 'aggregator' | 'other'
    displayName: string
    legalPublisherName?: string
    imprintName?: string
    authorizedRepresentative?: string
  }
  externalAccount: {
    accountLabel: string
    externalAccountId?: string
    googleCollectionCode?: string
    providerName?: string
    notes?: string
  }
  access: {
    status: 'not_started' | 'requested' | 'granted' | 'client_required' | 'revoked' | 'blocked'
    method:
      | 'manual_client_upload'
      | 'screen_share'
      | 'named_user_access'
      | 'google_service_provider'
      | 'pib_owned_login'
      | 'aggregator_dashboard'
    pibOperatorUserIds: string[]
    requiredClientPresence: boolean
    sensitiveCredentialStored: false
    consentDocumentIds: string[]
    approvalTaskIds: string[]
  }
  readiness: {
    identityVerification: 'unknown' | 'not_required' | 'pending' | 'complete' | 'blocked'
    taxProfile: 'unknown' | 'not_required' | 'pending' | 'complete' | 'blocked'
    paymentProfile: 'unknown' | 'pending' | 'complete' | 'blocked'
    reportAccess: 'none' | 'catalog_only' | 'analytics' | 'earnings' | 'full'
    territoryProfile: 'not_applicable' | 'missing' | 'partial' | 'complete' | 'blocked'
    lastVerifiedAt?: string
    recheckDueAt?: string
    evidenceArtifactIds: string[]
  }
  blockers: Array<{
    title: string
    severity: 'warning' | 'blocker'
    source: 'identity' | 'tax' | 'payment' | 'access' | 'territory' | 'rights' | 'reports' | 'security'
    ownerId?: string
    nextAction: string
    clientVisible: boolean
  }>
}
```

```ts
interface BookGenerationRun {
  id: string
  orgId: string
  bookProjectId: string
  bookSeriesId?: string
  editionId?: string
  taskId: string
  generationRunType: BookGenerationRunType
  skillKey: string
  assigneeAgentId: string
  state: BookGenerationRunState
  provider: BookGenerationProvider
  externalJob?: {
    providerJobId?: string
    providerResponseId?: string
    batchName?: string
    statusUrl?: string
    resultFileArtifactId?: string
  }
  target: {
    scope: 'project' | 'manuscript_unit' | 'section' | 'page' | 'spread' | 'asset' | 'package' | 'channel_listing' | 'analytics_import'
    manuscriptUnitId?: string
    sectionId?: string
    pageId?: string
    artifactId?: string
    packageId?: string
    channelListingId?: string
    branchLabel?: string
  }
  inputManifest: {
    idempotencyKey: string
    promptSpecVersion: string
    promptSummary: string
    retainedPromptArtifactId?: string
    sourceResearchItemIds: string[]
    sourceDocumentIds: string[]
    sourceArtifactIds: string[]
    sourceVersionManifestIds: string[]
    sourceGenerationRunIds: string[]
    modelName?: string
    modelSnapshot?: string
    toolVersion?: string
    parameters?: Record<string, string | number | boolean>
    safetyPolicyKey: string
    allowedDataClasses: Array<'public' | 'client_internal' | 'sensitive_summary_only'>
  }
  budget: {
    maxInputTokens?: number
    maxOutputTokens?: number
    maxImageCount?: number
    maxAudioMinutes?: number
    maxPages?: number
    maxRequests?: number
    maxRuntimeSeconds?: number
    maxCost?: { amount: number; currency: string }
    approvalTaskIdForOverrun?: string
  }
  usage?: {
    inputTokens?: number
    outputTokens?: number
    imageCount?: number
    audioMinutes?: number
    pageCount?: number
    requestCount?: number
    runtimeSeconds?: number
    estimatedCost?: { amount: number; currency: string; source: 'provider_usage' | 'manual_estimate' }
  }
  safety: {
    preflightStatus: 'not_required' | 'passed' | 'warning' | 'blocked' | 'needs_review'
    postflightStatus: 'not_required' | 'passed' | 'warning' | 'blocked' | 'needs_review'
    moderationProvider?: 'openai' | 'gemini' | 'manual'
    flaggedCategories: string[]
    safetyReportArtifactIds: string[]
    reviewerAgentId?: string
    approvalGateTaskId?: string
  }
  output: {
    artifactIds: string[]
    documentIds: string[]
    versionManifestIds: string[]
    provenanceEventIds: string[]
    warnings: string[]
    blockers: Array<{ title: string; severity: 'warning' | 'blocker'; nextAction: string }>
  }
  retry: {
    attempt: number
    maxAttempts: number
    previousRunId?: string
    retryReason?: string
    cancelReason?: string
    supersededByRunId?: string
  }
  createdAt: string
  startedAt?: string
  completedAt?: string
}
```

```ts
interface BookProvenanceEvent {
  id: string
  orgId: string
  bookProjectId: string
  eventType:
    | 'source_added'
    | 'ai_generation'
    | 'human_edit'
    | 'version_created'
    | 'asset_added'
    | 'rights_reviewed'
    | 'approval_recorded'
    | 'waiver_recorded'
    | 'export_created'
    | 'validation_recorded'
    | 'account_readiness_recorded'
    | 'generation_run_created'
    | 'generation_run_completed'
    | 'generation_run_failed'
    | 'safety_review_recorded'
    | 'manuscript_unit_created'
    | 'manuscript_unit_revised'
    | 'editorial_pass_completed'
    | 'claim_review_recorded'
    | 'accessibility_review_recorded'
    | 'manual_upload_recorded'
    | 'report_imported'
  actor: {
    type: 'user' | 'agent' | 'system'
    id: string
    displayName?: string
  }
  source: {
    researchItemIds?: string[]
    documentIds?: string[]
    artifactIds?: string[]
    taskIds?: string[]
    previousVersionId?: string
    toolName?: string
    modelName?: string
    generationRunId?: string
    promptSummary?: string
    editorialPassId?: string
  }
  target: {
    manuscriptVersionId?: string
    sectionId?: string
    pageId?: string
    manuscriptUnitId?: string
    artifactId?: string
    channelListingId?: string
    exportPackageId?: string
    generationRunId?: string
    claimReviewId?: string
    accessibilityReviewId?: string
  }
  aiUsage: {
    classification: 'none' | 'assisted' | 'generated'
    generatedText?: boolean
    generatedImages?: boolean
    generatedTranslation?: boolean
    humanModificationSummary?: string
  }
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  evidenceNotes?: string
  createdAt: string
}
```

```ts
interface BookVersionManifest {
  id: string
  orgId: string
  bookProjectId: string
  versionType: 'outline' | 'manuscript' | 'proof' | 'cover' | 'interior' | 'epub' | 'pdf' | 'audiobook' | 'publishing_packet'
  versionLabel: string
  status: 'draft' | 'in_review' | 'approved' | 'superseded' | 'released' | 'blocked'
  supersedesVersionId?: string
  sourceDocumentIds: string[]
  sourceArtifactIds: string[]
  exportPackageIds?: string[]
  generationRunIds: string[]
  manuscriptUnitIds: string[]
  manuscriptUnitRevisionIds: string[]
  editorialPassIds: string[]
  claimReviewIds: string[]
  accessibilityReviewIds: string[]
  sectionIds: string[]
  pageIds: string[]
  checksums: Array<{ artifactId: string; algorithm: 'sha256'; value: string }>
  contributors: Array<{ type: 'user' | 'agent'; id: string; role: string }>
  provenanceEventIds: string[]
  rightsReviewIds: string[]
  releaseGateIds: string[]
}
```

```ts
type BookFilePackageType =
  | 'source_archive'
  | 'kdp_ebook_reflowable'
  | 'kdp_ebook_fixed_layout'
  | 'kdp_print_paperback'
  | 'kdp_print_hardcover'
  | 'google_ebook'
  | 'audiobook_package'
  | 'metadata_only_packet'

type BookFilePackageState =
  | 'draft'
  | 'assembled'
  | 'validated'
  | 'previewed'
  | 'approved_for_upload'
  | 'uploaded'
  | 'superseded'
  | 'blocked'

type BookFileRole =
  | 'editable_source'
  | 'manuscript'
  | 'interior_pdf'
  | 'ebook_epub'
  | 'ebook_kpf'
  | 'ebook_docx'
  | 'ebook_cover'
  | 'full_wrap_cover_pdf'
  | 'cover_template'
  | 'page_image'
  | 'audio_master'
  | 'audio_sample'
  | 'supplemental_pdf'
  | 'metadata_packet'
  | 'validation_report'
  | 'preview_evidence'

interface BookFilePackage {
  id: string
  orgId: string
  bookProjectId: string
  editionId?: string
  channelListingId?: string
  packageType: BookFilePackageType
  state: BookFilePackageState
  manifestVersion: number
  packageLabel: string
  supersedesPackageId?: string
  source: {
    manuscriptVersionIds: string[]
    versionManifestIds: string[]
    sourceDocumentIds: string[]
    sourceArtifactIds: string[]
    sourceTaskIds: string[]
    generationRunIds: string[]
    exportTool?: string
    exportToolVersion?: string
    exportedBy?: string
    exportedAt?: string
  }
  files: Array<{
    artifactId: string
    role: BookFileRole
    filename: string
    mimeType: string
    sizeBytes: number
    checksum: { algorithm: 'sha256'; value: string }
    required: boolean
    channelUploadOrder?: number
  }>
  printSpec?: {
    trimSize?: string
    bleed: boolean
    pageCount?: number
    interiorType?: 'black_white' | 'standard_color' | 'premium_color'
    paperType?: 'white' | 'cream' | 'groundwood'
    coverWidthInches?: number
    coverHeightInches?: number
    spineWidthInches?: number
    barcodeProvided?: boolean
  }
  ebookSpec?: {
    layoutMode: 'reflowable' | 'fixed_layout'
    epubVersion?: '2' | '3'
    kindleSourceFormat?: 'epub' | 'kpf' | 'docx'
    googleFormatsIncluded?: Array<'epub' | 'pdf'>
  }
  disclosureSnapshot: {
    aiGeneratedText: boolean
    aiGeneratedImages: boolean
    aiGeneratedTranslation: boolean
    rightsReviewIds: string[]
    assetRightsIds: string[]
    approvalTaskIds: string[]
  }
  validations: BookPackageValidation[]
  previewEvidence: BookPackagePreviewEvidence[]
  uploadInstructions: {
    channel: BookChannel
    publishingAccountProfileId?: string
    accountContext?: string
    steps: Array<{ order: number; action: string; fileRole?: BookFileRole; notes?: string }>
    expectedExternalFields: string[]
  }
  approval?: {
    status: 'not_requested' | 'needs_review' | 'approved' | 'waived' | 'revoked'
    approvedBy?: string
    approvedAt?: string
    approvalGateTaskId?: string
    approvedChecksumSet?: Array<{ artifactId: string; sha256: string }>
    revokedBecause?: string
  }
  blockers: Array<{
    title: string
    severity: 'warning' | 'blocker'
    ownerId?: string
    sourceValidationId?: string
    clientVisible: boolean
    nextAction: string
  }>
}

interface BookPackageValidation {
  id: string
  validatorKey:
    | 'manifest_required_files'
    | 'epubcheck'
    | 'pdf_preflight'
    | 'kdp_ebook_preview'
    | 'kdp_print_preview'
    | 'google_file_guidelines'
    | 'audio_file_check'
    | 'rights_disclosure_snapshot'
  validatorVersion?: string
  scope: 'package' | 'file' | 'channel_listing' | 'rights' | 'preview'
  status: 'passed' | 'warning' | 'blocked' | 'waived' | 'not_applicable'
  severity: 'info' | 'warning' | 'blocker'
  checkedAt: string
  checkedBy: { type: 'user' | 'agent' | 'system'; id: string }
  summary: string
  reportArtifactId?: string
  issues: Array<{
    code?: string
    message: string
    fileRole?: BookFileRole
    artifactId?: string
    pageOrLocation?: string
    recommendedAction?: string
  }>
}

interface BookPackagePreviewEvidence {
  id: string
  type:
    | 'kindle_previewer'
    | 'kdp_online_previewer'
    | 'kdp_print_previewer'
    | 'physical_proof'
    | 'google_partner_center_file_processing'
    | 'manual_reader_check'
  status: 'passed' | 'warning' | 'blocked' | 'waived'
  checkedAt: string
  checkedBy: string
  evidenceArtifactIds: string[]
  notes: string
}
```

```ts
interface BookRightsReview {
  id: string
  orgId: string
  bookProjectId: string
  scope: 'project' | 'manuscript_version' | 'asset' | 'channel_listing' | 'export_package'
  scopeId: string
  status: 'not_started' | 'in_review' | 'passed' | 'warning' | 'blocked' | 'waived'
  reviewType:
    | 'ai_disclosure'
    | 'copyright_registration'
    | 'public_domain'
    | 'companion_or_summary'
    | 'asset_license'
    | 'quote_permission'
    | 'font_license'
    | 'audio_rights'
    | 'territory_rights'
    | 'drm_printing'
  findings: Array<{
    title: string
    body: string
    severity: 'info' | 'warning' | 'blocker'
    sourceIds: string[]
  }>
  decision?: {
    outcome: 'approve' | 'block' | 'waive'
    decidedBy: string
    decidedAt: string
    notes: string
    approvalGateTaskId?: string
  }
}
```

```ts
interface BookQualityGate {
  id: string
  orgId: string
  bookProjectId: string
  gateKey: string
  title: string
  status: 'not_started' | 'in_progress' | 'passed' | 'warning' | 'blocked' | 'waived'
  severity: 'info' | 'warning' | 'blocker'
  reviewerAgentId?: string
  requiredCapability?: 'read' | 'draft' | 'write' | 'approve' | 'publish' | 'spend' | 'message_client'
  evidence: {
    sourceResearchItemIds: string[]
    sourceDocumentIds: string[]
    taskIds: string[]
    workspaceArtifactIds: string[]
    notes?: string
  }
  waiver?: {
    approvalGateTaskId: string
    approvedBy: string
    reason: string
    approvedAt: string
  }
}
```

```ts
interface BookSeries {
  id: string
  orgId: string
  name: string
  description: string
  orderMode: 'ordered' | 'unordered'
  bookIds: string[]
  styleGuide: {
    tone?: string
    artStyle?: string
    colorPalette?: string
    recurringCharacters?: Array<{
      id: string
      name: string
      role: string
      visualDescription?: string
      personality?: string
    }>
    continuityRules: string[]
  }
  publishing: {
    kdpSeriesUrl?: string
    googleSeriesUrl?: string
    statusByChannel: Partial<Record<BookChannel, string>>
  }
}
```

```ts
interface BookChannelListing {
  id: string
  orgId: string
  bookProjectId: string
  channel: BookChannel
  format: BookFormat
  publishingAccountProfileId?: string
  status: 'not_started' | 'metadata_ready' | 'files_ready' | 'uploaded' | 'in_review' | 'live' | 'blocked' | 'unpublished'
  identifiers: {
    isbn?: string
    asin?: string
    googleBookId?: string
    sku?: string
    url?: string
  }
  filePackages: {
    candidatePackageIds: string[]
    approvedUploadPackageId?: string
    lastUploadedPackageId?: string
    requiredPackageTypes: BookFilePackageType[]
  }
  metadata: {
    title: string
    subtitle?: string
    contributors: Array<{ name: string; role: string }>
    description: string
    categories: string[]
    keywords: string[]
    language: string
    matureAudience: boolean
  }
  pricing: Array<{
    marketplace: string
    currency: string
    listPrice: number
    taxIncluded?: boolean
    fixedPriceLawApplies?: boolean
    effectiveFrom?: string
    effectiveUntil?: string
    royaltyPlan?: 'kdp_ebook_35' | 'kdp_ebook_70' | 'kdp_print_50' | 'kdp_print_60' | 'kdp_expanded_40' | 'google_70' | 'google_52' | 'other'
    kdpSelect?: {
      enrolled: boolean
      termStart?: string
      termEnd?: string
      exclusivityAcknowledgedBy?: string
    }
    costEstimate?: {
      fileSizeMb?: number
      deliveryCost?: number
      pageCount?: number
      inkType?: 'black' | 'standard_color' | 'premium_color'
      printCost?: number
      productionCostAllocated?: number
      launchCostAllocated?: number
      source?: 'kdp_calculator' | 'partner_center' | 'manual' | 'imported_report'
      checkedAt?: string
    }
    marginEstimate?: {
      estimatedPublisherRevenue?: number
      estimatedContributionMargin?: number
      estimatedCostRecovery?: number
      confidence: 'estimate' | 'reported' | 'settled' | 'reconciled'
    }
    approval?: {
      status: 'draft' | 'needs_review' | 'approved' | 'waived'
      approvedBy?: string
      approvedAt?: string
      waiverReason?: string
    }
  }>
  aiDisclosure: {
    text: boolean
    images: boolean
    translation: boolean
    notes?: string
  }
}
```

## Domain API, Query, And Mutation Contract

Book Studio should use the same route-wrapper pattern as Mobile Apps, YouTube Studio, Research, Projects, and Client Documents: route handlers resolve auth, org, module entitlement, and surface-specific visibility, while shared library functions own sanitizing, serialization, gate checks, and state transitions. The API should not expose raw Firestore documents or let route-local code bypass publishing gates.

### Collection And API Boundaries

Recommended collection ownership:

| Collection | API owner | Mutability model | Notes |
| --- | --- | --- | --- |
| `book_projects` | Book Studio project API | Mutable summary with guarded state transitions. | Stores compact identity, stage, risk, visibility, current pointers, and linked PiB record IDs only. |
| `book_series` | Book Studio series API | Mutable summary with guarded ordering changes. | Stores continuity and ordering metadata; style bibles should be documents/artifacts. |
| `book_project_editions` | Book Studio edition API | Mutable until package approval. | Stores format/channel readiness decisions, not large files. |
| `book_quality_gates` | Book Studio gate API | Guarded transition records. | Gates can pass, warn, block, waive, or become not applicable only with evidence or approval references. |
| `book_channel_listings` | Publishing packet API | Guarded transition records. | KDP/Google status, metadata packet, price plan, upload package, external IDs, and manual status. |
| `book_publishing_account_profiles` | Publishing account API | Mutable with recheck history. | No credentials, tax IDs, bank details, identity documents, or secret fields. |
| `book_export_packages` | Export package API | Versioned; approval is checksum-bound. | File manifests, validation results, preview evidence, rights snapshots, and upload instructions. |
| `book_generation_runs` | Hermes/runtime API | Append-heavy state ledger. | Idempotent model-backed task execution, budgets, provider jobs, safety review, output artifacts, and supersede/cancel history. |
| `book_manuscript_units` | Manuscript API | Mutable planning records. | Section/page/spread structure with pointers to revisions and artifacts. |
| `book_manuscript_unit_revisions` | Manuscript API | Versioned; approved revisions are immutable. | Content lives in documents/artifacts; records store references, review coverage, and approval state. |
| `book_editorial_passes` | Manuscript/review API | Append-heavy review records. | Developmental edit, copyedit, proofread, fact check, reading-level, accessibility, link/TOC, specialist, and client review. |
| `book_provenance_events` | Provenance API | Immutable event ledger. | Generation, import, edit, approval, waiver, export, upload, and report-import evidence. |
| `book_rights_reviews` | Provenance API | Guarded review records. | AI disclosure, copyright, public-domain/companion, asset/font/audio, territory, and DRM/printing decisions. |
| `book_analytics_imports` | Analytics API | Immutable import ledger. | Source report, parser version, checksum, period, currency, confidence, and raw evidence. |
| `book_analytics_snapshots` | Analytics API | Superseded snapshots. | Derived dashboards are recalculated from validated imports and marked by source confidence. |
| `book_launch_plans` | Launch API | Guarded campaign records. | Activity plans, budgets, approval gates, promotion windows, review hygiene, attribution, and lifecycle events. |
| `book_skill_evaluations` | Hermes policy API | Append-heavy evaluation records. | Fixture, dry-run, readiness, drift, expected artifacts, reviewer, and follow-up tasks. |

### Route Families

Admin APIs should stay org-scoped and require `orgId`, matching the existing `withAuth('admin')` plus org-access pattern:

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/v1/book-studio/projects` | `GET`, `POST` | List/create projects for an org; `POST` creates initial gate profile and optional linked Project/Kanban shell. |
| `/api/v1/book-studio/projects/[id]` | `GET`, `PATCH` | Load/update project summary, visibility, links, stage, owner, and safe state transitions. |
| `/api/v1/book-studio/projects/[id]/archive` | `POST` | Soft archive project and hide from portal without deleting evidence ledgers. |
| `/api/v1/book-studio/series` | `GET`, `POST` | List/create series for an org; supports ordered/unordered/collection/spin-off modes. |
| `/api/v1/book-studio/series/[id]` | `GET`, `PATCH` | Update continuity metadata, volume map, planned slots, and channel-series warnings. |
| `/api/v1/book-studio/projects/[id]/gates` | `GET`, `POST`, `PATCH` | List gates, add ad hoc gate, transition gate state, or request/record waiver. |
| `/api/v1/book-studio/projects/[id]/brief` | `POST` | Create or link a Book Brief client document from project/research state. |
| `/api/v1/book-studio/projects/[id]/research` | `POST` | Link existing Research item or create a seed Research item. |
| `/api/v1/book-studio/projects/[id]/tasks` | `POST` | Create Hermes-ready task packets with exact `bookStudioSkillKey` and reviewer defaults. |
| `/api/v1/book-studio/projects/[id]/manuscript-units` | `GET`, `POST`, `PATCH` | Manage structure and revision pointers without storing long manuscript text in the project record. |
| `/api/v1/book-studio/projects/[id]/export-packages` | `GET`, `POST`, `PATCH` | Assemble package manifests, validation evidence, preview evidence, and checksum-bound approvals. |
| `/api/v1/book-studio/projects/[id]/channel-listings` | `GET`, `POST`, `PATCH` | Manage channel readiness, metadata packet, account profile, price plan, selected package, and manual external status. |
| `/api/v1/book-studio/projects/[id]/analytics-imports` | `GET`, `POST` | Attach/import reports and create reconciliation summaries without overwriting raw import evidence. |
| `/api/v1/book-studio/skill-evaluations` | `GET`, `POST` | Record fixture/dry-run evaluations and readiness state for Book Studio skills. |

Portal APIs should be smaller and client-safe:

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/v1/portal/book-studio` | `GET` | Return visible project summaries, approved review packets, safe blockers, and safe analytics summaries for the active portal org. |
| `/api/v1/portal/book-studio/[id]` | `GET` | Return one client-visible project detail with only approved lanes and client-actionable tasks. |
| `/api/v1/portal/book-studio/[id]/comments` | `POST` | Add client comments to the approved review artifact or packet. |
| `/api/v1/portal/book-studio/[id]/decision` | `POST` | Record approved, changes requested, or rejected decisions only when a review state is open. |
| `/api/v1/portal/book-studio/request` | `POST` | Optional future client request intake; should create an internal reviewable request, not a production-ready project. |

The portal route must load the active org, check `isPortalModuleEnabled(settings, 'bookStudio')`, and return `403` with `{ moduleDisabled: true, module: 'bookStudio' }` when disabled. It must not query or return project records after the module guard fails.

### Query Rules

Book Studio should prefer simple Firestore queries and in-memory filtering/sorting where the result set is org-scoped:

- Every list query starts with `where('orgId', '==', orgId)`.
- Avoid `!=`, broad `array-contains-any`, and cross-field ordering until a deliberate index is documented.
- Filter `deleted !== true` or `archived !== true` in memory unless an index-backed query is deliberately added.
- Portal list queries first collect project IDs visible to the client, then filter dependent gates, packets, comments, and analytics by those IDs.
- Admin detail APIs may fan out in parallel by `orgId` and explicit IDs, but must reject any dependent record whose `orgId` or `bookProjectId` does not match.
- Large content is never hydrated through list endpoints. Lists return compact summaries and counts; detail routes load the selected lane.
- API responses should include serialized timestamps and omit empty optional fields.

### Mutation Rules

Mutations should use shared transition helpers rather than route-local state edits:

- Project creation creates default gates from `bookTypeFamily`, target channels, account model, and format decisions in the same batch where possible.
- Project updates can change summary fields, owner, visibility, linked IDs, and next action, but cannot silently pass gates, approve packages, mark listings uploaded, or supersede approved versions.
- Gate transitions require evidence for `passed`, approval evidence for `waived`, and blocker notes for `blocked`.
- Export package approval is bound to the exact package version, file roles, and checksums. Any file/checksum/source-version change returns the package to review.
- Channel listing `approved_for_upload` requires passed/waived required gates, selected approved export package, reviewed price plan, current account profile, and no unresolved rights/disclosure blockers.
- Portal decisions can only affect open client-review states. They create comments/decision records and update client-review status; they do not publish, upload, spend, archive, or delete.
- Analytics imports are append-only. Re-importing a period creates a superseding import/snapshot rather than rewriting prior evidence.
- Generation runs use idempotency keys and cannot update approved versions, client-visible packets, export packages, or channel listings after the run becomes stale, blocked, failed, cancelled, expired, or superseded.

### Response And Error Semantics

Recommended response conventions:

- `400`: missing required input, invalid enum, malformed body, or unsupported route action.
- `403`: org access denied, portal module disabled, portal record not visible, or role cannot perform action.
- `404`: record missing, deleted/archived when not explicitly requested, or hidden from the current surface.
- `409`: state conflict, stale package checksum, closed client-review decision, stale generation run, duplicate series volume, or upload approval attempted while dependent state changed.
- `422`: readiness/gate validation failed with a structured blocker list.

Every blocker response should include machine-readable `blockers` where useful:

```ts
type BookStudioBlocker = {
  code: string
  severity: 'warning' | 'blocker'
  gateId?: string
  sourceRecordId?: string
  message: string
  clientVisible: boolean
}
```

Admin responses may include internal blockers and evidence IDs. Portal responses include only client-visible blockers and client-safe summaries.

### Sanitizers And Client-Safe Serializers

Phase 1 should create shared helpers before route handlers grow:

- `sanitizeBookProjectInput`
- `serializeBookStudioRecord`
- `clientSafeBookProject`
- `clientSafeBookPublishingPacket`
- `clientSafeBookAnalyticsSummary`
- `ensureBookStudioOrgAccess`
- `ensureBookStudioPortalEnabled`
- `deriveBookStageAndNextAction`
- `deriveBookTypeGateProfile`
- `validateBookGateTransition`
- `validateExportPackageApproval`
- `validateChannelListingUploadApproval`
- `stripUndefinedDeep`

The devil's-advocate concern is that route files will become the product rules if these helpers are skipped. Book Studio has too many dependent states for scattered inline checks; the same gate logic must protect admin buttons, portal decisions, Hermes task outputs, and API mutations.

## Hermes Skills Needed

The module will need new skills, not one giant "book" skill.

### Research Skills

- `book-niche-research`: source-backed niche, audience, category, pricing, competitor, and risk research.
- `book-competitor-review-mining`: extract patterns from reviews and public descriptions without copying protected text.
- `book-series-strategy`: decide standalone vs ordered/unordered series, volume plan, and release cadence.

### Writing And Editorial Skills

- `book-brief-builder`: turn client/business goals into a book brief.
- `book-outline-builder`: produce outline, chapter/page map, and continuity plan.
- `book-manuscript-structure-keeper`: maintain manuscript units, hierarchy, navigation, release snapshots, and section/page status.
- `book-draft-writer`: draft sections within the approved outline.
- `book-developmental-editor`: structure, pacing, promise, reader fit.
- `book-copyeditor`: grammar, clarity, style, consistency.
- `book-proofreader`: final typo and formatting pass.
- `book-reading-level-review`: age/reading-level assessment.
- `book-fact-checker`: source-backed review for non-fiction claims.
- `book-accessibility-review`: reading order, TOC/link usability, alt text, table usability, language direction, and accessibility metadata review.

### Visual And Layout Skills

- `book-cover-brief`: cover positioning, title hierarchy, platform-safe requirements.
- `book-illustration-director`: scene prompts, character consistency, style bible.
- `book-layout-designer`: page/spread layout, trim constraints, bleed/margins checklist.
- `book-asset-rights-auditor`: provenance, licensing, AI disclosure, risky references.

### Publishing And Analytics Skills

- `book-generation-run-governor`: create, budget, retry, cancel, supersede, and reconcile generation run records.
- `book-generation-safety-review`: preflight prompts and postflight outputs for provider safety feedback, PiB policy fit, and client/publishing visibility blockers.
- `book-metadata-optimizer`: channel-safe title, description, categories, keywords.
- `book-kdp-readiness-check`: KDP checklist, AI disclosure, ISBN, file package, metadata.
- `book-google-play-readiness-check`: Google metadata, series, files, price, report setup.
- `book-export-packager`: generate or assemble EPUB/PDF/cover/metadata packets.
- `book-file-package-validator`: run manifest, EPUB/PDF/audio, preview-evidence, and checksum-bound package checks.
- `book-publishing-account-readiness`: check KDP/Google account ownership, access, identity/tax/payment/report/territory readiness, and operating authority.
- `book-publishing-ops`: maintain channel status and manual upload steps.
- `book-analytics-import`: parse CSV/report exports and separate estimated/reported/settled metrics.
- `book-launch-campaign`: connect book launch to PiB social/email/ads/landing pages.
- `book-review-compliance-check`: review planned review requests, ARC/free-copy handling, third-party promotion tactics, and FTC/Amazon risk.
- `book-lifecycle-ops`: track post-launch revisions, price changes, promotion windows, ad state, store blockers, archive/unpublish events, and series follow-up tasks.

### Hermes Skill Contract Model

PiB's Hermes policy treats skills as owned, allowlisted, versioned runtime capabilities. Book Studio skills should follow that pattern rather than becoming ad-hoc prompts. Pip remains the orchestrator, specialist agents own skill families, and Quinn/QA reviews release-sensitive output.

Every Book Studio skill should declare:

- **Trigger phrases:** what user/request language loads the skill.
- **Inputs:** required record IDs, source artifacts, research IDs, client document IDs, or approval task IDs.
- **Outputs:** exact artifact type, target collection/document, and whether the output is internal, client-reviewable, or public-ready.
- **Evidence contract:** sources, assumptions, provenance, validation results, and confidence/risk flags.
- **Runtime contract:** generation run type, idempotency key, allowed source manifest, provider/model policy, retry/cancel behavior, and maximum cost/usage budget.
- **Safety contract:** prompt preflight, output postflight, required moderation/safety artifacts, and whether the output is allowed to become client-visible or publishing-facing.
- **Allowed actions:** read, draft, write, approve, publish, spend, message_client, or delete. Publish/spend/message_client/delete/secret work remains hard-gated by approval tasks.
- **Reviewer:** the default reviewer agent and when human approval is required.

Draft skill contracts:

| Skill | Owner | Inputs | Outputs | Evidence and gates |
| --- | --- | --- | --- | --- |
| `book-niche-research` | Sage | Client/org, audience, book type, target channels, seed keywords, source constraints. | Internal Research item with findings, recommendations, competitor/category notes, pricing ranges, and risk flags. | Must cite sources and keep visibility internal until reviewed. No invented bestseller claims. |
| `book-competitor-review-mining` | Sage | Approved competitor list or channel search brief, review URLs/snippets, target reader promise. | Pattern summary of reader complaints, praise, unmet needs, and positioning opportunities. | Must summarize patterns only. Do not copy review text into manuscripts or metadata. |
| `book-series-strategy` | Sage + Iris | Research item, target audience, genre, commercial goal, existing book/series IDs. | Series plan with standalone-vs-series recommendation, volume order, continuity bible requirements, cadence, and risk notes. | Must flag KDP/Google series constraints, volume gaps, public-domain/low-content issues, and continuity dependencies. |
| `book-brief-builder` | Iris | Client goal, Research item, audience, book type, brand voice, channel plan. | Book Brief client document or internal brief with approval mode, scope, success criteria, assumptions, and source links. | Client-visible only after internal review. Formal approval required before production tasks start. |
| `book-outline-builder` | Iris + Maya | Approved brief, book type, length/format constraints, series bible, research links. | Chapter/page map, continuity plan, required assets, and task candidates. | Must stay within approved brief. Changes to promise/audience/format create a brief revision. |
| `book-manuscript-structure-keeper` | Iris + Theo | Approved outline, book type, target formats, manuscript units, navigation rules, generation runs, editorial pass state. | Updated manuscript unit tree, TOC/navigation map, release snapshot recommendation, and unit-level blockers. | Cannot approve content quality by itself. Must block release snapshots when unit order, TOC labels, source units, or required pass coverage are inconsistent. |
| `book-draft-writer` | Maya | Approved outline section, style guide, research sources, AI disclosure state, writing constraints. | Draft manuscript section linked to a manuscript version or client document section. | Draft only. Must record AI-generated vs AI-assisted status and source dependencies. No public-ready claim. |
| `book-developmental-editor` | Iris | Draft manuscript, brief, outline, audience, book type. | Editorial report with structural issues, reader-fit notes, revision tasks, and approval recommendation. | Can propose rewrites but should not silently replace approved scope. |
| `book-copyeditor` | Iris | Revised manuscript, style guide, spelling locale, brand terms, glossary. | Copyedit pass with tracked suggestions or clean revision plus change summary. | Must preserve meaning and flag factual uncertainty instead of "fixing" facts. |
| `book-proofreader` | Quinn + Iris | Final-layout proof, manuscript version, file package, channel checklist. | Proofread report and final typo/formatting issue list. | Release gate evidence before export/publishing packet approval. |
| `book-reading-level-review` | Iris | Draft/manuscript, target age/grade, book type, sensitive content flags. | Reading-level and age-fit assessment with flagged vocabulary, sentence complexity, and content concerns. | Required for children's, early-reader, education, and YA projects. |
| `book-fact-checker` | Sage | Non-fiction draft claims, research sources, citation expectations. | Claim-level fact-check report with verified/disputed/unsupported status. | Unsupported claims must block client-visible publishing packets until resolved or removed. |
| `book-accessibility-review` | Quinn + Theo | Manuscript version or export package, unit tree, TOC/nav map, images/tables/media, language/reading-order metadata. | Accessibility review with pass/warn/block checks, metadata summary, missing alt text/table/link issues, and evaluator/report evidence. | Must block export approval when navigation, reading order, alt text, tables, links, or required accessibility metadata are missing or unresolved. |
| `book-cover-brief` | Maya | Book brief, metadata, audience, comparable covers, format/channel constraints. | Cover creative brief with title hierarchy, visual direction, trim/format needs, and avoid list. | Must flag trademark/IP/lookalike risks and store-safe content concerns. |
| `book-illustration-director` | Maya | Art style guide, character bible, scene list, rights constraints, model/tool constraints. | Scene prompts, continuity notes, asset checklist, and provenance requirements. | Must record AI/image provenance and block unlicensed style mimicry or celebrity/brand lookalikes. |
| `book-layout-designer` | Maya + Quinn | Manuscript, trim/format, interior type, images, bleed/margin rules. | Layout plan, page/spread map, print/ebook packaging checklist, and validation tasks. | Must separate layout recommendations from validated print-ready files until file checks pass. |
| `book-asset-rights-auditor` | Quinn | Asset list, source links, licenses, generated-image metadata, contributors. | Rights/provenance audit with pass/fail/blocker status for each asset. | Hard gate before client-visible publishing packet and public submission. |
| `book-generation-run-governor` | Pip + Theo | Project/task IDs, skill key, approved source manifest, target scope, model/provider policy, budget, idempotency key. | `BookGenerationRun` record, state transitions, retry/cancel/supersede notes, usage/cost reconciliation, and blocker tasks. | Required for long-running or high-cost generation/validation/import jobs. Cannot create public/client-visible output by itself. |
| `book-generation-safety-review` | Quinn + Pip | Prompt/output artifact, run ID, target audience, book type, provider safety feedback, PiB safety policy. | Safety review report with pass/warn/block state, flagged categories, visibility recommendation, and required next actions. | Blocks client-visible or publishing-facing output when preflight/postflight safety is failed, missing, stale, or unresolved. |
| `book-metadata-optimizer` | Sage + Maya | Approved brief, manuscript summary, categories, keywords, competitor research, channel constraints. | Channel-specific metadata packet: title/subtitle, description, keywords, categories, series text, mature flags. | Must avoid misleading categories, competitor names as keywords, keyword stuffing, and claims unsupported by content. |
| `book-kdp-readiness-check` | Quinn | KDP listing packet, files, AI disclosure, ISBN/imprint, metadata, pricing, series status. | KDP readiness report with blockers, warnings, and manual upload checklist. | Approval required before any KDP public submission. |
| `book-google-play-readiness-check` | Quinn | Google listing packet, PDF/EPUB files, metadata, identifiers, series details, pricing. | Google Play readiness report and Partner Center checklist. | Must check identifier/series consistency and file package readiness before upload. |
| `book-export-packager` | Theo + Quinn | Approved manuscript/assets, layout plan, metadata packet, validation requirements. | Export packet manifest with files, checksums, validation results, and manual-upload instructions. | Produces artifacts only; public publishing remains a separate approval-gated action. |
| `book-file-package-validator` | Quinn + Theo | Export package manifest, files, source versions, channel listing, preview/proof evidence. | Package validation report with pass/warn/block results, checksum-bound approval recommendation, and required re-export actions. | Must block upload approval when required files, checksums, rights snapshot, EPUBCheck/PDF/audio checks, or preview evidence are missing. |
| `book-publishing-account-readiness` | Quinn + Pip | Publishing account profile, channel listing, consent documents, account-readiness evidence, territory/pricing plan. | Account readiness report with pass/warn/block state, missing authority checklist, and recheck date. | Must not request, store, or transmit passwords, tax IDs, bank details, or identity documents; blocks upload approval when account authority or readiness is missing. |
| `book-publishing-ops` | Pip + Quinn | Approved publishing packet, channel listing IDs, approval task, manual upload state. | Channel status updates, external IDs, blocker tasks, and post-upload review notes. | Requires approval task for public submission; no silent store upload. |
| `book-analytics-import` | Vera | Channel reports, ad reports, UTM/landing data, book/series IDs, reporting period. | Analytics import with estimated/reported/settled separation and reconciliation notes. | Must preserve source report, import timestamp, currency, refunds/returns, and confidence. |
| `book-launch-campaign` | Maya + Ari + Vera | Approved book packet, launch window, channels, budget approval state, audience, tracking plan. | Launch campaign brief, social/email/ad tasks, landing-page/link plan, and measurement plan. | Drafts are allowed; paid spend and public/client-visible sends require approval gates. |
| `book-review-compliance-check` | Quinn + Ari | Launch plan, review request copy, ARC/free-copy plan, third-party promotion details, Amazon/FTC policy evidence. | Review-compliance report with pass/warn/block state, permitted copy, disclosure notes, and blocker tasks. | Required before review requests, ARC outreach, or third-party review/promotion services. Blocks compensation-for-sentiment, review gating, insider requests without disclosure review, and fake social proof. |
| `book-lifecycle-ops` | Pip + Vera | Live channel listings, launch plan, analytics summary, blocker notes, price/promotion/revision request, approval task. | Lifecycle event record, follow-up tasks, revised packet requirements, and analytics/postmortem summary. | Public listing changes, price changes, unpublish/archive, ad state changes, and revised-edition actions need approval gates. |

Future implementation should either add these as separate `.claude/skills/book-*/SKILL.md` files or group closely related editorial skills into a `book-editorial` package only if the manifest still exposes clear sub-capabilities. The policy manifest must include owner agent, allowed agents, risk level, sync target, and approval gates before VPS skill sync.

### Hermes Task Packet Runtime Shape

Book Studio should dispatch Hermes work through Projects/Kanban tasks rather than route-local prompts. The existing task shape already supports the needed contract: `assigneeAgentId`, `agentInput.spec`, `agentInput.context`, `agentInput.constraints`, `requiredCapability`, `riskLevel`, `reviewerAgentId`, `approvalGateTaskId`, `sourceResearchItemId`, `sourceDocumentId`, `sourceDocumentSectionId`, `expectedArtifacts`, `internalOnly`, and `agentOutput.artifacts`.

Recommended `agentInput.context` for Book Studio tasks:

```ts
type BookStudioSkillKey = string // must match a Book Studio entry in config/agent-skill-policy.json

interface BookStudioAgentContext {
  bookProjectId: string
  bookStudioSkillKey: BookStudioSkillKey
  sourceSpecVersion?: string
  bookSeriesId?: string
  editionId?: string
  channelListingId?: string
  publishingAccountProfileId?: string
  generationRunId?: string
  skillEvaluationId?: string
  manuscriptUnitId?: string
  manuscriptVersionId?: string
  launchPlanId?: string
  reviewComplianceRecordId?: string
  lifecycleEventId?: string
  bookTypeFamily: BookTypeFamily
  productionGateProfile: string
  sourceResearchItemId?: string
  sourceDocumentId?: string
  sourceDocumentSectionId?: string
  sourceArtifactIds?: string[]
  publishingPacketId?: string
  qualityGateIds?: string[]
  approvalGateTaskId?: string
  expectedArtifactTypes: BookStudioArtifactType[]
  visibility: 'internal' | 'client_reviewable'
  safetyPolicyKey?: string
  budget?: {
    maxCost?: { amount: number; currency: string }
    maxInputTokens?: number
    maxOutputTokens?: number
    maxImageCount?: number
    maxRuntimeSeconds?: number
  }
  riskFlags: string[]
}

type BookStudioArtifactType =
  | 'research_item'
  | 'book_brief_document'
  | 'series_strategy'
  | 'outline_packet'
  | 'manuscript_structure_map'
  | 'manuscript_section'
  | 'editorial_report'
  | 'claim_review_report'
  | 'accessibility_review_report'
  | 'cover_brief'
  | 'illustration_direction'
  | 'layout_plan'
  | 'rights_audit'
  | 'generation_run_report'
  | 'safety_review_report'
  | 'metadata_packet'
  | 'kdp_readiness_report'
  | 'google_play_readiness_report'
  | 'export_manifest'
  | 'file_package_validation_report'
  | 'publishing_status_note'
  | 'analytics_import'
  | 'launch_campaign_brief'
  | 'review_compliance_report'
  | 'lifecycle_status_report'
  | 'skill_evaluation_report'
```

Every Book Studio Hermes task should include:

- a concise `agentInput.spec` that states the job, accepted inputs, and exact output shape;
- `agentInput.context.bookStudioSkillKey` matching one Book Studio skill path or package capability in `config/agent-skill-policy.json`;
- `requiredCapability` set to an accepted task capability such as `research`, `content`, `qa`, `draft`, or `write`, or to a future Book Studio capability only after `lib/projects/taskPayload.ts` deliberately allows it;
- `riskLevel`, with rights, public publishing, AI disclosure, children's content, public-domain/companion, low-content, audiobook, and paid launch work defaulting to `high` or `critical`;
- at least one source pointer (`sourceResearchItemId`, `sourceDocumentId`, `sourceArtifactIds`, or `channelListingId`) unless the task is an initial research task;
- `manuscriptUnitId` or `manuscriptVersionId` for section drafting, editing, proofing, claim review, accessibility review, link/TOC review, and release-snapshot work;
- `generationRunId` for every long-running, high-cost, model-backed, validation, package, or report-import job;
- `safetyPolicyKey` and budget limits for any model-backed writing, image, cover, metadata, translation, or children's-content task;
- `expectedArtifacts` that name the artifact type and destination;
- a `reviewerAgentId` for any output that can become client-visible or publishing-facing;
- `approvalGateTaskId` whenever the task can influence public metadata, publishing, paid spend, ISBN/imprint, AI disclosure, or client-visible packets.

Skill outputs should use `agentOutput.summary` for a short human-readable result and `agentOutput.artifacts` for structured references. A skill may draft, annotate, recommend, or create internal artifacts, but it should not silently transition a book project, channel listing, client document, or campaign into an externally visible state. State transitions remain task/API actions with approval evidence.

### Initial Skill Implementation Waves

Implementation should not try to install all skills at once. The first wave should cover the minimum production loop:

| Wave | Skills | Why first |
| --- | --- | --- |
| 1. Foundation research and brief | `book-generation-run-governor`, `book-niche-research`, `book-series-strategy`, `book-brief-builder`, `book-outline-builder` | Creates the evidence, planning, and execution-control loop before manuscript or publishing work starts. |
| 2. Safety and release checks | `book-generation-safety-review`, `book-asset-rights-auditor`, `book-metadata-optimizer`, `book-kdp-readiness-check`, `book-google-play-readiness-check`, `book-publishing-account-readiness` | Prevents policy/rights/account-authority mistakes before anything reaches a client or store. |
| 3. Production drafting | `book-manuscript-structure-keeper`, `book-draft-writer`, `book-developmental-editor`, `book-copyeditor`, `book-proofreader`, `book-reading-level-review`, `book-fact-checker`, `book-accessibility-review` | Useful only after the brief and gate model are stable; keeps drafts tied to units, claims, navigation, accessibility, and version snapshots. |
| 4. Visual and package work | `book-cover-brief`, `book-illustration-director`, `book-layout-designer`, `book-export-packager`, `book-file-package-validator` | Depends on approved book direction, rights rules, and file-package conventions. |
| 5. Launch and analytics | `book-publishing-ops`, `book-analytics-import`, `book-launch-campaign`, `book-review-compliance-check`, `book-lifecycle-ops` | Depends on channel listing state, packet fields, import ledger behavior, review hygiene, attribution, and public lifecycle governance. |

`book-publishing-account-readiness` should run with Wave 2 for any project that expects PiB to help upload or reconcile reports, because unresolved account authority can block a launch even when metadata and files are ready.

Wave 1 and Wave 2 are the right targets for a first Hermes skill rollout because they reduce strategic and policy risk before the module generates a large amount of manuscript or visual work.

### Skill Rollout, Evaluation, And Policy Sync

The skill list above is not enough by itself. A Book Studio skill is not production-ready until PiB can prove what it may do, which agents may run it, what evidence it must return, and which fixtures it passes. Otherwise the module recreates the risk of a single broad book assistant with attractive output and weak controls.

Current PiB policy already has the right enforcement surface:

- `config/agent-skill-policy.json` is the canonical manifest for repo skill paths, owner agent, allowed runtime agents, risk level, sync target, agent skill lists, capabilities, approval gates, and reviewer defaults.
- `docs/deploy/hermes-agent-skill-policy.md` requires generated runtime directories at `/var/lib/hermes/agent-skills/<agentId>` and warns against loading `/var/lib/hermes/pib-skills` directly.
- `lib/agents/skill-policy.ts` can list catalog skills, build per-agent policy state, classify installed skills, and compute drift between expected and installed skills.
- `lib/projects/taskPayload.ts` already preserves provenance fields, but it currently accepts only the existing `VALID_AGENT_CAPABILITIES`. Book Studio should not put exact skill names into `requiredCapability` until that validator is extended. Use `bookStudioSkillKey` in `agentInput.context` for exact dispatch identity, and keep `requiredCapability` on the accepted capability vocabulary until a deliberate migration adds a Book Studio capability namespace.

Skill policy bootstrap should work like this:

1. Add draft skill docs under `.claude/skills/book-*/SKILL.md` or a small number of grouped packages only where the package still exposes exact sub-capabilities.
2. Add matching `skillCatalog` entries with `ownerAgentId`, `allowedAgentIds`, `riskLevel`, and `syncTarget: 'vps'`.
3. Add the skills to the owning and allowed agents' `pibSkills` or `runtimeSkills` lists only after fixture tests pass.
4. Keep publish, spend, message-client, access-secret, delete, and final approval work behind the existing hard approval gates.
5. Run manifest validation and drift checks before VPS sync. A missing, unexpected, or locally profile-loaded Book Studio skill is a blocker, not a warning.

Skill readiness should be explicit:

| Level | State | Allowed use |
| --- | --- | --- |
| 0 | Proposed in dossier only | No runtime task dispatch. |
| 1 | Skill doc drafted | Internal review only; no watcher dispatch. |
| 2 | Manifest allowlisted | Can appear in policy preview and drift checks, but cannot affect client-visible or publishing-facing records. |
| 3 | Fixture tested | Can run against canned inputs and produce expected artifacts; still no live project mutation. |
| 4 | Sandbox dry-run verified | Can run on internal sandbox book projects with internal-only output and reviewer assignment. |
| 5 | Internal project enabled | Can run on real PiB-operated book projects, still behind reviewer and approval gates. |
| 6 | Client-visible enabled | Outputs may become client-reviewable only after visibility, safety, rights, provenance, and reviewer gates pass. |

Minimum evaluation fixtures:

| Fixture | Skills covered | Must prove |
| --- | --- | --- |
| Market niche research | `book-niche-research`, `book-series-strategy`, `book-brief-builder` | Sources are cited, assumptions are labeled, findings stay internal, and no bestseller/category claims are invented. |
| Public-domain or companion-risk project | `book-asset-rights-auditor`, `book-kdp-readiness-check`, `book-google-play-readiness-check` | Public-domain proof, copyrighted-source risk, companion-guide limits, territory risk, and upload blockers are surfaced before metadata or manuscript work proceeds. |
| Children's fixed-layout picture book | `book-outline-builder`, `book-illustration-director`, `book-reading-level-review`, `book-accessibility-review`, `book-file-package-validator` | Age fit, visual continuity, image provenance, alt text, reading order, bleed/trim assumptions, and safety review are required before client visibility. |
| Low-content workbook or puzzle book | `book-layout-designer`, `book-export-packager`, `book-google-play-readiness-check`, `book-file-package-validator` | The workflow treats print/DRM/printing requirements as product constraints and blocks Google settings that would make physical-page use impossible. |
| Nonfiction claims and citations | `book-fact-checker`, `book-developmental-editor`, `book-copyeditor` | Unsupported claims become blockers or revision tasks instead of silently edited prose. |
| Launch and review compliance | `book-launch-campaign`, `book-review-compliance-check`, `book-lifecycle-ops` | Review requests, ARC/free-copy plans, third-party promotion services, public sends, and paid spend all require compliance evidence and approval gates. |
| Analytics import reconciliation | `book-analytics-import`, `book-lifecycle-ops` | Estimated, reported, settled, refunded, and attributed metrics remain source-labeled and create reconciliation tasks when identifiers or totals do not match. |
| Export/package validation | `book-export-packager`, `book-file-package-validator`, `book-publishing-ops` | Checksums, file roles, preview evidence, rights snapshots, and manual upload instructions are present before upload approval. |

Dispatch blockers:

- Do not dispatch a task whose `bookStudioSkillKey` is absent from the manifest or below the required readiness level for that project scope.
- Do not dispatch a task blocked by dependencies or a pending `approvalGateTaskId`.
- Do not dispatch a model-backed writing, translation, image, metadata, children's-content, validation, or report-import job without `generationRunId`, `safetyPolicyKey`, budget limits, and an idempotency key.
- Do not dispatch client-visible or publishing-facing work without `reviewerAgentId`, `expectedArtifacts`, source links, and a visibility target.
- Do not dispatch public publishing, paid launch, review outreach, price change, unpublish/archive, secret/account, or destructive-data actions as direct skill actions. Those remain approval-gated operator/API actions.
- Do not sync Book Studio skills to the VPS when drift checks show missing skills, unexpected profile skills, wrong external dirs, stale local profile skills, or manifest/package mismatch.

First rollout sequence:

1. Add manifest entries and draft skill docs for Wave 1 and Wave 2, but keep them internal-only.
2. Add tests for manifest shape, task payload sanitizer support for `bookStudioSkillKey`, forbidden direct-action fields, and required provenance.
3. Run the evaluation fixtures above against canned inputs and record `skill_evaluation_report` artifacts.
4. Enable sandbox dry-runs on one internal PiB book project.
5. Enable internal project dispatch only after drift checks are clean and Quinn/Iris have reviewed the fixture outputs.
6. Allow client-reviewable outputs only after the portal visibility model, safety gates, rights/provenance gates, and approval tasks are implemented.

### Skill Action Matrix

| Action | Admin/operator | Portal client | Hermes skill |
| --- | --- | --- | --- |
| Create book project | Yes | No in V1 | No; can recommend via task |
| Create Research item | Yes | No | Yes for research skills, internal by default |
| Create Book Brief | Yes | Review/approve only | Draft only; client-visible after review |
| Create outline | Yes | Review/approve only when exposed | Draft only |
| Draft manuscript section | Yes | Review/comment only when exposed | Draft only, never final approval |
| Create cover/illustration direction | Yes | Review/comment only when exposed | Draft only with provenance requirements |
| Approve rights/AI disclosure/ISBN/imprint | Yes | Can confirm facts where requested | No final approval |
| Approve publishing account authority | Yes | Can grant/confirm client-owned access where requested | Readiness check only; no secret handling |
| Approve publishing packet | Yes | Can approve client-facing facts/scope | No |
| Upload/publish to KDP/Google | Manual operator action in V1 | No | No direct public publishing |
| Change paid launch spend | Yes with approval | No | No direct spend |
| Import analytics reports | Yes | No | Yes for import/normalization tasks |
| View analytics | Yes | Client-safe summary | Yes if assigned |
| Request reviews or run ARC outreach | Yes with compliance approval | Can receive approved request only | Compliance check only; no manipulation or direct review gating |
| Schedule promotions or price changes | Yes with approval | Can approve client-facing facts where requested | Draft/recommend only |
| Record lifecycle events | Yes | Client-safe summary where visible | Draft/recommend and create internal reports only |

This matrix should be enforced in skill policy, task creation, and future API guards. If a skill output recommends a public action, the output should create or update a blocker/approval task rather than performing the action itself.

### Approval Gates

These actions should require explicit approval tasks:

- Public publishing submission.
- Paid ad campaign launch or spend changes.
- Review request, ARC/free-copy outreach, or third-party promotion plan.
- KDP/Google promotion scheduling or price change.
- Unpublish/archive, revised edition, metadata update, or file revision affecting a public listing.
- Client-visible publication package.
- AI-generated content disclosure decision.
- ISBN/imprint decision.
- Publishing account owner, service-provider consent, report/payment access, or PiB-owned-imprint operating model.
- Copyright-sensitive derivative/companion book decisions.
- Final metadata if it can affect public listing or policy compliance.

## Devil's Advocate

### Product Risk

- A "make books with AI" module can quickly become low-quality AI slop if it optimizes for volume over editorial quality.
- KDP and Google policies are not static; hardcoded claims will age badly.
- Self-serve clients may publish bad or infringing content and blame PiB.
- Book publishing is slower than app/social workflows; users may expect instant results and underestimate editing/proofing.

Mitigation: position V1 as a controlled production workflow with quality gates, not an instant-publish button.

### Legal And Rights Risk

- AI-generated images/text must be tracked for KDP disclosure.
- Covers or art too close to known books/brands can create policy and IP risk.
- Companion books, summaries, study guides, or public-domain derivatives can trigger policy scrutiny.
- Author/imprint/ISBN ownership decisions have long-term consequences.
- Publishing under the wrong account, legal name, imprint, tax profile, or payment profile can create ownership and revenue disputes even if the book itself is valid.

Mitigation: store provenance, disclosure state, source links, and required human approvals.

### Platform Risk

- KDP does not expose a simple official publish API for this use case.
- Google Play Books supports bulk workflows but still expects Partner Center setup and policy compliance.
- Store analytics are delayed and can disagree with ads reports.
- KDP Select exclusivity conflicts with selling the ebook elsewhere.
- KDP account setup, identity verification, tax validation, two-step verification, and no-shared-credential constraints can block upload timing; Google Partner Center access and service-provider consent can block report reconciliation.

Mitigation: build channel adapters and manual checklist/export flows first; API automation only for sanctioned reporting/ads surfaces.

### Engineering Risk

- Fixed-layout books, EPUB generation, print PDF, cover wrap, and image-heavy exports are complex.
- Firestore records can get large if manuscript/page content and image metadata are stored carelessly.
- Long-running generation jobs do not fit ordinary request/response routes.
- Model-backed generation can fail, expire, duplicate, or return in a different order from request order when run through batch/offline systems.
- Without a run ledger, cost, token usage, model/provider version, prompt inputs, and stale-output overwrites become difficult to audit.
- Rendering acceptance by KDP/Google cannot be proven by local tests alone.

Mitigation: keep core records small, store large files in storage, use generation run records plus agent tasks, enforce idempotency/supersede rules, and create verifiable export packages.

### AI Safety And Quality Risk

- Book generation can produce unsafe, mature, defamatory, low-quality, or policy-incompatible text/images before anyone notices.
- Provider safety systems are useful but not identical to PiB's business policy or KDP/Google publishing risk.
- Safety scores and categories can change as provider models evolve, so thresholds must be versioned and reviewable.
- Children's books, education, health/legal/financial non-fiction, public-domain derivatives, and AI images need stricter human review than ordinary internal drafts.
- An output can be "safe" in a moderation sense and still be commercially unusable, plagiaristic-looking, misleading, off-brief, or rights-risky.

Mitigation: require prompt preflight, output postflight, safety report artifacts, rights/provenance gates, reviewer approval, and client/publishing visibility locks before generated output leaves internal review.

### Commercial Risk

- Many book types have weak margins after print costs, delivery fees, refunds, ad spend, and human/Hermes production time.
- KDP print royalty thresholds can make a small price change materially affect margin.
- KDP Select can improve KU/promotional reach while blocking wide ebook sales for the enrollment period.
- Bookstore distribution through Ingram-like channels can introduce return risk and wholesale-discount pressure.
- Children's, illustrated, comic, workbook, and audio books are expensive to make well and can have high file/print costs.
- Paid ads can burn budget before reviews, conversion evidence, series read-through, or social proof exist.
- Review requests, ARC/free-copy programs, third-party promotion sites, and influencer outreach can create Amazon/FTC risk if compensation, disclosure, or sentiment conditions are mishandled.
- Amazon Ads, KDP, Google promotions, PiB links, and external ad dashboards can all report different attribution slices, so launch "success" is easy to overclaim.
- A client can mistake downloads, free-rank movement, email opens, or ad-attributed sales for durable profit if the dashboard does not separate free, paid, attributed, settled, and margin-adjusted outcomes.

Mitigation: require a pricing plan, cost estimate, margin confidence label, launch plan, review-compliance record, tracking plan, and reviewer approval before publishing packets, promotion windows, review requests, or ad budgets can move to launch.

## Phased Delivery Recommendation

### Phase 0: Discovery And Final Product Decision

- Confirm target user: internal PiB team, client-facing, or public SaaS.
- Confirm initial book categories.
- Confirm whether V1 includes actual file export or only workflow/checklists.
- Confirm whether clients can approve but not create.

### Phase 1: Book Studio Foundation

- Admin-only book/series workspace.
- Firestore records for books, series, channel listings, and artifacts.
- Book-type gate profiles for narrative, children's, visual/sequential, nonfiction, activity/workbook, low-content, public-domain/companion, and audiobook projects.
- PiB integration wiring for Research, Client Documents, Projects/Kanban, workspace artifacts, Hermes task provenance, and future `settings.portalModules.bookStudio`.
- Research linkages.
- Client document generation for book brief and publishing packet.
- Portal module toggle, but portal may show read/review only.
- Publishing account profile readiness for KDP/Google before upload approval.
- Generation run ledger for model-backed Hermes work, budgets, safety checks, retries, and stale-output protection.
- Hermes skills for research, brief, outline, metadata, readiness check, run governance, and generation safety review.

### Phase 2: Manuscript And Series Production

- Outline and manuscript versioning.
- Manuscript unit tree for front matter, body matter, back matter, chapters, sections, pages/spreads, captions, exercises, answer keys, glossary entries, and references.
- Editorial pass ledger for developmental edit, copyedit, proofread, fact check, reading-level review, accessibility review, link/TOC review, specialist review, and client review.
- Claim/citation ledger for non-fiction, instructional, education, public-domain/companion, and other evidence-sensitive projects.
- Accessibility review records for reading order, TOC/navigation, link targets, alt text, tables, language direction, media alternatives, evaluator/date/report metadata, and export blockers.
- Series style guide and continuity checks.
- Page/chapter/unit status.
- Comments and approval handoff through client documents.
- Asset library/provenance.

### Phase 3: Export Packages

- EPUB export for reflowable books.
- PDF interior export for simple print/fixed layouts.
- Cover asset package.
- Metadata packet.
- File package manifest with checksums, validation results, preview/proof evidence, rights/disclosure snapshot, and upload instructions.
- KDP/Google checklists.

### Phase 4: Publishing Ops And Analytics

- Channel listing status tracking.
- Launch campaign plan with PiB landing, email, social, ads, Amazon Attribution, Google promotions, and approved tracking links.
- Review-compliance ledger for review requests, ARC/free-copy outreach, third-party services, and FTC/Amazon risk.
- Promotion window tracker for KDP Free Promotions, Kindle Countdown Deals, Google promo codes/pricing, series bundles, and series subscriptions.
- Lifecycle event tracker for price changes, revised editions, metadata updates, file revisions, unpublish/archive, series follow-ups, and postmortems.
- Manual import for KDP/Google reports.
- PiB launch campaign linkage.
- Series/book dashboards.
- Royalty/ad-spend/unit economics.

### Phase 5: Deeper Automation

- Sanctioned Amazon Ads/Amazon Attribution integration.
- Google report import improvements.
- Additional channels such as Apple/Kobo/D2D/IngramSpark.
- Direct publishing automation only where an official, stable API and approval model exist.

## First Scope Recommendation

Build the first approved spec around:

1. Admin Book Studio.
2. Series manager.
3. Book-type gate profiles and compliance defaults.
4. PiB-native integration backbone: Research, Client Documents, Projects/Kanban, workspace artifacts, Hermes task provenance, and future portal module gating.
5. Research-backed book brief.
6. Generation run ledger for model-backed Hermes jobs, budgets, safety checks, retries, and stale-output protection.
7. Hermes skill set for research, outline, metadata, readiness, run governance, and safety review.
8. Client document approval for brief and publishing packet.
9. Export package manifest and validation tracker for source archives, KDP/Google files, checksums, preview evidence, and upload instructions.
10. Publisher account governance for KDP/Google ownership, access, tax/payment/profile readiness, report access, and operating authority.
11. KDP/Google export checklist and channel listing tracker.
12. Launch/review/promotion lifecycle ledger for governed sell-through operations after upload.
13. Analytics import model, initially manual CSV/report ingestion.

Do not include in the first implementation:

- Public self-serve SaaS.
- Fully automatic KDP/Google publishing.
- Full print-perfect PDF engine for every book type.
- All channels.
- Autonomous paid ads launch.

## Phase 1 Foundation Blueprint

This is not yet an implementation plan. It is the smallest coherent foundation that turns the research dossier into a PiB-native product surface once the product position is approved.

### Phase 1 Epics

| Epic | Scope | Why it matters | Done when |
| --- | --- | --- | --- |
| Module entitlement | Add a future `settings.portalModules.bookStudio` switch, safe portal org exposure, and portal API guards. | Client visibility must be controlled per organisation, matching the new Mobile Apps module-switch pattern. | Admin can enable/disable portal Book Studio visibility without affecting internal admin work. |
| Domain records | Add typed records and sanitizers for `book_projects`, `book_series`, `book_project_editions`, `book_channel_listings`, `book_quality_gates`, manuscript/editorial records, provenance/version/rights records, and analytics import metadata. | The module needs book-specific state, but Research, Documents, Projects, and artifacts remain authoritative for evidence, approvals, work, and large files. | Records are org-scoped, serializable, guarded by role, and do not embed large manuscript or image payloads. |
| Admin workspace | Build admin list/detail routes for book projects and series with tabs for overview, research, brief, production, publishing, gates, and analytics. | Operators need one command surface before manuscript generation or export engines exist. | A PiB admin can create a project, connect it to a series, see status/risk/gates, and move through the production checklist. |
| Research and brief bridge | Link or create Research items and Book Brief client documents from a book project. | The module should inherit PiB's evidence and approval model rather than recreate `ai-story` research notes. | A book project can show linked findings/recommendations, create a brief packet, and preserve source IDs. |
| Hermes task contracts | Store Hermes-ready task metadata for research, brief, outline, metadata, and readiness work without granting direct publish powers. | Agent output must be bounded, reviewable, and attributable. | Created tasks include book context, expected artifacts, reviewer, risk level, and approval-gate linkage. |
| Hermes skill policy and evaluation harness | Add draft Wave 1 and Wave 2 Book Studio skill docs, manifest entries, readiness levels, fixture definitions, and evaluation-result artifacts before runtime enablement. | Book Studio depends on Hermes work, but untested skills can create bad manuscripts, misleading metadata, rights exposure, or unsafe publishing decisions at scale. | Each enabled skill has manifest ownership, allowed agents, risk level, sync target, fixture coverage, readiness state, and clean drift status before watcher dispatch. |
| Generation run ledger | Add `BookGenerationRun` records linked to tasks, source manifests, prompt specs, provider jobs, usage/cost budgets, safety review, retries, and output artifacts. | Long-running book generation and validation cannot be trusted as route-local model calls or chat transcripts. | Model-backed tasks create run records, enforce idempotency, preserve usage/safety results, and prevent stale runs from overwriting newer approved versions. |
| Rights, provenance, and version ledger | Add provenance events, version manifests, rights reviews, and asset-rights metadata linked to documents, tasks, and artifacts. | AI disclosure, copyright registration, public-domain/companion claims, asset licensing, and client disputes require evidence before upload, not after a problem appears. | Each reviewable or exportable version has source links, AI usage classification, contributors, checksums where relevant, rights state, and a release-gate decision. |
| Export package manifest | Add file package records for source archives, KDP ebook/print, Google ebook, audiobook, and metadata-only packets with files, checksums, validations, preview evidence, source versions, rights snapshots, and upload instructions. | Store-ready work is not proven by manuscript approval. The module needs a repeatable way to prove which exact files were validated, previewed, approved, uploaded, and later superseded. | A channel listing can reference candidate packages, and only a package with required files, validation results, preview evidence, provenance, and checksum-bound approval can become the approved upload package. |
| Publishing account governance | Add channel account profile records for KDP/Google ownership, access method, legal publisher/imprint, tax/payment/report readiness, Google service-provider consent, territories, blockers, and evidence artifacts without storing secrets. | Upload-ready files are still not publishable if account identity, tax, payment, territory, report access, or operating authority is unresolved. | A channel listing references an account profile, and upload approval is blocked when the profile is missing, stale, credential-sharing-dependent, or has unresolved account blockers. |
| Publishing packet and channel tracker | Add KDP/Google channel listing records, readiness state, blocker notes, metadata fields, file checklist, AI disclosure, ISBN/imprint decision, pricing summary, and manual external status. | KDP/Google setup is currently a manual operator action; PiB should prepare and track it, not pretend it can safely auto-publish. | A project can produce a channel-specific readiness packet and record uploaded/in review/live/blocked status with evidence. |
| Commercial pricing ledger | Add price-plan, cost-estimate, margin-confidence, and approval fields to channel listings before reports are imported. | KDP/Google economics vary by royalty option, print cost, delivery cost, territory, exclusivity, refunds, payment profile, and currency conversion. | Admin can record a KDP/Google price plan, attach calculator/Partner Center evidence, see estimated margin/cost recovery, and require reviewer approval or a waiver before launch. |
| Portal review surface | Add client-safe portal read/review routes only when the module is enabled and selected records are approved for portal visibility. | Clients need review and approval, not internal risk notes or raw research assumptions. | Portal users see only approved briefs, proofs, publishing packets, comments, and approval/change-request actions. |
| Analytics ingestion shell | Add manual report-import ledger and normalized analytics snapshot records before building automated integrations. | KDP and Google reports can lag and disagree; the data model must separate estimated, reported, and settled figures from day one. | Admin can attach a KDP/Google report import, see confidence/source labels, and create reconciliation tasks for mismatches. |

### Phase 1 Acceptance Criteria

- A PiB admin can create a book project under a client organisation with `bookTypeFamily`, status, series, initial target channels, and compliance defaults.
- Missing or disabled portal entitlement cannot expose Book Studio in portal nav, portal API responses, or scoped workspace state.
- Book-type gate profiles generate the correct initial `book_quality_gates` for narrative, children's, visual/sequential, nonfiction, activity/workbook, low-content, public-domain/companion, and audiobook projects.
- The project detail can link Research, create or attach a Book Brief document, link a Project/Kanban workspace, and show linked artifacts without duplicating those systems.
- Manuscript/proof/export versions can store provenance manifests with source document/artifact/task links, contributor roles, AI usage classification, rights review IDs, and checksums where files are involved.
- Export file packages can store package type, state, source versions, source artifacts, file roles, filenames, MIME types, sizes, SHA-256 checksums, validation results, preview/proof evidence, rights/disclosure snapshots, upload instructions, blockers, and checksum-bound approval state.
- Publishing account profiles can store channel, owner, legal publisher/imprint, access method, PiB operator IDs, consent evidence, identity/tax/payment/report/territory readiness, recheck dates, and account-level blockers without storing passwords, tax IDs, bank account numbers, or identity documents.
- Rights reviews can block or approve AI disclosure, copyright-registration posture, public-domain/companion claims, quote permissions, asset/font/audio licenses, territory rights, and Google DRM/printing settings.
- Hermes task preparation is possible for research, brief, outline, metadata, and readiness checks, but the tasks do not publish, submit, or spend money.
- Book Studio task packets store an exact `bookStudioSkillKey` while `requiredCapability` remains compatible with the current task payload validator or a deliberate future Book Studio capability migration.
- Wave 1 and Wave 2 skills cannot be enabled for watcher dispatch until they have manifest entries, owner/allowed-agent metadata, readiness state, fixture coverage, reviewer defaults, and clean drift checks.
- `skill_evaluation_report` artifacts record fixture input, expected artifacts, actual artifacts, pass/warn/block state, reviewer, readiness level, and required follow-up tasks.
- Dispatch is blocked when a skill is missing from the manifest, below readiness level, blocked by a pending approval gate, missing expected artifacts, missing source evidence, or trying to request publish/spend/message-client/access-secret/delete work directly.
- Model-backed Hermes tasks create `BookGenerationRun` records with idempotency keys, approved source manifests, provider/model policy, prompt spec version, usage/cost budgets, safety policy, and output artifact references.
- A stale, failed, blocked, expired, cancelled, or superseded generation run cannot update an approved manuscript version, client-visible packet, export package, or channel listing.
- Generation outputs cannot become client-visible or publishing-facing until required prompt/output safety review, rights/provenance checks, and reviewer gates pass.
- Budget overruns, repeated retries, high-cost runs, missing usage data, or unsafe retained-prompt requests create blocker/approval tasks instead of continuing silently.
- Manuscript units can be versioned independently from release manifests, and approved manifests cannot be silently mutated by later section/page edits.
- Manuscript/proof snapshots can require editorial pass coverage, claim/citation review, TOC/link review, and accessibility review before client visibility or export approval.
- A KDP readiness packet explicitly captures metadata, categories/keywords, file checklist, AI-generated-vs-assisted disclosure, ISBN/imprint choice, rights confirmation, content-risk notes, provenance/version evidence, pricing, and manual upload status.
- A Google Play readiness packet explicitly captures EPUB/PDF readiness, cover file, metadata, series naming/volume consistency, rights/territories, pricing, DRM/copy-print choices, provenance/version evidence, and manual Partner Center status.
- KDP and Google channel listings can store price plans, royalty/revenue-share assumptions, cost estimates, KDP Select exclusivity state, calculator/effective-price evidence, margin confidence, and approval/waiver state.
- KDP and Google channel listings reference a publishing account profile before upload approval; unresolved account blockers prevent `approved_for_upload`.
- A project cannot mark a channel listing `approved_for_upload` unless the selected upload package is in `approved_for_upload` state and all included file checksums match the package approval task.
- A project cannot mark a publishing packet `approved_for_upload` while its selected channel listing has an unreviewed price plan, an unresolved KDP Select/wide-distribution conflict, or a negative per-unit margin without a waiver.
- A project cannot mark a publishing packet `approved_for_upload` while its selected publishing account profile has incomplete identity, tax, payment, access, report, or territory readiness required for that channel.
- Portal reviewers can comment, approve, or request changes on approved client-visible packets while internal research, unresolved rights blockers, and draft risk notes remain hidden.
- Analytics imports are source-labeled and confidence-labeled; estimated dashboard data, reported sales/read data, settled payment data, and ad attribution data are not merged into one ambiguous metric.
- Launch plans can store campaign activities, tracking IDs, budgets, approval gates, promotion windows, review-compliance records, and lifecycle events without launching ads or sending public/client-visible messages automatically.
- Review requests, ARC/free-copy outreach, and third-party promotion services are blocked until review-compliance checks pass or an approval-task waiver exists.

### Phase 1 Test Focus

- Type/sanitizer tests for Book Studio records, provenance/version/rights records, and defaults.
- Type/sanitizer tests for export package manifests, file roles, validation results, preview evidence, and checksum-bound approvals.
- Type/sanitizer tests for manuscript units, unit revisions, editorial passes, claim reviews, accessibility reviews, and release snapshot manifests.
- Admin API tests for org scoping, create/update/list, soft archive, and linked-record preservation.
- Portal guard tests for disabled module state, role access, and client-visible filtering.
- Gate-profile tests for each book type family.
- Publishing packet tests for KDP and Google required fields and blocker behavior.
- File package gate tests that block upload approval when required files, checksums, validation results, preview evidence, or rights/disclosure snapshots are missing or stale.
- Publishing account profile tests that ensure sensitive credentials cannot be stored and upload approval is blocked by missing/stale account readiness, unresolved account blockers, or shared-credential-dependent access.
- Hermes skill policy tests that verify Book Studio skill manifest entries include owner agent, allowed agents, risk level, sync target, reviewer defaults, and do not appear in runtime agent lists before the required readiness level.
- Hermes task contract tests that verify `bookStudioSkillKey`, `requiredCapability` validator compatibility, provenance, reviewer, expected artifacts, and forbidden direct-action fields.
- Skill evaluation fixture tests for market research, public-domain/companion risk, children's fixed layout, low-content workbook, nonfiction claims, launch/review compliance, analytics reconciliation, and export/package validation.
- Drift tests that block VPS sync or watcher dispatch when expected Book Studio skills are missing, unexpected skills are installed, external dirs are wrong, or local profile skills bypass the policy manifest.
- Generation run tests that verify idempotency keys, source manifests, usage budgets, retry/cancel/supersede transitions, and stale-run overwrite blocking.
- Safety gate tests that block client-visible or publishing-facing output when prompt/output moderation, provider safety feedback, rights review, or reviewer approval is missing, failed, stale, or inconclusive.
- Manuscript production tests that verify approved version manifests do not mutate when units are revised, and that missing editorial/claim/accessibility/link/TOC coverage blocks client-visible proof or export approval where required.
- Gate tests that block publishing-packet readiness when provenance, rights review, AI disclosure, or version manifest evidence is missing.
- Analytics import tests that verify estimated/reported/settled separation and reconciliation task creation.
- Launch lifecycle tests that verify paid activity, review outreach, promotion windows, price changes, and public listing lifecycle events require approval gates and preserve attribution/review-compliance evidence.

### Phase 1 Explicit Deferrals

- No direct KDP, Google Play Books, Apple, Kobo, Draft2Digital, IngramSpark, ACX, or ads API publishing.
- No client self-serve book generator.
- No full manuscript editor or print-perfect fixed-layout engine.
- No autonomous cover/image generation approval into public packets.
- No automated ISBN purchase/registration.
- No paid ad launch, budget mutation, or Amazon Ads automation.
- No automated review solicitation, third-party promotion purchase, or influencer/ARC outreach.
- No automated KDP/Google promotion scheduling or price-change execution.
- No guarantee that a packet passing PiB readiness will be accepted by a publishing platform.

Approval of option 1, internal PiB production studio with optional client review, should unlock a separate implementation plan for this Phase 1 foundation.

## Open Product Decision

The next design step depends on one product decision:

Should Book Studio V1 be:

1. **Internal PiB production studio with optional client review**.
2. **Client-facing module where clients create their own books**.
3. **Public/productized AI-book SaaS surface**.

Recommendation: choose option 1 for V1.
