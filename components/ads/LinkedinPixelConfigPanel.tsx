'use client'
import { useState } from 'react'

interface Props {
  orgId: string
  orgSlug: string
  /** ID of the pixel config record to patch. */
  configId: string
  initial: {
    pixelId?: string
    hasCapiToken: boolean
    testEventCode?: string
  }
}

function buildSnippet(pixelId: string): string {
  return `<script type="text/javascript">
_linkedin_partner_id = "${pixelId}";
window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
window._linkedin_data_partner_ids.push(_linkedin_partner_id);
</script>
<script type="text/javascript">
(function(l) {
if (!l){window.lintrk = function(a,b){window.lintrk.q.push([a,b])};
window.lintrk.q=[]}
var s = document.getElementsByTagName("script")[0];
var b = document.createElement("script");
b.type = "text/javascript";b.async = true;
b.src = "https://snap.licdn.com/li.lms-analytics/insight.min.js";
s.parentNode.insertBefore(b, s);})(window.lintrk);
</script>
<noscript>
<img height="1" width="1" style="display:none;" alt="" src="https://px.ads.linkedin.com/collect/?pid=${pixelId}&fmt=gif" />
</noscript>`
}

export function LinkedinPixelConfigPanel({
  orgId,
  orgSlug: _orgSlug,
  configId,
  initial,
}: Props) {
  const [pixelId, setPixelId] = useState(initial.pixelId ?? '')
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

    const linkedin: Record<string, unknown> = {
      pixelId,
      testEventCode: testEventCode || undefined,
    }
    if (capiToken) {
      linkedin.capiToken = capiToken
    }

    const res = await fetch(`/api/v1/ads/pixel-configs/${configId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Org-Id': orgId },
      body: JSON.stringify({ linkedin }),
    })
    const body = await res.json()
    setSaving(false)
    if (!body.success) {
      setSaveStatus('error')
      setSaveError(body.error ?? 'Unknown error')
    } else {
      setSaveStatus('success')
      setCapiToken('') // clear after save
    }
  }

  async function copySnippet() {
    if (!pixelId) return
    await navigator.clipboard.writeText(buildSnippet(pixelId))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section className="space-y-4 rounded border border-white/10 p-5">
      <header>
        <h2 className="text-lg font-semibold">LinkedIn Insight Tag</h2>
        <p className="text-sm text-white/60 mt-0.5">
          Server-side conversion tracking via rw_conversions CAPI. Token encrypted at rest.
        </p>
      </header>

      {/* Insight Tag Partner ID */}
      <div className="space-y-1">
        <label className="text-sm text-white/80" htmlFor="li-pixel-id">
          Insight Tag Partner ID
        </label>
        <input
          id="li-pixel-id"
          className="w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          placeholder="Numeric partner ID from LinkedIn Campaign Manager"
          value={pixelId}
          onChange={(e) => setPixelId(e.target.value)}
          aria-label="Insight Tag Partner ID"
        />
        <p className="text-xs text-white/40">
          Found in LinkedIn Campaign Manager → Account Assets → Insight Tag.
        </p>
      </div>

      {/* CAPI Token */}
      <div className="space-y-1">
        <label className="text-sm text-white/80" htmlFor="li-capi-token">
          CAPI Token (rw_conversions scope)
        </label>
        <input
          id="li-capi-token"
          type="password"
          className="w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          placeholder={
            initial.hasCapiToken
              ? 'Set ✓ (enter new value to replace)'
              : 'Not set'
          }
          value={capiToken}
          onChange={(e) => setCapiToken(e.target.value)}
          aria-label="CAPI Token"
        />
        <p className="text-xs text-white/40">
          Token is encrypted before storage and never returned in plaintext.
        </p>
      </div>

      {/* Test Event Code */}
      <div className="space-y-1">
        <label className="text-sm text-white/80" htmlFor="li-test-code">
          Test Event Code{' '}
          <span className="text-white/40 font-normal">(optional)</span>
        </label>
        <input
          id="li-test-code"
          className="w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          placeholder="LinkedIn test event code for staging"
          value={testEventCode}
          onChange={(e) => setTestEventCode(e.target.value)}
          aria-label="Test Event Code"
        />
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
          aria-controls="li-snippet-content"
        >
          <span>{snippetOpen ? '▾' : '▸'}</span>
          <span>Installation snippet</span>
        </button>

        {snippetOpen && (
          <div id="li-snippet-content" className="mt-3 space-y-2">
            {pixelId ? (
              <>
                <pre className="rounded bg-black/40 border border-white/10 p-3 text-xs text-white/80 overflow-x-auto whitespace-pre-wrap">
                  {buildSnippet(pixelId)}
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
                Set the Insight Tag Partner ID above to generate the install snippet
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
