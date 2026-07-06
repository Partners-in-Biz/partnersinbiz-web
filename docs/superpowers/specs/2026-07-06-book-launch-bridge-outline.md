# Book Launch Bridge — Outline (future spec)

**Date:** 2026-07-06
**Status:** Outline only — to be expanded into a full spec after `2026-07-06-book-studio-front-door-authoring-spec.md` ships.
**Depends on:** an assembled, gate-passed book project with approved chapters.

## Thesis

A traditional publisher's weakest muscle (marketing) is PiB's strongest. Books on this platform are authority assets and lead magnets for clients. The Launch Bridge closes the loop no other small-business platform closes: **approved book → full launch campaign** using modules that already exist (campaigns/content engine, email-outreach, social-media-manager, SEO insights, lead-capture forms).

## Trigger

"Plan launch" action on a book project — operator-only initially — enabled when: manifest `status: 'generated'`, editorial gates passed, metadata (categories, description, ISBNs where applicable) complete.

## What it creates (one orchestrated campaign record)

1. **Campaign shell** — a `campaign` (existing content-engine record) named "Launch: {book title}", linked `bookStudioProjectId`, reviewable by the client at `/portal/campaigns/[id]` like any other campaign.
2. **Landing page / lead capture** — a lead-capture form + page for the book (ebook-as-lead-magnet or buy-links page). Reuses CRM public form + capture-source attribution; submissions tag contacts with the book.
3. **Email sequence** — launch sequence (announce → excerpt → social proof → CTA) seeded from book metadata + selected chapter excerpts; drip via existing email-outreach sequences.
4. **Social calendar** — N weeks of platform-specific posts repurposed from approved chapters (quotes, insights, cover reveal, countdown), scheduled through social-media-manager as drafts pending approval.
5. **Blog repurposing** — 2–4 chapter-derived blog drafts for the client's insights/SEO surface, linked into any active SEO sprint.
6. **Assets** — cover-derived creatives (canvas runs: social crops, banner sizes) written back as campaign assets.

## Content sourcing rules

- Only chapters with status `approved` are eligible for excerpt/repurposing.
- Excerpt selection is proposed by AI (operator-side canvas/agent runs), approved per-item through the campaign's existing review flow — no auto-publishing.
- Book metadata (title, subtitle, description, categories) seeds copy; the metadata-listing gate's "no rank/sales promises" rules apply to all generated launch copy.

## Governance

- All outputs land as **drafts** in their home modules with existing approval flows; nothing publishes without the module's own approval step.
- Portal client sees the launch campaign in the campaigns portal; approving there is the existing campaign approval, not a new surface.
- Store-side launch (KDP price promos, ads) stays out — manual, per V1 posture.

## Open questions for the full spec

- Which template variants per book format (lead-magnet nonfiction vs. children's book launch look very different)?
- Excerpt-length/rights guardrails for repurposed content (self-owned, but AI-disclosure propagation to derived posts?).
- Should "Plan launch" fan out synchronously (content-engine style long run) or create a checklist of operator-triggered steps? (Lean: checklist first, automation second.)
- KPI wiring: launch UTM conventions + analytics funnel (form submits, email CTR, social engagement) into the book's analytics view.
