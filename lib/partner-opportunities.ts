export type PartnerOpportunity = {
  id: string
  title: string
  eyebrow: string
  icon: string
  summary: string
  detail: string
  audience: string
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
    title: 'I am Ballito regional coupon partner',
    eyebrow: 'Local marketplace operator',
    icon: 'public',
    summary: 'Own a defined local area, recruit merchants, and grow a useful coupon marketplace with businesses residents already know.',
    detail:
      'This opportunity is for someone who understands a local region and can turn that knowledge into merchant conversations. The first focus is I am Ballito: local offers, useful business profiles, and coupon-led reasons for residents to return. We want to hear which area you can cover, which merchant categories you can open, and what local proof you already have.',
    audience: 'Regional operators, community connectors, local media owners, chamber/network members, and people who can walk into real businesses and start a practical partnership conversation.',
    commercialModel: 'Structured regional partnership discussion after fit review. No public income promise is made on this page; terms are agreed only after region, responsibilities, and proof are reviewed.',
    proofNeeded: 'Area knowledge, merchant relationships, examples of local pages/groups/sites you can access, and any demo-only credentials where a reviewer needs to inspect a non-public asset.',
    reviewerAccess: 'Share public links freely. If a reviewer needs login access, provide demo credentials only or request a secure handoff. Do not paste real passwords into the public form.',
    points: ['Defined town or region', 'Merchant and offer acquisition', 'Local content and coupon growth'],
    nextSteps: ['Register interest for this exact region', 'PiB reviews fit and conflicts', 'If promising, we agree a protected handoff for demos or real access'],
    href: '/partner-with-us/ballito-regional-coupon-partner',
  },
  {
    id: 'athleet-club-growth',
    title: 'Athleet club growth partner',
    eyebrow: 'Sports and club sales lane',
    icon: 'sports_martial_arts',
    summary: 'Introduce Athleet to wrestling clubs, schools, coaches, and sports communities where athlete management is already a real operational problem.',
    detail:
      'Athleet needs people who can open trusted club and coach conversations, not generic affiliate traffic. The right partner can identify clubs that need athlete records, registrations, communication, attendance, performance tracking, and simpler admin. Tell us which sport circles you can reach and how you would create the first qualified introductions.',
    audience: 'Wrestling networks, school-sport connectors, club administrators, coaches, sports parents with reach, and regional reps who can create warm introductions.',
    commercialModel: 'Ground-sales or referral-style partnership discussion after fit review. Terms depend on territory, introduction quality, and the level of support needed.',
    proofNeeded: 'Club/school/coach networks, relevant pages or groups, demo access to any review material, and notes about where a secure access handoff is needed.',
    reviewerAccess: 'Use public links and demo logins only. If actual club systems or private communities need review, request a secure handoff instead of putting secrets in the form.',
    points: ['Coach and club introductions', 'School and sport-network mapping', 'Qualified Athleet demos'],
    nextSteps: ['Register interest for Athleet', 'PiB reviews your network and first-introduction plan', 'We agree safe demo/reviewer access where needed'],
    href: '/partner-with-us/athleet-club-growth',
  },
  {
    id: 'local-growth-scout',
    title: 'Local growth scout',
    eyebrow: 'Opportunity finder',
    icon: 'travel_explore',
    summary: 'Bring credible local business, property, school, sport, or community opportunities into PiB where a Growth Operating System could unlock value.',
    detail:
      'Some people are better scouts than operators. This lane is for people who spot credible local opportunities: businesses with demand but poor conversion, regional networks that need better systems, or communities where PiB can create a focused growth sprint. Tell us what you see, who you can introduce, and what proof makes the opportunity worth reviewing.',
    audience: 'Connectors, consultants, community leaders, property-network insiders, B2B introducers, and people who repeatedly see under-used growth opportunities.',
    commercialModel: 'Reviewed introduction or scout partnership. Any commercial arrangement is agreed case by case after PiB validates fit, permission, and evidence.',
    proofNeeded: 'Public evidence links, company or location context, why the opportunity matters now, and whether any private review requires secure handoff.',
    reviewerAccess: 'Public evidence is preferred. If login-gated proof matters, use demo credentials or ask for a secure handoff process; never submit real secrets publicly.',
    points: ['Qualified opportunity spotting', 'Warm introductions', 'Evidence-led local growth ideas'],
    nextSteps: ['Register the specific opportunity', 'PiB checks fit and permission boundaries', 'Promising leads move into a scoped follow-up conversation'],
    href: '/partner-with-us/local-growth-scout',
  },
]

export function getPartnerOpportunity(id: string) {
  return PARTNER_OPPORTUNITIES.find((opportunity) => opportunity.id === id) ?? null
}
