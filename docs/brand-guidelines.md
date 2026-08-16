# Partners in Biz — Brand Guidelines (2026)

> Canonical brand reference. The agent's master copy lives at
> `~/Cowork/Cowork/agents/partners/wiki/brand-guidelines.md` — both files are
> kept in sync. When the brand evolves, update both.

Version: **v2026.04** (post-marketing-redesign)
Last Updated: 2026-04-26

---

## TL;DR

- **Tagline:** Software your competitors will copy.
- **Palette:** Dark `#0A0A0B` background + warm amber `#F5A623` accent.
- **Type:** Instrument Serif (display) + Geist Sans (body) + Geist Mono (labels).
- **Voice:** Direct, confident, founder-led, dryly opinionated. No corporate fluff.
- **Primary CTA:** *Start a project* (never "Contact us").
- **Single source of truth:** `partnersinbiz-web/lib/seo/site.ts` + `app/globals.css`.

---

## 1. Positioning

| | |
|---|---|
| **Who we are** | A Cape Town–based web development & AI integration studio |
| **Who we serve** | Ambitious SMEs across South Africa, the UK, and the US |
| **What we sell** | Production websites, web apps, mobile apps, AI integrations, growth automation |
| **The wedge** | SA-based, global-quality work; EFT-first invoicing; no Stripe; the same person from quote to launch |
| **Counter-position** | Warm, editorial, founder-led — against the cold "we leverage cutting-edge AI" template |

**Voice:** A competent person who actually writes the code, not a sales deck.

---

## 2. Verbal Identity

### Tagline & one-liners
- **Tagline:** *Software your competitors will copy.*
- **One-liner:** *We build websites, web apps, mobile apps, and AI integrations that ship in weeks — and keep working long after.*
- **Process page:** *We don't sell hours. We sell shipped software.*
- **Pricing page:** *Honest numbers. No "let's talk" gatekeeping.*
- **Footer CTA:** *Let's build something your competitors will copy.*

### Voice attributes
- **Direct.** No "leverage", no "synergies", no "solutions".
- **Confident.** "We build" not "We strive to build".
- **Honest.** Real numbers, real names, real timelines.
- **Dryly opinionated.** British editorial register over American hype.
- **Founder voice.** "I" and "we" both work; avoid "the team is excited to announce".

### Words we use
ship · build · scope · craft · production · real · own · weeks · honest · direct

### Words we don't
leverage · synergy · innovative · cutting-edge · solutions · world-class (in copy) · trusted partner · we deliver excellence · where creativity meets technology

### CTA copy — only these
- Primary: **Start a project**
- Secondary: **See the work** · **Read the case study** · **Book a 20-min intro**
- Never: Contact us · Get in touch · Submit · Learn more · Click here

### Reading the live site
The live site (`partnersinbiz.online`) is the canonical reference for tone. When in doubt, paste a draft into a section that already exists and ask: *would this read out of place next to the existing copy?*

---

## 3. Logo & Marks

### Wordmark
**Partners** [muted] in [/muted] **Biz** — set in Instrument Serif. The word "in" is always `--color-pib-text-muted` (`#8B8B92`); the rest is `--color-pib-text` (`#EDEDED`).

### Monogram
A single uppercase **P** in mono-weight, white on `#0A0A0B`, 14px corner radius.
Source: `partnersinbiz-web/app/icon.svg` (favicon also uses an amber-on-dark variant).

### Inline lockup
8×8 rounded mono-P chip + wordmark. See `components/layout/Navbar.tsx` for the exact composition.

### Don'ts
- No sans-serif substitution for the wordmark
- No tagline directly under the logo (the page handles that)
- No coloured monogram beyond white-on-dark or black-on-cream

---

## 4. Colour Tokens

### Primary (dark theme — default everywhere on marketing)

| Token | Hex | Used for |
|---|---|---|
| `--color-pib-bg` | `#0A0A0B` | Page background |
| `--color-pib-surface` | `#141416` | Cards, resting |
| `--color-pib-surface-2` | `#1C1C20` | Cards, hover |
| `--color-pib-text` | `#EDEDED` | Primary text |
| `--color-pib-text-muted` | `#8B8B92` | Secondary text |
| `--color-pib-text-faint` | `#4A4A52` | Footnotes, version strings |
| `--color-pib-line` | `rgba(255,255,255,0.08)` | Standard divider |
| `--color-pib-line-strong` | `rgba(255,255,255,0.16)` | Button outlines, emphasised borders |

### Accent

| Token | Hex | Used for |
|---|---|---|
| `--color-pib-accent` | `#F5A623` | The warm amber wedge — primary accent |
| `--color-pib-accent-hover` | `#FFB840` | Hover state on accent buttons |
| `--color-pib-accent-soft` | `rgba(245,166,35,0.12)` | Pill backgrounds, hover glows |

### Atmospheric (use sparingly)

| Token | Hex | Used for |
|---|---|---|
| `--color-pib-violet` | `#7C5CFF` | Gradient mesh secondary tint only |
| `--color-pib-success` | `#4ADE80` | "Currently building" status dot |

### Reserved (not yet in production)

| Token | Hex | Reserved for |
|---|---|---|
| `--color-pib-cream` | `#F0EEE6` | Future editorial / inverted sections |
| `--color-pib-ink` | `#181818` | Text on cream |

### Rules
- **One accent per page region.** Amber dominates; violet only in atmospheric meshes.
- **No pure white** (`#FFFFFF`) anywhere — use `#EDEDED`.
- **No pure black** (`#000000`) anywhere — use `#0A0A0B`.
- Body copy hits AAA contrast against the background.

---

## 5. Typography

| Role | Family | Variable | Notes |
|---|---|---|---|
| **Display** | Instrument Serif 400 | `--font-display` | Google Fonts, free, italics for emphasis only |
| **Body / UI** | Geist Sans | `--font-sans` | Vercel, free, default everywhere |
| **Labels / mono** | Geist Mono | `--font-mono` | Vercel, free, for numbers and eyebrows |
| **Legacy (admin only)** | Inter + Space Grotesk | `--font-inter`, `--font-space-grotesk` | Retained for `/admin` and `/portal` only |

All loaded via `next/font` — self-hosted, no external requests, no CLS.

### Scale
- **`.h-display`** — `clamp(2.75rem, 7vw, 6.5rem)` · Instrument Serif 400 · `letter-spacing: -0.02em` · `line-height: 0.95`
- **Section h2** — `text-3xl`–`text-4xl` Instrument Serif via `font-display`
- **Card h3** — `text-2xl` Instrument Serif
- **Body** — `text-base` to `text-lg` Geist Sans
- **`.eyebrow`** — Geist Mono · `0.7rem` · uppercase · `letter-spacing: 0.18em` · muted

### Rules
- `text-balance` on every display and section headline.
- `text-pretty` on body paragraphs.
- One `<h1>` per page, always `.h-display`.
- Italic in Instrument Serif only for: pull-quotes and the accent-coloured emphasis word in headlines (e.g. *"...will <em>copy.</em>"*).
- Use `font-mono` for: stats numbers, version strings (`v2026.04`), eyebrow labels, step indicators (01–05).

---

## 6. Spacing & Layout

- **Container:** `.container-pib` = `max-w-[1320px] mx-auto px-6 md:px-10 lg:px-14`.
- **Section rhythm:** `.section` = `py-20 md:py-32`. Always separate with `border-t border-[var(--color-pib-line)]`.
- **Card radius:** 18px (the `bento-card` uses this).
- **Button radius:** fully rounded (`9999px`).
- **Input radius:** `0.5rem`.

---

## 7. Component Primitives

In `partnersinbiz-web/components/marketing/`:

| Primitive | Use |
|---|---|
| `Reveal` | Scroll-triggered fade-up. Stagger child reveals by 60–80 ms via `delay`. |
| `Marquee` | Pure-CSS infinite ticker (used for the logo wall). |
| `FAQ` | Accordion — always paired with `faqSchema` in JSON-LD. |
| `SectionHead` | Standard eyebrow / title / subtitle / CTA at the top of every section. |

Utility classes in `globals.css`: `bento-card`, `pill`, `pill-accent`, `btn-pib-primary|secondary|accent`, `pib-mesh`, `pib-grid-bg`, `pib-marquee`, `pib-link-underline`, `eyebrow`, `h-display`, `text-display`.

---

## 8. Imagery & Icons

### Photography
- **Real photos only.** No stock teams-smiling-at-laptops.
- Sources: founder portraits, real behind-the-scenes, client work screenshots.
- Treatment: medium-contrast, slight desaturation OK; never heavy colour grading.
- **Default state on cards:** 50–70% opacity + dark gradient overlay so text is always readable. Hover restores to 100%.

### Icons
- **Material Symbols Outlined** (Google Fonts).
- Settings: `'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24`.
- Inside `bento-card`, render in `--color-pib-accent` to draw the eye.
- Standard arrows: `arrow_outward` (external/CTA), `arrow_forward` (continuation), `add` rotated 45° (FAQ accordion open state).

### Logo walls
- Render client names in **Instrument Serif** at 2-3xl + a small `stars` Material Symbol in amber at 60% opacity. No actual client logos needed to look credible.

---

## 9. Motion

- Easing: `cubic-bezier(0.22, 1, 0.36, 1)` (out-quart). Durations 200–700 ms.
- Animate `transform` and `opacity` only (GPU).
- `prefers-reduced-motion: reduce` is honoured globally — animations collapse to instant.
- Scroll reveals via `Reveal`, threshold `0.05`, `rootMargin: -60px`. Stagger by 60–80 ms.
- **No GSAP, no scroll-jacking, no parallax.** Lenis available but not yet wired — add only when a hero needs choreography.

---

## 10. Brand Signals to Repeat

Three small visual signatures that should be recognisable at a glance:

1. **The amber word.** One word in every hero coloured `--color-pib-accent` (e.g. *"...will __copy__"*). One per page.
2. **The eyebrow eye-line.** Every section opens with a small Geist Mono uppercase eyebrow above its headline.
3. **The "currently building" status pill.** Green pulsing dot + "Open for new work · [Month Year]". Reused on the homepage hero and work index.

---

## 11. Off-Site Brand

These count as the brand too — they govern how PiB appears outside the site.

- **OG image:** generated dynamically via `app/og/default.png/route.tsx`. 1200×630, dark mesh background, mono-P logo, big tagline, footer URL + status. Per-page OG can override.
- **Schema graph:** Organization + LocalBusiness + WebSite + Person stitched via `@id` references (see `lib/seo/schema.tsx`). Entity name `Partners in Biz`, alt `PiB`.
- **`/llms.txt` + `/llms-full.txt`:** the AI-discoverability surface. Tone there should match the site exactly.
- **Email signature template** (PLACEHOLDER — to be added when peet's signature standardises):
  ```
  Peet Stander · Founder, Partners in Biz
  partnersinbiz.online · Cape Town
  Software your competitors will copy.
  ```

---

## 12. Single Source of Truth (engineering)

Customer-facing copy and tokens live here. **Edit these, not individual pages:**

- `partnersinbiz-web/lib/seo/site.ts` — SITE config, NAV, SERVICES, CASE_STUDIES, TESTIMONIALS, TECH_STACK, PROCESS, FAQ_HOMEPAGE
- `partnersinbiz-web/lib/content/posts.ts` — blog posts
- `partnersinbiz-web/app/globals.css` — design tokens (`@theme` block)
- `partnersinbiz-web/components/marketing/` — primitives
- `partnersinbiz-web/lib/seo/schema.tsx` — structured-data helpers
- `partnersinbiz-web/app/icon.svg` — favicon / monogram

---

## 13. What's Out (Don't Ever)

- Stock photos of teams in meetings, handshake imagery
- Generic taglines: "We deliver excellence", "Innovative solutions", "Your trusted partner"
- Heavy parallax, scroll-jacking, page-locking animations
- Carousel sliders in heroes
- AI-generated hero images
- Skeuomorphic 3D buttons, drop shadows beyond a hairline
- "Welcome to" or "Hi, we're..." headlines
- Word clouds, auto-popping live chat bubbles, infinite Twitter embeds
- Long auto-playing background videos
- Generic Heroicons (we use Material Symbols Outlined deliberately)

---

## 14. Versioning

- The footer always shows the current brand version: `v2026.04`.
- Bump the version (e.g. `v2026.10`) when a meaningful design or content shift lands.
- Update this doc + the wiki entry + `app/(public)/components/layout/Footer.tsx` in the same PR.
- Hot cache (`~/Cowork/Cowork/agents/partners/wiki/hot.md`) should mention the version bump.

---

## 15. Outstanding placeholders to fill

Tracked in `wiki/hot.md`. Brand-related ones:
- Real client photos (using `portrait-1/2/3.png`, `team-marcus|julian|elena.png` as placeholders)
- Real testimonial author names + companies (currently "Founder, CEO" placeholders)
- Real social URLs in `SITE.social` (LinkedIn / Twitter / Instagram / GitHub)
- Real Cal.com URL
- Real WhatsApp + phone numbers
- Per-page OG images (only `default.png` implemented)
- Standardised email signature
