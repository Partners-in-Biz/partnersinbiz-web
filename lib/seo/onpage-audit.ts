import { runMetadataCheck } from '@/lib/seo/tools/metadata'
import { runRobotsCheck } from '@/lib/seo/tools/robots'
import { runSitemapCheck } from '@/lib/seo/tools/sitemap'
import { runCanonicalCheck } from '@/lib/seo/tools/canonical'
import { runSchemaValidate } from '@/lib/seo/tools/schema'
import { runInternalLinkAudit } from '@/lib/seo/tools/internal-link-audit'
import { runPageSpeed } from '@/lib/seo/integrations/pagespeed/client'

export interface AuditIssue {
  id: string
  title: string
  severity: 'critical' | 'warning' | 'info'
  affectedPages: string[]
  howToFix: string
  detail?: string
}

export interface AuditCategory {
  category: string
  issues: AuditIssue[]
}

export interface SiteAuditResult {
  url: string
  score: number
  breakdown: { critical: number; warning: number; info: number }
  categories: AuditCategory[]
}

function failedCheckIssue(id: string, label: string, err: unknown): AuditIssue {
  return {
    id: `check-failed-${id}`,
    title: `Could not run ${label} check`,
    severity: 'info',
    affectedPages: [],
    howToFix: 'Check site connectivity and try again.',
    detail: err instanceof Error ? err.message : String(err),
  }
}

export async function runSiteAudit(siteUrl: string, focusKeyword?: string): Promise<SiteAuditResult> {
  const url = /^https?:\/\//i.test(siteUrl) ? siteUrl : `https://${siteUrl}`
  const sitemapUrl = url.replace(/\/$/, '') + '/sitemap.xml'

  const categories: AuditCategory[] = []

  // ── Metadata ─────────────────────────────────────────────────────────────
  {
    const issues: AuditIssue[] = []
    try {
      const meta = await runMetadataCheck(url)

      if (!meta.title) {
        issues.push({
          id: 'meta-missing-title',
          title: 'Missing page title',
          severity: 'critical',
          affectedPages: [url],
          howToFix: 'Add a unique <title> tag (50-60 chars).',
        })
      } else if (meta.titleLength !== undefined && meta.titleLength < 30) {
        issues.push({
          id: 'meta-title-short',
          title: 'Page title is too short',
          severity: 'warning',
          affectedPages: [url],
          howToFix: 'Expand the title to 50-60 characters.',
          detail: `Current length: ${meta.titleLength} chars`,
        })
      } else if (meta.titleLength !== undefined && meta.titleLength > 65) {
        issues.push({
          id: 'meta-title-long',
          title: 'Page title is too long',
          severity: 'warning',
          affectedPages: [url],
          howToFix: 'Trim the title to under 60 characters to avoid truncation in SERPs.',
          detail: `Current length: ${meta.titleLength} chars`,
        })
      }

      if (!meta.description) {
        issues.push({
          id: 'meta-missing-desc',
          title: 'Missing meta description',
          severity: 'warning',
          affectedPages: [url],
          howToFix: 'Add a meta description of 120-160 characters.',
        })
      } else if (meta.descriptionLength !== undefined && meta.descriptionLength < 70) {
        issues.push({
          id: 'meta-desc-short',
          title: 'Meta description is short',
          severity: 'info',
          affectedPages: [url],
          howToFix: 'Expand to at least 120 characters for better click-through rates.',
          detail: `Current length: ${meta.descriptionLength} chars`,
        })
      } else if (meta.descriptionLength !== undefined && meta.descriptionLength > 165) {
        issues.push({
          id: 'meta-desc-long',
          title: 'Meta description is too long',
          severity: 'warning',
          affectedPages: [url],
          howToFix: 'Shorten to under 160 characters.',
          detail: `Current length: ${meta.descriptionLength} chars`,
        })
      }

      // Check OG tags from issues array
      const issueText = (meta.issues ?? []).join(' ')
      if (issueText.includes('og:title') || !(meta as any).ogTitle) {
        // Only flag if issues mention it or we have a way to detect absence
        const hasOgTitleIssue = (meta.issues ?? []).some(
          (i) => i.toLowerCase().includes('og:title') || i.toLowerCase().includes('og title'),
        )
        if (hasOgTitleIssue) {
          issues.push({
            id: 'meta-missing-og-title',
            title: 'Missing og:title',
            severity: 'info',
            affectedPages: [url],
            howToFix: 'Add Open Graph tags for better social sharing.',
          })
        }
      }
      const hasOgImageIssue = (meta.issues ?? []).some(
        (i) => i.toLowerCase().includes('og:image') || i.toLowerCase().includes('og image'),
      )
      if (hasOgImageIssue) {
        issues.push({
          id: 'meta-missing-og-image',
          title: 'Missing og:image',
          severity: 'info',
          affectedPages: [url],
          howToFix: 'Add an og:image for social previews.',
        })
      }
    } catch (err) {
      issues.push(failedCheckIssue('metadata', 'metadata', err))
    }
    categories.push({ category: 'Metadata', issues })
  }

  // ── Crawlability ──────────────────────────────────────────────────────────
  {
    const issues: AuditIssue[] = []
    try {
      const robots = await runRobotsCheck(url)
      for (const issue of robots.issues ?? []) {
        const isCritical = issue.includes('Disallow: /')
        issues.push({
          id: `robots-${Buffer.from(issue).toString('base64').slice(0, 12)}`,
          title: issue,
          severity: isCritical ? 'critical' : 'warning',
          affectedPages: [url],
          howToFix: isCritical
            ? 'Update robots.txt to allow search engine crawlers.'
            : 'Review your robots.txt directives.',
        })
      }
      const hasSitemap =
        (robots.sitemaps ?? []).length > 0 ||
        (robots.issues ?? []).some((i) => i.toLowerCase().includes('sitemap'))
      if (!hasSitemap && (robots.sitemaps ?? []).length === 0) {
        issues.push({
          id: 'robots-no-sitemap',
          title: 'Sitemap not referenced in robots.txt',
          severity: 'warning',
          affectedPages: [url],
          howToFix: 'Add Sitemap: https://yourdomain.com/sitemap.xml to your robots.txt',
        })
      }
    } catch (err) {
      issues.push(failedCheckIssue('robots', 'robots.txt', err))
    }
    categories.push({ category: 'Crawlability', issues })
  }

  // ── Indexation ────────────────────────────────────────────────────────────
  {
    const issues: AuditIssue[] = []
    try {
      const sitemap = await runSitemapCheck(sitemapUrl)
      for (const issue of sitemap.issues ?? []) {
        const isStatus400 = /4\d\d|5\d\d/.test(issue) || issue.toLowerCase().includes('not accessible')
        if (isStatus400) {
          issues.push({
            id: 'sitemap-not-accessible',
            title: 'Sitemap not accessible',
            severity: 'critical',
            affectedPages: [sitemapUrl],
            howToFix: 'Ensure /sitemap.xml returns HTTP 200.',
            detail: issue,
          })
        }
      }
      if (sitemap.totalUrls === 0) {
        issues.push({
          id: 'sitemap-empty',
          title: 'Sitemap is empty',
          severity: 'warning',
          affectedPages: [sitemapUrl],
          howToFix: 'Ensure your sitemap contains all indexable URLs.',
        })
      }
      for (const checked of sitemap.spotChecked ?? []) {
        if (checked.status >= 400) {
          issues.push({
            id: `sitemap-bad-url-${Buffer.from(checked.url).toString('base64').slice(0, 12)}`,
            title: 'Sitemap URL returns 4xx/5xx',
            severity: 'warning',
            affectedPages: [checked.url],
            howToFix: 'Fix or remove broken URLs from your sitemap.',
            detail: `Status ${checked.status}: ${checked.url}`,
          })
        }
      }
    } catch (err) {
      issues.push(failedCheckIssue('sitemap', 'sitemap', err))
    }
    categories.push({ category: 'Indexation', issues })
  }

  // ── Canonical ─────────────────────────────────────────────────────────────
  {
    const issues: AuditIssue[] = []
    try {
      const canonical = await runCanonicalCheck(url)
      if (!canonical.canonical) {
        issues.push({
          id: 'canonical-missing',
          title: 'Missing canonical tag',
          severity: 'warning',
          affectedPages: [url],
          howToFix: "Add <link rel='canonical' href='...'> to your homepage.",
        })
      } else if (!canonical.matches) {
        issues.push({
          id: 'canonical-mismatch',
          title: 'Canonical points to different URL',
          severity: 'warning',
          affectedPages: [url],
          howToFix: 'Update canonical to point to the preferred URL.',
          detail: `Canonical: ${canonical.canonical}`,
        })
      }
    } catch (err) {
      issues.push(failedCheckIssue('canonical', 'canonical', err))
    }
    categories.push({ category: 'Canonical', issues })
  }

  // ── Structured data ───────────────────────────────────────────────────────
  {
    const issues: AuditIssue[] = []
    try {
      const schema = await runSchemaValidate(url)
      if (!schema.blocks || schema.blocks.length === 0) {
        issues.push({
          id: 'schema-none',
          title: 'No structured data found',
          severity: 'warning',
          affectedPages: [url],
          howToFix: 'Add JSON-LD schema (Organization, WebSite, etc.) to improve rich results.',
        })
      } else {
        for (const issue of schema.issues ?? []) {
          const isInvalidJson =
            issue.toLowerCase().includes('invalid json') || issue.toLowerCase().includes('parse error')
          const missingPropsMatch = issue.match(/(?:missing|required)[^:]*:\s*(.+)/i)
          const typeMatch = issue.match(/type\s+(\w+)/i)
          if (isInvalidJson) {
            issues.push({
              id: 'schema-invalid-json',
              title: 'Invalid JSON-LD block',
              severity: 'critical',
              affectedPages: [url],
              howToFix: 'Fix JSON syntax errors in your schema blocks.',
              detail: issue,
            })
          } else if (missingPropsMatch) {
            const schemaType = typeMatch?.[1] ?? 'Schema'
            const props = missingPropsMatch[1]
            issues.push({
              id: `schema-missing-props-${schemaType.toLowerCase()}`,
              title: `Schema type ${schemaType} missing required properties: ${props}`,
              severity: 'warning',
              affectedPages: [url],
              howToFix: 'Add the missing properties to your JSON-LD.',
              detail: issue,
            })
          } else {
            issues.push({
              id: `schema-issue-${Buffer.from(issue).toString('base64').slice(0, 12)}`,
              title: issue,
              severity: 'warning',
              affectedPages: [url],
              howToFix: 'Review and fix structured data issues.',
            })
          }
        }
      }
    } catch (err) {
      issues.push(failedCheckIssue('schema', 'structured data', err))
    }
    categories.push({ category: 'Structured data', issues })
  }

  // ── Internal linking ──────────────────────────────────────────────────────
  {
    const issues: AuditIssue[] = []
    try {
      const links = await runInternalLinkAudit(sitemapUrl)
      if (links.totalLinks === 0 && links.totalPages > 1) {
        issues.push({
          id: 'internal-links-none',
          title: 'No internal links detected',
          severity: 'critical',
          affectedPages: [url],
          howToFix: 'Internal linking is critical for crawlability. Link between your pages.',
        })
      }
      if (links.orphans && links.orphans.length > 0) {
        issues.push({
          id: 'internal-links-orphans',
          title: `${links.orphans.length} orphan pages detected`,
          severity: links.orphans.length > 5 ? 'warning' : 'info',
          affectedPages: links.orphans.slice(0, 20),
          howToFix: 'Add internal links from relevant pages to these orphaned URLs.',
          detail: `${links.orphans.length} pages have no inbound internal links`,
        })
      }
    } catch (err) {
      issues.push(failedCheckIssue('internal-links', 'internal link', err))
    }
    categories.push({ category: 'Internal linking', issues })
  }

  // ── Performance ───────────────────────────────────────────────────────────
  {
    const issues: AuditIssue[] = []
    try {
      const ps = await runPageSpeed(url, 'mobile')

      if (ps.performance < 50) {
        issues.push({
          id: 'perf-very-poor',
          title: 'Very poor mobile performance score',
          severity: 'critical',
          affectedPages: [url],
          howToFix: 'Optimise images, reduce JS bundle size, and enable compression.',
          detail: `Score: ${ps.performance}`,
        })
      } else if (ps.performance < 75) {
        issues.push({
          id: 'perf-needs-improvement',
          title: 'Mobile performance needs improvement',
          severity: 'warning',
          affectedPages: [url],
          howToFix: 'Review Core Web Vitals and address largest opportunities.',
          detail: `Score: ${ps.performance}`,
        })
      }

      if (ps.lcp !== undefined) {
        if (ps.lcp > 4000) {
          issues.push({
            id: 'perf-lcp-critical',
            title: `LCP is very slow (${ps.lcp}ms)`,
            severity: 'critical',
            affectedPages: [url],
            howToFix: 'Optimise the largest contentful paint element — compress images, preload key resources.',
          })
        } else if (ps.lcp > 2500) {
          issues.push({
            id: 'perf-lcp-warning',
            title: `LCP needs improvement (${ps.lcp}ms)`,
            severity: 'warning',
            affectedPages: [url],
            howToFix: 'Target LCP under 2500ms.',
          })
        }
      }

      if (ps.cls !== undefined) {
        if (ps.cls > 0.25) {
          issues.push({
            id: 'perf-cls-critical',
            title: `CLS is very high (${ps.cls})`,
            severity: 'critical',
            affectedPages: [url],
            howToFix: 'Fix layout shifts — set explicit sizes on images and embeds.',
          })
        } else if (ps.cls > 0.1) {
          issues.push({
            id: 'perf-cls-warning',
            title: `CLS needs improvement (${ps.cls})`,
            severity: 'warning',
            affectedPages: [url],
            howToFix: 'Reduce cumulative layout shift to under 0.1.',
          })
        }
      }

      if (ps.inp !== undefined) {
        if (ps.inp > 500) {
          issues.push({
            id: 'perf-inp-critical',
            title: `INP is very high (${ps.inp}ms)`,
            severity: 'critical',
            affectedPages: [url],
            howToFix: 'Reduce JavaScript execution time and main-thread blocking.',
          })
        } else if (ps.inp > 200) {
          issues.push({
            id: 'perf-inp-warning',
            title: `INP needs improvement (${ps.inp}ms)`,
            severity: 'warning',
            affectedPages: [url],
            howToFix: 'Target INP under 200ms.',
          })
        }
      }
    } catch (err) {
      issues.push(failedCheckIssue('pagespeed', 'PageSpeed', err))
    }
    categories.push({ category: 'Performance', issues })
  }

  // ── Score calculation ─────────────────────────────────────────────────────
  let critical = 0
  let warning = 0
  let info = 0
  for (const cat of categories) {
    for (const issue of cat.issues) {
      if (issue.severity === 'critical') critical++
      else if (issue.severity === 'warning') warning++
      else info++
    }
  }
  const score = Math.max(0, 100 - critical * 10 - warning * 4 - info * 1)

  return {
    url,
    score,
    breakdown: { critical, warning, info },
    categories,
  }
}
