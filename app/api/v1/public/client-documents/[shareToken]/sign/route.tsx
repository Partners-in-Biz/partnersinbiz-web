/**
 * Public signer-facing e-signature endpoint (US-172).
 *
 *   GET  ?st=<signToken>  — resolve the signature request + the shared document
 *                            so the public /d/[shareToken]/sign page can render
 *                            the document and the signer's details.
 *   POST ?st=<signToken>  — record the signature: store the captured signature
 *                            image (typed or drawn) + typed name, render a PDF
 *                            snapshot of the document at signing time, mark the
 *                            request signed, and write a signed-acceptance audit
 *                            row on the document.
 *
 * PUBLIC — gated by the per-signer signToken, not portal auth.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import {
  renderToBuffer,
  Document as PdfDocument,
  Page as PdfPage,
  Text as PdfText,
  View as PdfView,
  StyleSheet,
} from '@react-pdf/renderer'

import { apiError, apiSuccess } from '@/lib/api/response'
import { deserializeBlocksFromFirestore } from '@/lib/client-documents/firestore-blocks'
import { CLIENT_DOCUMENTS_COLLECTION } from '@/lib/client-documents/store'
import { stripPrivateDocumentFields } from '@/lib/client-documents/public'
import type { ClientDocument, DocumentBlock } from '@/lib/client-documents/types'
import { adminDb, getAdminApp } from '@/lib/firebase/admin'
import { getStorage } from 'firebase-admin/storage'
import { enforcePublicRateLimit, publicRequestIp, publicRateLimitHash } from '@/lib/api/public-rate-limit'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ shareToken: string }> }

const styles = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 11, padding: 48, color: '#1a1a1a', backgroundColor: '#ffffff' },
  title: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: '#111827', marginBottom: 4 },
  meta: { fontSize: 9, color: '#9ca3af', marginBottom: 24 },
  section: { marginBottom: 18 },
  sectionTitle: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#374151', marginBottom: 6 },
  body: { fontSize: 11, lineHeight: 1.6, color: '#374151' },
  signBox: {
    marginTop: 28,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 16,
  },
  signLabel: { fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  signName: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#111827', marginBottom: 4 },
  signMeta: { fontSize: 9, color: '#9ca3af' },
})

function extractBlockText(block: DocumentBlock): string | null {
  const content = block.content
  if (!content) return null
  if (typeof content === 'string') return content
  if (typeof content === 'object' && !Array.isArray(content)) {
    const record = content as Record<string, unknown>
    for (const field of ['text', 'body', 'description', 'content', 'headline', 'summary', 'title']) {
      if (typeof record[field] === 'string' && record[field]) return record[field] as string
    }
    if (Array.isArray(record.items)) {
      const labels = (record.items as Array<Record<string, unknown>>)
        .map((item) => (typeof item.label === 'string' ? item.label : null))
        .filter(Boolean)
      if (labels.length > 0) return labels.join(', ')
    }
  }
  return null
}

function firstForwardedIp(req: NextRequest) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
}

function requiredText(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

async function loadByShareToken(shareToken: string) {
  const snap = await adminDb
    .collection(CLIENT_DOCUMENTS_COLLECTION)
    .where('shareToken', '==', shareToken)
    .limit(1)
    .get()
  if (snap.empty) return null
  const docSnap = snap.docs[0]
  const document = { id: docSnap.id, ...docSnap.data() } as ClientDocument
  if (document.deleted === true) return null
  return { docSnap, document }
}

async function renderSignedPdf(opts: {
  title: string
  blocks: DocumentBlock[]
  signerName: string
  typedName: string
  signedAtIso: string
  ip: string
}): Promise<Buffer> {
  const visible = opts.blocks.filter((b) => b.visibility !== 'hidden' && b.visibility !== 'internal-only')
  const pdfDoc = (
    <PdfDocument title={opts.title}>
      <PdfPage size="A4" style={styles.page}>
        <PdfText style={styles.title}>{opts.title}</PdfText>
        <PdfText style={styles.meta}>Signed copy</PdfText>
        {visible.map((block) => {
          const heading = block.title ?? block.type.replace(/_/g, ' ')
          const bodyText = extractBlockText(block)
          if (!bodyText && !block.title) return null
          return (
            <PdfView key={block.id} style={styles.section} wrap={false}>
              <PdfText style={styles.sectionTitle}>{heading}</PdfText>
              {bodyText ? <PdfText style={styles.body}>{bodyText}</PdfText> : null}
            </PdfView>
          )
        })}
        <PdfView style={styles.signBox}>
          <PdfText style={styles.signLabel}>Electronically signed by</PdfText>
          <PdfText style={styles.signName}>{opts.typedName || opts.signerName}</PdfText>
          <PdfText style={styles.signMeta}>Signer: {opts.signerName}</PdfText>
          <PdfText style={styles.signMeta}>Signed at {opts.signedAtIso}</PdfText>
          {opts.ip ? <PdfText style={styles.signMeta}>IP {opts.ip}</PdfText> : null}
        </PdfView>
      </PdfPage>
    </PdfDocument>
  )
  return renderToBuffer(pdfDoc)
}

/** GET — resolve the signature request + shared document for the signer. */
export async function GET(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { shareToken } = await context.params
    if (!shareToken || shareToken.length < 8) return apiError('Invalid share token', 400)

    const signToken = req.nextUrl.searchParams.get('st')?.trim() ?? ''
    if (!signToken) return apiError('Missing signature token', 400)

    const limited = await enforcePublicRateLimit(req, {
      key: `public_sign_get:${publicRateLimitHash(shareToken)}:${publicRequestIp(req)}`,
      limit: 120,
      windowMs: 60 * 60 * 1000,
    })
    if (limited) return limited

    const loaded = await loadByShareToken(shareToken)
    if (!loaded) return apiError('Document not found', 404)
    const { docSnap, document } = loaded
    if (document.shareEnabled !== true) return apiError('Share link disabled', 403)

    const reqSnap = await adminDb
      .collection(CLIENT_DOCUMENTS_COLLECTION)
      .doc(docSnap.id)
      .collection('signature_requests')
      .where('signToken', '==', signToken)
      .limit(1)
      .get()

    if (reqSnap.empty) return apiError('Signature request not found', 404)
    const requestDoc = reqSnap.docs[0]
    const request = requestDoc.data()

    const versionId = (request.versionId as string) || document.latestPublishedVersionId
    if (!versionId) return apiError('Published version not found', 404)

    const versionSnap = await adminDb
      .collection(CLIENT_DOCUMENTS_COLLECTION)
      .doc(docSnap.id)
      .collection('versions')
      .doc(versionId)
      .get()
    if (!versionSnap.exists) return apiError('Published version not found', 404)

    const versionData = versionSnap.data()!
    const version = {
      id: versionSnap.id,
      ...versionData,
      blocks: deserializeBlocksFromFirestore(versionData.blocks),
    }

    return apiSuccess({
      document: stripPrivateDocumentFields(document),
      version: stripPrivateDocumentFields(version),
      signatureRequest: {
        id: requestDoc.id,
        signerName: request.signerName ?? '',
        signerEmail: request.signerEmail ?? '',
        message: request.message ?? '',
        status: request.status ?? 'pending',
      },
    })
  } catch (err) {
    console.error('[public/client-documents/sign GET]', err)
    return apiError('Internal Server Error', 500)
  }
}

/** POST — record the signature + PDF snapshot. */
export async function POST(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { shareToken } = await context.params
    if (!shareToken || shareToken.length < 8) return apiError('Invalid share token', 400)

    const signToken = req.nextUrl.searchParams.get('st')?.trim() ?? ''
    if (!signToken) return apiError('Missing signature token', 400)

    const limited = await enforcePublicRateLimit(req, {
      key: `public_sign_post:${publicRateLimitHash(shareToken)}:${publicRequestIp(req)}`,
      limit: 20,
      windowMs: 60 * 60 * 1000,
    })
    if (limited) return limited

    const loaded = await loadByShareToken(shareToken)
    if (!loaded) return apiError('Document not found', 404)
    const { docSnap, document } = loaded
    if (document.shareEnabled !== true) return apiError('Share link disabled', 403)

    const reqSnap = await adminDb
      .collection(CLIENT_DOCUMENTS_COLLECTION)
      .doc(docSnap.id)
      .collection('signature_requests')
      .where('signToken', '==', signToken)
      .limit(1)
      .get()
    if (reqSnap.empty) return apiError('Signature request not found', 404)
    const requestRef = reqSnap.docs[0].ref
    const request = reqSnap.docs[0].data()

    if (request.status === 'signed') return apiError('This document has already been signed', 409)
    if (request.status === 'cancelled') return apiError('This signature request was cancelled', 410)

    const body = await req.json().catch(() => ({}))
    const typedName = requiredText(body.typedName)
    const signatureImage = typeof body.signatureImage === 'string' ? body.signatureImage : ''
    const agreed = body.agreed === true

    if (!typedName) return apiError('typedName is required', 400)
    if (!agreed) return apiError('You must agree to sign before submitting', 400)
    if (!signatureImage || !signatureImage.startsWith('data:image/')) {
      return apiError('A signature (typed or drawn) is required', 400)
    }
    // Guard against oversized payloads (~700KB cap on the data-URL).
    if (signatureImage.length > 700_000) return apiError('Signature image is too large', 413)

    const versionId = (request.versionId as string) || document.latestPublishedVersionId || ''
    const ip = firstForwardedIp(req)
    const userAgent = req.headers.get('user-agent') ?? ''
    const signedAtIso = new Date().toISOString()

    // Render a PDF snapshot of the document as signed, and store it.
    let pdfSnapshotPath: string | undefined
    let pdfSnapshotUrl: string | undefined
    try {
      let blocks: DocumentBlock[] = []
      if (versionId) {
        const versionSnap = await adminDb
          .collection(CLIENT_DOCUMENTS_COLLECTION)
          .doc(docSnap.id)
          .collection('versions')
          .doc(versionId)
          .get()
        if (versionSnap.exists) {
          blocks = deserializeBlocksFromFirestore(versionSnap.data()?.blocks)
        }
      }
      const pdfBuffer = await renderSignedPdf({
        title: document.title ?? 'Document',
        blocks,
        signerName: (request.signerName as string) ?? '',
        typedName,
        signedAtIso,
        ip,
      })
      const downloadToken = crypto.randomUUID()
      const storagePath = `client-documents/${docSnap.id}/signed/${requestRef.id}.pdf`
      const bucket = getStorage(getAdminApp()).bucket()
      await bucket.file(storagePath).save(pdfBuffer, {
        metadata: {
          contentType: 'application/pdf',
          metadata: { firebaseStorageDownloadTokens: downloadToken },
        },
      })
      pdfSnapshotPath = storagePath
      pdfSnapshotUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`
    } catch (err) {
      // PDF snapshot is best-effort — the signature itself still records.
      console.error('[public sign] PDF snapshot failed (non-blocking)', err)
    }

    const now = FieldValue.serverTimestamp()
    const documentRef = adminDb.collection(CLIENT_DOCUMENTS_COLLECTION).doc(docSnap.id)
    const acceptanceRef = documentRef.collection('approvals').doc()
    const batch = adminDb.batch()

    batch.update(requestRef, {
      status: 'signed',
      typedName,
      signatureImage,
      ...(pdfSnapshotPath ? { pdfSnapshotPath } : {}),
      ...(pdfSnapshotUrl ? { pdfSnapshotUrl } : {}),
      ip,
      userAgent,
      signedAt: now,
    })

    batch.set(acceptanceRef, {
      documentId: docSnap.id,
      versionId,
      mode: 'formal_acceptance',
      signatureSide: 'client',
      actorId: `signer:${requestRef.id}`,
      actorName: (request.signerName as string) ?? typedName,
      actorRole: 'client',
      typedName,
      signatureImage,
      ...(pdfSnapshotPath ? { pdfSnapshotPath } : {}),
      ...(pdfSnapshotUrl ? { pdfSnapshotUrl } : {}),
      ip,
      userAgent,
      createdAt: now,
    })

    // Stamp the document so the portal can show a "Signed" badge.
    batch.update(documentRef, {
      signedByExternal: {
        signatureRequestId: requestRef.id,
        signerName: (request.signerName as string) ?? typedName,
        signerEmail: (request.signerEmail as string) ?? '',
        typedName,
        versionId,
        ...(pdfSnapshotPath ? { pdfSnapshotPath } : {}),
        ...(pdfSnapshotUrl ? { pdfSnapshotUrl } : {}),
        signedAt: now,
        ip,
      },
      updatedAt: now,
    })

    await batch.commit()

    return apiSuccess({ signed: true, ...(pdfSnapshotUrl ? { pdfSnapshotUrl } : {}) })
  } catch (err) {
    console.error('[public/client-documents/sign POST]', err)
    return apiError('Internal Server Error', 500)
  }
}
