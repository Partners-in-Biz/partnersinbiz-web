import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import type { ContentBrief } from '@/lib/seo/content-brief'

const BRAND = '#4F46E5'
const LIGHT = '#EEF2FF'
const GREY = '#6B7280'
const DARK = '#111827'

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, color: DARK, padding: 32 },
  header: { backgroundColor: BRAND, borderRadius: 6, padding: '12 16', marginBottom: 16 },
  headerTitle: { fontSize: 15, color: '#fff', fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  headerSub: { fontSize: 9, color: '#C7D2FE' },
  sectionTitle: { fontSize: 8, color: GREY, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6, marginTop: 14 },
  metaBox: { backgroundColor: LIGHT, borderRadius: 4, padding: '8 10', marginBottom: 4 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  metaKey: { color: GREY, fontSize: 8, width: '32%' },
  metaVal: { fontSize: 8, fontFamily: 'Helvetica-Bold', width: '68%' },
  h2: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: BRAND, marginTop: 8, marginBottom: 3 },
  bullet: { fontSize: 8.5, color: DARK, marginBottom: 2, marginLeft: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  chip: { backgroundColor: LIGHT, borderRadius: 3, padding: '2 6', fontSize: 8, color: BRAND, marginRight: 4, marginBottom: 4 },
  faqQ: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 5 },
  faqA: { fontSize: 8, color: GREY, marginLeft: 8 },
  footer: { marginTop: 'auto', borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 7, color: GREY },
})

export function BriefReportPDF({ brief, clientName }: { brief: ContentBrief; clientName?: string }) {
  const date = new Date(brief.generatedAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <Document title={`Content Brief — ${brief.keyword}`} author="Partners in Biz">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <Text style={s.headerTitle}>Content Brief</Text>
          <Text style={s.headerSub}>{brief.keyword}{clientName ? `  ·  ${clientName}` : ''}</Text>
        </View>

        <View style={s.metaBox}>
          <View style={s.metaRow}><Text style={s.metaKey}>Title tag</Text><Text style={s.metaVal}>{brief.title}</Text></View>
          <View style={s.metaRow}><Text style={s.metaKey}>Meta description</Text><Text style={s.metaVal}>{brief.metaDescription}</Text></View>
          <View style={s.metaRow}><Text style={s.metaKey}>Search intent</Text><Text style={s.metaVal}>{brief.searchIntent}</Text></View>
          <View style={s.metaRow}><Text style={s.metaKey}>Word count</Text><Text style={s.metaVal}>{brief.recommendedWordCount}</Text></View>
          {brief.targetUrl ? <View style={s.metaRow}><Text style={s.metaKey}>Target URL</Text><Text style={s.metaVal}>{brief.targetUrl}</Text></View> : null}
        </View>

        <Text style={s.sectionTitle}>H2 Outline</Text>
        {brief.h2Outline.map((sec, i) => (
          <View key={i}>
            <Text style={s.h2}>{i + 1}. {sec.heading}</Text>
            {sec.talkingPoints.map((p, j) => (
              <Text key={j} style={s.bullet}>• {p}</Text>
            ))}
          </View>
        ))}

        <Text style={s.sectionTitle}>Semantic Keywords</Text>
        <View style={s.chipRow}>
          {brief.semanticKeywords.map((k, i) => (
            <Text key={i} style={s.chip}>{k}</Text>
          ))}
        </View>

        <Text style={s.sectionTitle}>FAQs</Text>
        {brief.faqs.map((f, i) => (
          <View key={i}>
            <Text style={s.faqQ}>{f.question}</Text>
            <Text style={s.faqA}>{f.answerHint}</Text>
          </View>
        ))}

        <View style={s.footer}>
          <Text style={s.footerText}>Partners in Biz — partnersinbiz.online</Text>
          <Text style={s.footerText}>Generated {date}</Text>
        </View>
      </Page>
    </Document>
  )
}
