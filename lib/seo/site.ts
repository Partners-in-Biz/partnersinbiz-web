export const SITE = {
  name: 'Partners in Biz',
  shortName: 'PiB',
  url: 'https://partnersinbiz.online',
  locale: 'en_ZA',
  language: 'en-ZA',
  description:
    'South African web development and AI integration agency. We build Next.js websites, custom platforms, AI agents, and growth automation for ambitious SMEs.',
  tagline: 'Software your competitors will copy.',
  email: 'hello@partnersinbiz.online',
  phone: '+27-67-896-6333',
  whatsapp: '+27678966333',
  address: {
    streetAddress: 'Remote-first', // PLACEHOLDER
    addressLocality: 'Pretoria',
    addressRegion: 'Gauteng',
    postalCode: '0001',
    addressCountry: 'ZA',
  },
  geo: { latitude: -25.7461, longitude: 28.1881 },
  founder: {
    name: 'Peet Stander',
    role: 'Founder & Principal Engineer',
    linkedin: 'https://www.linkedin.com/in/peetstander', // PLACEHOLDER — verify
    twitter: 'https://twitter.com/peetstander', // PLACEHOLDER
    github: 'https://github.com/peetstander', // PLACEHOLDER
  },
  social: {
    facebook: 'https://www.facebook.com/partnersinbiz',
    linkedin: 'https://www.linkedin.com/company/partnersinbiz', // PLACEHOLDER
    twitter: 'https://twitter.com/partnersinbiz', // PLACEHOLDER
    instagram: 'https://www.instagram.com/partnersinbiz', // PLACEHOLDER
    github: 'https://github.com/partnersinbiz', // PLACEHOLDER
  },
  cal: {
    url: '/book-a-call',
  },
  founded: '2024',
  pricing: {
    currency: 'ZAR',
    starterFrom: 35000,
    growthFrom: 120000,
  },
} as const;

export const NAV = [
  { href: '/work', label: 'Work' },
  { href: '/services', label: 'Services' },
  { href: '/our-process', label: 'Process' },
  { href: '/insights', label: 'Insights' },
  { href: '/about', label: 'About' },
] as const;

export const SERVICES = [
  {
    slug: 'web-development',
    name: 'Marketing Websites',
    short: 'High-performance sites that convert',
    outcome: 'Sub-2s LCP. Real lead capture. Built to be found.',
    icon: 'public',
    keywords: ['Next.js', 'Tailwind', 'SEO', 'Vercel'],
  },
  {
    slug: 'web-applications',
    name: 'Web Applications',
    short: 'Custom platforms, internal tools, SaaS',
    outcome: 'Production CRMs, dashboards, and bespoke SaaS — shipped in weeks, not quarters.',
    icon: 'dashboard',
    keywords: ['React', 'Firebase', 'Next.js', 'Auth'],
  },
  {
    slug: 'mobile-apps',
    name: 'Mobile Apps',
    short: 'iOS + Android from a single codebase',
    outcome: 'Native-feel apps with shared business logic, real offline support, and store-ready builds.',
    icon: 'phone_iphone',
    keywords: ['React Native', 'Expo', 'Capacitor'],
  },
  {
    slug: 'ai-integration',
    name: 'AI Integrations',
    short: 'Agents, assistants, and automation',
    outcome: 'Claude and GPT integrations that do real work — not chatbots that pretend to.',
    icon: 'bolt',
    keywords: ['Claude', 'OpenAI', 'RAG', 'Agents'],
  },
  {
    slug: 'growth-systems',
    name: 'Growth Systems',
    short: 'Automation, analytics, and outreach',
    outcome: 'Scheduled content, email nurture, and analytics — wired to your CRM, not bolted on.',
    icon: 'trending_up',
    keywords: ['Resend', 'Analytics', 'Automation'],
  },
  {
    slug: 'bespoke-builds',
    name: 'Bespoke Builds',
    short: 'When the off-the-shelf answer is "no"',
    outcome: 'Strategic partnerships for novel software — equity, retainer, or fixed-scope.',
    icon: 'auto_awesome',
    keywords: ['Strategy', 'Architecture'],
  },
] as const;

export const CASE_STUDIES = [
  {
    slug: 'athleet',
    client: 'Athleet',
    industry: 'Sports & Fitness',
    services: ['Web Application', 'Mobile App', 'Brand'],
    year: '2025',
    summary: 'A multi-tenant club management platform now powering 500+ athletes across South Africa.',
    headline: 'How we built a sports club OS in under 4 weeks',
    metrics: [
      { value: '500+', label: 'athletes managed' },
      { value: '<4w', label: 'time to launch' },
      { value: '98%', label: 'retention' },
    ],
    cover: '/images/case-athleet-cover.jpg',
    stack: ['Next.js 16', 'Firebase', 'Tailwind v4', 'Resend'],
    href: '/work/athleet',
  },
  {
    slug: 'loyalty-plus',
    client: 'Loyalty Plus',
    industry: 'Aviation',
    services: ['Web Application', 'Mobile App'],
    year: '2025',
    summary: 'B2B loyalty platform rebuilt from the ground up — Angular + Ionic monorepo serving global aviation clients.',
    headline: 'Modernising a 10-year B2B loyalty platform without downtime',
    metrics: [
      { value: '0', label: 'minutes downtime' },
      { value: '4.1x', label: 'faster page loads' },
      { value: '12+', label: 'enterprise clients' },
    ],
    cover: '/images/case-loyaltyplus-cover.jpg',
    stack: ['Angular', 'Ionic', 'Capacitor', 'Firebase'],
    href: '/work/loyalty-plus',
  },
  {
    slug: 'ahs-law',
    client: 'AHS Law',
    industry: 'Legal',
    services: ['Marketing Website', 'Client Portal'],
    year: '2025',
    summary: 'Bespoke marketing site and secure client document portal for a boutique South African law firm.',
    headline: 'A law firm site that ranks — and a portal that bills',
    metrics: [
      { value: '#1', label: 'on Google for primary terms' },
      { value: '1.4s', label: 'mobile LCP' },
      { value: '2x', label: 'inbound enquiries' },
    ],
    cover: '/images/case-ahs-law-cover.jpg',
    stack: ['Vite', 'React', 'Firebase Auth'],
    href: '/work/ahs-law',
  },
  {
    slug: 'scrolledbrain',
    client: 'Scrolled Brain',
    industry: 'EdTech / Productivity',
    services: ['Marketing Website', 'Analytics'],
    year: '2026',
    summary: 'Conversion-focused marketing site for a speed-reading platform, with custom product analytics and funnel tracking.',
    headline: 'A marketing site wired to a custom analytics stack',
    metrics: [
      { value: '94', label: 'mobile Lighthouse' },
      { value: '38%', label: 'sign-up rate' },
      { value: 'Day 1', label: 'analytics in production' },
    ],
    cover: '/images/case-scrolledbrain-cover.jpg',
    stack: ['Next.js', '@partnersinbiz/analytics-js'],
    href: '/work/scrolledbrain',
  },
] as const;

export const TESTIMONIALS = [
  {
    quote:
      'Pip and the Partners in Biz team rebuilt our entire platform in 6 weeks. We shipped what our last vendor took 9 months to half-finish.',
    author: 'Founder', // PLACEHOLDER
    role: 'CEO, Athleet',
    avatar: '/images/case-athleet-cover.jpg',
    company: 'Athleet',
  },
  {
    quote:
      'They write code like grown-ups. No stubs, no "we will fix it in v2", no surprises in the invoice.',
    author: 'Operations Lead', // PLACEHOLDER
    role: 'Director, AHS Law',
    avatar: '/images/case-ahs-law-cover.jpg',
    company: 'AHS Law',
  },
  {
    quote:
      'The thing that sold me was the process page. They show you exactly what they will do — and then they do it.',
    author: 'Product Lead', // PLACEHOLDER
    role: 'Product, Loyalty Plus',
    avatar: '/images/case-loyaltyplus-cover.jpg',
    company: 'Loyalty Plus',
  },
] as const;

export const STATS = [
  { value: '23', suffix: '+', label: 'SMEs scaled' },
  { value: '4.2', suffix: 'x', label: 'avg. lead increase' },
  { value: '38', suffix: ' days', label: 'median launch time' },
  { value: '100', suffix: '%', label: 'clients still operating' },
] as const;

export const TECH_STACK = [
  'Next.js', 'React', 'TypeScript', 'Tailwind CSS', 'Vercel',
  'Firebase', 'Supabase', 'Anthropic', 'OpenAI', 'Resend',
  'Stripe', 'PayPal', 'Sanity', 'Vite',
] as const;

export const PROCESS = [
  {
    step: '01',
    name: 'Discover',
    blurb:
      'A focused 2-week strategy sprint. We map your business, your customers, and the wedge — before a single line of code.',
    deliverables: ['Audit deck', 'Architecture map', 'Cost-of-build estimate', 'Success metrics'],
  },
  {
    step: '02',
    name: 'Design',
    blurb:
      'High-fidelity prototypes in Figma. Interaction-tested, brand-aligned, ready to build. No "design system" theatre.',
    deliverables: ['Figma file', 'Component library', 'Prototype links', 'Brand artifacts'],
  },
  {
    step: '03',
    name: 'Build',
    blurb:
      'Production code on day one. Daily Loom updates. Linear board you can read. Vercel preview URLs for every PR.',
    deliverables: ['Vercel previews', 'Linear board', 'Daily Looms', 'Test coverage'],
  },
  {
    step: '04',
    name: 'Launch',
    blurb:
      'A real launch — DNS, analytics, monitoring, SEO, and an actual launch plan with copy and assets.',
    deliverables: ['Production deploy', 'Analytics wired', 'Launch checklist', 'Handover docs'],
  },
  {
    step: '05',
    name: 'Grow',
    blurb:
      'Month-on-month iteration against real data. Retainer or pay-as-you-go. We own the outcome, not just the codebase.',
    deliverables: ['Monthly report', 'Roadmap reviews', 'On-call support', 'Growth experiments'],
  },
] as const;

export const FAQ_HOMEPAGE = [
  {
    q: 'How much does a custom website or platform cost?',
    a: 'Marketing sites start around R35 000. Custom web apps typically range from R120 000 to R450 000+ depending on scope. Every project is custom-quoted after a 30-minute discovery call. We share a fixed-scope estimate within 3 business days.',
  },
  {
    q: 'How long until I have something live?',
    a: 'Marketing sites: 2-4 weeks. Web apps: 6-12 weeks for an MVP, with weekly Vercel previews from week one. We do not believe in 9-month "discovery" phases.',
  },
  {
    q: 'Do I own the code?',
    a: 'Yes — completely. Every project ships to your GitHub, your Vercel, and your Firebase / Supabase. No vendor lock-in, no recurring "platform fees".',
  },
  {
    q: 'Are you South African?',
    a: 'Yes — based in Pretoria, working with clients across South Africa, the UK, and the US. We invoice in ZAR (with USD/EUR available) and accept EFT, PayPal, and international cards.',
  },
  {
    q: 'What stack do you build with?',
    a: 'Next.js 16, React 19, Tailwind v4, TypeScript, and Vercel for the front end. Firebase or Supabase for data. Anthropic Claude and OpenAI for AI features. Resend for email. We pick the boring, battle-tested tools — not whatever is on Hacker News this week.',
  },
  {
    q: 'Can you work with my existing developer or agency?',
    a: 'Often, yes. We do strategic engagements (architecture review, AI feature builds, performance audits) that slot into existing teams without owning the whole codebase.',
  },
  {
    q: 'What about ongoing support?',
    a: 'We offer monthly retainers from R15k/month covering hosting, monitoring, security patches, and 8-20 hours of dev work. Or pay-as-you-go at R950/hour for ad-hoc work.',
  },
  {
    q: 'How do I start?',
    a: 'Fill in the 4-step form on /start-a-project (takes 90 seconds), or book a 20-minute intro call at /book-a-call. We reply within one business day.',
  },
] as const;
