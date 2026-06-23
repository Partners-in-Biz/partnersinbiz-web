// lib/reports/pdf.tsx
//
// Server-side PDF generator for a Report using @react-pdf/renderer (US-175 PDF
// download). Builds a branded document from the Report data — both standard KPI
// reports and custom section-based reports. Returns a Buffer the route streams.

import React from 'react'
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import type { Report, ReportKpis, ReportSection } from './types'
import { metricValue } from './custom'

const fmtZar = (n: number) =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(n)
const fmtNum = (n: number) => new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 }).format(n)

const styles = StyleSheet.create({
  page: { backgroundColor: '#0A0A0B', color: '#EDEDED', padding: 40, fontSize: 10, fontFamily: 'Helvetica' },
  eyebrow: { fontSize: 8, letterSpacing: 2, color: '#9a9a9a', textTransform: 'uppercase', marginBottom: 6 },
  h1: { fontSize: 26, marginBottom: 4 },
  period: { fontSize: 11, color: '#9a9a9a', marginBottom: 24 },
  sectionTitle: { fontSize: 9, letterSpacing: 1.5, color: '#9a9a9a', textTransform: 'uppercase', marginTop: 20, marginBottom: 8 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  kpiTile: { width: '46%', margin: 4, padding: 10, borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)' },
  kpiLabel: { fontSize: 7, letterSpacing: 1.5, color: '#9a9a9a', textTransform: 'uppercase', marginBottom: 4 },
  kpiValue: { fontSize: 16 },
  para: { fontSize: 10, lineHeight: 1.5, color: '#cccccc', marginBottom: 8 },
  bullet: { fontSize: 10, color: '#dddddd', marginBottom: 4 },
  tableRow: { flexDirection: 'row', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingVertical: 4 },
  tableCellL: { flex: 1, fontSize: 9 },
  tableCellR: { width: 90, fontSize: 9, textAlign: 'right' },
  footer: { marginTop: 30, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: 8, color: '#666' },
})

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kpiTile}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue}>{value}</Text>
    </View>
  )
}

function StandardBody({ k, report }: { k: ReportKpis; report: Report }) {
  return (
    <>
      {report.highlights.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Highlights</Text>
          {report.highlights.map((h, i) => (
            <Text key={i} style={styles.bullet}>• {h}</Text>
          ))}
        </>
      )}
      <Text style={styles.sectionTitle}>Headline metrics</Text>
      <View style={styles.kpiGrid}>
        <KpiTile label="Total revenue" value={fmtZar(k.total_revenue)} />
        <KpiTile label="MRR" value={fmtZar(k.mrr)} />
        <KpiTile label="Active subs" value={fmtNum(k.active_subs)} />
        <KpiTile label="Sessions" value={fmtNum(k.sessions)} />
        <KpiTile label="Ad revenue" value={fmtZar(k.ad_revenue)} />
        <KpiTile label="Outstanding" value={fmtZar(k.outstanding)} />
      </View>
      {report.exec_summary ? (
        <>
          <Text style={styles.sectionTitle}>Executive summary</Text>
          {report.exec_summary.split('\n\n').map((p, i) => (
            <Text key={i} style={styles.para}>{p}</Text>
          ))}
        </>
      ) : null}
    </>
  )
}

function CustomSection({ section, k }: { section: ReportSection; k: ReportKpis }) {
  switch (section.type) {
    case 'page_break':
      return <View break />
    case 'metric': {
      const metric = section.dataSource?.metric
      const raw = section.dataSource?.kind === 'manual'
        ? section.dataSource.value ?? 0
        : metric ? metricValue(k, metric) : 0
      return (
        <View style={styles.kpiGrid}>
          <KpiTile label={section.title ?? metric ?? 'Metric'} value={fmtNum(raw)} />
        </View>
      )
    }
    case 'table': {
      const rows = section.dataSource?.kind === 'manual'
        ? (section.dataSource.rows ?? []).map((r) => ({ label: r.label, value: r.value }))
        : (section.dataSource?.metrics ?? []).map((m) => ({ label: m, value: fmtNum(metricValue(k, m)) }))
      return (
        <>
          {section.title ? <Text style={styles.sectionTitle}>{section.title}</Text> : null}
          {rows.map((r, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={styles.tableCellL}>{r.label}</Text>
              <Text style={styles.tableCellR}>{r.value}</Text>
            </View>
          ))}
        </>
      )
    }
    case 'chart': {
      // PDF charts are summarised as a labelled value (the renderer has no SVG path support here).
      const metric = section.dataSource?.metric
      const val = metric ? metricValue(k, metric) : 0
      return (
        <>
          {section.title ? <Text style={styles.sectionTitle}>{section.title}</Text> : null}
          <Text style={styles.para}>{metric ?? 'series'}: {fmtNum(val)}</Text>
        </>
      )
    }
    case 'text':
    default:
      return (
        <>
          {section.title ? <Text style={styles.sectionTitle}>{section.title}</Text> : null}
          {(section.body ?? '').split('\n\n').map((p, i) => (
            <Text key={i} style={styles.para}>{p}</Text>
          ))}
        </>
      )
  }
}

function ReportPdf({ report }: { report: Report }) {
  const k = report.kpis
  return (
    <Document title={`${report.brand.orgName} report`}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.eyebrow}>
          {report.category && report.category !== 'monthly' ? `${report.category} report` : 'Monthly performance report'}
        </Text>
        <Text style={styles.h1}>{report.brand.orgName}</Text>
        <Text style={styles.period}>{report.period.start}  to  {report.period.end}</Text>

        {report.custom && report.custom.sections.length > 0 ? (
          report.custom.sections.map((s) => <CustomSection key={s.id} section={s} k={k} />)
        ) : (
          <StandardBody k={k} report={report} />
        )}

        <Text style={styles.footer}>Generated by Partners in Biz · partnersinbiz.online</Text>
      </Page>
    </Document>
  )
}

export async function renderReportPdf(report: Report): Promise<Buffer> {
  return renderToBuffer(<ReportPdf report={report} />)
}
