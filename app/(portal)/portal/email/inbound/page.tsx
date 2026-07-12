import { MarketingStudioNav } from '@/components/email-marketing/MarketingStudioNav'
import { ReplyQueue } from '@/components/email-marketing/ReplyQueue'

export const dynamic = 'force-dynamic'

export default async function InboundEmailsPage({ searchParams }: { searchParams?: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams
  const scope = { orgId: params?.orgId, orgSlug: params?.orgSlug, sourceCompanyId: params?.sourceCompanyId, sourceCompanyName: params?.sourceCompanyName }
  return <main className="min-w-0 overflow-hidden rounded-[22px] border border-[var(--color-card-border)] bg-[var(--color-card)]/55 text-on-surface"><MarketingStudioNav scope={scope} active="Inbox & replies" /><ReplyQueue scope={scope} /></main>
}
