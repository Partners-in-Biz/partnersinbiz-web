'use client'

import type { DocumentBlock } from '@/lib/client-documents/types'
import { BlockFrame } from './BlockFrame'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

type SeriesPoint = { name: string; value: number }
type RingData = { value: number; max: number; label?: string }
type Content =
  | { kind: 'bar'; title?: string; data: SeriesPoint[]; options?: { horizontal?: boolean } }
  | { kind: 'pie'; title?: string; data: SeriesPoint[]; options?: { donut?: boolean } }
  | { kind: 'line'; title?: string; data: SeriesPoint[] }
  | { kind: 'progress_ring'; title?: string; data: RingData }

/** Studio chart series (brand 11.11): terracotta primary, ink-soft rest. */
function seriesFill(index: number) {
  return index === 0 ? 'var(--sc-accent)' : 'var(--sc-ink-soft)'
}

const AXIS_TICK = {
  className: 'sc-tiny',
  fill: 'var(--sc-ink-soft)',
  fontSize: 11,
} as const

export function ChartBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const content = block.content as Content | undefined

  if (!content?.kind) return null

  return (
    <BlockFrame block={block} index={index}>
      {block.title && (
        <h2 className="mb-6 text-2xl font-semibold text-[var(--doc-accent)] md:text-4xl">
          {block.title}
        </h2>
      )}
      <div
        className="h-80 w-full"
        style={{
          background: 'var(--doc-surface)',
          border: '1px solid var(--doc-border)',
          borderRadius: '0.75rem',
          padding: '1rem',
        }}
      >
        {content.kind === 'progress_ring' ? (
          <ProgressRing
            value={content.data.value}
            max={content.data.max}
            label={content.data.label}
            color="var(--sc-accent)"
          />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {content.kind === 'bar' ? (
              <BarChart
                data={content.data}
                layout={content.options?.horizontal ? 'vertical' : 'horizontal'}
              >
                <CartesianGrid stroke="var(--sc-line)" strokeWidth={1} />
                <XAxis
                  dataKey={content.options?.horizontal ? 'value' : 'name'}
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  type={content.options?.horizontal ? 'number' : 'category'}
                />
                <YAxis
                  dataKey={content.options?.horizontal ? 'name' : undefined}
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  type={content.options?.horizontal ? 'category' : 'number'}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--sc-surface)',
                    border: '1px solid var(--sc-line)',
                    borderRadius: 6,
                    color: 'var(--sc-ink)',
                  }}
                />
                <Bar dataKey="value">
                  {content.data.map((_, i) => (
                    <Cell key={i} fill={seriesFill(i)} />
                  ))}
                </Bar>
              </BarChart>
            ) : content.kind === 'pie' ? (
              <PieChart>
                <Pie
                  data={content.data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={content.options?.donut ? 60 : 0}
                  outerRadius={100}
                >
                  {content.data.map((_, i) => (
                    <Cell key={i} fill={seriesFill(i)} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'var(--sc-surface)',
                    border: '1px solid var(--sc-line)',
                    borderRadius: 6,
                    color: 'var(--sc-ink)',
                  }}
                />
              </PieChart>
            ) : (
              <LineChart data={content.data}>
                <CartesianGrid stroke="var(--sc-line)" strokeWidth={1} />
                <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--sc-surface)',
                    border: '1px solid var(--sc-line)',
                    borderRadius: 6,
                    color: 'var(--sc-ink)',
                  }}
                />
                <Line
                  dataKey="value"
                  stroke="var(--sc-accent)"
                  strokeWidth={2}
                  dot={{ fill: 'var(--sc-accent)' }}
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </BlockFrame>
  )
}

function ProgressRing({
  value,
  max,
  label,
  color,
}: {
  value: number
  max: number
  label?: string
  color: string
}) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  const r = 80
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 200 200" className="h-full w-full">
      <circle cx={100} cy={100} r={r} stroke="var(--sc-line)" strokeWidth={14} fill="none" />
      <circle
        cx={100}
        cy={100}
        r={r}
        stroke={color}
        strokeWidth={14}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        transform="rotate(-90 100 100)"
      />
      <text
        x={100}
        y={100}
        dy="0.3em"
        textAnchor="middle"
        fontSize={28}
        fontWeight={500}
        fill="var(--sc-ink)"
        className="st-num"
      >
        {Math.round(pct * 100)}%
      </text>
      {label && (
        <text x={100} y={140} textAnchor="middle" className="sc-tiny" fill="var(--sc-ink-soft)">
          {label}
        </text>
      )}
    </svg>
  )
}
