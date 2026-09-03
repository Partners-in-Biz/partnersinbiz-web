import { CTA_LABEL } from '@/lib/seo/site'
import { WORK_SHOTS, type StageMarket, type StageStill } from './stage-content'

/**
 * The Studio stage. One sticky frame, four acts, real work only.
 *
 *   1 Open    the firm in one line, three real shots slide in
 *   2 Work    a filmstrip: four things we build, each with price and a real plate
 *   3 Proof   the ink panel: four numbers with names on them
 *   4 Close   how it goes, the price anchors, one CTA
 *
 * No parody, no generated stills. Copy has no em dashes. One CTA label.
 */

export interface StudioSlide {
  index: string
  service: string
  h2: string
  line: string
  price: string
  terms: string
  shot: StageStill
  credit: string
  href: string
}

export interface StudioStat {
  n: string
  line: string
  credit: string
}

export interface StudioContent {
  market: StageMarket
  path: '/' | '/us'
  bookHref: string
  cta: string
  hero: {
    kicker: string
    h1: string
    dek: string
    shots: [StageStill, StageStill, StageStill]
  }
  work: {
    kicker: string
    slides: StudioSlide[]
  }
  proof: {
    h2: string
    dek: string
    stats: StudioStat[]
  }
  close: {
    h2: string
    steps: string[]
    anchors: Array<{ label: string; price: string }>
    statement: string
    ctaLead: string
  }
  colophon: {
    place: string
    note: string
    servicesLabel: string
    servicesHref: string
  }
}

const SHARED_PROOF: StudioContent['proof'] = {
  h2: 'Real names. Real numbers.',
  dek: 'Every project on this page is a live codebase we can point at.',
  stats: [
    { n: 'No. 1', line: 'on Google for its main practice term within eight weeks. Enquiries doubled.', credit: 'AHS Law, Pretoria' },
    { n: '8s to 2s', line: 'page loads after a zero-downtime rebuild of a ten-year-old aviation loyalty platform.', credit: 'Loyalty Plus' },
    { n: '4 weeks', line: 'from kick-off to live for three pilot sports clubs, on their own subdomains.', credit: 'Athleet' },
    { n: '2 stores', line: 'iOS and Android from one codebase, with subscriptions that survived review.', credit: 'Velox and Lumen' },
  ],
}

export const ZA_STUDIO: StudioContent = {
  market: 'za',
  path: '/',
  bookHref: '/book-a-call',
  cta: CTA_LABEL,
  hero: {
    kicker: 'Partners in Biz. Pretoria.',
    h1: 'Software that brings in clients.',
    dek: 'Websites, web apps, mobile apps and AI for South African businesses. Built by the person who quotes it. Yours outright.',
    shots: [WORK_SHOTS.ahsLaw, WORK_SHOTS.athleet, WORK_SHOTS.velox],
  },
  work: {
    kicker: 'What we build',
    slides: [
      {
        index: '01',
        service: 'Marketing sites',
        h2: 'A site that makes the phone ring.',
        line: 'Found on Google, fast on a phone, enquiries straight to your WhatsApp. Written and designed for your business, not a template.',
        price: 'From R35,000',
        terms: 'Fixed. Half to start, half at launch. Live in 2 to 4 weeks.',
        shot: WORK_SHOTS.ahsLaw,
        credit: 'AHS Law. Number one on Google in eight weeks.',
        href: '/services/web-development',
      },
      {
        index: '02',
        service: 'Web applications',
        h2: 'The platform your business runs on.',
        line: 'CRMs, client portals, dashboards and internal tools. A working preview from week two, and you own the code the day it ships.',
        price: 'From R120,000',
        terms: 'Fixed scope after a two-week discovery.',
        shot: WORK_SHOTS.athleet,
        credit: 'Athleet. Club platform live for three clubs in under four weeks.',
        href: '/services/web-applications',
      },
      {
        index: '03',
        service: 'Mobile apps',
        h2: 'In both stores, from one codebase.',
        line: 'iOS and Android with offline support, push notifications, subscriptions, and the store submissions handled for you.',
        price: 'From R180,000',
        terms: 'One number, both stores.',
        shot: WORK_SHOTS.velox,
        credit: 'Velox. In the App Store and on Google Play.',
        href: '/services/mobile-apps',
      },
      {
        index: '04',
        service: 'AI integrations',
        h2: 'Agents that do real work.',
        line: 'Answer, quote, summarise and follow up, wired into the tools you already use. One production workflow at a time.',
        price: 'From R75,000',
        terms: 'Fixed after a use-case design call.',
        shot: WORK_SHOTS.lumen,
        credit: 'Lumen. AI-generated reading passages in three languages.',
        href: '/services/ai-integration',
      },
    ],
  },
  proof: SHARED_PROOF,
  close: {
    h2: 'How it goes.',
    steps: [
      'A 20-minute call about what you have and what you need.',
      'A fixed quote within three working days. No discovery retainer.',
      'A preview link from the first week. WhatsApp the whole time.',
      'Launch on your Vercel, in your GitHub, on your domain. Fire us the next day and nothing breaks.',
    ],
    anchors: [
      { label: 'Marketing site', price: 'from R35,000' },
      { label: 'Web application', price: 'from R120,000' },
      { label: 'Retainer', price: 'from R15,000 a month' },
    ],
    statement: 'Pretoria studio. One person from quote to launch.',
    ctaLead: 'Twenty minutes is enough to know if we are the right shape for you.',
  },
  colophon: {
    place: 'Partners in Biz. Pretoria.',
    note: 'Growth systems, bespoke builds and retainers are on the services page.',
    servicesLabel: 'Everything we do',
    servicesHref: '/services',
  },
}

export const US_STUDIO: StudioContent = {
  market: 'us',
  path: '/us',
  bookHref: '/book-a-call?market=us',
  cta: CTA_LABEL,
  hero: {
    kicker: 'Partners in Biz. United States.',
    h1: 'A site that makes the phone ring. Live in 28 days.',
    dek: 'The 4-Week Site for founder-led firms: law, clinics, coaches, B2B services. Built by the person who quotes it. You own the repo, the hosting and the domain.',
    shots: [WORK_SHOTS.ahsLaw, WORK_SHOTS.athleet, WORK_SHOTS.velox],
  },
  work: {
    kicker: 'The offer',
    slides: [
      {
        index: '01',
        service: 'The 4-Week Site',
        h2: 'A site that gets you clients.',
        line: 'A custom Next.js site, written and designed for your firm. Loads in under two seconds, built to rank, lead capture wired to your inbox or CRM.',
        price: '$9,500',
        terms: 'Half on Stripe to start, half at launch. Live in 28 days.',
        shot: WORK_SHOTS.ahsLaw,
        credit: 'AHS Law. Number one on Google in eight weeks.',
        href: '/us',
      },
      {
        index: '02',
        service: 'The 90-Day Fill',
        h2: 'Then we get them to find it.',
        line: 'Ninety days of Google Business Profile work: the map pack, the reviews, the posts that mention the neighborhoods you serve. You take the calls.',
        price: '$4,500',
        terms: 'Half now, half at day 45.',
        shot: WORK_SHOTS.scrolledBrain,
        credit: 'Scrolled Brain. A 38% sign-up rate on the new landing page.',
        href: '/us',
      },
      {
        index: '03',
        service: 'Portals and apps',
        h2: 'When the site needs a back end.',
        line: 'Client portals, dashboards and internal tools. A working preview from week two, and you own the code the day it ships.',
        price: 'From $35,000',
        terms: 'Fixed scope after a two-week discovery.',
        shot: WORK_SHOTS.athleet,
        credit: 'Athleet. Club platform live for three clubs in under four weeks.',
        href: '/services/web-applications',
      },
      {
        index: '04',
        service: 'Keep shipping',
        h2: 'A retainer you can cancel any month.',
        line: 'Hosting, monitoring, and a standing block of development hours so the site keeps working after launch.',
        price: '$2,500 a month',
        terms: 'Cancel any month. Overlap 8am to 12pm ET.',
        shot: WORK_SHOTS.velox,
        credit: 'Velox. In the App Store and on Google Play.',
        href: '/services/growth-systems',
      },
    ],
  },
  proof: SHARED_PROOF,
  close: {
    h2: 'How it goes.',
    steps: [
      'A 20-minute call about what you have and what you need.',
      'A fixed quote within three working days. No discovery retainer.',
      'A preview link from the first week. WhatsApp the whole time.',
      'Launch on your Vercel, in your GitHub, on your domain. Fire us the next day and nothing breaks.',
    ],
    anchors: [
      { label: 'The 4-Week Site', price: '$9,500' },
      { label: 'The 90-Day Fill', price: '$4,500' },
      { label: 'Retainer', price: '$2,500 a month' },
    ],
    statement: 'One price. One promise. 28 days.',
    ctaLead: 'Twenty minutes is enough to know if this is the right shape for you.',
  },
  colophon: {
    place: 'Partners in Biz. Pretoria, working US hours.',
    note: 'The full firm, with prices in rand, is on the services page.',
    servicesLabel: 'Everything we do',
    servicesHref: '/services',
  },
}
