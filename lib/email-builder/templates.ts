// lib/email-builder/templates.ts
//
// EmailTemplate type + the 5 starter templates that ship out-of-the-box.
// Starters live in code (not Firestore) so they can be edited as part of
// the codebase and never get accidentally deleted. They render through
// the same renderEmail() pipeline as user-saved templates.

import type { Block, EmailDocument } from './types'

export type TemplateCategory =
  | 'newsletter'
  | 'welcome'
  | 'product-launch'
  | 'reengagement'
  | 'transactional'
  | 'custom'

export interface EmailTemplate {
  id: string
  orgId: string | null // null for starters
  name: string
  description: string
  category: TemplateCategory
  document: EmailDocument
  isStarter: boolean
  createdAt: string | null
  updatedAt: string | null
  deleted: boolean
}

// Stable ids for in-code starters. Prefixed so they never collide with
// Firestore-generated ids.
const STARTER_PREFIX = 'starter-'

const PIB_PRIMARY = '#F5A623'
const PIB_DARK = '#0A0A0B'
const PIB_OFFWHITE = '#F4F4F5'
const PIB_ADDRESS = 'Pretoria, Gauteng, South Africa'
const PIB_SOCIAL = {
  facebook: 'https://www.facebook.com/partnersinbiz',
  linkedin: 'https://www.linkedin.com/company/the-partners-in-biz',
  github: 'https://github.com/Partners-in-Biz',
}

const SYSTEM_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"

// Tiny id helper for starter block ids — deterministic per template so
// reloads keep stable identities.
function bid(template: string, n: number): string {
  return `${template}-b${n}`
}

// -------------------- 1. Newsletter --------------------

const newsletterBlocks: Block[] = [
  {
    id: bid('news', 0),
    type: 'hero',
    props: {
      backgroundColor: PIB_DARK,
      headline: 'This week at {{orgName}}',
      subhead: 'The three things worth your attention.',
      textColor: '#FFFFFF',
    },
  },
  {
    id: bid('news', 1),
    type: 'heading',
    props: { text: 'The headline story', level: 2, align: 'left' },
  },
  {
    id: bid('news', 2),
    type: 'image',
    props: {
      src: 'https://images.unsplash.com/photo-1499951360447-b19be8fe80f5?w=1200&q=80',
      alt: 'Featured story',
      width: 552,
      align: 'center',
    },
  },
  {
    id: bid('news', 3),
    type: 'paragraph',
    props: {
      html: 'Hey {{firstName}}, a quick one. We spent the week shipping the new analytics dashboard and the early numbers are <b>better than we hoped</b>. Here is what we learned.',
      align: 'left',
    },
  },
  {
    id: bid('news', 4),
    type: 'button',
    props: { text: 'Read the full story', url: 'https://partnersinbiz.online/blog', color: PIB_PRIMARY, textColor: PIB_DARK, align: 'left', fullWidth: false },
  },
  { id: bid('news', 5), type: 'divider', props: { color: '#E5E7EB', thickness: 1 } },
  {
    id: bid('news', 6),
    type: 'heading',
    props: { text: 'In case you missed it', level: 2, align: 'left' },
  },
  {
    id: bid('news', 7),
    type: 'paragraph',
    props: {
      html: '<b>We rebuilt the email composer.</b> Drag-drop blocks, live preview, real Outlook-safe HTML. If you saw the old one, this is not that.',
      align: 'left',
    },
  },
  {
    id: bid('news', 8),
    type: 'button',
    props: { text: 'See it in action', url: 'https://partnersinbiz.online/features/email', color: PIB_PRIMARY, textColor: PIB_DARK, align: 'left', fullWidth: false },
  },
  { id: bid('news', 9), type: 'divider', props: { color: '#E5E7EB', thickness: 1 } },
  {
    id: bid('news', 10),
    type: 'heading',
    props: { text: 'One thing worth reading', level: 2, align: 'left' },
  },
  {
    id: bid('news', 11),
    type: 'paragraph',
    props: {
      html: 'A short essay on why most SaaS dashboards are useless and what to do instead. Direct, opinionated, written by an operator — not a content team.',
      align: 'left',
    },
  },
  {
    id: bid('news', 12),
    type: 'button',
    props: { text: 'Read it (5 min)', url: 'https://partnersinbiz.online/essays', color: PIB_PRIMARY, textColor: PIB_DARK, align: 'left', fullWidth: false },
  },
  { id: bid('news', 13), type: 'spacer', props: { height: 16 } },
  {
    id: bid('news', 14),
    type: 'footer',
    props: {
      orgName: '{{orgName}}',
      address: PIB_ADDRESS,
      unsubscribeUrl: '{{unsubscribeUrl}}',
      social: PIB_SOCIAL,
    },
  },
]

// -------------------- 2. Welcome --------------------

const welcomeBlocks: Block[] = [
  {
    id: bid('welcome', 0),
    type: 'hero',
    props: {
      backgroundColor: PIB_PRIMARY,
      headline: 'Welcome aboard, {{firstName}}.',
      subhead: 'Right — let us get you moving.',
      textColor: PIB_DARK,
    },
  },
  {
    id: bid('welcome', 1),
    type: 'paragraph',
    props: {
      html: "I'm Peet, the person who built this. You signed up for {{orgName}} a few minutes ago and I wanted to send you a real note — not a template — to say thanks.",
      align: 'left',
    },
  },
  {
    id: bid('welcome', 2),
    type: 'paragraph',
    props: {
      html: 'The fastest way to get value out of the platform is to do the 10-minute setup. It walks you through connecting your tools and importing your first contacts. After that, the AI agents take over.',
      align: 'left',
    },
  },
  {
    id: bid('welcome', 3),
    type: 'button',
    props: { text: 'Start the setup (10 min)', url: 'https://partnersinbiz.online/onboarding', color: PIB_DARK, textColor: '#FFFFFF', align: 'center', fullWidth: false },
  },
  { id: bid('welcome', 4), type: 'spacer', props: { height: 16 } },
  {
    id: bid('welcome', 5),
    type: 'heading',
    props: { text: "What's next", level: 3, align: 'left' },
  },
  {
    id: bid('welcome', 6),
    type: 'paragraph',
    props: {
      html: '<b>1.</b> Tomorrow you will get the first lesson — three growth tactics that actually work in 2026.',
      align: 'left',
    },
  },
  {
    id: bid('welcome', 7),
    type: 'paragraph',
    props: {
      html: '<b>2.</b> Day three: I will show you the playbook we use to fill the top of the funnel.',
      align: 'left',
    },
  },
  {
    id: bid('welcome', 8),
    type: 'paragraph',
    props: {
      html: '<b>3.</b> Day seven: a live walkthrough of how one of our clients went from 0 to 200 leads/month.',
      align: 'left',
    },
  },
  { id: bid('welcome', 9), type: 'spacer', props: { height: 16 } },
  {
    id: bid('welcome', 10),
    type: 'paragraph',
    props: {
      html: 'Reply to this email if you want. It goes to me. — Peet',
      align: 'left',
    },
  },
  {
    id: bid('welcome', 11),
    type: 'footer',
    props: {
      orgName: '{{orgName}}',
      address: PIB_ADDRESS,
      unsubscribeUrl: '{{unsubscribeUrl}}',
    },
  },
]

// -------------------- 3. Product launch --------------------

const productLaunchBlocks: Block[] = [
  {
    id: bid('launch', 0),
    type: 'hero',
    props: {
      backgroundColor: PIB_DARK,
      backgroundUrl: 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=1200&q=80',
      headline: 'It is finally here.',
      subhead: 'We rebuilt the entire email engine from scratch. Here is why it matters.',
      ctaText: 'See what is new',
      ctaUrl: 'https://partnersinbiz.online/launch',
      ctaColor: PIB_PRIMARY,
      textColor: '#FFFFFF',
    },
  },
  {
    id: bid('launch', 1),
    type: 'heading',
    props: { text: 'The fastest email composer in the SA market', level: 1, align: 'center' },
  },
  {
    id: bid('launch', 2),
    type: 'paragraph',
    props: {
      html: 'Drag-drop blocks. Live preview. Templates that render the same on Gmail, Outlook, and Apple Mail. No more "looks great in Gmail, broken in Outlook" surprises. {{firstName}}, this one is for you.',
      align: 'center',
    },
  },
  {
    id: bid('launch', 3),
    type: 'button',
    props: { text: 'Try it now', url: 'https://partnersinbiz.online/launch', color: PIB_PRIMARY, textColor: PIB_DARK, align: 'center', fullWidth: false },
  },
  {
    id: bid('launch', 4),
    type: 'paragraph',
    props: {
      html: '<a href="https://partnersinbiz.online/learn-more">Learn more →</a>',
      align: 'center',
    },
  },
  { id: bid('launch', 5), type: 'spacer', props: { height: 24 } },
  { id: bid('launch', 6), type: 'divider', props: { color: '#E5E7EB', thickness: 1 } },
  {
    id: bid('launch', 7),
    type: 'columns',
    props: {
      columns: [
        [
          {
            id: bid('launch', 100),
            type: 'heading',
            props: { text: 'Block-based', level: 3, align: 'left' },
          },
          {
            id: bid('launch', 101),
            type: 'paragraph',
            props: {
              html: 'Nine block types. Heros, headings, paragraphs, buttons, images, columns, dividers, spacers, footers. Compose anything.',
              align: 'left',
            },
          },
        ],
        [
          {
            id: bid('launch', 200),
            type: 'heading',
            props: { text: 'Outlook-safe', level: 3, align: 'left' },
          },
          {
            id: bid('launch', 201),
            type: 'paragraph',
            props: {
              html: 'Table-based layout, inline styles, MSO conditional comments. Renders correctly everywhere — even Outlook 2016.',
              align: 'left',
            },
          },
        ],
      ],
    },
  },
  {
    id: bid('launch', 8),
    type: 'columns',
    props: {
      columns: [
        [
          {
            id: bid('launch', 300),
            type: 'heading',
            props: { text: 'AI-ready', level: 3, align: 'left' },
          },
          {
            id: bid('launch', 301),
            type: 'paragraph',
            props: {
              html: 'Every template is callable via API. Your AI agents can compose and send the same emails you draft by hand.',
              align: 'left',
            },
          },
        ],
        [
          {
            id: bid('launch', 400),
            type: 'heading',
            props: { text: 'Merge fields', level: 3, align: 'left' },
          },
          {
            id: bid('launch', 401),
            type: 'paragraph',
            props: {
              html: 'Personalise with {{firstName}}, {{company}}, or any custom variable. Per-send and per-recipient.',
              align: 'left',
            },
          },
        ],
      ],
    },
  },
  { id: bid('launch', 9), type: 'spacer', push: 24 } as unknown as Block, // (intentionally fixed below)
  {
    id: bid('launch', 10),
    type: 'footer',
    props: {
      orgName: '{{orgName}}',
      address: PIB_ADDRESS,
      unsubscribeUrl: '{{unsubscribeUrl}}',
      social: PIB_SOCIAL,
    },
  },
]

// Fix the deliberate typo above so the linter is happy and the block is valid.
productLaunchBlocks[9] = { id: bid('launch', 9), type: 'spacer', props: { height: 24 } }

// -------------------- 4. Re-engagement --------------------

const reengagementBlocks: Block[] = [
  {
    id: bid('reeng', 0),
    type: 'hero',
    props: {
      backgroundColor: '#FEF3C7',
      headline: 'We miss you, {{firstName}}.',
      subhead: 'It has been a minute. Let us fix that.',
      textColor: PIB_DARK,
    },
  },
  {
    id: bid('reeng', 1),
    type: 'paragraph',
    props: {
      html: 'You have not opened one of our emails in a while and I get it — inboxes are a war zone. Before we stop sending, I wanted to make one more offer.',
      align: 'left',
    },
  },
  {
    id: bid('reeng', 2),
    type: 'heading',
    props: { text: '30% off your next 3 months', level: 2, align: 'center' },
  },
  {
    id: bid('reeng', 3),
    type: 'paragraph',
    props: {
      html: 'No catch. Use code <b>COMEBACK30</b> at checkout and the next three months drop by 30%. The offer expires in seven days.',
      align: 'center',
    },
  },
  {
    id: bid('reeng', 4),
    type: 'button',
    props: { text: 'Claim 30% off', url: 'https://partnersinbiz.online/comeback', color: PIB_PRIMARY, textColor: PIB_DARK, align: 'center', fullWidth: false },
  },
  { id: bid('reeng', 5), type: 'spacer', props: { height: 16 } },
  {
    id: bid('reeng', 6),
    type: 'paragraph',
    props: {
      html: 'Not interested? No hard feelings. <a href="{{unsubscribeUrl}}">No thanks, unsubscribe me</a> and we will stop sending.',
      align: 'center',
    },
  },
  {
    id: bid('reeng', 7),
    type: 'footer',
    props: {
      orgName: '{{orgName}}',
      address: PIB_ADDRESS,
      unsubscribeUrl: '{{unsubscribeUrl}}',
    },
  },
]

// -------------------- 5. Transactional receipt --------------------

const receiptBlocks: Block[] = [
  {
    id: bid('rcpt', 0),
    type: 'heading',
    props: { text: '{{orgName}}', level: 3, align: 'left' },
  },
  { id: bid('rcpt', 1), type: 'divider', props: { color: '#E5E7EB', thickness: 1 } },
  {
    id: bid('rcpt', 2),
    type: 'heading',
    props: { text: 'Receipt for your order', level: 1, align: 'left' },
  },
  {
    id: bid('rcpt', 3),
    type: 'paragraph',
    props: {
      html: 'Hi {{firstName}}, thanks for the order. Here is the breakdown for your records. Invoice <b>#{{invoiceNumber}}</b>.',
      align: 'left',
    },
  },
  { id: bid('rcpt', 4), type: 'spacer', props: { height: 16 } },
  {
    id: bid('rcpt', 5),
    type: 'paragraph',
    props: { html: '<b>Description:</b> {{itemDescription}}', align: 'left' },
  },
  {
    id: bid('rcpt', 6),
    type: 'paragraph',
    props: { html: '<b>Quantity:</b> {{quantity}}', align: 'left' },
  },
  {
    id: bid('rcpt', 7),
    type: 'paragraph',
    props: { html: '<b>Subtotal:</b> {{subtotal}}', align: 'left' },
  },
  {
    id: bid('rcpt', 8),
    type: 'paragraph',
    props: { html: '<b>VAT (15%):</b> {{vat}}', align: 'left' },
  },
  { id: bid('rcpt', 9), type: 'divider', props: { color: '#0A0A0B', thickness: 2 } },
  {
    id: bid('rcpt', 10),
    type: 'heading',
    props: { text: 'Total: {{total}}', level: 2, align: 'right' },
  },
  { id: bid('rcpt', 11), type: 'spacer', props: { height: 24 } },
  {
    id: bid('rcpt', 12),
    type: 'button',
    props: { text: 'Download PDF invoice', url: '{{invoiceUrl}}', color: PIB_DARK, textColor: '#FFFFFF', align: 'left', fullWidth: false },
  },
  {
    id: bid('rcpt', 13),
    type: 'paragraph',
    props: {
      html: 'Questions about this charge? Reply to this email — we always answer.',
      align: 'left',
    },
  },
  {
    id: bid('rcpt', 14),
    type: 'footer',
    props: {
      orgName: '{{orgName}}',
      address: PIB_ADDRESS,
      unsubscribeUrl: '{{unsubscribeUrl}}',
    },
  },
]

// -------------------- assemble starters --------------------

function makeStarter(
  slug: string,
  name: string,
  description: string,
  category: TemplateCategory,
  doc: EmailDocument,
): EmailTemplate {
  return {
    id: STARTER_PREFIX + slug,
    orgId: null,
    name,
    description,
    category,
    document: doc,
    isStarter: true,
    createdAt: null,
    updatedAt: null,
    deleted: false,
  }
}

const baseTheme = {
  primaryColor: PIB_PRIMARY,
  textColor: PIB_DARK,
  backgroundColor: PIB_OFFWHITE,
  fontFamily: SYSTEM_FONT,
  contentWidth: 600,
}

export const STARTER_TEMPLATES: EmailTemplate[] = [
  makeStarter('newsletter', 'Weekly newsletter', "Three-story newsletter format. Hero, headline story, in-case-you-missed-it, one-thing-worth-reading.", 'newsletter', {
    subject: 'This week at {{orgName}} — three things worth your attention',
    preheader: 'The headline story, the thing you missed, and one essay worth your time.',
    blocks: newsletterBlocks,
    theme: { ...baseTheme },
  }),
  makeStarter('welcome', 'Welcome — day one', "Founder-led welcome email. Warm greeting, onboarding CTA, what's-next bullets.", 'welcome', {
    subject: 'Welcome to {{orgName}}, {{firstName}}',
    preheader: "I'm Peet — wanted to send a real note, not a template. Here is what is next.",
    blocks: welcomeBlocks,
    theme: { ...baseTheme, backgroundColor: '#FFF8EC' },
  }),
  makeStarter('product-launch', 'Product launch', 'Bold launch announcement with hero image, dual CTAs, and 2-column features grid.', 'product-launch', {
    subject: 'We rebuilt it from scratch — see what changed',
    preheader: 'New email composer. Faster. Outlook-safe. AI-ready. Live now.',
    blocks: productLaunchBlocks,
    theme: { ...baseTheme, backgroundColor: '#0A0A0B' },
  }),
  makeStarter('reengagement', 'Re-engagement — last chance', '"We miss you" email with a single 30% off offer and a soft unsubscribe.', 'reengagement', {
    subject: 'We miss you, {{firstName}} — 30% off if you come back',
    preheader: 'It has been a minute. Before we stop sending, one last offer.',
    blocks: reengagementBlocks,
    theme: { ...baseTheme, backgroundColor: '#FEF3C7' },
  }),
  makeStarter('transactional-receipt', 'Order receipt', 'Clean transactional receipt. Order details, line items, total, PDF link.', 'transactional', {
    subject: 'Your receipt from {{orgName}} — #{{invoiceNumber}}',
    preheader: 'Order details, total, and a link to the PDF invoice.',
    blocks: receiptBlocks,
    theme: { ...baseTheme, backgroundColor: '#FFFFFF' },
  }),
]

export function isStarterId(id: string): boolean {
  return id.startsWith(STARTER_PREFIX)
}

export function findStarter(id: string): EmailTemplate | undefined {
  return STARTER_TEMPLATES.find((t) => t.id === id)
}
