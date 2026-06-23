// components/reports/ReportView.tsx
//
// Branded server component that renders a Report. Used both at /reports/[token]
// (public viewer) and /admin/reports/[id]/preview (admin). Print-friendly.

import type { Report, ReportKpis, ReportSection, ReportMetricKey } from '@/lib/reports/types'

const fmtZar = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 0,
})

const fmtNum = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 })

function fmtPct(p: number | null) {
  if (p === null) return '—'
  const sign = p >= 0 ? '+' : ''
  return `${sign}${p.toFixed(1)}%`
}

function deltaClass(p: number | null) {
  if (p === null) return 'text-white/40'
  if (p > 0) return 'text-emerald-300'
  if (p < 0) return 'text-rose-300'
  return 'text-white/40'
}

interface KpiTileProps {
  label: string
  value: string
  delta?: number | null
  hint?: string
}

function KpiTile({ label, value, delta, hint }: KpiTileProps) {
  return (
    <div className="bento-tile rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <div className="text-[10px] uppercase tracking-[0.25em] text-white/40 font-mono mb-2">
        {label}
      </div>
      <div className="text-3xl font-display tabular-nums">{value}</div>
      {(delta !== undefined || hint) && (
        <div className="mt-2 text-xs">
          {delta !== undefined && (
            <span className={`font-mono ${deltaClass(delta ?? null)}`}>
              {fmtPct(delta ?? null)} <span className="text-white/30">vs prior</span>
            </span>
          )}
          {hint && <span className="text-white/40 ml-2">{hint}</span>}
        </div>
      )}
    </div>
  )
}

function Sparkline({ values, width = 120, height = 36 }: { values: number[]; width?: number; height?: number }) {
  if (values.length === 0) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const stepX = width / Math.max(1, values.length - 1)
  const path = values
    .map((v, i) => {
      const x = i * stepX
      const y = height - ((v - min) / range) * height
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={width} height={height} aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function pickSeries(report: Report, metric: string): number[] {
  return report.series.find((s) => s.metric === metric)?.series.map((p) => p.value) ?? []
}

function metricVal(k: ReportKpis, key?: ReportMetricKey): number {
  if (!key) return 0
  const v = (k as unknown as Record<string, unknown>)[key]
  return typeof v === 'number' ? v : 0
}

/** Renders one section of a custom (builder) report. */
function CustomSectionView({ section, report }: { section: ReportSection; report: Report }) {
  const k = report.kpis
  if (section.type === 'page_break') {
    return <div className="report-page-break mt-12 border-t border-white/10" />
  }
  if (section.type === 'text') {
    return (
      <section className="mt-12">
        {section.title ? <h2 className="eyebrow mb-4">{section.title}</h2> : null}
        <div className="prose prose-invert max-w-none text-white/80 text-base leading-relaxed">
          {(section.body ?? '').split('\n\n').map((p, i) => (
            <p key={i} className="mb-4">{p}</p>
          ))}
        </div>
      </section>
    )
  }
  if (section.type === 'metric') {
    const val = section.dataSource?.kind === 'manual'
      ? section.dataSource.value ?? 0
      : metricVal(k, section.dataSource?.metric)
    return (
      <section className="mt-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiTile label={section.title ?? section.dataSource?.metric ?? 'Metric'} value={fmtNum.format(val)} />
        </div>
      </section>
    )
  }
  if (section.type === 'chart') {
    const metric = section.dataSource?.metric ?? section.dataSource?.series ?? ''
    return (
      <section className="mt-12">
        {section.title ? <h2 className="eyebrow mb-4">{section.title}</h2> : null}
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-[var(--report-accent)]">
          <Sparkline values={pickSeries(report, metric)} width={420} height={64} />
        </div>
      </section>
    )
  }
  // table
  const rows = section.dataSource?.kind === 'manual'
    ? (section.dataSource.rows ?? []).map((r) => ({ label: r.label, value: r.value }))
    : (section.dataSource?.metrics ?? []).map((m) => ({ label: m, value: fmtNum.format(metricVal(k, m)) }))
  return (
    <section className="mt-12">
      {section.title ? <h2 className="eyebrow mb-4">{section.title}</h2> : null}
      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02]">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-white/5">
                <td className="py-3 px-4 font-mono text-white/60">{r.label}</td>
                <td className="text-right tabular-nums py-3 px-4">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function ReportView({ report }: { report: Report }) {
  const k = report.kpis
  const isCustom = Boolean(report.custom && report.custom.sections.length > 0)
  return (
    <article className="report-view max-w-5xl mx-auto px-6 md:px-10 py-12 text-[var(--report-text)]" style={{
      // Reports always use the dark+amber Partners-in-Biz brand,
      // overlaid with the client's accent.
      ['--report-bg' as never]: report.brand.bg,
      ['--report-text' as never]: report.brand.text,
      ['--report-accent' as never]: report.brand.accent,
    } as React.CSSProperties}>
      <header className="flex flex-wrap items-end justify-between gap-6 pb-10 border-b border-white/10">
        <div>
          <p className="text-[10px] uppercase tracking-[0.4em] text-white/40 font-mono">
            {report.type === 'monthly' ? 'Monthly performance report' : `${report.type} report`}
          </p>
          <h1 className="mt-3 text-4xl md:text-5xl font-display leading-tight">
            {report.brand.orgName}
          </h1>
          <p className="mt-2 text-sm text-white/60">
            {report.period.start} → {report.period.end}
            <span className="text-white/30"> · {report.period.tz}</span>
          </p>
        </div>
        <div className="text-right">
          {report.brand.orgLogoUrl ? (
            <img src={report.brand.orgLogoUrl} alt="" className="h-12 inline-block opacity-90" />
          ) : null}
          <p className="mt-3 text-[10px] uppercase tracking-[0.3em] text-white/40 font-mono">
            Partners in Biz · Studio report
          </p>
        </div>
      </header>

      {/* Custom builder reports: render authored sections in order. */}
      {isCustom && report.custom!.sections.map((s) => (
        <CustomSectionView key={s.id} section={s} report={report} />
      ))}

      {/* Highlights */}
      {!isCustom && report.highlights.length > 0 && (
        <section className="mt-10">
          <h2 className="eyebrow mb-4 text-[var(--report-accent)]">Highlights</h2>
          <ul className="grid gap-2 md:grid-cols-2">
            {report.highlights.map((h, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-white/80">
                <span className="mt-2 w-1.5 h-1.5 rounded-full bg-[var(--report-accent)] shrink-0" />
                <span>{h}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Headline KPIs */}
      {!isCustom && (
      <section className="mt-12">
        <h2 className="eyebrow mb-4">Headline metrics</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiTile label="Total revenue" value={fmtZar.format(k.total_revenue)} delta={k.deltas.total_revenue} hint="ZAR" />
          <KpiTile label="MRR" value={fmtZar.format(k.mrr)} delta={k.deltas.mrr} />
          <KpiTile label="Active subs" value={fmtNum.format(k.active_subs)} delta={k.deltas.active_subs} />
          <KpiTile label="Sessions" value={fmtNum.format(k.sessions)} delta={k.deltas.sessions} />
          <KpiTile label="Ad revenue" value={fmtZar.format(k.ad_revenue)} delta={k.deltas.ad_revenue} />
          <KpiTile label="IAP revenue" value={fmtZar.format(k.iap_revenue)} delta={k.deltas.iap_revenue} />
          <KpiTile label="Installs" value={fmtNum.format(k.installs)} delta={k.deltas.installs} />
          <KpiTile label="Outstanding" value={fmtZar.format(k.outstanding)} hint="invoiced, unpaid" />
        </div>
      </section>
      )}

      {/* Exec summary */}
      {!isCustom && report.exec_summary && (
      <section className="mt-12">
        <h2 className="eyebrow mb-4">Executive summary</h2>
        <div className="prose prose-invert max-w-none text-white/80 text-base leading-relaxed">
          {report.exec_summary.split('\n\n').map((p, i) => (
            <p key={i} className="mb-4">{p}</p>
          ))}
        </div>
      </section>
      )}

      {/* Series sparklines */}
      {!isCustom && report.series.length > 0 && (
        <section className="mt-12">
          <h2 className="eyebrow mb-4">Trend lines</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {report.series.map((s) => (
              <div key={s.metric} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs uppercase tracking-wider text-white/50 font-mono">{s.metric}</span>
                  <span className="text-xs text-white/40 font-mono">{s.series.length} pts</span>
                </div>
                <div className="text-[var(--report-accent)]">
                  <Sparkline values={pickSeries(report, s.metric)} width={300} height={56} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Per-property breakdown */}
      {!isCustom && report.properties.length > 0 && (
        <section className="mt-12">
          <h2 className="eyebrow mb-4">By property</h2>
          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02]">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-white/40 font-mono">
                <tr className="border-b border-white/10">
                  <th className="text-left py-3 px-4">Property</th>
                  <th className="text-right py-3 px-4">MRR</th>
                  <th className="text-right py-3 px-4">Subs</th>
                  <th className="text-right py-3 px-4">Sessions</th>
                  <th className="text-right py-3 px-4">Installs</th>
                  <th className="text-right py-3 px-4">Ad rev (ZAR)</th>
                  <th className="text-right py-3 px-4">IAP rev (ZAR)</th>
                </tr>
              </thead>
              <tbody>
                {report.properties.map((p) => (
                  <tr key={p.propertyId} className="border-b border-white/5">
                    <td className="py-3 px-4">
                      <div className="font-medium text-white">{p.name}</div>
                      <div className="text-xs text-white/40 font-mono uppercase">{p.type}</div>
                    </td>
                    <td className="text-right tabular-nums py-3 px-4">{fmtZar.format(p.kpis.mrr ?? 0)}</td>
                    <td className="text-right tabular-nums py-3 px-4">{fmtNum.format(p.kpis.active_subs ?? 0)}</td>
                    <td className="text-right tabular-nums py-3 px-4">{fmtNum.format(p.kpis.sessions ?? 0)}</td>
                    <td className="text-right tabular-nums py-3 px-4">{fmtNum.format(p.kpis.installs ?? 0)}</td>
                    <td className="text-right tabular-nums py-3 px-4">{fmtZar.format(p.kpis.ad_revenue ?? 0)}</td>
                    <td className="text-right tabular-nums py-3 px-4">{fmtZar.format(p.kpis.iap_revenue ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer className="mt-16 pt-8 border-t border-white/10 text-xs text-white/40 font-mono flex flex-wrap items-center justify-between gap-4">
        <span>Generated {new Date().toLocaleDateString('en-ZA', { dateStyle: 'medium' })}</span>
        <span>Powered by Partners in Biz · partnersinbiz.online</span>
      </footer>

      <style>{`
        @media print {
          .report-view { background: white; color: black; }
          .report-view .bento-tile { border-color: rgba(0,0,0,0.12); background: rgba(0,0,0,0.02); }
          .report-view tr { border-color: rgba(0,0,0,0.08) !important; }
          .report-view .text-white\\/40, .report-view .text-white\\/30, .report-view .text-white\\/60, .report-view .text-white\\/80 {
            color: rgba(0,0,0,0.65) !important;
          }
          .report-view .border-white\\/10 { border-color: rgba(0,0,0,0.12) !important; }
        }
      `}</style>
    </article>
  )
}
