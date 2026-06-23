import { fetchPage } from './tools/page-fetch'
import { runMetadataCheck } from './tools/metadata'
import { runKeywordDensity } from './tools/keyword-density'
import { runPageSpeed } from './integrations/pagespeed/client'
import { runSchemaValidate } from './tools/schema'

export interface OnPageCheckItem {
  id: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
  weight: number
}

export interface OnPageCheckResult {
  url: string
  keyword: string
  score: number
  checklist: OnPageCheckItem[]
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function runOnPageCheck(url: string, keyword: string): Promise<OnPageCheckResult> {
  const [metaResult, densityResult, psResult, schemaResult, pageResult] = await Promise.allSettled([
    runMetadataCheck(url),
    runKeywordDensity(url, keyword),
    runPageSpeed(url, 'mobile'),
    runSchemaValidate(url),
    fetchPage(url),
  ])

  const checklist: OnPageCheckItem[] = []

  // ── Metadata ──────────────────────────────────────────────────────────────
  if (metaResult.status === 'fulfilled') {
    const meta = metaResult.value

    // 1. title-present
    if (meta.title) {
      checklist.push({ id: 'title-present', label: 'Title tag', status: 'pass', detail: `Title tag found: '${meta.title}'`, weight: 15 })
    } else {
      checklist.push({ id: 'title-present', label: 'Title tag', status: 'fail', detail: 'No <title> tag found.', weight: 15 })
    }

    // 2. title-length
    if (meta.title) {
      const tl = meta.titleLength
      if (tl >= 30 && tl <= 65) {
        checklist.push({ id: 'title-length', label: 'Title length', status: 'pass', detail: `${tl} characters — good length.`, weight: 10 })
      } else {
        checklist.push({ id: 'title-length', label: 'Title length', status: 'warn', detail: `Title is ${tl} chars — aim for 30-65 characters.`, weight: 10 })
      }
    } else {
      checklist.push({ id: 'title-length', label: 'Title length', status: 'warn', detail: 'Could not check title length: no title tag.', weight: 10 })
    }

    // 3. description-present
    if (meta.description) {
      checklist.push({ id: 'description-present', label: 'Meta description', status: 'pass', detail: 'Meta description found.', weight: 10 })
    } else {
      checklist.push({ id: 'description-present', label: 'Meta description', status: 'fail', detail: 'No meta description found.', weight: 10 })
    }

    // 4. description-length
    if (meta.description) {
      const dl = meta.descriptionLength
      if (dl >= 70 && dl <= 160) {
        checklist.push({ id: 'description-length', label: 'Meta description length', status: 'pass', detail: `${dl} chars — optimal.`, weight: 8 })
      } else {
        checklist.push({ id: 'description-length', label: 'Meta description length', status: 'warn', detail: `${dl} chars — aim for 70-160 characters.`, weight: 8 })
      }
    } else {
      checklist.push({ id: 'description-length', label: 'Meta description length', status: 'warn', detail: 'Could not check description length: no description.', weight: 8 })
    }
  } else {
    const msg = errMsg(metaResult.reason)
    checklist.push({ id: 'title-present', label: 'Title tag', status: 'warn', detail: `Could not run check: ${msg}`, weight: 15 })
    checklist.push({ id: 'title-length', label: 'Title length', status: 'warn', detail: `Could not run check: ${msg}`, weight: 10 })
    checklist.push({ id: 'description-present', label: 'Meta description', status: 'warn', detail: `Could not run check: ${msg}`, weight: 10 })
    checklist.push({ id: 'description-length', label: 'Meta description length', status: 'warn', detail: `Could not run check: ${msg}`, weight: 8 })
  }

  // ── HTML parsing ──────────────────────────────────────────────────────────
  let html = ''
  if (pageResult.status === 'fulfilled') {
    html = pageResult.value.html
  }

  const htmlAvailable = pageResult.status === 'fulfilled'
  const htmlErrMsg = htmlAvailable ? '' : errMsg((pageResult as PromiseRejectedResult).reason)

  // Parse H1s
  const h1Matches = html.match(/<h1[^>]*>[\s\S]*?<\/h1>/gi) ?? []
  const h1Count = h1Matches.length

  // 5. h1-present
  if (!htmlAvailable) {
    checklist.push({ id: 'h1-present', label: 'H1 tag', status: 'warn', detail: `Could not run check: ${htmlErrMsg}`, weight: 12 })
    checklist.push({ id: 'h1-keyword', label: 'Keyword in H1', status: 'warn', detail: `Could not run check: ${htmlErrMsg}`, weight: 10 })
  } else if (h1Count === 0) {
    checklist.push({ id: 'h1-present', label: 'H1 tag', status: 'fail', detail: 'No H1 tag found.', weight: 12 })
    checklist.push({ id: 'h1-keyword', label: 'Keyword in H1', status: 'fail', detail: `H1 does not contain the focus keyword '${keyword}'.`, weight: 10 })
  } else if (h1Count > 1) {
    checklist.push({ id: 'h1-present', label: 'H1 tag', status: 'warn', detail: `${h1Count} H1 tags found — use only one.`, weight: 12 })
    // 6. h1-keyword — check first H1
    const h1Text = h1Matches[0]?.replace(/<[^>]+>/g, '').toLowerCase() ?? ''
    if (h1Text.includes(keyword.toLowerCase())) {
      checklist.push({ id: 'h1-keyword', label: 'Keyword in H1', status: 'pass', detail: 'H1 contains the focus keyword.', weight: 10 })
    } else {
      checklist.push({ id: 'h1-keyword', label: 'Keyword in H1', status: 'fail', detail: `H1 does not contain the focus keyword '${keyword}'.`, weight: 10 })
    }
  } else {
    checklist.push({ id: 'h1-present', label: 'H1 tag', status: 'pass', detail: 'Single H1 tag found.', weight: 12 })
    // 6. h1-keyword
    const h1Text = h1Matches[0]?.replace(/<[^>]+>/g, '').toLowerCase() ?? ''
    if (h1Text.includes(keyword.toLowerCase())) {
      checklist.push({ id: 'h1-keyword', label: 'Keyword in H1', status: 'pass', detail: 'H1 contains the focus keyword.', weight: 10 })
    } else {
      checklist.push({ id: 'h1-keyword', label: 'Keyword in H1', status: 'fail', detail: `H1 does not contain the focus keyword '${keyword}'.`, weight: 10 })
    }
  }

  // 7. keyword-density
  if (densityResult.status === 'fulfilled') {
    const d = densityResult.value
    if (d.occurrences === 0) {
      checklist.push({ id: 'keyword-density', label: 'Keyword density', status: 'fail', detail: 'Keyword not found on page.', weight: 8 })
    } else if (d.density >= 0.005 && d.density <= 0.025) {
      checklist.push({ id: 'keyword-density', label: 'Keyword density', status: 'pass', detail: `${(d.density * 100).toFixed(2)}% density — optimal.`, weight: 8 })
    } else if (d.density < 0.005) {
      checklist.push({ id: 'keyword-density', label: 'Keyword density', status: 'warn', detail: `Keyword appears ${d.occurrences} times (${(d.density * 100).toFixed(2)}%) — too sparse.`, weight: 8 })
    } else {
      checklist.push({ id: 'keyword-density', label: 'Keyword density', status: 'warn', detail: `Keyword density ${(d.density * 100).toFixed(2)}% — may be over-optimised.`, weight: 8 })
    }
  } else {
    checklist.push({ id: 'keyword-density', label: 'Keyword density', status: 'warn', detail: `Could not run check: ${errMsg(densityResult.reason)}`, weight: 8 })
  }

  // 8. internal-links
  if (!htmlAvailable) {
    checklist.push({ id: 'internal-links', label: 'Internal links', status: 'warn', detail: `Could not run check: ${htmlErrMsg}`, weight: 7 })
  } else {
    let hostname = ''
    try {
      hostname = new URL(url).hostname
    } catch {
      // ignore
    }
    const hrefMatches = [...html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)]
    const internalCount = hrefMatches.filter(([, href]) => {
      if (href.startsWith('/')) return true
      if (!href.startsWith('http')) return true
      if (hostname && href.includes(hostname)) return true
      return false
    }).length

    if (internalCount >= 3) {
      checklist.push({ id: 'internal-links', label: 'Internal links', status: 'pass', detail: `${internalCount} internal links found.`, weight: 7 })
    } else if (internalCount >= 1) {
      checklist.push({ id: 'internal-links', label: 'Internal links', status: 'warn', detail: `Only ${internalCount} internal link(s) — add more for better crawlability.`, weight: 7 })
    } else {
      checklist.push({ id: 'internal-links', label: 'Internal links', status: 'fail', detail: 'No internal links detected.', weight: 7 })
    }
  }

  // 9. image-alt
  if (!htmlAvailable) {
    checklist.push({ id: 'image-alt', label: 'Image alt text', status: 'warn', detail: `Could not run check: ${htmlErrMsg}`, weight: 6 })
  } else {
    const imgTags = html.match(/<img[^>]*>/gi) ?? []
    const totalImgs = imgTags.length
    if (totalImgs === 0) {
      checklist.push({ id: 'image-alt', label: 'Image alt text', status: 'pass', detail: 'No images found.', weight: 6 })
    } else {
      const withAlt = imgTags.filter((tag) => /alt=["'][^"']+["']/i.test(tag)).length
      const coverage = withAlt / totalImgs
      if (coverage >= 0.9) {
        checklist.push({ id: 'image-alt', label: 'Image alt text', status: 'pass', detail: `All ${totalImgs} images have alt text.`, weight: 6 })
      } else if (coverage >= 0.5) {
        checklist.push({ id: 'image-alt', label: 'Image alt text', status: 'warn', detail: `${withAlt}/${totalImgs} images have alt text.`, weight: 6 })
      } else {
        checklist.push({ id: 'image-alt', label: 'Image alt text', status: 'fail', detail: `Most images missing alt text (${withAlt}/${totalImgs} have alt).`, weight: 6 })
      }
    }
  }

  // ── PageSpeed ─────────────────────────────────────────────────────────────
  if (psResult.status === 'fulfilled') {
    const ps = psResult.value

    // 10. page-speed
    if (ps.performance >= 75) {
      checklist.push({ id: 'page-speed', label: 'Page speed (mobile)', status: 'pass', detail: `Performance score: ${ps.performance}/100.`, weight: 8 })
    } else if (ps.performance >= 50) {
      checklist.push({ id: 'page-speed', label: 'Page speed (mobile)', status: 'warn', detail: `Performance score: ${ps.performance}/100 — needs improvement.`, weight: 8 })
    } else {
      checklist.push({ id: 'page-speed', label: 'Page speed (mobile)', status: 'fail', detail: `Performance score: ${ps.performance}/100 — critical.`, weight: 8 })
    }

    // 11. mobile-friendly (use SEO score)
    if (ps.seo >= 80) {
      checklist.push({ id: 'mobile-friendly', label: 'Mobile SEO signals', status: 'pass', detail: `SEO score: ${ps.seo}/100.`, weight: 4 })
    } else if (ps.seo >= 60) {
      checklist.push({ id: 'mobile-friendly', label: 'Mobile SEO signals', status: 'warn', detail: `SEO score: ${ps.seo}/100 — review mobile SEO signals.`, weight: 4 })
    } else {
      checklist.push({ id: 'mobile-friendly', label: 'Mobile SEO signals', status: 'fail', detail: `SEO score: ${ps.seo}/100 — significant mobile SEO issues.`, weight: 4 })
    }
  } else {
    const msg = errMsg(psResult.reason)
    checklist.push({ id: 'page-speed', label: 'Page speed (mobile)', status: 'warn', detail: `Could not run check: ${msg}`, weight: 8 })
    checklist.push({ id: 'mobile-friendly', label: 'Mobile SEO signals', status: 'warn', detail: `Could not run check: ${msg}`, weight: 4 })
  }

  // ── Structured data ───────────────────────────────────────────────────────
  // 12. structured-data
  if (schemaResult.status === 'fulfilled') {
    const schema = schemaResult.value
    if (schema.blocks.length === 0) {
      checklist.push({ id: 'structured-data', label: 'Structured data', status: 'fail', detail: 'No structured data found.', weight: 2 })
    } else {
      const allValid = schema.blocks.every((b) => b.valid)
      if (allValid) {
        const types = schema.blocks.map((b) => b.type).join(', ')
        checklist.push({ id: 'structured-data', label: 'Structured data', status: 'pass', detail: `Structured data found (${types}).`, weight: 2 })
      } else {
        checklist.push({ id: 'structured-data', label: 'Structured data', status: 'warn', detail: 'Structured data found but has validation errors.', weight: 2 })
      }
    }
  } else {
    checklist.push({ id: 'structured-data', label: 'Structured data', status: 'warn', detail: `Could not run check: ${errMsg(schemaResult.reason)}`, weight: 2 })
  }

  // ── Score ─────────────────────────────────────────────────────────────────
  const totalWeight = checklist.reduce((s, i) => s + i.weight, 0)
  const passWeight = checklist.filter((i) => i.status === 'pass').reduce((s, i) => s + i.weight, 0)
  const warnWeight = checklist.filter((i) => i.status === 'warn').reduce((s, i) => s + i.weight * 0.5, 0)
  const score = Math.round(((passWeight + warnWeight) / totalWeight) * 100)

  return { url, keyword, score, checklist }
}
