'use client'

// Per-block-type property forms. One small component per type  -  bundled
// into a single file because each one is tiny.

import type {
  ButtonBlockProps,
  ColumnsBlockProps,
  DividerBlockProps,
  FooterBlockProps,
  HeadingBlockProps,
  HeroBlockProps,
  ImageBlockProps,
  ParagraphBlockProps,
  SpacerBlockProps,
} from '@/lib/email-builder/types'
import { ALIGN_SELECT, CheckboxField, ColorInput, Field, NumberInput, Select, TextArea, TextInput } from './shared'

export function HeroBlockForm({ props, onChange }: { props: HeroBlockProps; onChange: (p: HeroBlockProps) => void }) {
  return (
    <div>
      <Field label="Headline"><TextInput value={props.headline} onChange={(v) => onChange({ ...props, headline: v })} /></Field>
      <Field label="Subhead"><TextInput value={props.subhead ?? ''} onChange={(v) => onChange({ ...props, subhead: v })} /></Field>
      <Field label="Background color"><ColorInput value={props.backgroundColor} onChange={(v) => onChange({ ...props, backgroundColor: v })} /></Field>
      <Field label="Background image URL (optional)"><TextInput value={props.backgroundUrl ?? ''} onChange={(v) => onChange({ ...props, backgroundUrl: v || undefined })} placeholder="https://..." /></Field>
      <Field label="Text color"><ColorInput value={props.textColor ?? '#FFFFFF'} onChange={(v) => onChange({ ...props, textColor: v })} /></Field>
      <Field label="CTA button text"><TextInput value={props.ctaText ?? ''} onChange={(v) => onChange({ ...props, ctaText: v || undefined })} /></Field>
      <Field label="CTA button URL"><TextInput value={props.ctaUrl ?? ''} onChange={(v) => onChange({ ...props, ctaUrl: v || undefined })} /></Field>
      <Field label="CTA color"><ColorInput value={props.ctaColor ?? 'var(--st-warning)'} onChange={(v) => onChange({ ...props, ctaColor: v })} /></Field>
    </div>
  )
}

export function HeadingBlockForm({ props, onChange }: { props: HeadingBlockProps; onChange: (p: HeadingBlockProps) => void }) {
  return (
    <div>
      <Field label="Text"><TextInput value={props.text} onChange={(v) => onChange({ ...props, text: v })} /></Field>
      <Field label="Level">
        <Select
          aria-label="Heading level"
          value={String(props.level) as '1' | '2' | '3'}
          onChange={(v) => onChange({ ...props, level: Number(v) as 1 | 2 | 3 })}
          options={[
            { value: '1', label: 'H1  -  Largest' },
            { value: '2', label: 'H2  -  Medium' },
            { value: '3', label: 'H3  -  Small' },
          ]}
        />
      </Field>
      <Field label="Align"><Select aria-label="Align" value={props.align} onChange={(v) => onChange({ ...props, align: v })} options={ALIGN_SELECT} /></Field>
    </div>
  )
}

export function ParagraphBlockForm({ props, onChange }: { props: ParagraphBlockProps; onChange: (p: ParagraphBlockProps) => void }) {
  return (
    <div>
      <Field label="HTML content (allowed tags: b, i, u, a, br, span)">
        <TextArea aria-label="Html" value={props.html} onChange={(v) => onChange({ ...props, html: v })} rows={6} />
      </Field>
      <Field label="Align"><Select aria-label="Align" value={props.align} onChange={(v) => onChange({ ...props, align: v })} options={ALIGN_SELECT} /></Field>
    </div>
  )
}

export function ButtonBlockForm({ props, onChange }: { props: ButtonBlockProps; onChange: (p: ButtonBlockProps) => void }) {
  return (
    <div>
      <Field label="Button text"><TextInput value={props.text} onChange={(v) => onChange({ ...props, text: v })} /></Field>
      <Field label="URL"><TextInput value={props.url} onChange={(v) => onChange({ ...props, url: v })} placeholder="https://..." /></Field>
      <Field label="Background color"><ColorInput value={props.color} onChange={(v) => onChange({ ...props, color: v })} /></Field>
      <Field label="Text color"><ColorInput value={props.textColor} onChange={(v) => onChange({ ...props, textColor: v })} /></Field>
      <Field label="Align"><Select aria-label="Align" value={props.align} onChange={(v) => onChange({ ...props, align: v })} options={ALIGN_SELECT} /></Field>
      <CheckboxField checked={props.fullWidth} onChange={(v) => onChange({ ...props, fullWidth: v })} label="Full-width button" />
    </div>
  )
}

export function ImageBlockForm({ props, onChange }: { props: ImageBlockProps; onChange: (p: ImageBlockProps) => void }) {
  return (
    <div>
      <Field label="Image URL"><TextInput value={props.src} onChange={(v) => onChange({ ...props, src: v })} placeholder="https://..." /></Field>
      <Field label="Alt text"><TextInput value={props.alt} onChange={(v) => onChange({ ...props, alt: v })} /></Field>
      <Field label="Link URL (optional)"><TextInput value={props.link ?? ''} onChange={(v) => onChange({ ...props, link: v || undefined })} /></Field>
      <Field label="Width (px)"><NumberInput value={props.width ?? 552} onChange={(v) => onChange({ ...props, width: v })} min={50} max={600} /></Field>
      <Field label="Align"><Select aria-label="Align" value={props.align} onChange={(v) => onChange({ ...props, align: v })} options={ALIGN_SELECT} /></Field>
    </div>
  )
}

export function DividerBlockForm({ props, onChange }: { props: DividerBlockProps; onChange: (p: DividerBlockProps) => void }) {
  return (
    <div>
      <Field label="Color"><ColorInput value={props.color} onChange={(v) => onChange({ ...props, color: v })} /></Field>
      <Field label="Thickness (px)"><NumberInput value={props.thickness} onChange={(v) => onChange({ ...props, thickness: v })} min={1} max={10} /></Field>
    </div>
  )
}

export function SpacerBlockForm({ props, onChange }: { props: SpacerBlockProps; onChange: (p: SpacerBlockProps) => void }) {
  return (
    <div>
      <Field label="Height (px)"><NumberInput value={props.height} onChange={(v) => onChange({ ...props, height: v })} min={4} max={200} /></Field>
    </div>
  )
}

export function ColumnsBlockForm({ props }: { props: ColumnsBlockProps; onChange: (p: ColumnsBlockProps) => void }) {
  return (
    <div className="text-xs text-[var(--color-pib-text-muted)]">
      <p className="mb-2">Columns: 2 (left {props.columns[0].length} block(s), right {props.columns[1].length} block(s))</p>
      <p className="text-zinc-500">Edit child blocks in code  -  column nesting management is not exposed in the inline editor for this slice.</p>
    </div>
  )
}

export function FooterBlockForm({ props, onChange }: { props: FooterBlockProps; onChange: (p: FooterBlockProps) => void }) {
  const social = props.social ?? {}
  function setSocial(key: keyof typeof social, value: string) {
    onChange({ ...props, social: { ...social, [key]: value || undefined } })
  }
  return (
    <div>
      <Field label="Org name"><TextInput value={props.orgName} onChange={(v) => onChange({ ...props, orgName: v })} /></Field>
      <Field label="Address"><TextInput value={props.address} onChange={(v) => onChange({ ...props, address: v })} /></Field>
      <Field label="Unsubscribe URL"><TextInput value={props.unsubscribeUrl} onChange={(v) => onChange({ ...props, unsubscribeUrl: v })} /></Field>
      <Field label="Preferences URL (optional)"><TextInput value={props.preferencesUrl ?? ''} onChange={(v) => onChange({ ...props, preferencesUrl: v || undefined })} /></Field>
      <Field label="Twitter URL"><TextInput value={social.twitter ?? ''} onChange={(v) => setSocial('twitter', v)} /></Field>
      <Field label="LinkedIn URL"><TextInput value={social.linkedin ?? ''} onChange={(v) => setSocial('linkedin', v)} /></Field>
      <Field label="Instagram URL"><TextInput value={social.instagram ?? ''} onChange={(v) => setSocial('instagram', v)} /></Field>
      <Field label="Facebook URL"><TextInput value={social.facebook ?? ''} onChange={(v) => setSocial('facebook', v)} /></Field>
    </div>
  )
}
