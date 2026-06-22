import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer, Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

import { withAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { getAccessibleClientDocument } from '@/lib/client-documents/access'
import { adminDb } from '@/lib/firebase/admin'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import type { ClientDocumentVersion, DocumentBlock } from '@/lib/client-documents/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

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

export const GET = withAuth('client', async (_req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  const { id } = await ctx.params
  const access = await getAccessibleClientDocument(id, user)
  if (!access.ok) return access.response

  const doc = access.document

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

  const docTitle = doc.title ?? 'Document'
  const exportDate = new Date().toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  // Filter to client-visible blocks only
  const visibleBlocks = blocks.filter(
    (b) => b.visibility !== 'hidden' && b.visibility !== 'internal-only',
  )

  const pdfDoc = (
    <Document title={docTitle} author="Partners in Biz">
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.brand}>Prepared by Partners in Biz</Text>
          <Text style={styles.title}>{docTitle}</Text>
          <Text style={styles.meta}>Exported {exportDate}</Text>
        </View>

        {/* Content blocks */}
        {visibleBlocks.map((block) => {
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
            `Partners in Biz  ·  Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  )

  const buffer = await renderToBuffer(pdfDoc)
  const filename = sanitizeFilename(docTitle)

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}.pdf"`,
      'Content-Length': String(buffer.byteLength),
    },
  })
})
