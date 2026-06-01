# Gauteng Growth Audit Funnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public `/gauteng-growth-audit` campaign page that converts Gauteng small-business traffic into qualified website + 90-day SEO + social media sprint leads.

**Architecture:** Add one server-rendered public page for SEO and persuasive content, plus one small client form component for lead capture. Reuse the existing PiB marketing primitives, `/api/enquiries` endpoint, site constants, case studies, FAQ schema, and sitemap pattern.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind v4 utility classes, Jest, Testing Library, existing PiB public marketing components.

---

## File Structure

- Create: `app/(public)/gauteng-growth-audit/page.tsx`
  - Server page with metadata, JSON-LD, hero, problem mirror, three-part engine, 90-day roadmap, proof, FAQ, and form placement.
- Create: `app/(public)/gauteng-growth-audit/GautengGrowthAuditForm.tsx`
  - Client component that validates five fields and posts to `/api/enquiries`.
- Create: `__tests__/app/gauteng-growth-audit-form.test.tsx`
  - Form validation and payload tests.
- Create: `__tests__/app/sitemap.test.ts`
  - Route discoverability test for the public sitemap.
- Modify: `app/sitemap.ts`
  - Add `/gauteng-growth-audit` to static sitemap pages.
- Modify: `docs/superpowers/specs/2026-06-01-gauteng-growth-audit-funnel-design.md`
  - No functional edits expected after implementation starts.

---

### Task 1: Form Test And Client Lead Capture

**Files:**
- Create: `__tests__/app/gauteng-growth-audit-form.test.tsx`
- Create: `app/(public)/gauteng-growth-audit/GautengGrowthAuditForm.tsx`

- [ ] **Step 1: Write the failing form tests**

Create `__tests__/app/gauteng-growth-audit-form.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import GautengGrowthAuditForm from '@/app/(public)/gauteng-growth-audit/GautengGrowthAuditForm'

describe('GautengGrowthAuditForm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'audit-lead-1' }),
    })
  })

  it('blocks incomplete audit requests before posting', () => {
    render(<GautengGrowthAuditForm />)

    fireEvent.click(screen.getByRole('button', { name: 'Get my free growth audit' }))

    expect(global.fetch).not.toHaveBeenCalled()
    expect(screen.getByText('Please add your name, business, link, WhatsApp number, and biggest challenge.')).toBeInTheDocument()
  })

  it('posts a qualified Gauteng audit enquiry payload', async () => {
    render(<GautengGrowthAuditForm />)

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ava Owner' } })
    fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Ava Florist' } })
    fireEvent.change(screen.getByLabelText('Website or social link'), { target: { value: 'https://instagram.com/avaflorist' } })
    fireEvent.change(screen.getByLabelText('WhatsApp number'), { target: { value: '067 000 0000' } })
    fireEvent.change(screen.getByLabelText('Biggest online growth challenge'), { target: { value: 'People like our posts but do not enquire.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Get my free growth audit' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))

    expect(global.fetch).toHaveBeenCalledWith('/api/enquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Ava Owner',
        email: 'audit-leads@partnersinbiz.online',
        company: 'Ava Florist',
        projectType: 'Gauteng Growth Audit',
        details: [
          'Gauteng Growth Audit request',
          '',
          'Business: Ava Florist',
          'Website or social link: https://instagram.com/avaflorist',
          'WhatsApp: 067 000 0000',
          'Biggest challenge: People like our posts but do not enquire.',
          'Source page: /gauteng-growth-audit',
        ].join('\n'),
      }),
    })

    expect(await screen.findByText('Your audit request is in.')).toBeInTheDocument()
  })

  it('shows a retryable error when the enquiry endpoint fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Submission failed' }),
    })

    render(<GautengGrowthAuditForm />)

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ava Owner' } })
    fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Ava Florist' } })
    fireEvent.change(screen.getByLabelText('Website or social link'), { target: { value: 'https://instagram.com/avaflorist' } })
    fireEvent.change(screen.getByLabelText('WhatsApp number'), { target: { value: '067 000 0000' } })
    fireEvent.change(screen.getByLabelText('Biggest online growth challenge'), { target: { value: 'We need more leads from Google.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Get my free growth audit' }))

    expect(await screen.findByText('Submission failed')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the failing form tests**

Run:

```bash
npm test -- --runTestsByPath __tests__/app/gauteng-growth-audit-form.test.tsx
```

Expected: fail because `GautengGrowthAuditForm` does not exist.

- [ ] **Step 3: Implement the form component**

Create `app/(public)/gauteng-growth-audit/GautengGrowthAuditForm.tsx` with:

```tsx
'use client'

import { useState } from 'react'

type Status = 'idle' | 'loading' | 'success' | 'error'

const AUDIT_EMAIL = 'audit-leads@partnersinbiz.online'

interface FormState {
  name: string
  business: string
  link: string
  whatsapp: string
  challenge: string
}

const INITIAL: FormState = {
  name: '',
  business: '',
  link: '',
  whatsapp: '',
  challenge: '',
}

export default function GautengGrowthAuditForm() {
  const [data, setData] = useState<FormState>(INITIAL)
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setData((current) => ({ ...current, [key]: value }))
  }

  function isComplete() {
    return Object.values(data).every((value) => value.trim().length > 0)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')

    if (!isComplete()) {
      setStatus('error')
      setMessage('Please add your name, business, link, WhatsApp number, and biggest challenge.')
      return
    }

    setStatus('loading')

    const details = [
      'Gauteng Growth Audit request',
      '',
      `Business: ${data.business.trim()}`,
      `Website or social link: ${data.link.trim()}`,
      `WhatsApp: ${data.whatsapp.trim()}`,
      `Biggest challenge: ${data.challenge.trim()}`,
      'Source page: /gauteng-growth-audit',
    ].join('\n')

    try {
      const res = await fetch('/api/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name.trim(),
          email: AUDIT_EMAIL,
          company: data.business.trim(),
          projectType: 'Gauteng Growth Audit',
          details,
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'Submission failed')
      }
      setStatus('success')
      setMessage('Your audit request is in.')
    } catch (err) {
      setStatus('error')
      setMessage(err instanceof Error ? err.message : 'Submission failed')
    }
  }

  if (status === 'success') {
    return (
      <div className="bento-card p-6 md:p-8" role="status" aria-live="polite">
        <p className="eyebrow mb-3">Audit requested</p>
        <h2 className="font-display text-3xl text-[var(--color-pib-text)]">{message}</h2>
        <p className="mt-4 text-[var(--color-pib-text-muted)]">
          We will review your website, Google visibility, and social presence, then reply within one business day with the first fixes we would make.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="bento-card p-6 md:p-8" noValidate>
      <p className="eyebrow mb-3">Free audit</p>
      <h2 className="font-display text-3xl text-[var(--color-pib-text)]">Find the enquiry leaks.</h2>
      <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">
        Five fields. We reply within one business day with practical fixes, not a generic sales deck.
      </p>

      <div className="mt-6 grid gap-4">
        <Field label="Your name" value={data.name} onChange={(value) => update('name', value)} placeholder="Ava Owner" />
        <Field label="Business name" value={data.business} onChange={(value) => update('business', value)} placeholder="Ava Florist" />
        <Field label="Website or social link" value={data.link} onChange={(value) => update('link', value)} placeholder="https://..." />
        <Field label="WhatsApp number" value={data.whatsapp} onChange={(value) => update('whatsapp', value)} placeholder="067 000 0000" />
        <label className="grid gap-2 text-sm font-medium text-[var(--color-pib-text)]">
          <span>Biggest online growth challenge</span>
          <textarea
            value={data.challenge}
            onChange={(event) => update('challenge', event.target.value)}
            rows={4}
            placeholder="What is not turning into leads yet?"
            className="w-full rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-4 py-3 text-base text-[var(--color-pib-text)] outline-none transition focus:border-[var(--color-pib-accent)]"
          />
        </label>
      </div>

      {message && (
        <p className="mt-4 text-sm text-[var(--color-pib-danger,var(--color-pib-accent))]" role="alert">
          {message}
        </p>
      )}

      <button type="submit" className="btn-pib-accent mt-6 w-full justify-center" disabled={status === 'loading'}>
        {status === 'loading' ? 'Sending audit request...' : 'Get my free growth audit'}
      </button>
    </form>
  )
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="grid gap-2 text-sm font-medium text-[var(--color-pib-text)]">
      <span>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-4 py-3 text-base text-[var(--color-pib-text)] outline-none transition focus:border-[var(--color-pib-accent)]"
      />
    </label>
  )
}
```

- [ ] **Step 4: Run the form tests**

Run:

```bash
npm test -- --runTestsByPath __tests__/app/gauteng-growth-audit-form.test.tsx
```

Expected: pass.

- [ ] **Step 5: Commit form work**

Run:

```bash
git add __tests__/app/gauteng-growth-audit-form.test.tsx app/\(public\)/gauteng-growth-audit/GautengGrowthAuditForm.tsx
git commit -m "feat(marketing): add Gauteng growth audit form"
```

---

### Task 2: Campaign Page And Sitemap

**Files:**
- Create: `app/(public)/gauteng-growth-audit/page.tsx`
- Create: `__tests__/app/sitemap.test.ts`
- Modify: `app/sitemap.ts`

- [ ] **Step 1: Write the sitemap test**

Create `__tests__/app/sitemap.test.ts`:

```ts
import sitemap from '@/app/sitemap'
import { SITE } from '@/lib/seo/site'

describe('public sitemap', () => {
  it('includes the Gauteng growth audit campaign page', () => {
    expect(sitemap()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: `${SITE.url}/gauteng-growth-audit` }),
      ])
    )
  })
})
```

- [ ] **Step 2: Run the failing sitemap test**

Run:

```bash
npm test -- --runTestsByPath __tests__/app/sitemap.test.ts
```

Expected: fail because the route is not in `app/sitemap.ts`.

- [ ] **Step 3: Add the sitemap route**

Modify `app/sitemap.ts` and add `'/gauteng-growth-audit'` to `staticPages` immediately after `'/services'`.

- [ ] **Step 4: Create the campaign page**

Create `app/(public)/gauteng-growth-audit/page.tsx` using these concrete sections:

```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { CASE_STUDIES, SITE } from '@/lib/seo/site'
import { JsonLd, breadcrumbSchema, faqSchema } from '@/lib/seo/schema'
import { Reveal } from '@/components/marketing/Reveal'
import GautengGrowthAuditForm from './GautengGrowthAuditForm'

export const metadata: Metadata = {
  title: 'Gauteng Growth Audit for Small Businesses',
  description:
    'Get a free growth audit for your Gauteng small business. Partners in Biz reviews your website, local SEO, and social media, then shows where enquiries are leaking.',
  alternates: { canonical: '/gauteng-growth-audit' },
  openGraph: {
    title: 'Gauteng Growth Audit for Small Businesses',
    description:
      'A free audit for Gauteng SMEs that checks your website, local SEO, and social media lead paths.',
    url: `${SITE.url}/gauteng-growth-audit`,
    type: 'website',
  },
}

const FAQS = [
  { q: 'Is the Gauteng Growth Audit really free?', a: 'Yes. We review the visible parts of your website, Google presence, and social media, then send the first practical fixes we would make. If there is a fit, we will explain the 90-day sprint after the audit.' },
  { q: 'Do I need a new website?', a: 'Not always. Some businesses need a better lead path, faster pages, stronger proof, or clearer local SEO before a rebuild makes sense. The audit is designed to separate quick fixes from rebuild work.' },
  { q: 'What if someone already posts on social media for us?', a: 'That can help. We look at whether your posts support trust, local demand, proof, and enquiries. If posting is happening without a measurable path to leads, the system needs tightening.' },
  { q: 'How soon can SEO create leads?', a: 'SEO compounds over weeks and months. The first 30 days focus on foundations and conversion leaks, days 31-60 build content and local visibility, and days 61-90 optimise from real signals.' },
  { q: 'Do you only work with Gauteng businesses?', a: 'Partners in Biz works beyond Gauteng, but this campaign is built for Gauteng small businesses because local proof, local search intent, and practical owner-led marketing matter here.' },
  { q: 'What happens after the 90 days?', a: 'The sprint becomes a compounding rhythm: keep the technical base healthy, publish useful content, improve social proof, and optimise lead paths from data instead of guessing.' },
]

const ROADMAP = [
  { label: 'Days 1-30', title: 'Foundation', body: 'Audit, positioning, tracking, website structure, technical SEO, and the first conversion fixes.' },
  { label: 'Days 31-60', title: 'Momentum', body: 'SEO content, local search pages, Google Business Profile guidance, and a social content engine.' },
  { label: 'Days 61-90', title: 'Compounding', body: 'Optimise from data, strengthen proof, publish authority content, and improve lead paths.' },
]

const AREAS = ['Pretoria', 'Johannesburg', 'Centurion', 'Midrand', 'East Rand', 'West Rand']
const CASES = CASE_STUDIES.filter((study) => ['ahs-law', 'scrolledbrain'].includes(study.slug))

export default function GautengGrowthAuditPage() {
  return (
    <main className="relative">
      <JsonLd data={breadcrumbSchema([{ name: 'Home', url: '/' }, { name: 'Gauteng Growth Audit', url: '/gauteng-growth-audit' }])} />
      <JsonLd data={faqSchema(FAQS)} />

      <section className="section relative overflow-hidden">
        <div className="pib-mesh absolute inset-0 -z-10 opacity-70" />
        <div className="container-pib grid gap-10 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-7">
            <Reveal>
              <p className="eyebrow mb-6">Free Gauteng Growth Audit</p>
              <h1 className="h-display text-balance max-w-5xl">Gauteng small businesses deserve more than a website that just sits there.</h1>
              <p className="mt-6 max-w-2xl text-lg md:text-xl text-[var(--color-pib-text-muted)] text-pretty">
                We build your website, sharpen your Google visibility, and turn social media into a lead engine over 90 days. Start with a free growth audit so you can see exactly where enquiries are leaking.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#audit-form" className="btn-pib-accent">Get my free growth audit</a>
                <a href="#ninety-day-plan" className="btn-pib-secondary">See the 90-day plan</a>
              </div>
            </Reveal>
          </div>
          <div id="audit-form" className="lg:col-span-5 lg:sticky lg:top-28">
            <GautengGrowthAuditForm />
          </div>
        </div>
      </section>

      <section id="ninety-day-plan" className="section pt-0">
        <div className="container-pib grid gap-4 md:grid-cols-3">
          {ROADMAP.map((item) => (
            <div key={item.label} className="bento-card p-6">
              <p className="eyebrow mb-3">{item.label}</p>
              <h2 className="font-display text-2xl">{item.title}</h2>
              <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section pt-0">
        <div className="container-pib">
          <div className="bento-card p-8 md:p-10">
            <p className="eyebrow mb-4">Built for Gauteng owners</p>
            <div className="flex flex-wrap gap-2">
              {AREAS.map((area) => (
                <span key={area} className="pill">{area}</span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
```

The final page must also include the problem mirror, three-part growth engine, proof cards from `CASES`, next-step list, and FAQ sections using the copy from `docs/superpowers/specs/2026-06-01-gauteng-growth-audit-funnel-design.md`.

- [ ] **Step 5: Run the sitemap and form tests**

Run:

```bash
npm test -- --runTestsByPath __tests__/app/sitemap.test.ts __tests__/app/gauteng-growth-audit-form.test.tsx
```

Expected: pass.

- [ ] **Step 6: Commit page and sitemap work**

Run:

```bash
git add app/sitemap.ts __tests__/app/sitemap.test.ts app/\(public\)/gauteng-growth-audit/page.tsx
git commit -m "feat(marketing): add Gauteng growth audit page"
```

---

### Task 3: Verification And Closeout

**Files:**
- Verify: `app/(public)/gauteng-growth-audit/page.tsx`
- Verify: `app/(public)/gauteng-growth-audit/GautengGrowthAuditForm.tsx`
- Verify: `app/sitemap.ts`

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- --runTestsByPath __tests__/app/gauteng-growth-audit-form.test.tsx __tests__/app/sitemap.test.ts
```

Expected: pass.

- [ ] **Step 2: Run TypeScript**

Run:

```bash
npx tsc --noEmit --pretty false
```

Expected: pass or report only unrelated baseline errors. If errors touch the new files, fix them before continuing.

- [ ] **Step 3: Run a production build**

Run:

```bash
NODE_OPTIONS=--max-old-space-size=8192 npm run build
```

Expected: pass. If the repo baseline fails on unrelated routes, capture the failing routes and still verify the new route with dev server.

- [ ] **Step 4: Browser-check the page**

Run:

```bash
npm run dev -- --hostname 127.0.0.1 --port 3010
```

Open `http://127.0.0.1:3010/gauteng-growth-audit`.

Check desktop and mobile widths:

- Hero CTA is visible in the first viewport.
- Form is reachable and does not overlap the hero.
- Roadmap and proof sections do not overflow.
- Form validation message appears for empty submit.
- Filled form shows success state when the endpoint accepts the payload.

- [ ] **Step 5: Update Partners wiki/log**

Update:

- `/Users/peetstander/Cowork/Cowork/agents/partners/wiki/hot.md`
- `/Users/peetstander/Cowork/Cowork/agents/partners/logs/2026-06-01.md`
- `/Users/peetstander/Cowork/Cowork/agents/partners/index.md`

Record the route, offer, verification commands, and commit hashes.

- [ ] **Step 6: Final commit and push**

Run:

```bash
git status --short
git push origin development
```

Expected: push succeeds to `origin/development`.

If wiki files changed in the separate Cowork repo, commit and push that repo separately.

---

## Self-Review Notes

- Spec coverage: route, form, sitemap, SEO metadata, FAQ schema, 90-day roadmap, proof, and verification are covered by tasks.
- Placeholder scan: plan contains no unresolved requirements.
- Type consistency: form field names, payload keys, route path, and sitemap URL match the design spec.
