import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { getCurrentAdminUserFromCookies } from '@/lib/api/currentAdmin'
import { canAccessOrg } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

const TABS = [
  { key: 'overview', label: 'Overview', href: '' },
  { key: 'social', label: 'Social', href: '/social' },
  { key: 'blogs', label: 'Blogs', href: '/blogs' },
  { key: 'videos', label: 'Videos', href: '/videos' },
  { key: 'calendar', label: 'Calendar', href: '/calendar' },
  { key: 'brand', label: 'Brand', href: '/brand' },
  { key: 'research', label: 'Research', href: '/research' },
  { key: 'settings', label: 'Settings', href: '/settings' },
]

const STATUS_PILL: Record<string, string> = {
  draft: 'bg-gray-700 text-gray-100',
  in_review: 'bg-amber-700 text-amber-50',
  approved: 'bg-emerald-700 text-emerald-50',
  shipping: 'bg-violet-700 text-violet-50',
  archived: 'bg-zinc-800 text-zinc-300',
}

export default async function CampaignLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await getCurrentAdminUserFromCookies()
  if (!user) redirect('/login')

  const snap = await adminDb.collection('campaigns').doc(id).get()
  if (!snap.exists) notFound()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = snap.data() as any
  if (c.deleted) notFound()
  if (!canAccessOrg(user, c.orgId)) notFound()

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link href="/admin/campaigns" className="text-xs text-[var(--color-pib-text-muted)] hover:underline">
          ← All campaigns
        </Link>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">{c.name}</h1>
              <span
                className={`text-[10px] px-2 py-1 rounded uppercase tracking-wide ${
                  STATUS_PILL[c.status] ?? 'bg-gray-800 text-gray-300'
                }`}
              >
                {c.status}
              </span>
            </div>
            <p className="text-sm text-[var(--color-pib-text-muted)]">
              {c.clientType ?? '—'} · org <code>{c.orgId}</code>
              {c.shareEnabled !== false && c.shareToken && (
                <>
                  {' · '}
                  <a
                    href={`/c/${c.shareToken}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-pib-accent)] hover:underline"
                  >
                    public preview ↗
                  </a>
                </>
              )}
            </p>
          </div>
          <ApproveAllButton id={id} />
        </div>
      </header>
      <nav className="flex gap-1 border-b border-[var(--color-pib-line)] flex-wrap">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/campaigns/${id}${t.href}`}
            className="px-3 py-2 text-sm border-b-2 border-transparent hover:border-[var(--color-pib-line-strong)]"
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div>{children}</div>
    </div>
  )
}

function ApproveAllButton({ id }: { id: string }) {
  return (
    <form action={`/api/v1/campaigns/${id}/approve-all`} method="POST">
      <button
        formAction={`/api/v1/campaigns/${id}/approve-all`}
        className="text-sm px-4 py-2 rounded bg-[var(--color-pib-accent)] text-black hover:bg-[var(--color-pib-accent-hover)] font-medium"
      >
        Approve all
      </button>
    </form>
  )
}
