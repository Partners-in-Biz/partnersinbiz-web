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

### 8. Analytics And Reporting

Analytics should combine:

- KDP orders, KENP reads, royalties, refunds, promotions, and payments.
- Google earnings, sales summary, transactions, and preview traffic.
- Amazon Ads and Amazon Attribution where available.
- PiB campaign analytics for launch pages, email, social, ads, and links.
- Manual royalty/import CSVs where APIs are missing or unsuitable.

Important design principle: separate **estimated**, **reported**, and **settled** money. KDP/Google/aggregators update at different times, and ad dashboards can disagree with royalty dashboards.

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

interface BookProject {
  id: string
  orgId: string
  title: string
  subtitle?: string
  workingTitle?: string
  seriesId?: string
  seriesVolume?: number
  status: BookProjectStatus
  bookType: string
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
    projectId?: string
    campaignId?: string
    companyId?: string
  }
  compliance: {
    aiGeneratedText: boolean
    aiGeneratedImages: boolean
    aiGeneratedTranslation: boolean
    rightsConfirmed: boolean
    copyrightNotes?: string
    policyRisk: 'low' | 'medium' | 'high'
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
3. Research-backed book brief.
4. Hermes skill set for research, outline, metadata, and readiness.
5. Client document approval for brief and publishing packet.
6. KDP/Google export checklist and channel listing tracker.
7. Analytics import model, initially manual CSV/report ingestion.

Do not include in the first implementation:

- Public self-serve SaaS.
- Fully automatic KDP/Google publishing.
- Full print-perfect PDF engine for every book type.
- All channels.
- Autonomous paid ads launch.

## Open Product Decision

The next design step depends on one product decision:

Should Book Studio V1 be:

1. **Internal PiB production studio with optional client review**.
2. **Client-facing module where clients create their own books**.
3. **Public/productized AI-book SaaS surface**.

Recommendation: choose option 1 for V1.
