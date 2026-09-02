/**
 * Copy and stills for the split-stage home pages. `/` is ZA only, `/us` is US
 * only. Prices never cross: nothing here puts a USD string on the ZA stage or a
 * ZAR string on the US stage.
 */

export type StageMarket = 'za' | 'us'

export interface StageStill {
  src: string
  alt: string
}

export const STAGE_STILLS = {
  deadInterior: { src: '/marketing/dead-interior.png', alt: 'An empty reception with three chairs and a laminate counter' },
  deadWelcome: { src: '/marketing/dead-welcome.png', alt: 'An old laptop showing grey placeholder blocks on a welcome page' },
  storefrontBefore: { src: '/marketing/storefront-before.png', alt: 'A shopfront with faded vinyl lettering peeling off the fascia' },
  storefrontAfter: { src: '/marketing/storefront-after.png', alt: 'The same shopfront with a tight dark fascia and an amber door edge' },
  rebuildDesk: { src: '/marketing/rebuild-desk.png', alt: 'A dark desk with paper, a roll of amber tape, a laptop and a steel rule' },
  keysDesk: { src: '/marketing/keys-desk.png', alt: 'A key, a USB drive and a blank paper slip on a pale desk' },
  cityGridNight: { src: '/marketing/city-grid-night.png', alt: 'A city grid at dusk with a few amber lights coming on' },
  tapeDraw: { src: '/marketing/tape-draw.png', alt: '' },
  rebuildScrub: { src: '/marketing/rebuild-scrub.png', alt: 'A shopfront half old and peeling, half rebuilt in dark paint with an amber door' },
  collapsePaper: { src: '/marketing/collapse-paper.png', alt: '' },
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
    lines: string[]
    ownership: string
  }
  peak: {
    h1: string
    dek: string
    still: StageStill
  }
  close: {
    priceLabel: string
    price: string
    priceTerms: string
    statement: string
    /** Sentences before the CTA. The CTA is appended as the last sentence. */
    ctaLead: string
    /** Extra true lines, running text. Never a card grid. */
    extras?: string[]
    small?: string
  }
  colophon: {
    place: string
    note?: string
  }
}

export const CTA_TEXT = 'Book a 20-min call'

const DEAD_H1 = 'You have a site. The phone is quiet.'

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
    h1: 'A marketing site from R35,000',
    dek: 'Yours in 2 to 4 weeks. You own it.',
    lines: ['Built for you, not from a template.', 'Real lead capture, straight to your phone.', 'Analytics from day one.'],
    ownership: 'Your GitHub. Your Vercel. Your domain.',
  },
  peak: {
    h1: 'A site nobody can find is a brochure.',
    dek: 'You leave with the GitHub, the hosting, and the domain. Fire us the next day and nothing breaks.',
    still: STAGE_STILLS.keysDesk,
  },
  close: {
    priceLabel: 'A marketing site',
    price: 'R35,000',
    priceTerms: 'From R35,000. Yours in 2 to 4 weeks. You own it.',
    statement: 'Pretoria studio. One person. WhatsApp the whole time.',
    ctaLead: 'Twenty minutes is enough to know if this is the right shape for you.',
  },
  colophon: {
    place: 'Partners in Biz. Pretoria.',
    note: 'Also on the call if you need it: web apps from R120,000, retainers, advisory.',
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
    dek: '$9,500. Yours in 28 days.',
    lines: ['A custom site, not a template.', 'Real lead capture.', 'Analytics from day one.'],
    ownership: 'Your repo. Your hosting. Your keys.',
  },
  peak: {
    h1: 'Google still sends people to the guy who has been there ten years.',
    dek: 'For 90 days we make your Google Business Profile do the selling. You do not log in. You take the calls. $4,500.',
    still: STAGE_STILLS.cityGridNight,
  },
  close: {
    priceLabel: 'The 4-Week Site',
    price: '$9,500',
    priceTerms: 'Half on Stripe to start, half at launch. Live in 28 days.',
    statement: 'The 4-Week Site gets you a place they can trust. The 90-Day Fill gets them to find it.',
    ctaLead: 'The 90-Day Fill is $4,500: half now, half on day 45.',
    extras: [
      'One person, on WhatsApp, with an 8am to 12pm ET overlap. No discovery theatre. No account managers. No monthly platform fee. No site you do not own.',
    ],
    small: 'If you want us to stay on after day 90, $2,500 a month. Optional.',
  },
  colophon: {
    place: 'Partners in Biz. Pretoria, working US hours in the morning.',
  },
}

export const STAGE_BY_MARKET: Record<StageMarket, StageContent> = {
  za: ZA_STAGE,
  us: US_STAGE,
}
