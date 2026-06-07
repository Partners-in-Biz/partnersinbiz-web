// lib/email-builder/snippet-presets.ts
//
// Starter snippets that ship with the platform. Same surface as user
// snippets (one entry per chunk-of-blocks) but `isStarter=true` and
// `orgId=null` so they show up for every org without persistence.

import type { Block, EmailSnippet } from './types'

const PIB_PRIMARY = '#F5A623'
const PIB_DARK = '#0A0A0B'

function bid(slug: string, n: number): string {
  return `snip-${slug}-b${n}`
}

const STARTER_PREFIX = 'starter-snippet-'

function make(
  slug: string,
  name: string,
  description: string,
  category: EmailSnippet['category'],
  blocks: Block[],
): EmailSnippet {
  return {
    id: STARTER_PREFIX + slug,
    orgId: null,
    name,
    description,
    category,
    blocks,
    isStarter: true,
    createdAt: null,
    updatedAt: null,
    createdBy: 'system',
    deleted: false,
  }
}

// 1. Footer with social
const footerSocialBlocks: Block[] = [
  { id: bid('footer-social', 0), type: 'spacer', props: { height: 24 } },
  {
    id: bid('footer-social', 1),
    type: 'footer',
    props: {
      orgName: '{{orgName}}',
      address: 'Pretoria, Gauteng, South Africa',
      unsubscribeUrl: '{{unsubscribeUrl}}',
      social: {
        twitter: 'https://twitter.com/yourbrand',
        linkedin: 'https://linkedin.com/company/yourbrand',
        instagram: 'https://instagram.com/yourbrand',
      },
    },
  },
]

// 2. Hero with overlay CTA
const heroOverlayCtaBlocks: Block[] = [
  {
    id: bid('hero-cta', 0),
    type: 'hero',
    props: {
      backgroundColor: PIB_DARK,
      backgroundUrl: 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=1200&q=80',
      headline: 'A bold idea that grabs attention',
      subhead: 'One supporting line explaining why the reader should care.',
      ctaText: 'See the details',
      ctaUrl: 'https://',
      ctaColor: PIB_PRIMARY,
      textColor: '#FFFFFF',
    },
  },
]

// 3. 3-column feature grid (two stacked 2-column blocks + a paragraph intro)
const featureGridBlocks: Block[] = [
  {
    id: bid('feat3', 0),
    type: 'heading',
    props: { text: 'Three reasons it matters', level: 2, align: 'center' },
  },
  {
    id: bid('feat3', 1),
    type: 'paragraph',
    props: {
      html: 'A short intro paragraph explaining the trio of benefits below.',
      align: 'center',
    },
  },
  {
    id: bid('feat3', 2),
    type: 'columns',
    props: {
      columns: [
        [
          { id: bid('feat3', 100), type: 'image', props: { src: 'https://images.unsplash.com/photo-1499951360447-b19be8fe80f5?w=400', alt: 'Feature 1', width: 240, align: 'center' } },
          { id: bid('feat3', 101), type: 'heading', props: { text: 'Fast', level: 3, align: 'center' } },
          { id: bid('feat3', 102), type: 'paragraph', props: { html: 'A short line about the speed benefit.', align: 'center' } },
        ],
        [
          { id: bid('feat3', 200), type: 'image', props: { src: 'https://images.unsplash.com/photo-1499951360447-b19be8fe80f5?w=400', alt: 'Feature 2', width: 240, align: 'center' } },
          { id: bid('feat3', 201), type: 'heading', props: { text: 'Simple', level: 3, align: 'center' } },
          { id: bid('feat3', 202), type: 'paragraph', props: { html: 'A short line about the simplicity benefit.', align: 'center' } },
        ],
      ],
    },
  },
  {
    id: bid('feat3', 3),
    type: 'columns',
    props: {
      columns: [
        [
          { id: bid('feat3', 300), type: 'image', props: { src: 'https://images.unsplash.com/photo-1499951360447-b19be8fe80f5?w=400', alt: 'Feature 3', width: 240, align: 'center' } },
          { id: bid('feat3', 301), type: 'heading', props: { text: 'Trusted', level: 3, align: 'center' } },
          { id: bid('feat3', 302), type: 'paragraph', props: { html: 'A short line about why teams trust it.', align: 'center' } },
        ],
        [
          { id: bid('feat3', 400), type: 'paragraph', props: { html: '<a href="#">Learn more →</a>', align: 'center' } },
        ],
      ],
    },
  },
]

// 4. Testimonial card
const testimonialBlocks: Block[] = [
  { id: bid('testi', 0), type: 'spacer', props: { height: 16 } },
  {
    id: bid('testi', 1),
    type: 'paragraph',
    props: {
      html: '<i>"This changed how our team works. We&#39;ve cut hours of busywork every week and the results speak for themselves."</i>',
      align: 'center',
    },
  },
  {
    id: bid('testi', 2),
    type: 'paragraph',
    props: { html: '<b>— Jane Doe</b>, Head of Growth at Example Co.', align: 'center' },
  },
  { id: bid('testi', 3), type: 'spacer', props: { height: 16 } },
]

// 5. Stats row — three big numbers
const statsRowBlocks: Block[] = [
  {
    id: bid('stats', 0),
    type: 'columns',
    props: {
      columns: [
        [
          { id: bid('stats', 100), type: 'heading', props: { text: '10x', level: 1, align: 'center' } },
          { id: bid('stats', 101), type: 'paragraph', props: { html: 'faster than the old workflow', align: 'center' } },
        ],
        [
          { id: bid('stats', 200), type: 'heading', props: { text: '2,400+', level: 1, align: 'center' } },
          { id: bid('stats', 201), type: 'paragraph', props: { html: 'teams using us today', align: 'center' } },
        ],
      ],
    },
  },
  {
    id: bid('stats', 1),
    type: 'columns',
    props: {
      columns: [
        [
          { id: bid('stats', 300), type: 'heading', props: { text: '98%', level: 1, align: 'center' } },
          { id: bid('stats', 301), type: 'paragraph', props: { html: 'satisfaction across the last 90 days', align: 'center' } },
        ],
        [
          { id: bid('stats', 400), type: 'paragraph', props: { html: '<a href="#">See the case studies →</a>', align: 'center' } },
        ],
      ],
    },
  },
]

export const STARTER_SNIPPETS: EmailSnippet[] = [
  make('footer-with-social', 'Footer with social', 'Standard footer block plus social links + a spacer above.', 'footer', footerSocialBlocks),
  make('hero-with-cta', 'Hero with overlay CTA', 'Full-bleed hero image with headline, subhead, and a CTA button.', 'hero', heroOverlayCtaBlocks),
  make('three-col-feature-grid', '3-column feature grid', 'Intro heading + paragraph followed by 3 columns of image + heading + paragraph.', 'feature-grid', featureGridBlocks),
  make('testimonial-card', 'Testimonial card', 'A short customer quote with attribution.', 'testimonial', testimonialBlocks),
  make('stats-row', 'Stats row', 'Three big-number stats arranged across the email width.', 'cta', statsRowBlocks),
]

export function isStarterSnippetId(id: string): boolean {
  return id.startsWith(STARTER_PREFIX)
}

export function findStarterSnippet(id: string): EmailSnippet | undefined {
  return STARTER_SNIPPETS.find((s) => s.id === id)
}
