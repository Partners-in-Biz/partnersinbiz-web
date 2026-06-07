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

### Canonical Records And Ownership

V1 should introduce small, org-scoped Book Studio records while using existing PiB primitives for evidence, review, work, and files:

- `book_projects`: core identity, status, type family, gate profile, creative brief summary, compliance state, linked PiB records, and current risk state.
- `book_series`: series identity, order mode, style/continuity bible, volume map, shared channel-series metadata, and release cadence.
- `book_editions` or `book_project_editions`: ebook, paperback, hardcover, audiobook, workbook, low-content, or fixed-layout edition records. Each edition stores format decisions, file requirements, identifiers, and readiness state.
- `book_manuscript_versions`: version metadata, authorship/AI provenance, section map, approval state, and document/artifact links. Large manuscript content should live in client documents, Google Docs, or storage-backed artifacts, not as a large Firestore blob.
- `book_sections` or `book_pages`: semantic chapters/sections for reflowable books and pages/spreads/panels for fixed-layout books. These should stay concise and link to artifacts for large images/files.
- `book_channel_listings`: KDP, Google, and future channel state with metadata, pricing, territory rights, identifiers, upload status, blockers, and readiness report links.
- `book_quality_gates`: required checks, source task/document/research evidence, reviewer, pass/warn/block state, waiver state, and approval task link.
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
4. **Production tasks:** Pip or the operator creates Hermes-ready Project/Kanban tasks with `agentInput.context.bookProjectId`, `bookSeriesId`, `sourceResearchItemId`, `sourceDocumentId`, `requiredCapability`, `riskLevel`, `reviewerAgentId`, `approvalGateTaskId`, and `expectedArtifacts`.
5. **Manuscript and assets:** Maya/Iris/Quinn tasks create or revise sections, style guides, covers, illustrations, and proof reports. File outputs are linked as workspace artifacts with provenance and visibility state.
6. **Quality gates:** `book_quality_gates` aggregate evidence from tasks, documents, research, and artifacts. Blockers stay internal until resolved or waived through an approval task.
7. **Publishing packet:** Quinn/Pip assemble channel-specific metadata, files, AI disclosure, ISBN/imprint choice, rights/territory state, and upload checklist into a client document or internal packet.
8. **Manual channel execution:** Operator uploads externally to KDP/Google and records external IDs, status, review notes, blockers, and live URLs in `book_channel_listings`.
9. **Analytics import:** Vera imports reports/ad data/PiB launch funnel rows, matches them to book/series/edition/channel listings, and creates reconciliation tasks for mismatches.

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

Do not promise full KDP acceptance in-app. KDP Print Previewer and store review remain external gates.

### 7. Publishing Operations

V1 should track manual publishing with export packages:

- KDP eBook setup.
- KDP print setup.
- Google Play Books setup.
- Future channel slots for Apple/Kobo/D2D/IngramSpark.
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

KDP design sources: [Create a Book](https://kdp.amazon.com/help?topicId=G202172740), [Upload Book Resources](https://kdp.amazon.com/en_US/help/topic/G202175860), [Upload and Preview Book Content](https://kdp.amazon.com/en_US/help/topic/G200641240/), [Metadata Guidelines](https://kdp.amazon.com/help?topicId=G201953870), and [Content Guidelines](https://kdp.amazon.com/en_US/help/topic/G200672390).

Google Play Books packet fields:

- **Book metadata:** ISBN or Google identifier, title, contributors, language, genre, description, publisher/imprint, release date, series name, series relationship, and volume number.
- **Files:** EPUB artifact, PDF artifact, cover artifact, EpubCheck result for EPUB, PDF password/bookmark check, file size check, filename convention state for bulk/identifier-based upload, and full-book-not-sample confirmation.
- **Sales settings:** countries/territories, price/currency, DRM/copy-print choices, preview settings, pre-order/release behavior, payment profile, and tax/payment readiness.
- **Series:** series name exact-match check, capitalization/punctuation check, whole-number volume check, no skipped/repeated numbers for ordered series, book type, and special type label such as box set, bundle, omnibus, or special edition when applicable.
- **Reporting setup:** expected report type, identifier mapping, earnings report timing, transaction report timing, preview traffic report mapping, and unmatched-row reconciliation rules.

Google hard blockers:

- Missing EPUB/PDF content file, invalid file type, password-protected PDF, incomplete split-file set, or EPUB not validated.
- Cover file missing or below required dimensions.
- Identifier mismatch between the book record and file naming where identifier-based upload is used.
- Series name, punctuation, capitalization, or volume numbers are inconsistent across books.
- Sales territories, payment profile, or pricing are incomplete.
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

### 9. Client Portal Surface

Portal access should be module-gated like Mobile Apps:

- Portal nav item visible only when enabled.
- Portal API blocked when disabled.
- Clients can view approved book projects, briefs, drafts, cover options, proofs, and launch status.
- Clients can comment, approve, request changes, or accept publishing packets depending on permissions.
- Clients should not directly trigger publishing, paid ads, or public release without approval gates.

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
    projectId?: string
    campaignId?: string
    companyId?: string
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
  status: 'not_started' | 'metadata_ready' | 'files_ready' | 'uploaded' | 'in_review' | 'live' | 'blocked' | 'unpublished'
  identifiers: {
    isbn?: string
    asin?: string
    googleBookId?: string
    sku?: string
    url?: string
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
    royaltyPlan?: string
  }>
  aiDisclosure: {
    text: boolean
    images: boolean
    translation: boolean
    notes?: string
  }
}
```

## Hermes Skills Needed

The module will need new skills, not one giant "book" skill.

### Research Skills

- `book-niche-research`: source-backed niche, audience, category, pricing, competitor, and risk research.
- `book-competitor-review-mining`: extract patterns from reviews and public descriptions without copying protected text.
- `book-series-strategy`: decide standalone vs ordered/unordered series, volume plan, and release cadence.

### Writing And Editorial Skills

- `book-brief-builder`: turn client/business goals into a book brief.
- `book-outline-builder`: produce outline, chapter/page map, and continuity plan.
- `book-draft-writer`: draft sections within the approved outline.
- `book-developmental-editor`: structure, pacing, promise, reader fit.
- `book-copyeditor`: grammar, clarity, style, consistency.
- `book-proofreader`: final typo and formatting pass.
- `book-reading-level-review`: age/reading-level assessment.
- `book-fact-checker`: source-backed review for non-fiction claims.

### Visual And Layout Skills

- `book-cover-brief`: cover positioning, title hierarchy, platform-safe requirements.
- `book-illustration-director`: scene prompts, character consistency, style bible.
- `book-layout-designer`: page/spread layout, trim constraints, bleed/margins checklist.
- `book-asset-rights-auditor`: provenance, licensing, AI disclosure, risky references.

### Publishing And Analytics Skills

- `book-metadata-optimizer`: channel-safe title, description, categories, keywords.
- `book-kdp-readiness-check`: KDP checklist, AI disclosure, ISBN, file package, metadata.
- `book-google-play-readiness-check`: Google metadata, series, files, price, report setup.
- `book-export-packager`: generate or assemble EPUB/PDF/cover/metadata packets.
- `book-publishing-ops`: maintain channel status and manual upload steps.
- `book-analytics-import`: parse CSV/report exports and separate estimated/reported/settled metrics.
- `book-launch-campaign`: connect book launch to PiB social/email/ads/landing pages.

### Hermes Skill Contract Model

PiB's Hermes policy treats skills as owned, allowlisted, versioned runtime capabilities. Book Studio skills should follow that pattern rather than becoming ad-hoc prompts. Pip remains the orchestrator, specialist agents own skill families, and Quinn/QA reviews release-sensitive output.

Every Book Studio skill should declare:

- **Trigger phrases:** what user/request language loads the skill.
- **Inputs:** required record IDs, source artifacts, research IDs, client document IDs, or approval task IDs.
- **Outputs:** exact artifact type, target collection/document, and whether the output is internal, client-reviewable, or public-ready.
- **Evidence contract:** sources, assumptions, provenance, validation results, and confidence/risk flags.
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
| `book-draft-writer` | Maya | Approved outline section, style guide, research sources, AI disclosure state, writing constraints. | Draft manuscript section linked to a manuscript version or client document section. | Draft only. Must record AI-generated vs AI-assisted status and source dependencies. No public-ready claim. |
| `book-developmental-editor` | Iris | Draft manuscript, brief, outline, audience, book type. | Editorial report with structural issues, reader-fit notes, revision tasks, and approval recommendation. | Can propose rewrites but should not silently replace approved scope. |
| `book-copyeditor` | Iris | Revised manuscript, style guide, spelling locale, brand terms, glossary. | Copyedit pass with tracked suggestions or clean revision plus change summary. | Must preserve meaning and flag factual uncertainty instead of "fixing" facts. |
| `book-proofreader` | Quinn + Iris | Final-layout proof, manuscript version, file package, channel checklist. | Proofread report and final typo/formatting issue list. | Release gate evidence before export/publishing packet approval. |
| `book-reading-level-review` | Iris | Draft/manuscript, target age/grade, book type, sensitive content flags. | Reading-level and age-fit assessment with flagged vocabulary, sentence complexity, and content concerns. | Required for children's, early-reader, education, and YA projects. |
| `book-fact-checker` | Sage | Non-fiction draft claims, research sources, citation expectations. | Claim-level fact-check report with verified/disputed/unsupported status. | Unsupported claims must block client-visible publishing packets until resolved or removed. |
| `book-cover-brief` | Maya | Book brief, metadata, audience, comparable covers, format/channel constraints. | Cover creative brief with title hierarchy, visual direction, trim/format needs, and avoid list. | Must flag trademark/IP/lookalike risks and store-safe content concerns. |
| `book-illustration-director` | Maya | Art style guide, character bible, scene list, rights constraints, model/tool constraints. | Scene prompts, continuity notes, asset checklist, and provenance requirements. | Must record AI/image provenance and block unlicensed style mimicry or celebrity/brand lookalikes. |
| `book-layout-designer` | Maya + Quinn | Manuscript, trim/format, interior type, images, bleed/margin rules. | Layout plan, page/spread map, print/ebook packaging checklist, and validation tasks. | Must separate layout recommendations from validated print-ready files until file checks pass. |
| `book-asset-rights-auditor` | Quinn | Asset list, source links, licenses, generated-image metadata, contributors. | Rights/provenance audit with pass/fail/blocker status for each asset. | Hard gate before client-visible publishing packet and public submission. |
| `book-metadata-optimizer` | Sage + Maya | Approved brief, manuscript summary, categories, keywords, competitor research, channel constraints. | Channel-specific metadata packet: title/subtitle, description, keywords, categories, series text, mature flags. | Must avoid misleading categories, competitor names as keywords, keyword stuffing, and claims unsupported by content. |
| `book-kdp-readiness-check` | Quinn | KDP listing packet, files, AI disclosure, ISBN/imprint, metadata, pricing, series status. | KDP readiness report with blockers, warnings, and manual upload checklist. | Approval required before any KDP public submission. |
| `book-google-play-readiness-check` | Quinn | Google listing packet, PDF/EPUB files, metadata, identifiers, series details, pricing. | Google Play readiness report and Partner Center checklist. | Must check identifier/series consistency and file package readiness before upload. |
| `book-export-packager` | Theo + Quinn | Approved manuscript/assets, layout plan, metadata packet, validation requirements. | Export packet manifest with files, checksums, validation results, and manual-upload instructions. | Produces artifacts only; public publishing remains a separate approval-gated action. |
| `book-publishing-ops` | Pip + Quinn | Approved publishing packet, channel listing IDs, approval task, manual upload state. | Channel status updates, external IDs, blocker tasks, and post-upload review notes. | Requires approval task for public submission; no silent store upload. |
| `book-analytics-import` | Vera | Channel reports, ad reports, UTM/landing data, book/series IDs, reporting period. | Analytics import with estimated/reported/settled separation and reconciliation notes. | Must preserve source report, import timestamp, currency, refunds/returns, and confidence. |
| `book-launch-campaign` | Maya + Ari + Vera | Approved book packet, launch window, channels, budget approval state, audience, tracking plan. | Launch campaign brief, social/email/ad tasks, landing-page/link plan, and measurement plan. | Drafts are allowed; paid spend and public/client-visible sends require approval gates. |

Future implementation should either add these as separate `.claude/skills/book-*/SKILL.md` files or group closely related editorial skills into a `book-editorial` package only if the manifest still exposes clear sub-capabilities. The policy manifest must include owner agent, allowed agents, risk level, sync target, and approval gates before VPS skill sync.

### Hermes Task Packet Runtime Shape

Book Studio should dispatch Hermes work through Projects/Kanban tasks rather than route-local prompts. The existing task shape already supports the needed contract: `assigneeAgentId`, `agentInput.spec`, `agentInput.context`, `agentInput.constraints`, `requiredCapability`, `riskLevel`, `reviewerAgentId`, `approvalGateTaskId`, `sourceResearchItemId`, `sourceDocumentId`, `sourceDocumentSectionId`, `expectedArtifacts`, `internalOnly`, and `agentOutput.artifacts`.

Recommended `agentInput.context` for Book Studio tasks:

```ts
interface BookStudioAgentContext {
  bookProjectId: string
  bookSeriesId?: string
  editionId?: string
  channelListingId?: string
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
  riskFlags: string[]
}

type BookStudioArtifactType =
  | 'research_item'
  | 'book_brief_document'
  | 'series_strategy'
  | 'outline_packet'
  | 'manuscript_section'
  | 'editorial_report'
  | 'cover_brief'
  | 'illustration_direction'
  | 'layout_plan'
  | 'rights_audit'
  | 'metadata_packet'
  | 'kdp_readiness_report'
  | 'google_play_readiness_report'
  | 'export_manifest'
  | 'publishing_status_note'
  | 'analytics_import'
  | 'launch_campaign_brief'
```

Every Book Studio Hermes task should include:

- a concise `agentInput.spec` that states the job, accepted inputs, and exact output shape;
- `requiredCapability` matching one Book Studio skill name, such as `book-kdp-readiness-check`;
- `riskLevel`, with rights, public publishing, AI disclosure, children's content, public-domain/companion, low-content, audiobook, and paid launch work defaulting to `high` or `critical`;
- at least one source pointer (`sourceResearchItemId`, `sourceDocumentId`, `sourceArtifactIds`, or `channelListingId`) unless the task is an initial research task;
- `expectedArtifacts` that name the artifact type and destination;
- a `reviewerAgentId` for any output that can become client-visible or publishing-facing;
- `approvalGateTaskId` whenever the task can influence public metadata, publishing, paid spend, ISBN/imprint, AI disclosure, or client-visible packets.

Skill outputs should use `agentOutput.summary` for a short human-readable result and `agentOutput.artifacts` for structured references. A skill may draft, annotate, recommend, or create internal artifacts, but it should not silently transition a book project, channel listing, client document, or campaign into an externally visible state. State transitions remain task/API actions with approval evidence.

### Initial Skill Implementation Waves

Implementation should not try to install all skills at once. The first wave should cover the minimum production loop:

| Wave | Skills | Why first |
| --- | --- | --- |
| 1. Foundation research and brief | `book-niche-research`, `book-series-strategy`, `book-brief-builder`, `book-outline-builder` | Creates the evidence and planning loop before manuscript or publishing work starts. |
| 2. Safety and release checks | `book-asset-rights-auditor`, `book-metadata-optimizer`, `book-kdp-readiness-check`, `book-google-play-readiness-check` | Prevents policy/rights mistakes before anything reaches a client or store. |
| 3. Production drafting | `book-draft-writer`, `book-developmental-editor`, `book-copyeditor`, `book-proofreader`, `book-reading-level-review`, `book-fact-checker` | Useful only after the brief and gate model are stable. |
| 4. Visual and package work | `book-cover-brief`, `book-illustration-director`, `book-layout-designer`, `book-export-packager` | Depends on approved book direction, rights rules, and file-package conventions. |
| 5. Launch and analytics | `book-publishing-ops`, `book-analytics-import`, `book-launch-campaign` | Depends on channel listing state, packet fields, and import ledger behavior. |

Wave 1 and Wave 2 are the right targets for a first Hermes skill rollout because they reduce strategic and policy risk before the module generates a large amount of manuscript or visual work.

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
| Approve publishing packet | Yes | Can approve client-facing facts/scope | No |
| Upload/publish to KDP/Google | Manual operator action in V1 | No | No direct public publishing |
| Change paid launch spend | Yes with approval | No | No direct spend |
| Import analytics reports | Yes | No | Yes for import/normalization tasks |
| View analytics | Yes | Client-safe summary | Yes if assigned |

This matrix should be enforced in skill policy, task creation, and future API guards. If a skill output recommends a public action, the output should create or update a blocker/approval task rather than performing the action itself.

### Approval Gates

These actions should require explicit approval tasks:

- Public publishing submission.
- Paid ad campaign launch or spend changes.
- Client-visible publication package.
- AI-generated content disclosure decision.
- ISBN/imprint decision.
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

Mitigation: store provenance, disclosure state, source links, and required human approvals.

### Platform Risk

- KDP does not expose a simple official publish API for this use case.
- Google Play Books supports bulk workflows but still expects Partner Center setup and policy compliance.
- Store analytics are delayed and can disagree with ads reports.
- KDP Select exclusivity conflicts with selling the ebook elsewhere.

Mitigation: build channel adapters and manual checklist/export flows first; API automation only for sanctioned reporting/ads surfaces.

### Engineering Risk

- Fixed-layout books, EPUB generation, print PDF, cover wrap, and image-heavy exports are complex.
- Firestore records can get large if manuscript/page content and image metadata are stored carelessly.
- Long-running generation jobs do not fit ordinary request/response routes.
- Rendering acceptance by KDP/Google cannot be proven by local tests alone.

Mitigation: keep core records small, store large files in storage, use job records/agent tasks, and create verifiable export packages.

### Commercial Risk

- Many book types have weak margins after print costs, returns, ad spend, and time.
- Bookstore distribution through Ingram-like channels can introduce return risk.
- Children's and illustrated books are expensive to make well.
- Paid ads can burn budget before reviews/social proof exist.

Mitigation: analytics should show unit economics and stage-gate ad spend.

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
- Hermes skills for research, brief, outline, metadata, readiness check.

### Phase 2: Manuscript And Series Production

- Outline and manuscript versioning.
- Series style guide and continuity checks.
- Page/chapter status.
- Comments and approval handoff through client documents.
- Asset library/provenance.

### Phase 3: Export Packages

- EPUB export for reflowable books.
- PDF interior export for simple print/fixed layouts.
- Cover asset package.
- Metadata packet.
- KDP/Google checklists.

### Phase 4: Publishing Ops And Analytics

- Channel listing status tracking.
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
6. Hermes skill set for research, outline, metadata, and readiness.
7. Client document approval for brief and publishing packet.
8. KDP/Google export checklist and channel listing tracker.
9. Analytics import model, initially manual CSV/report ingestion.

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
| Domain records | Add typed records and sanitizers for `book_projects`, `book_series`, `book_project_editions`, `book_channel_listings`, `book_quality_gates`, and analytics import metadata. | The module needs book-specific state, but Research, Documents, Projects, and artifacts remain authoritative for evidence, approvals, work, and large files. | Records are org-scoped, serializable, guarded by role, and do not embed large manuscript or image payloads. |
| Admin workspace | Build admin list/detail routes for book projects and series with tabs for overview, research, brief, production, publishing, gates, and analytics. | Operators need one command surface before manuscript generation or export engines exist. | A PiB admin can create a project, connect it to a series, see status/risk/gates, and move through the production checklist. |
| Research and brief bridge | Link or create Research items and Book Brief client documents from a book project. | The module should inherit PiB's evidence and approval model rather than recreate `ai-story` research notes. | A book project can show linked findings/recommendations, create a brief packet, and preserve source IDs. |
| Hermes task contracts | Store Hermes-ready task metadata for research, brief, outline, metadata, and readiness work without granting direct publish powers. | Agent output must be bounded, reviewable, and attributable. | Created tasks include book context, expected artifacts, reviewer, risk level, and approval-gate linkage. |
| Publishing packet and channel tracker | Add KDP/Google channel listing records, readiness state, blocker notes, metadata fields, file checklist, AI disclosure, ISBN/imprint decision, pricing summary, and manual external status. | KDP/Google setup is currently a manual operator action; PiB should prepare and track it, not pretend it can safely auto-publish. | A project can produce a channel-specific readiness packet and record uploaded/in review/live/blocked status with evidence. |
| Portal review surface | Add client-safe portal read/review routes only when the module is enabled and selected records are approved for portal visibility. | Clients need review and approval, not internal risk notes or raw research assumptions. | Portal users see only approved briefs, proofs, publishing packets, comments, and approval/change-request actions. |
| Analytics ingestion shell | Add manual report-import ledger and normalized analytics snapshot records before building automated integrations. | KDP and Google reports can lag and disagree; the data model must separate estimated, reported, and settled figures from day one. | Admin can attach a KDP/Google report import, see confidence/source labels, and create reconciliation tasks for mismatches. |

### Phase 1 Acceptance Criteria

- A PiB admin can create a book project under a client organisation with `bookTypeFamily`, status, series, initial target channels, and compliance defaults.
- Missing or disabled portal entitlement cannot expose Book Studio in portal nav, portal API responses, or scoped workspace state.
- Book-type gate profiles generate the correct initial `book_quality_gates` for narrative, children's, visual/sequential, nonfiction, activity/workbook, low-content, public-domain/companion, and audiobook projects.
- The project detail can link Research, create or attach a Book Brief document, link a Project/Kanban workspace, and show linked artifacts without duplicating those systems.
- Hermes task preparation is possible for research, brief, outline, metadata, and readiness checks, but the tasks do not publish, submit, or spend money.
- A KDP readiness packet explicitly captures metadata, categories/keywords, file checklist, AI-generated-vs-assisted disclosure, ISBN/imprint choice, rights confirmation, content-risk notes, pricing, and manual upload status.
- A Google Play readiness packet explicitly captures EPUB/PDF readiness, cover file, metadata, series naming/volume consistency, rights/territories, pricing, DRM/copy-print choices, and manual Partner Center status.
- Portal reviewers can comment, approve, or request changes on approved client-visible packets while internal research, unresolved rights blockers, and draft risk notes remain hidden.
- Analytics imports are source-labeled and confidence-labeled; estimated dashboard data, reported sales/read data, settled payment data, and ad attribution data are not merged into one ambiguous metric.

### Phase 1 Test Focus

- Type/sanitizer tests for Book Studio records and defaults.
- Admin API tests for org scoping, create/update/list, soft archive, and linked-record preservation.
- Portal guard tests for disabled module state, role access, and client-visible filtering.
- Gate-profile tests for each book type family.
- Publishing packet tests for KDP and Google required fields and blocker behavior.
- Hermes task contract tests that verify provenance, reviewer, expected artifacts, and forbidden direct-action fields.
- Analytics import tests that verify estimated/reported/settled separation and reconciliation task creation.

### Phase 1 Explicit Deferrals

- No direct KDP, Google Play Books, Apple, Kobo, Draft2Digital, IngramSpark, ACX, or ads API publishing.
- No client self-serve book generator.
- No full manuscript editor or print-perfect fixed-layout engine.
- No autonomous cover/image generation approval into public packets.
- No automated ISBN purchase/registration.
- No paid ad launch, budget mutation, or Amazon Ads automation.
- No guarantee that a packet passing PiB readiness will be accepted by a publishing platform.

Approval of option 1, internal PiB production studio with optional client review, should unlock a separate implementation plan for this Phase 1 foundation.

## Open Product Decision

The next design step depends on one product decision:

Should Book Studio V1 be:

1. **Internal PiB production studio with optional client review**.
2. **Client-facing module where clients create their own books**.
3. **Public/productized AI-book SaaS surface**.

Recommendation: choose option 1 for V1.
