/**
 * Copy and stills for the split-stage home pages. `/` is ZA only, `/us` is US
 * only. Prices never cross: nothing here puts a USD string on the ZA stage or a
 * ZAR string on the US stage.
 *
 * Copy shape (see wiki site-copy-research-2026-09-02): the dead side is the
 * problem, the owned side is the outcome. The price is not the headline; it
 * lands in the relief lines after the value is shown, and again at the close.
 * The peak is real proof, never a slogan. No em dashes, no filler verbs, one
 * CTA label.
 */

export type StageMarket = 'za' | 'us'

export interface StageStill {
  src: string
  alt: string
}

/** Real screenshots of live client work. Captured from the public sites, not generated. */
export const WORK_SHOTS = {
  ahsLaw: { src: '/images/shot-ahs-law.jpg', alt: 'The AHS Law home page: a dark hero, gold book-a-consultation button, and a bronze statue of Justice' },
  athleet: { src: '/images/shot-athleet.jpg', alt: 'The Athleet home page: "Your club. Your brand. Our software." beside a live club dashboard card' },
  velox: { src: '/images/shot-velox.jpg', alt: 'The Velox site: "Beat your calculator in 60 seconds" with App Store and Google Play buttons' },
  lumen: { src: '/images/shot-lumen.jpg', alt: 'The Lumen site: "Train reading in any language" above a live 600 words-per-minute demo' },
  scrolledBrain: { src: '/images/shot-scrolledbrain.jpg', alt: 'The Scrolled Brain landing page: "How cooked is your attention span?" with a take-the-test button' },
} as const satisfies Record<string, StageStill>

export const STAGE_STILLS = {
  deadInterior: { src: '/marketing/dead-interior.png', alt: 'An empty reception with three chairs and a laminate counter' },
  deadWelcome: { src: '/marketing/dead-welcome.png', alt: 'An old laptop showing grey placeholder blocks on a welcome page' },
  storefrontBefore: { src: '/marketing/storefront-before.png', alt: 'A shopfront with faded vinyl lettering peeling off the fascia' },
  storefrontAfter: { src: '/marketing/storefront-after.png', alt: 'The same shopfront with a tight dark fascia and an amber door edge' },
  rebuildDesk: { src: '/marketing/rebuild-desk.png', alt: 'A dark desk with paper, a roll of amber tape, a laptop and a steel rule' },
  keysDesk: { src: '/marketing/keys-desk.png', alt: 'A key, a USB drive and a blank paper slip on a pale desk' },
  cityGridNight: { src: '/marketing/city-grid-night.png', alt: 'A city grid at dusk with a few amber lights coming on' },
  tapeDraw: { src: '/marketing/tape-draw.png', alt: 'A strip of amber tape torn at one end' },
  rebuildScrub: { src: '/marketing/rebuild-scrub.png', alt: 'A shopfront half old and peeling, half rebuilt in dark paint with an amber door' },
  collapsePaper: { src: '/marketing/collapse-paper.png', alt: 'Crumpled pale paper lit from one side' },
} as const satisfies Record<string, StageStill>

export type StageTell =
  | { kind: 'shout'; text: string }
  | { kind: 'menu'; text: string }
  | { kind: 'filler'; text: string }
  | { kind: 'broken'; text: string }
  | { kind: 'photo'; still: StageStill }
  | { kind: 'meta'; text: string }

export interface StageContent {
  market: StageMarket
  path: '/' | '/us'
  /** Where the running-text CTA goes. Always the existing scheduler. */
  bookHref: string
  cta: string
  dead: {
    h1: string
    tells: StageTell[]
  }
  own: {
    h1: string
    dek: string
    /** Value first, then the price line, in that order. */
    lines: string[]
    ownership: string
  }
  peak: {
    h1: string
    dek: string
    /** Who the proof belongs to. Rendered as a tiny credit under the dek. */
    credit?: string
    still: StageStill
  }
  close: {
    priceLabel: string
    price: string
    priceTerms: string
    /** What the price buys. Running text, one sentence per item. */
    stack: string[]
    statement: string
    /** Sentences before the CTA. The CTA is appended as the last sentence. */
    ctaLead: string
    /** Extra true lines, running text. Never a card grid. */
    extras?: string[]
    small?: string
  }
  colophon: {
    place: string
    /** Running text before the services link. */
    note: string
    /** The one quiet door from the stage to the rest of the firm. */
    servicesLabel: string
    servicesHref: string
  }
}

export const CTA_TEXT = 'Book a 20-min call'
export const SERVICES_LINK_TEXT = 'Everything we do'

const DEAD_H1 = 'You have a site. The phone is quiet.'
const OWN_H1 = 'A site that makes the phone ring.'

const SHARED_TELLS_HEAD: StageTell[] = [
  { kind: 'shout', text: 'Welcome to our website!!!' },
  { kind: 'menu', text: 'Home | About Us | Services | Gallery | Contact Us | Links' },
]

const SHARED_TELLS_TAIL: StageTell[] = [
  { kind: 'broken', text: 'header_final_v2.jpg' },
  { kind: 'photo', still: STAGE_STILLS.storefrontBefore },
  { kind: 'meta', text: 'Hit counter: image not found' },
  { kind: 'meta', text: 'Click here to email us!!' },
]

export const ZA_STAGE: StageContent = {
  market: 'za',
  path: '/',
  bookHref: '/book-a-call',
  cta: CTA_TEXT,
  dead: {
    h1: DEAD_H1,
    tells: [
      ...SHARED_TELLS_HEAD,
      {
        kind: 'filler',
        text: 'We are a proudly South African company with many years of experience in the industry. We offer a wide range of services to suit your needs.',
      },
      ...SHARED_TELLS_TAIL,
      { kind: 'meta', text: 'Last updated 14 March 2014. Site best viewed at 1024x768.' },
    ],
  },
  own: {
    h1: OWN_H1,
    dek: 'Built in 2 to 4 weeks. Yours outright.',
    lines: [
      'Built for you, not from a template.',
      'Lead capture straight to your WhatsApp.',
      'Analytics from day one.',
      'From R35,000, fixed. Half to start, half at launch.',
    ],
    ownership: 'Your GitHub. Your Vercel. Your domain.',
  },
  peak: {
    h1: 'Number one on Google in eight weeks. Enquiries doubled.',
    dek: 'A marketing site and a client portal for a Pretoria law firm. Mobile load 1.4 seconds. The portal paid for the project on its own.',
    credit: 'AHS Law, Pretoria',
    still: WORK_SHOTS.ahsLaw,
  },
  close: {
    priceLabel: 'A marketing site',
    price: 'R35,000',
    priceTerms: 'Built in 2 to 4 weeks. Yours outright.',
    stack: [
      'Up to eight pages, written and built for your business.',
      'Search set up properly: schema, sitemap, and a page Google can read.',
      'Lead capture wired to your phone, with analytics from the first visit.',
      'Handed over on your Vercel, in your GitHub, on your domain, with a 30-day warranty.',
    ],
    statement: 'Pretoria studio. One person. WhatsApp the whole time.',
    ctaLead: 'The R8,000 site skips the writing, the search work, and the lead capture, and you never own it. Twenty minutes is enough to know if this is the right shape for you.',
  },
  colophon: {
    place: 'Partners in Biz. Pretoria.',
    note: 'Also on the call if you need it: web apps from R120,000, mobile, AI, retainers.',
    servicesLabel: SERVICES_LINK_TEXT,
    servicesHref: '/services',
  },
}

export const US_STAGE: StageContent = {
  market: 'us',
  path: '/us',
  bookHref: '/book-a-call?market=us',
  cta: CTA_TEXT,
  dead: {
    h1: DEAD_H1,
    tells: [
      ...SHARED_TELLS_HEAD,
      {
        kind: 'filler',
        text: 'We are a family owned and operated business. We offer a wide range of services to suit your needs. Call today for a free estimate.',
      },
      ...SHARED_TELLS_TAIL,
      { kind: 'meta', text: 'Last updated March 14, 2014. Best viewed in Internet Explorer.' },
    ],
  },
  own: {
    h1: 'The 4-Week Site',
    dek: 'A site that makes the phone ring. Live in 28 days.',
    lines: [
      'A custom site, not a template.',
      'Real lead capture, to your phone.',
      'Analytics from day one.',
      '$9,500, fixed. Half on Stripe to start, half at launch.',
    ],
    ownership: 'Your repo. Your hosting. Your keys.',
  },
  peak: {
    h1: 'Google still sends people to the guy who has been there ten years.',
    dek: 'For 90 days we make your Google Business Profile do the selling. You do not log in. You take the calls. The 90-Day Fill is $4,500.',
    still: STAGE_STILLS.cityGridNight,
  },
  close: {
    priceLabel: 'The 4-Week Site',
    price: '$9,500',
    priceTerms: 'Half on Stripe to start, half at launch. Live in 28 days.',
    stack: [
      'Up to eight pages, written and built for your business.',
      'Search set up properly: schema, sitemap, and a page Google can read.',
      'Lead capture wired to your phone, with analytics from the first visit.',
      'Handed over in your repo, on your hosting, on your domain, with a 30-day warranty.',
    ],
    statement: 'The 4-Week Site gets you a place they can trust. The 90-Day Fill gets them to find it.',
    ctaLead: 'The 90-Day Fill is $4,500: half now, half on day 45.',
    extras: [
      'One person, on WhatsApp, with an 8am to 12pm ET overlap. No discovery theatre. No account managers. No monthly platform fee. No site you do not own.',
    ],
    small: 'If you want us to stay on after day 90, $2,500 a month. Optional.',
  },
  colophon: {
    place: 'Partners in Biz. Pretoria, working US hours in the morning.',
    note: 'Also on the call if you need it: web apps, mobile, AI, retainers.',
    servicesLabel: SERVICES_LINK_TEXT,
    servicesHref: '/services',
  },
}

export const STAGE_BY_MARKET: Record<StageMarket, StageContent> = {
  za: ZA_STAGE,
  us: US_STAGE,
}
