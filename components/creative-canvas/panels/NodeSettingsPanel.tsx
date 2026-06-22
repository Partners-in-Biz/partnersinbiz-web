'use client'

import { useState } from 'react'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'
import ModelPicker from '@/components/creative-canvas/panels/ModelPicker'
import { getCanvasModel } from '@/lib/creative-canvas/model-registry'
import type { CanvasModel } from '@/lib/creative-canvas/model-registry'
import type { CanvasNodeType } from '@/components/creative-canvas/nodes/ports'
import type { CreativeCanvasNode } from '@/lib/creative-canvas/types'

type Tab = 'configure' | 'review' | 'provenance' | 'export'

export interface NodeSettingsValues {
  model: string
  aspectRatio: string
  resolution: string
  quality: string
  duration: number
  generateAudio: boolean
  batch: number
}

export interface NodeSettingsPanelProps {
  open: boolean
  node: CreativeCanvasNode | null
  presentationType: CanvasNodeType | null
  values: NodeSettingsValues
  prompt: string
  generating: boolean
  canGenerate: boolean
  onPromptChange: (value: string) => void
  onModelSelect: (modelId: string) => void
  onChange: (patch: Partial<NodeSettingsValues>) => void
  onGenerate: () => void
  onClose: () => void
  onExport?: () => void
}

const ASPECT_RATIOS = ['1:1', '9:16', '16:9', '4:5', '3:2']
const RESOLUTIONS = ['1k', '2k', '4k']
const QUALITIES = ['Draft', 'Standard', 'High']
const DURATIONS = [4, 8, 15]

function kindFor(presentationType: CanvasNodeType | null): CanvasModel['kind'] {
  switch (presentationType) {
    case 'video_generator':
      return 'video'
    case 'voice_generator':
    case 'voiceover':
    case 'change_voice':
      return 'audio'
    case 'llm_assistant':
    case 'prompt':
    case 'translate':
      return 'text'
    default:
      return 'image'
  }
}

const labelStyle: React.CSSProperties = { fontSize: 12, color: canvasTheme.textMuted, fontWeight: 600 }
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderBottom: `1px solid ${canvasTheme.border}` }

function Pill({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'good' | 'warn' | 'bad' }) {
  const bg = tone === 'good' ? '#3ddc97' : tone === 'warn' ? '#ffb547' : tone === 'bad' ? '#ff6b6b' : canvasTheme.surfaceRaised
  const color = tone === 'muted' ? canvasTheme.textMuted : canvasTheme.accentText
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: bg, color }}>{children}</span>
}

function Segmented<T extends string | number>({ options, value, onChange }: { options: T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {options.map((option) => {
        const active = option === value
        return (
          <button
            key={String(option)}
            type="button"
            onClick={() => onChange(option)}
            style={{
              padding: '4px 8px',
              borderRadius: 7,
              fontSize: 12,
              fontWeight: 600,
              border: `1px solid ${active ? canvasTheme.accent : canvasTheme.border}`,
              background: active ? `${canvasTheme.accent}1f` : canvasTheme.surface,
              color: active ? canvasTheme.accent : canvasTheme.text,
              cursor: 'pointer',
            }}
          >
            {String(option)}
          </button>
        )
      })}
    </div>
  )
}

/** Higgsfield-style slide-in node settings. Configure is the default; the
 *  enterprise layer (Review / Provenance / Export) is tucked into tabs. */
export default function NodeSettingsPanel(props: NodeSettingsPanelProps) {
  const { open, node, presentationType, values, prompt, generating, canGenerate, onPromptChange, onModelSelect, onChange, onGenerate, onClose, onExport } = props
  const [tab, setTab] = useState<Tab>('configure')
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const kind = kindFor(presentationType)
  const isVideo = kind === 'video'
  const model = getCanvasModel(values.model)
  const creditCost = model?.creditCost
  const review = node?.review

  return (
    <div
      aria-hidden={!open}
      style={{
        position: 'absolute',
        top: 12,
        right: open ? 12 : -360,
        bottom: 12,
        width: 320,
        transition: 'right 180ms ease',
        background: canvasTheme.surface,
        border: `1px solid ${canvasTheme.border}`,
        borderRadius: 14,
        boxShadow: canvasTheme.nodeShadow,
        color: canvasTheme.text,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 6,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: `1px solid ${canvasTheme.border}` }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{node?.title ?? 'Node settings'}</span>
        <button type="button" aria-label="Close settings" onClick={onClose} style={{ background: 'transparent', border: 'none', color: canvasTheme.textMuted, cursor: 'pointer', fontSize: 16 }}>×</button>
      </div>

      <div style={{ display: 'flex', gap: 4, padding: '8px 10px', borderBottom: `1px solid ${canvasTheme.border}` }}>
        {(['configure', 'review', 'provenance', 'export'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: '5px 6px',
              borderRadius: 7,
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'capitalize',
              border: 'none',
              background: tab === t ? canvasTheme.surfaceRaised : 'transparent',
              color: tab === t ? canvasTheme.text : canvasTheme.textMuted,
              cursor: 'pointer',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {tab === 'configure' ? (
          <>
            <div style={{ paddingBottom: 10, borderBottom: `1px solid ${canvasTheme.border}` }}>
              <textarea
                value={prompt}
                onChange={(event) => onPromptChange(event.target.value)}
                placeholder="Describe what you want to create…"
                aria-label="Generation prompt"
                rows={4}
                style={{
                  resize: 'vertical',
                  width: '100%',
                  background: canvasTheme.bg,
                  border: `1px solid ${canvasTheme.border}`,
                  borderRadius: 8,
                  color: canvasTheme.text,
                  fontSize: 13,
                  padding: 8,
                }}
              />
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>Model</span>
              <button
                type="button"
                onClick={() => setModelPickerOpen((v) => !v)}
                style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '4px 10px', borderRadius: 7, border: `1px solid ${canvasTheme.border}`, background: canvasTheme.surfaceRaised, color: canvasTheme.text, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                {model?.label ?? values.model ?? 'Select model'}
              </button>
            </div>
            {modelPickerOpen ? (
              <div style={{ margin: '8px 0', border: `1px solid ${canvasTheme.border}`, borderRadius: 10, padding: 8, background: canvasTheme.bg }}>
                <ModelPicker
                  kind={kind}
                  selectedModelId={values.model}
                  onSelect={(id) => {
                    onModelSelect(id)
                    setModelPickerOpen(false)
                  }}
                />
              </div>
            ) : null}

            <div style={rowStyle}>
              <span style={labelStyle}>Aspect ratio</span>
              <Segmented options={ASPECT_RATIOS} value={values.aspectRatio} onChange={(v) => onChange({ aspectRatio: v })} />
            </div>

            {isVideo ? (
              <>
                <div style={rowStyle}>
                  <span style={labelStyle}>Duration (s)</span>
                  <Segmented options={DURATIONS} value={values.duration} onChange={(v) => onChange({ duration: v })} />
                </div>
                <div style={rowStyle}>
                  <span style={labelStyle}>Generate audio</span>
                  <button
                    type="button"
                    onClick={() => onChange({ generateAudio: !values.generateAudio })}
                    style={{ padding: '4px 12px', borderRadius: 7, fontSize: 12, fontWeight: 700, border: `1px solid ${values.generateAudio ? canvasTheme.accent : canvasTheme.border}`, background: values.generateAudio ? `${canvasTheme.accent}1f` : canvasTheme.surface, color: values.generateAudio ? canvasTheme.accent : canvasTheme.textMuted, cursor: 'pointer' }}
                  >
                    {values.generateAudio ? 'On' : 'Off'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={rowStyle}>
                  <span style={labelStyle}>Resolution</span>
                  <Segmented options={RESOLUTIONS} value={values.resolution} onChange={(v) => onChange({ resolution: v })} />
                </div>
                <div style={rowStyle}>
                  <span style={labelStyle}>Quality</span>
                  <Segmented options={QUALITIES} value={values.quality} onChange={(v) => onChange({ quality: v })} />
                </div>
              </>
            )}

            <div style={rowStyle}>
              <span style={labelStyle}>Batch size</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button type="button" aria-label="Decrease batch" onClick={() => onChange({ batch: Math.max(1, values.batch - 1) })} style={stepBtn}>−</button>
                <span style={{ width: 18, textAlign: 'center' }}>{values.batch}</span>
                <button type="button" aria-label="Increase batch" onClick={() => onChange({ batch: Math.min(4, values.batch + 1) })} style={stepBtn}>+</button>
              </div>
            </div>

            <button
              type="button"
              onClick={onGenerate}
              disabled={!canGenerate || generating}
              style={{ marginTop: 14, width: '100%', height: 38, borderRadius: 9, border: 'none', background: canvasTheme.accent, color: canvasTheme.accentText, fontWeight: 700, fontSize: 14, cursor: !canGenerate || generating ? 'default' : 'pointer', opacity: !canGenerate || generating ? 0.5 : 1 }}
            >
              {generating ? 'Generating…' : `Generate${typeof creditCost === 'number' ? `  ✦ ${creditCost}` : ''}`}
            </button>
          </>
        ) : null}

        {tab === 'review' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={rowStyle}><span style={labelStyle}>Review status</span><Pill tone={review?.status === 'passed' ? 'good' : review?.status === 'blocked' ? 'bad' : review?.status === 'warning' ? 'warn' : 'muted'}>{review?.status ?? 'not required'}</Pill></div>
            <div style={rowStyle}><span style={labelStyle}>Brand</span><Pill tone={review?.brandStatus === 'passed' ? 'good' : review?.brandStatus === 'blocked' ? 'bad' : 'muted'}>{review?.brandStatus ?? 'unknown'}</Pill></div>
            <div style={rowStyle}><span style={labelStyle}>Rights</span><Pill tone={review?.rightsStatus === 'cleared' ? 'good' : review?.rightsStatus === 'blocked' ? 'bad' : 'muted'}>{review?.rightsStatus ?? 'unknown'}</Pill></div>
            <div style={rowStyle}><span style={labelStyle}>Synthetic media disclosed</span><Pill tone={review?.syntheticMediaDisclosure ? 'good' : 'muted'}>{review?.syntheticMediaDisclosure ? 'yes' : 'no'}</Pill></div>
          </div>
        ) : null}

        {tab === 'provenance' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={rowStyle}><span style={labelStyle}>Provider</span><span style={{ fontSize: 12 }}>{node?.provider?.key ?? '—'}</span></div>
            <div style={rowStyle}><span style={labelStyle}>Model</span><span style={{ fontSize: 12 }}>{node?.provider?.model ?? '—'}</span></div>
            <div style={rowStyle}><span style={labelStyle}>Output kind</span><span style={{ fontSize: 12 }}>{node?.output?.kind ?? '—'}</span></div>
            <div style={rowStyle}><span style={labelStyle}>Asset</span><span style={{ fontSize: 12 }}>{node?.output?.url ? 'attached' : 'none'}</span></div>
          </div>
        ) : null}

        {tab === 'export' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 12, color: canvasTheme.textMuted }}>Export the reviewed output downstream (social draft, campaign asset, document block).</p>
            <button type="button" onClick={onExport} disabled={!onExport || !node?.output?.url} style={{ height: 34, borderRadius: 8, border: `1px solid ${canvasTheme.border}`, background: canvasTheme.surfaceRaised, color: canvasTheme.text, fontWeight: 600, fontSize: 13, cursor: onExport && node?.output?.url ? 'pointer' : 'default', opacity: onExport && node?.output?.url ? 1 : 0.5 }}>
              Export output
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

const stepBtn: React.CSSProperties = {
  width: 24,
  height: 24,
  display: 'grid',
  placeItems: 'center',
  borderRadius: 6,
  border: `1px solid ${canvasTheme.border}`,
  background: canvasTheme.surfaceRaised,
  color: canvasTheme.text,
  cursor: 'pointer',
}
