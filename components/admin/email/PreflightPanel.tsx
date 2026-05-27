// components/admin/email/PreflightPanel.tsx
//
// Renders a PreflightReport in the broadcast / sequence step editor.
// Shows a green "Ready to send" or red "X issues need attention" banner,
// then a tabbed view of Errors / Warnings / Info with each issue's title,
// detail, recommendation, and "Fix in editor" jump.
'use client'

import { useEffect, useMemo, useState } from 'react'
import { PageTabs } from '@/components/ui/AppFoundation'
import type { PreflightIssue, PreflightReport, PreflightSeverity } from '@/lib/email/preflight'

interface Props {
  report: PreflightReport | null
  loading: boolean
  onRefresh: () => void
  /**
   * Jump to a tab in the parent editor. The PreflightPanel decides which
   * tab to jump to based on the issue's `location` (e.g. 'subject' → content
   * tab, 'body' → content tab, 'from' → content tab, anything else → schedule).
   */
  onJumpToTab?: (tab: 'content' | 'audience' | 'schedule') => void
}

const SEVERITY_TABS: Array<{ key: PreflightSeverity; label: string }> = [
  { key: 'error', label: 'Errors' },
  { key: 'warning', label: 'Warnings' },
  { key: 'info', label: 'Info' },
]

function tabForLocation(location?: string): 'content' | 'audience' | 'schedule' {
  if (!location) return 'content'
  if (location.startsWith('audience')) return 'audience'
  return 'content'
}

export default function PreflightPanel({ report, loading, onRefresh, onJumpToTab }: Props) {
  const [activeTab, setActiveTab] = useState<PreflightSeverity>('error')

  const groups = useMemo(() => {
    const g: Record<PreflightSeverity, PreflightIssue[]> = { error: [], warning: [], info: [] }
    if (!report) return g
    for (const issue of report.issues) g[issue.severity].push(issue)
    return g
  }, [report])

  // Default tab to whichever section has any items (errors > warnings > info).
  useEffect(() => {
    if (!report) return
    if (groups.error.length > 0) setActiveTab('error')
    else if (groups.warning.length > 0) setActiveTab('warning')
    else if (groups.info.length > 0) setActiveTab('info')
  }, [report, groups])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-on-surface">Preflight checklist</h3>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-surface-container text-on-surface text-xs disabled:opacity-50"
        >
          {loading ? 'Running…' : 'Re-run'}
        </button>
      </div>

      {!report ? (
        <div className="rounded-xl border border-outline-variant bg-surface-container p-6 text-center text-sm text-on-surface-variant">
          {loading ? 'Running preflight…' : 'Click "Re-run" to scan this email.'}
        </div>
      ) : (
        <>
          {/* Top-line banner */}
          {report.pass ? (
            <div className="rounded-xl border border-emerald-400/50 bg-emerald-500/10 p-4">
              <p className="text-lg font-semibold text-emerald-300">Ready to send</p>
              <p className="text-xs text-emerald-200/80 mt-1">
                {report.warningCount} warning{report.warningCount === 1 ? '' : 's'} ·{' '}
                {report.infoCount} info note{report.infoCount === 1 ? '' : 's'}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-red-400/50 bg-red-500/10 p-4">
              <p className="text-lg font-semibold text-red-300">
                {report.errorCount} issue{report.errorCount === 1 ? '' : 's'} need attention
              </p>
              <p className="text-xs text-red-200/80 mt-1">
                Send is blocked until errors are resolved.{' '}
                {report.warningCount > 0 && (
                  <>· {report.warningCount} warning{report.warningCount === 1 ? '' : 's'}</>
                )}
              </p>
            </div>
          )}

          <PageTabs
            ariaLabel="Preflight severity"
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as PreflightSeverity)}
            tabs={SEVERITY_TABS.map((tab) => ({
              label: tab.label,
              value: tab.key,
              badge: groups[tab.key].length,
            }))}
          />

          <div className="space-y-2">
            {groups[activeTab].length === 0 ? (
              <p className="text-sm text-on-surface-variant italic px-2 py-4">
                No {activeTab === 'info' ? 'info notes' : activeTab + 's'}.
              </p>
            ) : (
              groups[activeTab].map((issue) => (
                <IssueCard key={`${issue.id}:${issue.location ?? ''}`} issue={issue} onJump={onJumpToTab} />
              ))
            )}
          </div>

          <p className="text-[11px] text-on-surface-variant">
            Scanned {new Date(report.scannedAt).toLocaleString()}
          </p>
        </>
      )}
    </div>
  )
}

const SEVERITY_STYLES: Record<PreflightSeverity, string> = {
  error: 'border-red-400/40 bg-red-500/5',
  warning: 'border-amber-400/40 bg-amber-500/5',
  info: 'border-sky-400/40 bg-sky-500/5',
}
const SEVERITY_TEXT: Record<PreflightSeverity, string> = {
  error: 'text-red-300',
  warning: 'text-amber-300',
  info: 'text-sky-300',
}

function IssueCard({
  issue,
  onJump,
}: {
  issue: PreflightIssue
  onJump?: (tab: 'content' | 'audience' | 'schedule') => void
}) {
  return (
    <div className={`rounded-lg border p-3 ${SEVERITY_STYLES[issue.severity]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className={`text-sm font-semibold ${SEVERITY_TEXT[issue.severity]}`}>
            {issue.title}
          </p>
          <p className="text-xs text-on-surface-variant mt-1">{issue.detail}</p>
          <p className="text-xs text-on-surface mt-2">
            <span className="font-medium">Fix:</span> {issue.recommendation}
          </p>
          {issue.location && (
            <p className="text-[10px] text-on-surface-variant mt-1 font-mono">
              {issue.location}
            </p>
          )}
        </div>
        {onJump && (
          <button
            onClick={() => onJump(tabForLocation(issue.location))}
            className="flex-none px-2 py-1 rounded bg-surface-container text-on-surface text-xs hover:bg-surface-container/80"
          >
            Fix in editor →
          </button>
        )}
      </div>
    </div>
  )
}
