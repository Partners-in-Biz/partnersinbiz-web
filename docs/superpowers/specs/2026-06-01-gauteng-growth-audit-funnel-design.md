# Gauteng Growth Audit Funnel Design

**Date:** 2026-06-01
**Author:** Pip + Peet
**Status:** Approved for implementation
**Module:** Public marketing site

## Goal

Create a conversion-focused public marketing page for Gauteng small businesses that turns cold campaign traffic into qualified leads for a website, 90-day SEO, and social media growth sprint.

## Core Offer

The front-door offer is a **Free Gauteng Growth Audit**. The audit is intentionally lower friction than asking for a full project application. It lets a business owner ask for practical feedback first, then gives Partners in Biz a natural path to recommend the paid 90-day sprint after trust has been earned.

Primary CTA: `Get my free growth audit`

Secondary CTA: `See the 90-day plan`

Recommended route: `/gauteng-growth-audit`

## Target Audience

The page is written for owner-managed small businesses in Gauteng, especially businesses around Pretoria, Johannesburg, Centurion, Midrand, East Rand, and West Rand.

The emotional state to meet:

- They know their business is good, but the website and social presence do not show it.
- They depend too heavily on referrals, WhatsApp, word of mouth, or sporadic posting.
- They have tried posting on social media but cannot connect it to steady enquiries.
- They are aware competitors appear stronger online, even when those competitors are not better in real life.
- They want leads, not vague marketing activity.

## Positioning

The page should not sound like a generic agency page. It should position Partners in Biz as a Gauteng-based growth partner that understands practical owner problems and builds a clear lead engine:

1. A website that gives visitors enough confidence to enquire.
2. A 90-day SEO sprint that improves local visibility and compounds over time.
3. Social media that supports trust, proof, and retargeting rather than random posting.

The message: **your business does not need more noise; it needs a connected online system that converts local attention into conversations.**

## Funnel Structure

### 1. Hero

Purpose: make the owner feel seen and give a low-risk next step.

Headline:

`Gauteng small businesses deserve more than a website that just sits there.`

Supporting copy:

`We build your website, sharpen your Google visibility, and turn social media into a lead engine over 90 days. Start with a free growth audit so you can see exactly where enquiries are leaking.`

Above-the-fold proof:

- `Pretoria-based`
- `Built for Gauteng SMEs`
- `Website + SEO + social in one sprint`
- `Reply within one business day`

Primary CTA: `Get my free growth audit`

Secondary CTA: `See the 90-day plan`

### 2. Problem Mirror

Purpose: create emotional resonance before selling the solution.

Core message:

`Your business may be strong offline, but online it can still look quiet, outdated, or hard to trust.`

Pain points:

- Website traffic does not become WhatsApp messages or form leads.
- Google searches send prospects to competitors.
- Social media is inconsistent and hard to measure.
- The business depends on referrals that cannot be scaled.
- The owner cannot tell what is working.

### 3. Three-Part Growth Engine

Purpose: explain the offer as one connected system, not three disconnected services.

Cards:

- **Website that converts:** fast pages, clear offer, trust proof, lead capture, analytics.
- **90-day SEO sprint:** technical foundation, local keyword targeting, content, indexing, measurement.
- **Social that builds demand:** posts, repurposed content, proof, consistency, calls to action.

### 4. 90-Day Roadmap

Purpose: reduce uncertainty by showing a concrete path.

- **Days 1-30: Foundation:** audit, positioning, website structure, tracking, technical SEO, conversion fixes.
- **Days 31-60: Momentum:** SEO content, local pages, Google Business Profile guidance, social content engine.
- **Days 61-90: Compounding:** optimise from data, strengthen proof, publish authority content, improve lead paths.

### 5. Local Trust

Purpose: show this is relevant to Gauteng rather than a generic global service.

Content should mention:

- Pretoria
- Johannesburg
- Centurion
- Midrand
- East Rand
- West Rand

Tone: grounded, practical, local, owner-to-owner.

### 6. Proof

Purpose: make the promise believable.

Use existing Partners in Biz proof from `lib/seo/site.ts` where suitable:

- AHS Law: marketing site and SEO outcome.
- Scrolled Brain: conversion-focused marketing site and analytics.
- Relevant site stats such as lead capture, performance, and operational outcomes.

Avoid unsupported claims. If a number is already in site data, it can be reused; otherwise use qualitative proof.

### 7. Audit Form

Purpose: capture leads without overloading the visitor.

Fields:

- Name
- Business name
- Website or social link
- WhatsApp number
- Biggest challenge

Submission should post through the existing `/api/enquiries` endpoint so the lead enters the existing enquiry workflow.

Submission payload:

- `projectType`: `Gauteng Growth Audit`
- `details`: include the challenge, source page, website/social link, and WhatsApp.

Success state:

`Your audit request is in. We will review your website, Google visibility, and social presence, then reply within one business day with the first fixes we would make.`

### 8. What Happens Next

Purpose: remove ambiguity and increase completion.

Steps:

1. We review the website, Google visibility, and social presence.
2. We identify the biggest enquiry leaks.
3. We send a plain-language audit summary.
4. If there is a fit, we map the 90-day sprint.

### 9. FAQ

Questions:

- Is the audit really free?
- Do I need a new website?
- What if I already have someone posting on social media?
- How soon can SEO create leads?
- Do you only work in Gauteng?
- What happens after the 90 days?

Answers should set expectations honestly: SEO compounds, social supports proof and trust, and the website must convert attention into action.

## Architecture

Create a focused public route at `app/(public)/gauteng-growth-audit/page.tsx`. Keep the page mostly server-rendered for SEO and performance. Add a small client component for the audit form because it needs interactive submit state.

Use existing public-site primitives and design language:

- `Reveal`
- `SectionHead`
- `JsonLd`
- `breadcrumbSchema`
- `faqSchema`
- `SITE`
- `CASE_STUDIES`

Add a lightweight form component at `app/(public)/gauteng-growth-audit/GautengGrowthAuditForm.tsx` that posts to `/api/enquiries`.

Update `app/sitemap.ts` so `/gauteng-growth-audit` is discoverable. The first implementation does not add homepage or service-page navigation links because campaign traffic can point directly at the route and sitemap discovery is enough for launch.

## SEO

Metadata:

- Title: `Gauteng Growth Audit for Small Businesses`
- Description: `Get a free growth audit for your Gauteng small business. Partners in Biz reviews your website, local SEO, and social media, then shows where enquiries are leaking.`
- Canonical: `/gauteng-growth-audit`

Structured data:

- Breadcrumb schema for Home -> Gauteng Growth Audit.
- FAQ schema from the page FAQ.

On-page keyword themes:

- Gauteng small business marketing
- Gauteng growth audit
- website SEO social media Gauteng
- Pretoria marketing website
- Johannesburg small business SEO

## Conversion Requirements

- Primary CTA is visible in the first viewport on mobile and desktop.
- Form asks for no more than five user-input fields.
- CTA copy is specific and outcome-led.
- Trust proof appears before the first form or beside it.
- Phone/WhatsApp follow-up expectation is clear.
- No modal, popup, or interruptive step is required before submitting.

## Visual Direction

Use the current Partners in Biz dark bento style, but make this page warmer and more human than the general homepage.

Preferred visual motifs:

- A first-viewport proof panel showing the audit scope.
- Roadmap bands for the 90-day sprint.
- Local area chips for Gauteng towns and business hubs.
- Small diagnostic cards that feel like an audit checklist.

No generated image is required for v1 because existing PiB public imagery and UI-driven proof blocks can carry the page without slowing launch. Campaign image assets are separate from this page build.

## Testing And Verification

Implementation must verify:

- The page renders at `/gauteng-growth-audit`.
- The form posts valid data to `/api/enquiries`.
- Required form validation prevents incomplete submissions.
- `/gauteng-growth-audit` appears in the sitemap output.
- TypeScript and targeted tests pass.
- Local browser check confirms mobile and desktop layouts do not have obvious overlap or broken CTA/form states.

## Out Of Scope

- Building the paid ad campaigns.
- Building custom XAI image assets.
- Creating a new backend lead endpoint.
- Changing the existing `/start-a-project` form.
- Promoting to production.
