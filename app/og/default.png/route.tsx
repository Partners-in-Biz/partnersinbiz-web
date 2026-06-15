import { ImageResponse } from 'next/og'
import { SITE } from '@/lib/seo/site'

export const runtime = 'edge'

export const dynamic = 'force-static'

const size = { width: 1200, height: 630 }

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          backgroundColor: '#0A0A0B', color: '#EDEDED',
          padding: '72px', justifyContent: 'space-between',
          backgroundImage:
            'radial-gradient(at 20% 20%, rgba(245, 166, 35, 0.18) 0px, transparent 50%), radial-gradient(at 80% 100%, rgba(124, 92, 255, 0.16) 0px, transparent 50%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: '#EDEDED', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, fontWeight: 700, fontFamily: 'monospace' }}>P</div>
          <div style={{ fontSize: 32, fontWeight: 500 }}>Partners in Biz</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ fontSize: 88, lineHeight: 1.05, letterSpacing: '-0.02em', maxWidth: 980 }}>
            Software your competitors will copy.
          </div>
          <div style={{ fontSize: 28, color: '#8B8B92' }}>
            Web · AI · Growth · Pretoria
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 24, color: '#8B8B92' }}>
          <div>{SITE.url.replace('https://', '')}</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: '#F5A623' }} />
            <span>Open for new work</span>
          </div>
        </div>
      </div>
    ),
    size
  )
}
