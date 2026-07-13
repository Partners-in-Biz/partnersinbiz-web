// lib/email-builder/types.ts
//
// Block-model definitions for the email builder. Every email is a tree of
// blocks rendered to table-based, inline-styled HTML via lib/email-builder/render.ts.
//
// Keep the type discriminator narrow — the renderer + validator + UI all
// switch on `type` and a missing/unknown case should be a TypeScript error.

export type Align = 'left' | 'center' | 'right'

// Dark-mode policy for the rendered HTML. `auto` is the default — the render
// emits `prefers-color-scheme: dark` rules + the Outlook 365 `[data-ogsc]`
// class-based fallback. `force-light` skips dark-mode CSS entirely so brands
// that rely on a fixed light-mode palette get consistent rendering even when
// the recipient's client requests dark mode.
export type DarkModeMode = 'auto' | 'force-light'

export interface ThemeConfig {
  primaryColor: string
  textColor: string
  backgroundColor: string
  fontFamily: string
  contentWidth: number
  // Optional. Absent values fall back to 'auto' (full dark-mode support).
  darkMode?: DarkModeMode
}

export interface HeroBlockProps {
  backgroundUrl?: string
  backgroundColor: string
  headline: string
  subhead?: string
  ctaText?: string
  ctaUrl?: string
  ctaColor?: string
  textColor?: string
}

export interface HeadingBlockProps {
  text: string
  level: 1 | 2 | 3
  align: Align
}

export interface ParagraphBlockProps {
  // Limited subset of HTML — only inline tags. The validator strips anything else.
  html: string
  align: Align
}

export interface ButtonBlockProps {
  text: string
  url: string
  color: string
  textColor: string
  align: Align
  fullWidth: boolean
}

export interface ImageBlockProps {
  src: string
  alt: string
  link?: string
  width?: number
  align: Align
}

export interface DividerBlockProps {
  color: string
  thickness: number
}

export interface SpacerBlockProps {
  height: number
}

export interface ColumnsBlockProps {
  // Exactly two columns, each a Block[]. Nested columns are forbidden.
  columns: [Block[], Block[]]
}

export interface SocialLinks {
  twitter?: string
  linkedin?: string
  instagram?: string
  facebook?: string
}

export interface FooterBlockProps {
  orgName: string
  address: string
  unsubscribeUrl: string
  preferencesUrl?: string
  social?: SocialLinks
}

// -------------------- AMP for Email blocks --------------------
//
// These blocks render interactive AMP content inside email clients that
// support AMP for Email (Gmail, Yahoo, Mail.ru). Every AMP block also has
// a sensible HTML fallback so recipients on clients that don't support AMP
// still get useful content.
//
// AMP rendering itself is handled by lib/email-builder/render-amp.ts. The
// regular HTML renderer in lib/email-builder/render.ts produces the
// fallbacks documented per-block below.

export interface AmpCarouselSlide {
  imageUrl: string
  alt: string
  linkUrl?: string
}

export interface AmpCarouselBlockProps {
  slides: AmpCarouselSlide[]
  // Optional autoplay interval in milliseconds (>=1000). Omit for manual.
  autoAdvance?: number
}

export interface AmpAccordionItem {
  heading: string
  bodyHtml: string
}

export interface AmpAccordionBlockProps {
  items: AmpAccordionItem[]
}

export type AmpFormFieldType = 'text' | 'email'

export interface AmpFormField {
  key: string
  label: string
  type: AmpFormFieldType
}

export interface AmpFormBlockProps {
  fields: AmpFormField[]
  // Must accept AMP form posts (returns JSON, CORS headers set per AMP spec).
  submitUrl: string
  successMessage: string
  buttonText: string
}

export interface AmpLiveDataBlockProps {
  // GET endpoint returning JSON. Fetched by `<amp-list>` at render-time.
  endpoint: string
  // Mustache template body for `<template type="amp-mustache">`. Use
  // standard `{{field}}` syntax — variables come from the endpoint payload,
  // NOT from TemplateVars.
  template: string
}

// -------------------- conditional visibility --------------------
//
// Optional per-block `condition` controlling whether the block renders for
// a given recipient. The renderer evaluates this against an optional
// recipientContext { tags, stage, customFields }. When no context is
// supplied (e.g. live preview) every block renders as if `always`.
//
// Backwards compatible: blocks without `condition` evaluate as `always`.

export type ConditionKind =
  | 'always'
  | 'has-tag'
  | 'not-has-tag'
  | 'at-stage'
  | 'not-at-stage'
  | 'has-field'
  | 'field-equals'
  | 'field-not-empty'

export interface BlockCondition {
  kind: ConditionKind
  tag?: string
  stage?: string
  field?: string
  value?: string
}

interface BlockBase<T extends string, P> {
  id: string
  type: T
  props: P
  condition?: BlockCondition
}

export type HeroBlock = BlockBase<'hero', HeroBlockProps>
export type HeadingBlock = BlockBase<'heading', HeadingBlockProps>
export type ParagraphBlock = BlockBase<'paragraph', ParagraphBlockProps>
export type ButtonBlock = BlockBase<'button', ButtonBlockProps>
export type ImageBlock = BlockBase<'image', ImageBlockProps>
export type DividerBlock = BlockBase<'divider', DividerBlockProps>
export type SpacerBlock = BlockBase<'spacer', SpacerBlockProps>
export type ColumnsBlock = BlockBase<'columns', ColumnsBlockProps>
export type FooterBlock = BlockBase<'footer', FooterBlockProps>
export type AmpCarouselBlock = BlockBase<'amp-carousel', AmpCarouselBlockProps>
export type AmpAccordionBlock = BlockBase<'amp-accordion', AmpAccordionBlockProps>
export type AmpFormBlock = BlockBase<'amp-form', AmpFormBlockProps>
export type AmpLiveDataBlock = BlockBase<'amp-live-data', AmpLiveDataBlockProps>

export type Block =
  | HeroBlock
  | HeadingBlock
  | ParagraphBlock
  | ButtonBlock
  | ImageBlock
  | DividerBlock
  | SpacerBlock
  | ColumnsBlock
  | FooterBlock
  | AmpCarouselBlock
  | AmpAccordionBlock
  | AmpFormBlock
  | AmpLiveDataBlock

export type BlockType = Block['type']

// Block types that produce interactive AMP content. The presence of any
// such block in a document means we render an AMP MIME part in addition to
// the HTML fallback — see lib/email-builder/render-amp.ts.
export const AMP_BLOCK_TYPES: BlockType[] = [
  'amp-carousel',
  'amp-accordion',
  'amp-form',
  'amp-live-data',
]

export interface EmailDocument {
  subject: string
  preheader: string
  blocks: Block[]
  theme: ThemeConfig
  /** Required fallbacks for recipient fields that can be empty at send time. */
  mergeTagFallbacks?: Record<string, string>
}

export const DEFAULT_THEME: ThemeConfig = {
  primaryColor: '#F5A623',
  textColor: '#0A0A0B',
  backgroundColor: '#F4F4F5',
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  contentWidth: 600,
}

// Tiny id generator — no new deps. Good enough for block ids in a document.
export function makeBlockId(): string {
  return 'b_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

// -------------------- snippets --------------------
//
// A snippet is a reusable group of blocks that can be dropped into any
// template. Stored at email_snippets/{id}. Starters live in code via
// lib/email-builder/snippet-presets.ts.

export type SnippetCategory =
  | 'header'
  | 'hero'
  | 'cta'
  | 'footer'
  | 'feature-grid'
  | 'testimonial'
  | 'custom'

// Timestamps come back as ISO strings from the API; the Firestore document
// stores Timestamp values. Kept loose to avoid coupling to firebase-admin
// from client-only code.
export interface EmailSnippet {
  id: string
  orgId: string | null   // null for built-in starter snippets
  name: string
  description: string
  category: SnippetCategory
  blocks: Block[]
  isStarter: boolean
  createdAt: string | null
  updatedAt: string | null
  createdBy?: string
  deleted?: boolean
}
