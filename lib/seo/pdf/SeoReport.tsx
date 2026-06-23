import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'

export interface SeoReportData {
  clientName: string
  siteUrl: string
  logoDataUrl?: string
  brandColor?: string
  dateRange: { from: string; to: string }
  generatedAt: string
  traffic: { impressions: number; clicks: number; ctr: number; avgPosition: number }
  trafficDelta?: { impressions: number; clicks: number; avgPosition: number } | null
  rankings: { tracked: number; top3: number; top10: number; ranking: number }
  backlinks: { total: number; referringDomains: number; newThisMonth: number; domainAuthority: number | null }
  topKeywords: { keyword: string; position: number | null; impressions: number; clicks: number }[]
  topPages: { url: string; impressions: number; clicks: number; avgPosition: number }[]
  sections: { traffic: boolean; rankings: boolean; backlinks: boolean }
}

const GREY = '#6B7280'
const DARK = '#111827'

function styles(brand: string) {
  const light = '#EEF2FF'
  return StyleSheet.create({
    page: { fontFamily: 'Helvetica', fontSize: 9, color: DARK, padding: 32 },
    header: { backgroundColor: brand, borderRadius: 6, padding: '14 16', marginBottom: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    logo: { width: 34, height: 34, borderRadius: 4, objectFit: 'contain', backgroundColor: '#fff' },
    headerTitle: { fontSize: 16, color: '#fff', fontFamily: 'Helvetica-Bold' },
    headerSub: { fontSize: 9, color: '#E5E7EB', marginTop: 2 },
    headerRange: { fontSize: 8, color: '#E5E7EB', textAlign: 'right' },
    sectionTitle: { fontSize: 8, color: GREY, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6, marginTop: 14 },
    row: { flexDirection: 'row', gap: 8 },
    statCard: { flex: 1, backgroundColor: light, borderRadius: 4, padding: '8 10' },
    statValue: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: brand },
    statLabel: { fontSize: 7.5, color: GREY, marginTop: 2 },
    statDelta: { fontSize: 7, marginTop: 1 },
    badgeRow: { flexDirection: 'row', gap: 8 },
    badge: { flex: 1, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 4, padding: '7 10', alignItems: 'center' },
    badgeValue: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: DARK },
    badgeLabel: { fontSize: 7.5, color: GREY, marginTop: 1 },
    tableHeader: { flexDirection: 'row', backgroundColor: brand, borderRadius: '2 2 0 0', padding: '4 6' },
    tableRow: { flexDirection: 'row', padding: '3 6', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
    th: { color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 7.5 },
    thKeyword: { width: '46%' },
    thNum: { flex: 1, textAlign: 'right' },
    tdKeyword: { width: '46%', fontSize: 7.5 },
    tdNum: { flex: 1, fontSize: 7.5, textAlign: 'right', color: GREY },
    footer: { marginTop: 'auto', borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between' },
    footerText: { fontSize: 7, color: GREY },
  })
}

function fmt(n: number, d = 0) {
  return n.toLocaleString('en-US', { maximumFractionDigits: d })
}
function pct(n: number) {
  return (n * 100).toFixed(1) + '%'
}
function delta(n: number, invert = false) {
  const good = invert ? n < 0 : n > 0
  const sign = n > 0 ? '+' : ''
  return { text: `${sign}${fmt(n, 1)}`, color: n === 0 ? GREY : good ? '#059669' : '#DC2626' }
}

export function SeoReportPDF({ data }: { data: SeoReportData }) {
  const brand = data.brandColor && /^#[0-9a-f]{6}$/i.test(data.brandColor) ? data.brandColor : '#4F46E5'
  const s = styles(brand)
  const dr = `${new Date(data.dateRange.from).toLocaleDateString('en-ZA')} – ${new Date(data.dateRange.to).toLocaleDateString('en-ZA')}`
  const gen = new Date(data.generatedAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <Document title={`SEO Report — ${data.clientName}`} author="Partners in Biz">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View style={s.headerLeft}>
            {data.logoDataUrl ? <Image style={s.logo} src={data.logoDataUrl} /> : null}
            <View>
              <Text style={s.headerTitle}>SEO Performance Report</Text>
              <Text style={s.headerSub}>{data.clientName}  ·  {data.siteUrl}</Text>
            </View>
          </View>
          <Text style={s.headerRange}>{dr}</Text>
        </View>

        {data.sections.traffic && (
          <>
            <Text style={s.sectionTitle}>Traffic</Text>
            <View style={s.row}>
              <View style={s.statCard}>
                <Text style={s.statValue}>{fmt(data.traffic.impressions)}</Text>
                <Text style={s.statLabel}>Impressions</Text>
                {data.trafficDelta ? <Text style={[s.statDelta, { color: delta(data.trafficDelta.impressions).color }]}>{delta(data.trafficDelta.impressions).text}</Text> : null}
              </View>
              <View style={s.statCard}>
                <Text style={s.statValue}>{fmt(data.traffic.clicks)}</Text>
                <Text style={s.statLabel}>Clicks</Text>
                {data.trafficDelta ? <Text style={[s.statDelta, { color: delta(data.trafficDelta.clicks).color }]}>{delta(data.trafficDelta.clicks).text}</Text> : null}
              </View>
              <View style={s.statCard}><Text style={s.statValue}>{pct(data.traffic.ctr)}</Text><Text style={s.statLabel}>CTR</Text></View>
              <View style={s.statCard}>
                <Text style={s.statValue}>{fmt(data.traffic.avgPosition, 1)}</Text>
                <Text style={s.statLabel}>Avg Position</Text>
                {data.trafficDelta ? <Text style={[s.statDelta, { color: delta(data.trafficDelta.avgPosition, true).color }]}>{delta(data.trafficDelta.avgPosition).text}</Text> : null}
              </View>
            </View>
          </>
        )}

        {data.sections.rankings && (
          <>
            <Text style={s.sectionTitle}>Rankings</Text>
            <View style={s.badgeRow}>
              <View style={s.badge}><Text style={s.badgeValue}>{data.rankings.tracked}</Text><Text style={s.badgeLabel}>Tracked</Text></View>
              <View style={s.badge}><Text style={s.badgeValue}>{data.rankings.top3}</Text><Text style={s.badgeLabel}>Top 3</Text></View>
              <View style={s.badge}><Text style={s.badgeValue}>{data.rankings.top10}</Text><Text style={s.badgeLabel}>Top 10</Text></View>
              <View style={s.badge}><Text style={s.badgeValue}>{data.rankings.ranking}</Text><Text style={s.badgeLabel}>Ranking</Text></View>
            </View>

            {data.topKeywords.length > 0 && (
              <>
                <Text style={s.sectionTitle}>Top Keywords</Text>
                <View>
                  <View style={s.tableHeader}>
                    <Text style={[s.th, s.thKeyword]}>Keyword</Text>
                    <Text style={[s.th, s.thNum]}>Position</Text>
                    <Text style={[s.th, s.thNum]}>Impressions</Text>
                    <Text style={[s.th, s.thNum]}>Clicks</Text>
                  </View>
                  {data.topKeywords.slice(0, 15).map((k, i) => (
                    <View key={i} style={s.tableRow}>
                      <Text style={s.tdKeyword}>{k.keyword}</Text>
                      <Text style={s.tdNum}>{k.position != null ? fmt(k.position, 1) : '—'}</Text>
                      <Text style={s.tdNum}>{fmt(k.impressions)}</Text>
                      <Text style={s.tdNum}>{fmt(k.clicks)}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </>
        )}

        {data.sections.backlinks && (
          <>
            <Text style={s.sectionTitle}>Backlinks & Authority</Text>
            <View style={s.row}>
              <View style={s.statCard}><Text style={s.statValue}>{fmt(data.backlinks.total)}</Text><Text style={s.statLabel}>Backlinks</Text></View>
              <View style={s.statCard}><Text style={s.statValue}>{fmt(data.backlinks.referringDomains)}</Text><Text style={s.statLabel}>Referring Domains</Text></View>
              <View style={s.statCard}><Text style={s.statValue}>+{fmt(data.backlinks.newThisMonth)}</Text><Text style={s.statLabel}>New This Month</Text></View>
              <View style={s.statCard}><Text style={s.statValue}>{data.backlinks.domainAuthority != null ? fmt(data.backlinks.domainAuthority) : '—'}</Text><Text style={s.statLabel}>Domain Authority</Text></View>
            </View>
          </>
        )}

        <View style={s.footer}>
          <Text style={s.footerText}>Prepared by Partners in Biz — partnersinbiz.online</Text>
          <Text style={s.footerText}>Generated {gen}</Text>
        </View>
      </Page>
    </Document>
  )
}
