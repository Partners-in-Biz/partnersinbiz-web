export type VentureStat = {
  label: string
  value: string
}

export type PartnerOpportunity = {
  id: string
  venture: string
  title: string
  eyebrow: string
  icon: string
  tagline: string
  summary: string
  pitch: string
  liveUrl?: string
  liveLabel?: string
  stats: VentureStat[]
  whatsBuilt: string[]
  partnerProfile: string
  whatYouDo: string[]
  whatYouGet: string[]
  commercialModel: string
  proofNeeded: string
  reviewerAccess: string
  points: string[]
  nextSteps: string[]
  href: string
}

export const PARTNER_OPPORTUNITIES: PartnerOpportunity[] = [
  {
    id: 'ballito-regional-coupon-partner',
    venture: 'I am Ballito',
    title: 'I am Ballito — regional venture partner',
    eyebrow: 'Local commerce platform',
    icon: 'public',
    tagline: 'Your Dolphin Coast, in your pocket.',
    summary:
      'A live, two-sided loyalty and coupon platform for Ballito and the Dolphin Coast. Locals install it in two taps, collect stamps that count across the whole town, and redeem coupons at the till. We are opening it to partners who can own merchant growth in a region — starting with Ballito, then town by town.',
    pitch:
      'I am Ballito is a finished, live product — not an idea looking for funding. Locals and visitors install it straight from the browser (no app store), browse the businesses around them, save coupons, and collect stamps on one passport that works at every participating merchant: coffee on Monday, ice cream on Wednesday, both count. Businesses list themselves, run their own coupons and stamp cards, and redeem at the till with a phone or iPad — no hardware. The platform, billing, compliance, and admin layer are built and running. What it needs now is what software cannot do: someone who knows the town, can walk into real businesses, and can sign the first wave of merchants. That is the partnership — own a defined region and grow it.',
    liveUrl: 'https://iam-ballito-pwa.vercel.app',
    liveLabel: 'Browse the live app',
    stats: [
      { label: 'Status', value: 'Live and feature-complete' },
      { label: 'Merchant plans', value: 'Free / R299 / R599 p.m.' },
      { label: 'Install', value: 'Two taps — no app store' },
      { label: 'Compliance', value: 'POPIA by design' },
    ],
    whatsBuilt: [
      'Installable PWA: two taps to the home screen on Android, a guided add on iPhone — no app store between us and a feature update.',
      'Cross-merchant stamp passport: one loyalty card for the whole town, with rewards that stack across cafés, salons, restaurants, and shops.',
      'Town-wide coupon feed with three till-side redemption mechanisms: rotating PIN/QR, scan-the-till QR, and cashier-scans-customer.',
      'Full merchant self-service: listing editor, three-step coupon wizard, stamp cards, staff seats, and a redemption console that runs on any phone.',
      'Tiered subscriptions (Free, Pro R299/mo, Premium R599/mo) with Paystack billing and limits enforced on the server, not just in the UI.',
      'Push campaigns, merchant analytics, a platform admin layer, and an editorial CMS publishing a weekly “What’s on in Ballito” digest.',
      'POPIA-compliant by default: unbundled consent at sign-up, an immutable consent ledger, and built-in data export and deletion.',
    ],
    partnerProfile:
      'Regional operators, community connectors, local media owners, chamber and network members — people who can walk into real businesses and open a practical conversation. For new regions beyond Ballito: anyone who knows their town well enough to sign its first ten merchants.',
    whatYouDo: [
      'Recruit and onboard merchants in a defined town or region.',
      'Own the local relationships, offer quality, and coupon momentum.',
      'Feed the editorial side with what is actually on in town.',
    ],
    whatYouGet: [
      'A finished platform to sell — no build cost, no app-store overhead, and updates that ship to every user instantly.',
      'A share in your region’s merchant subscription growth, structured as a revenue-share once territory and responsibilities are agreed.',
      'Platform, billing, compliance, and support stay on us — you focus on merchants and community.',
    ],
    commercialModel:
      'Revenue-share on regional merchant subscriptions, agreed after a fit review. We do not publish income promises on this page — terms follow region, responsibilities, and proof.',
    proofNeeded:
      'Area knowledge, merchant relationships, examples of local pages/groups/sites you can access, and any demo-only credentials where a reviewer needs to inspect a non-public asset.',
    reviewerAccess:
      'Share public links freely. If a reviewer needs login access, provide demo credentials only or request a secure handoff. Do not paste real passwords into the public form.',
    points: ['Own a defined region', 'Merchant acquisition', 'Share in subscription growth'],
    nextSteps: [
      'Register interest for the region you can cover',
      'PiB reviews fit, conflicts, and territory',
      'If promising, we agree terms and a protected handoff for demos or real access',
    ],
    href: '/partner-with-us/ballito-regional-coupon-partner',
  },
  {
    id: 'athleet-club-growth',
    venture: 'Athleet',
    title: 'Athleet — club growth partner',
    eyebrow: 'Sports club management SaaS',
    icon: 'sports_martial_arts',
    tagline: 'Athlete management without the admin.',
    summary:
      'A live, multi-tenant club and athlete management platform — registrations, athlete records, attendance, performance tracking, and team communication in one place. We want partners who can carry it into clubs, schools, and sports networks where the admin pain is already real.',
    pitch:
      'Every serious club runs on the same broken stack: a WhatsApp group, three spreadsheets, and one volunteer who knows where everything is. Athleet replaces that. Each club gets its own workspace with athlete records, registrations, attendance, performance tracking, and communication — built as a multi-tenant SaaS, so onboarding a new club is configuration, not a project. The product is live with seeded demo clubs you can walk a coach through today. What it needs is trusted introductions: coaches, club administrators, and school-sport networks do not respond to ads, they respond to people they know. If you are inside those circles, this is your lane.',
    liveUrl: 'https://athleet.space/demos',
    liveLabel: 'Walk through the live demos',
    stats: [
      { label: 'Status', value: 'Live with demo clubs' },
      { label: 'Built for', value: 'Clubs, schools, federations' },
      { label: 'Model', value: 'Club SaaS subscriptions' },
      { label: 'Onboarding', value: 'Configuration, not a project' },
    ],
    whatsBuilt: [
      'Multi-tenant SaaS: every club gets its own workspace, branding, and data — fully separated from the next club.',
      'Athlete records, registrations, and attendance in one system instead of scattered spreadsheets.',
      'Performance tracking and reporting that coaches actually use between sessions.',
      'Team communication that replaces the WhatsApp-group-and-spreadsheet stack.',
      'Live demo environments seeded with realistic club data — qualified prospects can see their own club in it immediately.',
    ],
    partnerProfile:
      'Wrestling networks, school-sport connectors, club administrators, coaches, sports parents with reach, and regional reps who can create warm introductions — not generic affiliate traffic.',
    whatYouDo: [
      'Open trusted club, school, and coach conversations.',
      'Map your sport network and qualify where the admin pain is sharpest.',
      'Run qualified Athleet demos, or hand them to us warm.',
    ],
    whatYouGet: [
      'A live product to demo, not a pitch deck — show a coach their club running on it in minutes.',
      'Referral or ground-sales economics agreed per territory and introduction quality.',
      'Product, hosting, and support stay on us — you bring the relationships.',
    ],
    commercialModel:
      'Ground-sales or referral-style partnership, agreed after a fit review. Terms depend on territory, introduction quality, and the level of support needed.',
    proofNeeded:
      'Club/school/coach networks, relevant pages or groups, demo access to any review material, and notes about where a secure access handoff is needed.',
    reviewerAccess:
      'Use public links and demo logins only. If actual club systems or private communities need review, request a secure handoff instead of putting secrets in the form.',
    points: ['Coach and club introductions', 'Sport-network mapping', 'Qualified Athleet demos'],
    nextSteps: [
      'Register interest for Athleet with your network details',
      'PiB reviews your reach and first-introduction plan',
      'We agree territory, economics, and safe demo access',
    ],
    href: '/partner-with-us/athleet-club-growth',
  },
  {
    id: 'services-growth-partner',
    venture: 'Partners in Biz services',
    title: 'Sell our growth services',
    eyebrow: 'Services and platform reseller',
    icon: 'storefront',
    tagline: 'A full growth team behind your client book.',
    summary:
      'Bring the clients; we carry the delivery. Websites, SEO sprints, content engines, CRM, email and social automation — productized services running on our own platform. Built for agencies, consultants, and connectors who keep meeting businesses that need growth but have nobody to deliver it.',
    pitch:
      'Most people who could sell growth services never do, because delivery is the hard part: you need designers, developers, SEO operators, content production, and a system that keeps clients informed without consuming your week. We already run that engine — for our own clients, on our own platform. This lane opens it to partners. You introduce a business that needs a website, an SEO sprint, a content engine, or the full growth operating system; we scope it, deliver it, and keep the client experience transparent through the portal. You stay as close to the work as you want — pure referrer, or reseller with the client relationship in your name.',
    liveUrl: '/services',
    liveLabel: 'See the full service catalogue',
    stats: [
      { label: 'Status', value: 'Delivering for live clients' },
      { label: 'Delivery', value: 'Productized, platform-run' },
      { label: 'Your role', value: 'Referrer or reseller' },
      { label: 'Client visibility', value: 'Portal with approvals' },
    ],
    whatsBuilt: [
      'Productized delivery: websites, 90-day SEO sprints, 12-week content engines, brand identity, and campaign work.',
      'A real operating platform behind every engagement — CRM, projects, email marketing, social scheduling, and analytics your clients see working.',
      'AI-assisted production that keeps delivery fast without cutting corners on review and approval.',
      'A client portal with proposals, approvals, reporting, and transparent progress — nothing disappears into a black box.',
    ],
    partnerProfile:
      'Agencies that want delivery capacity, consultants and bookkeepers with trusted client books, web designers who sell but do not build, and connectors who repeatedly meet businesses with demand but no growth engine.',
    whatYouDo: [
      'Introduce businesses that need growth work you cannot or do not want to deliver yourself.',
      'Choose your distance: hand the client over, or stay the face of the engagement.',
      'Keep the relationship — we protect it, not poach it.',
    ],
    whatYouGet: [
      'Commission or reseller margin agreed per arrangement and deal size.',
      'A delivery team and platform behind you without hiring one.',
      'Co-branded or white-labelled proposals where the arrangement fits.',
    ],
    commercialModel:
      'Referral commission or reseller margin, agreed case by case after a fit review. Terms depend on deal size, your involvement in delivery, and who owns the client relationship.',
    proofNeeded:
      'The kind of clients you can reach, examples of past introductions or engagements, your public presence, and any context that shows the demand is real.',
    reviewerAccess:
      'Public evidence is preferred. If login-gated proof matters, use demo credentials or ask for a secure handoff process; never submit real secrets publicly.',
    points: ['Bring the clients', 'We carry delivery', 'Referral or reseller terms'],
    nextSteps: [
      'Register interest with the client types you can reach',
      'PiB reviews fit and the first likely engagement',
      'We agree commission or reseller terms and start with one deal',
    ],
    href: '/partner-with-us/services-growth-partner',
  },
]

export function getPartnerOpportunity(id: string) {
  return PARTNER_OPPORTUNITIES.find((opportunity) => opportunity.id === id) ?? null
}
