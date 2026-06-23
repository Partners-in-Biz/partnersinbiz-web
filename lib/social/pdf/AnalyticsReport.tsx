import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

export interface PlatformBreakdownRow {
  platform: string
  posts: number
  impressions: number
  likes: number
  comments: number
  shares: number
  clicks: number
}

export interface TopPostRow {
  content: string
  platforms: string
  impressions: number
  engagements: number
  likes: number
  clicks: number
}

export interface AnalyticsSummary {
  totalPublished: number
  impressions: number
  reach: number
  engagements: number
  likes: number
  comments: number
  shares: number
  clicks: number
  engagementRate: number
}

export interface SocialAnalyticsReportProps {
  orgName: string
  rangeLabel: string
  generatedAt: string
  summary: AnalyticsSummary
  platforms: PlatformBreakdownRow[]
  topPosts: TopPostRow[]
}

const BRAND = '#4F46E5'
const LIGHT = '#EEF2FF'
const GREY = '#6B7280'
const DARK = '#111827'

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, color: DARK, padding: 32 },
  header: {
    backgroundColor: BRAND,
    borderRadius: 6,
    padding: '12 16',
    marginBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: { flex: 1 },
  headerTitle: { fontSize: 16, color: '#fff', fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  headerSub: { fontSize: 9, color: '#C7D2FE' },
  headerRight: { alignItems: 'flex-end' },
  headerRange: { fontSize: 11, color: '#fff', fontFamily: 'Helvetica-Bold' },
  headerRangeLabel: { fontSize: 8, color: '#C7D2FE' },

  sectionTitle: { fontSize: 8, color: GREY, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6, marginTop: 14 },

  row: { flexDirection: 'row', gap: 8 },
  statCard: { flex: 1, backgroundColor: LIGHT, borderRadius: 4, padding: '8 10' },
  statValue: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: BRAND },
  statLabel: { fontSize: 7.5, color: GREY, marginTop: 2 },

  badgeRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  badge: { flex: 1, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 4, padding: '7 10', alignItems: 'center' },
  badgeValue: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: DARK },
  badgeLabel: { fontSize: 7.5, color: GREY, marginTop: 1 },

  table: { marginTop: 4 },
  tableHeader: { flexDirection: 'row', backgroundColor: BRAND, borderRadius: '2 2 0 0', padding: '4 6' },
  tableRow: { flexDirection: 'row', padding: '3 6', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  tableRowAlt: { flexDirection: 'row', padding: '3 6', backgroundColor: LIGHT, borderBottomWidth: 1, borderBottomColor: '#E0E7FF' },
  thFirst: { width: '30%', color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 7.5 },
  thNum: { flex: 1, color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 7.5, textAlign: 'right' },
  tdFirst: { width: '30%', fontSize: 7.5 },
  tdNum: { flex: 1, fontSize: 7.5, textAlign: 'right', color: GREY },

  thContent: { width: '46%', color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 7.5 },
  tdContent: { width: '46%', fontSize: 7.5 },

  empty: { fontSize: 8, color: GREY, marginTop: 4 },

  footer: { marginTop: 'auto', borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 7, color: GREY },
})

function fmt(n: number, decimals = 0) {
  return n.toLocaleString('en-US', { maximumFractionDigits: decimals })
}

function titleCase(p: string) {
  return p.charAt(0).toUpperCase() + p.slice(1)
}

export function SocialAnalyticsReportPDF(props: SocialAnalyticsReportProps) {
  const { orgName, rangeLabel, generatedAt, summary, platforms, topPosts } = props
  const genDate = new Date(generatedAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
  const genTime = new Date(generatedAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })

  return (
    <Document title={`Social Analytics Report — ${orgName}`} author="Partners in Biz">
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <Text style={s.headerTitle}>Social Analytics Report</Text>
            <Text style={s.headerSub}>{orgName}  ·  Partners in Biz</Text>
            <Text style={[s.headerSub, { marginTop: 4 }]}>{genDate}</Text>
          </View>
          <View style={s.headerRight}>
            <Text style={s.headerRange}>{rangeLabel}</Text>
            <Text style={s.headerRangeLabel}>Reporting period</Text>
          </View>
        </View>

        {/* Summary totals */}
        <Text style={s.sectionTitle}>Summary</Text>
        <View style={s.row}>
          <View style={s.statCard}><Text style={s.statValue}>{fmt(summary.totalPublished)}</Text><Text style={s.statLabel}>Published Posts</Text></View>
          <View style={s.statCard}><Text style={s.statValue}>{fmt(summary.impressions)}</Text><Text style={s.statLabel}>Impressions</Text></View>
          <View style={s.statCard}><Text style={s.statValue}>{fmt(summary.reach)}</Text><Text style={s.statLabel}>Reach</Text></View>
          <View style={s.statCard}><Text style={s.statValue}>{fmt(summary.engagements)}</Text><Text style={s.statLabel}>Engagements</Text></View>
          <View style={s.statCard}><Text style={s.statValue}>{summary.engagementRate.toFixed(2)}%</Text><Text style={s.statLabel}>Engagement Rate</Text></View>
        </View>

        {/* Engagement breakdown */}
        <Text style={s.sectionTitle}>Engagement Breakdown</Text>
        <View style={s.badgeRow}>
          <View style={s.badge}><Text style={s.badgeValue}>{fmt(summary.likes)}</Text><Text style={s.badgeLabel}>Likes</Text></View>
          <View style={s.badge}><Text style={s.badgeValue}>{fmt(summary.comments)}</Text><Text style={s.badgeLabel}>Comments</Text></View>
          <View style={s.badge}><Text style={s.badgeValue}>{fmt(summary.shares)}</Text><Text style={s.badgeLabel}>Shares</Text></View>
          <View style={s.badge}><Text style={s.badgeValue}>{fmt(summary.clicks)}</Text><Text style={s.badgeLabel}>Clicks</Text></View>
        </View>

        {/* Platform breakdown */}
        <Text style={s.sectionTitle}>Platform Breakdown</Text>
        {platforms.length > 0 ? (
          <View style={s.table}>
            <View style={s.tableHeader}>
              <Text style={s.thFirst}>Platform</Text>
              <Text style={s.thNum}>Posts</Text>
              <Text style={s.thNum}>Impressions</Text>
              <Text style={s.thNum}>Likes</Text>
              <Text style={s.thNum}>Comments</Text>
              <Text style={s.thNum}>Shares</Text>
              <Text style={s.thNum}>Clicks</Text>
            </View>
            {platforms.map((p, i) => (
              <View key={i} style={i % 2 === 0 ? s.tableRow : s.tableRowAlt}>
                <Text style={s.tdFirst}>{titleCase(p.platform)}</Text>
                <Text style={s.tdNum}>{fmt(p.posts)}</Text>
                <Text style={s.tdNum}>{fmt(p.impressions)}</Text>
                <Text style={s.tdNum}>{fmt(p.likes)}</Text>
                <Text style={s.tdNum}>{fmt(p.comments)}</Text>
                <Text style={s.tdNum}>{fmt(p.shares)}</Text>
                <Text style={s.tdNum}>{fmt(p.clicks)}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={s.empty}>No platform data for this period.</Text>
        )}

        {/* Top posts */}
        <Text style={s.sectionTitle}>Top Posts</Text>
        {topPosts.length > 0 ? (
          <View style={s.table}>
            <View style={s.tableHeader}>
              <Text style={s.thContent}>Content</Text>
              <Text style={s.thNum}>Platforms</Text>
              <Text style={s.thNum}>Impressions</Text>
              <Text style={s.thNum}>Engagements</Text>
              <Text style={s.thNum}>Clicks</Text>
            </View>
            {topPosts.map((p, i) => (
              <View key={i} style={i % 2 === 0 ? s.tableRow : s.tableRowAlt}>
                <Text style={s.tdContent}>{p.content}</Text>
                <Text style={s.tdNum}>{p.platforms || '—'}</Text>
                <Text style={s.tdNum}>{fmt(p.impressions)}</Text>
                <Text style={s.tdNum}>{fmt(p.engagements)}</Text>
                <Text style={s.tdNum}>{fmt(p.clicks)}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={s.empty}>No post-level analytics for this period.</Text>
        )}

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerText}>Partners in Biz — partnersinbiz.online</Text>
          <Text style={s.footerText}>Generated {genDate} at {genTime}</Text>
        </View>
      </Page>
    </Document>
  )
}
