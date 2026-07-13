'use client'
import type { ChatContextAction, ContextAttentionSummary } from '@/lib/chat-context/types'
export function ContextAttentionMoment({ attention, onAction, pendingActionId }: { attention: ContextAttentionSummary; onAction?: (action: ChatContextAction) => void; pendingActionId?: string }) {
  return <div className="rounded-lg border border-amber-400/25 bg-amber-400/[0.06] p-3"><p className="text-xs font-semibold text-on-surface">{attention.label}</p>{attention.detail && <p className="mt-1 text-[10px] text-on-surface-variant">{attention.detail}</p>}<div className="mt-2 flex gap-2">{attention.actions?.map((action) => action.href && !action.method ? <a key={action.id} href={action.href} className="text-xs text-primary">{action.label}</a> : <button key={action.id} type="button" disabled={pendingActionId === action.id} onClick={() => onAction?.(action)} className="rounded-md bg-primary px-3 py-1.5 text-xs text-on-primary disabled:opacity-50">{action.label}</button>)}</div></div>
}
