import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex flex-col gap-3 border-b border-[var(--color-pib-line)] px-4 py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="font-medium text-sm text-[var(--color-pib-text)]">{label}</div>
        <div className="text-xs text-[var(--color-pib-text-muted)]">{detail}</div>
      </div>
      <span className={ok ? 'pib-pill pib-pill-success' : 'pib-pill pib-pill-warn'}>
        {ok ? 'OK' : 'Action needed'}
      </span>
    </div>
  )
}

export default async function HealthTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const snap = await adminDb.collection('seo_sprints').doc(id).get()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sprint = snap.data() as any
  const integrations = sprint?.integrations ?? {}
  const signals = sprint?.health?.signals ?? []

  return (
    <div className="space-y-6">
      <section className="pib-card-section">
        <div className="pib-card-section-header">
          <h3 className="font-semibold text-sm text-[var(--color-pib-text)]">Integrations</h3>
          <p className="text-xs text-[var(--color-pib-text-muted)]">Connection health for the sprint data layer.</p>
        </div>
        <StatusRow
          label="Google Search Console"
          ok={!!integrations.gsc?.connected && integrations.gsc?.tokenStatus !== 'expired'}
          detail={
            integrations.gsc?.connected
              ? `Connected to ${integrations.gsc.propertyUrl ?? '(no property selected)'}`
              : 'Not connected'
          }
        />
        <StatusRow
          label="Bing Webmaster Tools"
          ok={!!integrations.bing?.connected}
          detail={integrations.bing?.connected ? `Connected: ${integrations.bing.siteUrl}` : 'Not connected'}
        />
        <StatusRow
          label="PageSpeed Insights"
          ok={!!integrations.pagespeed?.enabled}
          detail={integrations.pagespeed?.enabled ? 'Enabled' : 'Disabled'}
        />
      </section>

      <section className="pib-card-section">
        <div className="pib-card-section-header flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm text-[var(--color-pib-text)]">Active signals</h3>
            <p className="text-xs text-[var(--color-pib-text-muted)]">{signals.length} open health signals</p>
          </div>
          <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">health_and_safety</span>
        </div>
        {signals.length === 0 ? (
          <p className="px-4 py-5 text-sm text-[var(--color-pib-text-muted)]">No active health signals.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-pib-line)]">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {signals.map((s: any, i: number) => (
              <li key={i} className="px-4 py-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-[var(--color-pib-text)]">{s.type}</span>
                  <span className={s.severity === 'high' ? 'pib-pill pib-pill-danger' : s.severity === 'medium' ? 'pib-pill pib-pill-warn' : 'pib-pill'}>
                  {s.severity}
                </span>
                </div>
                <pre className="mt-3 max-h-72 overflow-auto rounded-2xl border border-[var(--color-pib-line)] bg-black/20 p-3 text-xs text-[var(--color-pib-text-muted)]">{JSON.stringify(s.evidence, null, 2)}</pre>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
