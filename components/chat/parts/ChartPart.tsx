'use client'

import { useRef, type ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from 'recharts'
import type { ChartPart as ChartPartModel } from '@/lib/chat/parts'
import { PartStatusBox } from './status-box'

const SERIES_COLORS = [
  'var(--sc-accent)',
  'var(--sc-ink)',
  'var(--sc-ink-soft)',
  'var(--sc-line)',
] as const

function seriesColor(explicit: string | undefined, index: number): string {
  return explicit || SERIES_COLORS[index % SERIES_COLORS.length]
}

function csvEscape(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value)
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function chartToCsv(part: ChartPartModel): string {
  const keys = [part.x, ...part.series.map((item) => item.key)]
  const header = keys.join(',')
  const rows = part.data.map((row) => keys.map((key) => csvEscape(row[key])).join(','))
  return [header, ...rows].join('\n')
}

function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.click()
  URL.revokeObjectURL(href)
}

function exportSvgAsPng(svg: SVGSVGElement, filename: string) {
  const serializer = new XMLSerializer()
  const source = serializer.serializeToString(svg)
  const svgBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)
  const image = new Image()
  image.onload = () => {
    const canvas = document.createElement('canvas')
    const width = svg.clientWidth || Number(svg.getAttribute('width')) || 640
    const height = svg.clientHeight || Number(svg.getAttribute('height')) || 280
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      URL.revokeObjectURL(url)
      return
    }
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    canvas.toBlob((blob) => {
      URL.revokeObjectURL(url)
      if (blob) downloadBlob(blob, filename)
    }, 'image/png')
  }
  image.onerror = () => URL.revokeObjectURL(url)
  image.src = url
}

function ChartFrame({
  title,
  children,
  onPng,
  onCsv,
}: {
  title?: string
  children: ReactNode
  onPng: () => void
  onCsv: () => void
}) {
  return (
    <div data-testid="chart-part" className="my-2 overflow-hidden rounded-[6px] border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)]">
      {title && (
        <div className="border-b border-[var(--color-pib-line)] px-3 py-2 text-xs font-medium text-[var(--color-pib-text)]">
          {title}
        </div>
      )}
      <div className="px-2 py-3">{children}</div>
      <div className="flex flex-wrap gap-2 border-t border-[var(--color-pib-line)] px-3 py-2">
        <button
          type="button"
          onClick={onPng}
          className="inline-flex items-center rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-pib-text)] hover:border-primary/50"
        >
          PNG
        </button>
        <button
          type="button"
          onClick={onCsv}
          className="inline-flex items-center rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-pib-text)] hover:border-primary/50"
        >
          CSV
        </button>
      </div>
    </div>
  )
}

export function ChartPart({ part }: { part: ChartPartModel }) {
  const hostRef = useRef<HTMLDivElement | null>(null)

  if (!part.data.length) {
    return <PartStatusBox>No data</PartStatusBox>
  }

  const handleCsv = () => {
    downloadBlob(new Blob([chartToCsv(part)], { type: 'text/csv;charset=utf-8' }), `${part.title || 'chart'}.csv`)
  }
  const handlePng = () => {
    const svg = hostRef.current?.querySelector('svg')
    if (svg) exportSvgAsPng(svg, `${part.title || 'chart'}.png`)
  }

  const stackId = part.stacked ? 'stack' : undefined
  const pieData = part.data.map((row) => ({
    name: String(row[part.x] ?? ''),
    value: Number(row[part.series[0]?.key] ?? 0),
  }))

  return (
    <ChartFrame title={part.title} onPng={handlePng} onCsv={handleCsv}>
      <div ref={hostRef} className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height={280}>
          {part.kind === 'bar' ? (
            <BarChart data={part.data}>
              <CartesianGrid stroke="var(--sc-line)" strokeDasharray="3 3" />
              <XAxis dataKey={part.x} tick={{ fill: 'var(--sc-ink-soft)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'var(--sc-ink-soft)', fontSize: 11 }} unit={part.unit} />
              <Tooltip />
              {part.series.map((series, index) => (
                <Bar
                  key={series.key}
                  dataKey={series.key}
                  name={series.label ?? series.key}
                  fill={seriesColor(series.color, index)}
                  stackId={stackId}
                />
              ))}
            </BarChart>
          ) : part.kind === 'area' ? (
            <AreaChart data={part.data}>
              <CartesianGrid stroke="var(--sc-line)" strokeDasharray="3 3" />
              <XAxis dataKey={part.x} tick={{ fill: 'var(--sc-ink-soft)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'var(--sc-ink-soft)', fontSize: 11 }} unit={part.unit} />
              <Tooltip />
              {part.series.map((series, index) => (
                <Area
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  name={series.label ?? series.key}
                  stroke={seriesColor(series.color, index)}
                  fill={seriesColor(series.color, index)}
                  stackId={stackId}
                />
              ))}
            </AreaChart>
          ) : part.kind === 'pie' ? (
            <PieChart>
              <Tooltip />
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}>
                {pieData.map((_, index) => (
                  <Cell key={`slice-${index}`} fill={seriesColor(part.series[index]?.color, index)} />
                ))}
              </Pie>
            </PieChart>
          ) : part.kind === 'scatter' ? (
            <ScatterChart>
              <CartesianGrid stroke="var(--sc-line)" strokeDasharray="3 3" />
              <XAxis dataKey={part.x} tick={{ fill: 'var(--sc-ink-soft)', fontSize: 11 }} name={part.x} />
              <YAxis
                dataKey={part.series[0]?.key}
                tick={{ fill: 'var(--sc-ink-soft)', fontSize: 11 }}
                name={part.series[0]?.label ?? part.series[0]?.key}
                unit={part.unit}
              />
              <Tooltip />
              <Scatter
                data={part.data}
                name={part.series[0]?.label ?? part.series[0]?.key ?? 'series'}
                fill={seriesColor(part.series[0]?.color, 0)}
              />
            </ScatterChart>
          ) : (
            <LineChart data={part.data}>
              <CartesianGrid stroke="var(--sc-line)" strokeDasharray="3 3" />
              <XAxis dataKey={part.x} tick={{ fill: 'var(--sc-ink-soft)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'var(--sc-ink-soft)', fontSize: 11 }} unit={part.unit} />
              <Tooltip />
              {part.series.map((series, index) => (
                <Line
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  name={series.label ?? series.key}
                  stroke={seriesColor(series.color, index)}
                  dot={false}
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  )
}
