'use client'
import { useState } from 'react'

interface Props {
  orgId: string
  orgSlug: string
  /** ID of the pixel config record to patch. */
  configId: string
  initial: {
    pixelCode?: string
    hasCapiToken: boolean
    testEventCode?: string
  }
}

function buildSnippet(pixelCode: string): string {
  return `<script>
!function (w, d, t) {
  w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
  ttq.load('${pixelCode}');
  ttq.page();
}(window, document, 'ttq');
</script>`
}

export function TiktokPixelConfigPanel({
  orgId,
  orgSlug: _orgSlug,
  configId,
  initial,
}: Props) {
  const [pixelCode, setPixelCode] = useState(initial.pixelCode ?? '')
  const [capiToken, setCapiToken] = useState('')
  const [testEventCode, setTestEventCode] = useState(initial.testEventCode ?? '')
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
  const [snippetOpen, setSnippetOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  async function save() {
    setSaving(true)
    setSaveStatus('idle')
    setSaveError('')

    const tiktok: Record<string, unknown> = {
      pixelId: pixelCode, // stored as pixelId per AdPixelConfigPlatform; "Pixel Code" is the TikTok UI name
      testEventCode: testEventCode || undefined,
    }
    if (capiToken) {
      tiktok.capiToken = capiToken
    }

    const res = await fetch(`/api/v1/ads/pixel-configs/${configId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Org-Id': orgId },
      body: JSON.stringify({ tiktok }),
    })
    const body = await res.json()
    setSaving(false)
    if (!body.success) {
      setSaveStatus('error')
      setSaveError(body.error ?? 'Unknown error')
    } else {
      setSaveStatus('success')
      setCapiToken('') // clear after save — never redisplay plaintext
    }
  }

  async function copySnippet() {
    if (!pixelCode) return
    await navigator.clipboard.writeText(buildSnippet(pixelCode))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section className="space-y-4 rounded border border-white/10 p-5">
      <header>
        <h2 className="text-lg font-semibold">TikTok Pixel &amp; Events API</h2>
        <p className="text-sm text-white/60 mt-0.5">
          Server-side conversion tracking via TikTok Events API. Token encrypted at rest.
          Use a separate Events API token from TikTok Events Manager → Settings → Generate Token.
        </p>
      </header>

      {/* Pixel Code */}
      <div className="space-y-1">
        <label className="text-sm text-white/80" htmlFor="tt-pixel-code">
          TikTok Pixel ID (Pixel Code)
        </label>
        <input
          id="tt-pixel-code"
          className="w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          placeholder="e.g. ABCDEFGHIJK (from TikTok Events Manager)"
          value={pixelCode}
          onChange={(e) => setPixelCode(e.target.value)}
          aria-label="TikTok Pixel ID"
        />
        <p className="text-xs text-white/40">
          Found in TikTok Events Manager → Data Sources → your pixel → Settings.
        </p>
      </div>

      {/* Events API Token */}
      <div className="space-y-1">
        <label className="text-sm text-white/80" htmlFor="tt-capi-token">
          Events API Token
        </label>
        <input
          id="tt-capi-token"
          type="password"
          className="w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          placeholder={
            initial.hasCapiToken
              ? 'Set ✓ — enter new value to replace'
              : 'Not set'
          }
          value={capiToken}
          onChange={(e) => setCapiToken(e.target.value)}
          aria-label="Events API Token"
        />
        <p className="text-xs text-white/40">
          Generate in TikTok Events Manager → your pixel → Settings → Generate Token.
          Token is encrypted before storage and never returned in plaintext.
        </p>
      </div>

      {/* Test Event Code */}
      <div className="space-y-1">
        <label className="text-sm text-white/80" htmlFor="tt-test-code">
          Test Event Code{' '}
          <span className="text-white/40 font-normal">(optional — staging only)</span>
        </label>
        <input
          id="tt-test-code"
          className="w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          placeholder="e.g. TEST12345 from TikTok Events Manager → Test Events"
          value={testEventCode}
          onChange={(e) => setTestEventCode(e.target.value)}
          aria-label="Test Event Code"
        />
        <p className="text-xs text-white/40">
          When set, all server-side events include this code so TikTok routes them to
          Test Events. Remove before production go-live.
        </p>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          className="btn-pib-accent text-sm"
          onClick={save}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {saveStatus === 'success' && (
          <span className="text-sm text-emerald-400" role="status">
            ✓ Saved successfully
          </span>
        )}
        {saveStatus === 'error' && (
          <span className="text-sm text-red-400" role="alert">
            ✗ {saveError}
          </span>
        )}
      </div>

      {/* Installation Snippet */}
      <div className="border-t border-white/10 pt-4">
        <button
          className="flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors"
          onClick={() => setSnippetOpen((o) => !o)}
          aria-expanded={snippetOpen}
          aria-controls="tt-snippet-content"
        >
          <span>{snippetOpen ? '▾' : '▸'}</span>
          <span>Browser pixel installation snippet</span>
        </button>

        {snippetOpen && (
          <div id="tt-snippet-content" className="mt-3 space-y-2">
            {pixelCode ? (
              <>
                <p className="text-xs text-white/50">
                  Paste inside the <code>&lt;head&gt;</code> of every page. This loads
                  the TikTok browser pixel and fires a page view automatically.
                  Server-side Events API events are sent by PiB and do not require this
                  snippet — but both together enable deduplication via <code>event_id</code>.
                </p>
                <pre className="rounded bg-black/40 border border-white/10 p-3 text-xs text-white/80 overflow-x-auto whitespace-pre-wrap">
                  {buildSnippet(pixelCode)}
                </pre>
                <button
                  className="btn-pib-ghost text-xs"
                  onClick={copySnippet}
                  aria-label="Copy installation snippet"
                >
                  {copied ? '✓ Copied!' : 'Copy to clipboard'}
                </button>
              </>
            ) : (
              <p className="text-sm text-white/40 italic">
                Set the TikTok Pixel ID above to generate the install snippet
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
