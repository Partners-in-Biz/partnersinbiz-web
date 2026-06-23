// /reports/[token] — public viewer for a generated report.
// No auth: the URL is the credential. The publicToken is a 32-byte random
// base64url string (~256 bits of entropy).

import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { getReportByPublicToken } from '@/lib/reports/generate'
import { recordReportOpen } from '@/lib/reports/share'
import ReportView from '@/components/reports/ReportView'

export const dynamic = 'force-dynamic'

interface PageParams { params: Promise<{ token: string }> }

export async function generateMetadata({ params }: PageParams) {
  const { token } = await params
  const report = await getReportByPublicToken(token)
  if (!report) return { title: 'Report not found' }
  return {
    title: `${report.brand.orgName} · ${report.period.start} → ${report.period.end} · Partners in Biz`,
    description: `Performance report for ${report.brand.orgName}.`,
    robots: { index: false, follow: false },
  }
}

export default async function PublicReportPage({ params }: PageParams) {
  const { token } = await params
  const report = await getReportByPublicToken(token)
  if (!report) notFound()

  // Record a per-open event (US-189). Deduped per visitor fingerprint so we can
  // report total vs. unique opens. Fire-and-forget — never block the render.
  const h = await headers()
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    null
  recordReportOpen(report.id, {
    ip,
    userAgent: h.get('user-agent'),
    referer: h.get('referer'),
  }).catch(() => {})

  return (
    <main className="min-h-screen bg-[#0A0A0B] text-[#EDEDED]">
      <ReportView report={report} />
    </main>
  )
}
