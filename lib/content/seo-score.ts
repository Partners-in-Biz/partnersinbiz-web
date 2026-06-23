// Pure, client-safe SEO scoring + readability helpers for the article editor.
// No server imports — safe to use in a 'use client' component.

import { blocksToPlainText, type SeoArticle, type SeoBlock } from './types'

export interface SeoCheck {
  id: string
  label: string
  pass: boolean
  detail: string
}

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return 0
  if (w.length <= 3) return 1
  const groups = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '')
    .match(/[aeiouy]{1,2}/g)
  return groups ? groups.length : 1
}

/** Flesch reading-ease (0–100, higher = easier). */
export function fleschReadingEase(text: string): number {
  const sentences = (text.match(/[.!?]+/g) ?? []).length || 1
  const words = (text.match(/\b[\w'-]+\b/g) ?? [])
  const wordCount = words.length || 1
  const syllables = words.reduce((acc, w) => acc + countSyllables(w), 0) || 1
  const score = 206.835 - 1.015 * (wordCount / sentences) - 84.6 * (syllables / wordCount)
  return Math.max(0, Math.min(100, Math.round(score * 10) / 10))
}

export function readabilityGrade(score: number): string {
  if (score >= 90) return 'Very easy'
  if (score >= 70) return 'Easy'
  if (score >= 60) return 'Standard'
  if (score >= 50) return 'Fairly hard'
  if (score >= 30) return 'Hard'
  return 'Very hard'
}

function firstParagraphText(blocks: SeoBlock[]): string {
  const p = blocks.find((b) => b.type === 'paragraph' && (b.text ?? '').trim().length > 0)
  return (p?.text ?? '').toLowerCase()
}

export function runSeoChecklist(article: {
  title: string
  metaTitle: string
  metaDescription: string
  keyword: string
  body: SeoBlock[]
}): SeoCheck[] {
  const keyword = article.keyword.trim().toLowerCase()
  const bodyText = blocksToPlainText(article.body).toLowerCase()
  const titleLower = (article.metaTitle || article.title).toLowerCase()
  const metaLen = article.metaDescription.trim().length
  const titleLen = (article.metaTitle || article.title).trim().length

  const hasH2 = article.body.some((b) => b.type === 'heading' && (b.level ?? 2) === 2)
  const imageWithAlt = article.body.some((b) => b.type === 'image' && (b.alt ?? '').trim().length > 0)

  const keywordInTitle = keyword.length > 0 && titleLower.includes(keyword)
  const keywordInFirstPara = keyword.length > 0 && firstParagraphText(article.body).includes(keyword)
  const keywordInBody = keyword.length > 0 && bodyText.includes(keyword)
  const keywordEverywhere = keywordInTitle && keywordInFirstPara && keywordInBody

  return [
    {
      id: 'title-length',
      label: 'Title length 50–60 chars',
      pass: titleLen >= 50 && titleLen <= 60,
      detail: `${titleLen} chars`,
    },
    {
      id: 'meta-length',
      label: 'Meta description 120–160 chars',
      pass: metaLen >= 120 && metaLen <= 160,
      detail: `${metaLen} chars`,
    },
    {
      id: 'keyword',
      label: 'Keyword in title, first paragraph & body',
      pass: keywordEverywhere,
      detail: keyword
        ? `title:${keywordInTitle ? '✓' : '✗'} intro:${keywordInFirstPara ? '✓' : '✗'} body:${keywordInBody ? '✓' : '✗'}`
        : 'no keyword set',
    },
    {
      id: 'h2',
      label: 'At least one H2 subheading',
      pass: hasH2,
      detail: hasH2 ? 'present' : 'add an H2',
    },
    {
      id: 'image-alt',
      label: 'At least one image with alt text',
      pass: imageWithAlt,
      detail: imageWithAlt ? 'present' : 'add image + alt',
    },
  ]
}

export function seoScorePercent(checks: SeoCheck[]): number {
  if (checks.length === 0) return 0
  return Math.round((checks.filter((c) => c.pass).length / checks.length) * 100)
}

export type { SeoArticle }
