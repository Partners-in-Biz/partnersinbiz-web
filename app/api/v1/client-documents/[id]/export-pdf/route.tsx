import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer, Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'

import { withAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getAccessibleClientDocument } from '@/lib/client-documents/access'
import { adminDb } from '@/lib/firebase/admin'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import type { ClientDocumentVersion, DocumentBlock } from '@/lib/client-documents/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

type PageSize = 'A4' | 'LETTER'

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 11,
    padding: 48,
    color: '#1a1a1a',
    backgroundColor: '#ffffff',
  },
  header: {
    marginBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingBottom: 16,
  },
  headerLogo: {
    height: 36,
    marginBottom: 12,
    objectFit: 'contain',
    alignSelf: 'flex-start',
  },
  brand: {
    fontSize: 9,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    marginBottom: 4,
  },
  meta: {
    fontSize: 9,
    color: '#9ca3af',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  body: {
    fontSize: 11,
    lineHeight: 1.6,
    color: '#374151',
  },
  footer: {
    position: 'absolute',
    bottom: 32,
    left: 48,
    right: 48,
    fontSize: 8,
    color: '#9ca3af',
    textAlign: 'center',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 8,
  },
  coverPage: {
    fontFamily: 'Helvetica',
    padding: 48,
    color: '#1a1a1a',
    backgroundColor: '#ffffff',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
  },
  coverLogo: {
    height: 56,
    marginBottom: 32,
    objectFit: 'contain',
  },
  coverBrand: {
    fontSize: 12,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 24,
    textAlign: 'center',
  },
  coverTitle: {
    fontSize: 30,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    marginBottom: 16,
    textAlign: 'center',
  },
  coverType: {
    fontSize: 13,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 40,
    textAlign: 'center',
  },
  coverDate: {
    fontSize: 11,
    color: '#9ca3af',
    textAlign: 'center',
  },
})

function extractBlockText(block: DocumentBlock): string | null {
  const content = block.content
  if (!content) return null
  if (typeof content === 'string') return content

  if (typeof content === 'object' && !Array.isArray(content)) {
    const record = content as Record<string, unknown>
    // Common text fields across block types
    const textFields = ['text', 'body', 'description', 'content', 'headline', 'summary', 'title']
    for (const field of textFields) {
      if (typeof record[field] === 'string' && record[field]) {
        return record[field] as string
      }
    }
    // For items arrays, join labels
    if (Array.isArray(record.items)) {
      const labels = (record.items as Array<Record<string, unknown>>)
        .map((item) => typeof item.label === 'string' ? item.label : null)
        .filter(Boolean)
      if (labels.length > 0) return labels.join(', ')
    }
  }
  return null
}

function sanitizeFilename(title: string): string {
  return title.replace(/[^a-z0-9\-_. ]/gi, '_').trim() || 'document'
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

/** Only render an Image when src is a non-empty https URL — @react-pdf throws on bad/relative srcs. */
function isUsableImageUrl(url: unknown): url is string {
  return typeof url === 'string' && url.trim().startsWith('https://')
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await getAccessibleClientDocument(id, user)
  if (!access.ok) return access.response

  const doc = access.document

  // ---- Parse export options (US-174) ----
  const params = req.nextUrl.searchParams
  const pageSize: PageSize = params.get('pageSize') === 'Letter' ? 'LETTER' : 'A4'
  const coverPageRaw = params.get('coverPage')
  const coverPage = coverPageRaw === '1' || coverPageRaw === 'true'
  const format = params.get('format') === 'summary' ? 'summary' : 'detailed'

  // Fetch the current version's blocks
  let blocks: DocumentBlock[] = []
  try {
    const versionId = doc.currentVersionId
    if (versionId) {
      const versionSnap = await adminDb
        .collection(CLIENT_DOCUMENTS_COLLECTION)
        .doc(id)
        .collection('versions')
        .doc(versionId)
        .get()
      if (versionSnap.exists) {
        const versionData = versionSnap.data() as ClientDocumentVersion
        blocks = (versionData.blocks ?? []) as DocumentBlock[]
      }
    }
  } catch {
    // Non-fatal — render PDF without blocks
  }

  // ---- Resolve org logo + brand name from the organization doc ----
  let logoUrl: string | null = null
  let brandName = 'Partners in Biz'
  try {
    const orgId = doc.orgId
    if (orgId) {
      const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
      if (orgSnap.exists) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const org: any = orgSnap.data() ?? {}
        const resolvedLogo = org?.settings?.logoUrl ?? org?.logoUrl
        if (isUsableImageUrl(resolvedLogo)) logoUrl = resolvedLogo
        if (typeof org?.name === 'string' && org.name.trim()) brandName = org.name.trim()
      }
    }
  } catch {
    // Non-fatal — fall back to defaults, render without logo
  }

  const docTitle = doc.title ?? 'Document'
  const docTypeLabel = humanize(String(doc.type ?? 'document'))
  const exportDate = new Date().toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  // Filter to client-visible blocks only
  const visibleBlocks = blocks.filter(
    (b) => b.visibility !== 'hidden' && b.visibility !== 'internal-only',
  )

  // ---- Summary format: reduce to hero/summary/approval-ish blocks, else title + first text block ----
  const SUMMARY_TYPES = new Set([
    'hero',
    'summary',
    'executive_summary',
    'executive-summary',
    'overview',
    'approval',
    'sign_off',
    'sign-off',
    'signoff',
  ])
  let renderBlocks = visibleBlocks
  if (format === 'summary') {
    const matched = visibleBlocks.filter((b) =>
      SUMMARY_TYPES.has(String(b.type).toLowerCase()),
    )
    if (matched.length > 0) {
      renderBlocks = matched
    } else {
      // Deterministic fallback: first block that yields renderable text (or a title)
      const first = visibleBlocks.find((b) => extractBlockText(b) || b.title)
      renderBlocks = first ? [first] : []
    }
  }

  const pdfDoc = (
    <Document title={docTitle} author={brandName}>
      {/* Optional dedicated cover page */}
      {coverPage ? (
        <Page size={pageSize} style={styles.coverPage}>
          {logoUrl ? <Image src={logoUrl} style={styles.coverLogo} /> : null}
          <Text style={styles.coverBrand}>{brandName}</Text>
          <Text style={styles.coverTitle}>{docTitle}</Text>
          <Text style={styles.coverType}>{docTypeLabel}</Text>
          <Text style={styles.coverDate}>Exported {exportDate}</Text>
        </Page>
      ) : null}

      <Page size={pageSize} style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          {logoUrl ? <Image src={logoUrl} style={styles.headerLogo} /> : null}
          <Text style={styles.brand}>Prepared by {brandName}</Text>
          <Text style={styles.title}>{docTitle}</Text>
          <Text style={styles.meta}>Exported {exportDate}</Text>
        </View>

        {/* Content blocks */}
        {renderBlocks.map((block) => {
          const heading = block.title ?? block.type.replace(/_/g, ' ')
          const bodyText = extractBlockText(block)
          if (!bodyText && !block.title) return null
          return (
            <View key={block.id} style={styles.section} wrap={false}>
              <Text style={styles.sectionTitle}>{heading}</Text>
              {bodyText ? <Text style={styles.body}>{bodyText}</Text> : null}
            </View>
          )
        })}

        {/* Footer */}
        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `${brandName}  ·  Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  )

  let buffer: Buffer
  try {
    buffer = await renderToBuffer(pdfDoc)
  } catch {
    // Most likely an Image rendering failure (e.g. unreachable logo URL).
    // Retry once without the logo so the export still succeeds.
    const fallbackDoc = (
      <Document title={docTitle} author={brandName}>
        {coverPage ? (
          <Page size={pageSize} style={styles.coverPage}>
            <Text style={styles.coverBrand}>{brandName}</Text>
            <Text style={styles.coverTitle}>{docTitle}</Text>
            <Text style={styles.coverType}>{docTypeLabel}</Text>
            <Text style={styles.coverDate}>Exported {exportDate}</Text>
          </Page>
        ) : null}
        <Page size={pageSize} style={styles.page}>
          <View style={styles.header}>
            <Text style={styles.brand}>Prepared by {brandName}</Text>
            <Text style={styles.title}>{docTitle}</Text>
            <Text style={styles.meta}>Exported {exportDate}</Text>
          </View>
          {renderBlocks.map((block) => {
            const heading = block.title ?? block.type.replace(/_/g, ' ')
            const bodyText = extractBlockText(block)
            if (!bodyText && !block.title) return null
            return (
              <View key={block.id} style={styles.section} wrap={false}>
                <Text style={styles.sectionTitle}>{heading}</Text>
                {bodyText ? <Text style={styles.body}>{bodyText}</Text> : null}
              </View>
            )
          })}
          <Text
            style={styles.footer}
            render={({ pageNumber, totalPages }) =>
              `${brandName}  ·  Page ${pageNumber} of ${totalPages}`
            }
            fixed
          />
        </Page>
      </Document>
    )
    try {
      buffer = await renderToBuffer(fallbackDoc)
    } catch {
      return apiError('Failed to render PDF', 500)
    }
  }

  const filename = sanitizeFilename(docTitle)

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}.pdf"`,
      'Content-Length': String(buffer.byteLength),
    },
  })
})
