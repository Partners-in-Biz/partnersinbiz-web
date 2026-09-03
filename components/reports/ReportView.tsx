// components/reports/ReportView.tsx
//
// Branded server component that renders a Report. Used at /reports/[token]
// (public viewer). Print-friendly. Studio paper/ink CSS classes only (no React
// kit import: components/studio/index.tsx still lacks "use client").

import type { Report, ReportKpis, ReportSection, ReportMetricKey } from '@/lib/reports/types'
import '@/components/studio/studio-ui.css'

const fmtZar = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 0,
})

const fmtNum = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 })

function fmtPct(p: number | null) {
  if (p === null) return 'n/a'
  const sign = p >= 0 ? '+' : ''
  return `${sign}${p.toFixed(1)}%`
}

function deltaTone(p: number | null): 'success' | 'danger' | 'info' | undefined {
  if (p === null) return undefined
  if (p > 0) return 'success'
  if (p < 0) return 'danger'
  return 'info'
}

interface KpiTileProps {
  label: string
  value: string
  delta?: number | null
  hint?: string
}

function KpiTile({ label, value, delta, hint }: KpiTileProps) {
  const tone = delta !== undefined ? deltaTone(delta ?? null) : undefined
  return (
    <div className="st-panel st-panel--flat">
      <p className="sc-tiny">{label}</p>
      <p className="st-num mt-2" style={{ fontSize: '1.75rem' }}>{value}</p>
      {(delta !== undefined || hint) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {delta !== undefined ? (
            <span className={`st-status sc-tiny${tone ? ` st-status--${tone}` : ''}`}>
              {fmtPct(delta ?? null)} vs prior
            </span>
          ) : null}
          {hint ? <span className="sc-body" style={{ fontSize: '0.875rem' }}>{hint}</span> : null}
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
    <svg width={width} height={height} aria-hidden="true" style={{ color: 'var(--sc-accent)' }}>
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

function CustomSectionView({ section, report }: { section: ReportSection; report: Report }) {
  const k = report.kpis
  if (section.type === 'page_break') {
    return <div className="report-page-break mt-12 border-t border-[var(--sc-line)]" />
  }
  if (section.type === 'text') {
    return (
      <section className="mt-12">
        {section.title ? <h2 className="st-title">{section.title}</h2> : null}
        <div className="sc-body mt-4 max-w-none">
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
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <KpiTile label={section.title ?? section.dataSource?.metric ?? 'Metric'} value={fmtNum.format(val)} />
        </div>
      </section>
    )
  }
  if (section.type === 'chart') {
    const metric = section.dataSource?.metric ?? section.dataSource?.series ?? ''
    return (
      <section className="mt-12">
        {section.title ? <h2 className="st-title">{section.title}</h2> : null}
        <div className="st-panel st-panel--flat mt-4">
          <Sparkline values={pickSeries(report, metric)} width={420} height={64} />
        </div>
      </section>
    )
  }
  const rows = section.dataSource?.kind === 'manual'
    ? (section.dataSource.rows ?? []).map((r) => ({ label: r.label, value: r.value }))
    : (section.dataSource?.metrics ?? []).map((m) => ({ label: m, value: fmtNum.format(metricVal(k, m)) }))
  return (
    <section className="mt-12">
      {section.title ? <h2 className="st-title">{section.title}</h2> : null}
      <div className="mt-4">
        <table className="st-table">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="sc-tiny">{r.label}</td>
                <td className="st-num text-right">{r.value}</td>
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
    <article className="report-view">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--sc-line)] pb-8">
        <div>
          <p className="sc-tiny">
            {report.type === 'monthly' ? 'Monthly performance report' : `${report.type} report`}
          </p>
          <h1 className="sc-article__h2 mt-2">{report.brand.orgName}</h1>
          <p className="sc-body mt-2">
            {report.period.start} to {report.period.end}
            <span className="sc-tiny"> · {report.period.tz}</span>
          </p>
        </div>
        <div className="text-right">
          {report.brand.orgLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={report.brand.orgLogoUrl} alt="" className="inline-block h-10 opacity-90" />
          ) : null}
          <p className="sc-tiny mt-3">Partners in Biz · Studio report</p>
        </div>
      </header>

      {isCustom && report.custom!.sections.map((s) => (
        <CustomSectionView key={s.id} section={s} report={report} />
      ))}

      {!isCustom && report.highlights.length > 0 && (
        <section className="mt-10">
          <h2 className="st-title">Highlights</h2>
          <ul className="mt-4 grid gap-2 md:grid-cols-2">
            {report.highlights.map((h, i) => (
              <li key={i} className="sc-body flex items-start gap-3">
                <span
                  className="mt-2 shrink-0"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--sc-accent)',
                  }}
                  aria-hidden
                />
                <span>{h}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!isCustom && (
        <section className="mt-12">
          <h2 className="st-title">Headline metrics</h2>
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
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

      {!isCustom && report.exec_summary && (
        <section className="mt-12">
          <h2 className="st-title">Executive summary</h2>
          <div className="sc-body mt-4 max-w-none">
            {report.exec_summary.split('\n\n').map((p, i) => (
              <p key={i} className="mb-4">{p}</p>
            ))}
          </div>
        </section>
      )}

      {!isCustom && report.series.length > 0 && (
        <section className="mt-12">
          <h2 className="st-title">Trend lines</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {report.series.map((s) => (
              <div key={s.metric} className="st-panel st-panel--flat">
                <div className="mb-3 flex items-center justify-between">
                  <span className="sc-tiny">{s.metric}</span>
                  <span className="sc-tiny">{s.series.length} pts</span>
                </div>
                <Sparkline values={pickSeries(report, s.metric)} width={300} height={56} />
              </div>
            ))}
          </div>
        </section>
      )}

      {!isCustom && report.properties.length > 0 && (
        <section className="mt-12">
          <h2 className="st-title">By property</h2>
          <div className="mt-4">
            <table className="st-table">
              <thead>
                <tr>
                  <th>Property</th>
                  <th className="text-right">MRR</th>
                  <th className="text-right">Subs</th>
                  <th className="text-right">Sessions</th>
                  <th className="text-right">Installs</th>
                  <th className="text-right">Ad rev (ZAR)</th>
                  <th className="text-right">IAP rev (ZAR)</th>
                </tr>
              </thead>
              <tbody>
                {report.properties.map((p) => (
                  <tr key={p.propertyId}>
                    <td>
                      <div>{p.name}</div>
                      <div className="sc-tiny">{p.type}</div>
                    </td>
                    <td className="st-num text-right">{fmtZar.format(p.kpis.mrr ?? 0)}</td>
                    <td className="st-num text-right">{fmtNum.format(p.kpis.active_subs ?? 0)}</td>
                    <td className="st-num text-right">{fmtNum.format(p.kpis.sessions ?? 0)}</td>
                    <td className="st-num text-right">{fmtNum.format(p.kpis.installs ?? 0)}</td>
                    <td className="st-num text-right">{fmtZar.format(p.kpis.ad_revenue ?? 0)}</td>
                    <td className="st-num text-right">{fmtZar.format(p.kpis.iap_revenue ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--sc-line)] pt-8">
        <span className="sc-tiny">Generated {new Date().toLocaleDateString('en-ZA', { dateStyle: 'medium' })}</span>
        <span className="sc-tiny">Powered by Partners in Biz · partnersinbiz.online</span>
      </footer>

      <style>{`
        @media print {
          .report-view { background: white; color: black; }
          .report-view .st-panel {
            border-color: rgba(0,0,0,0.12);
            background: white;
            box-shadow: none;
          }
        }
      `}</style>
    </article>
  )
}
