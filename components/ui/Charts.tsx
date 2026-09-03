'use client'

import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from 'recharts'

// ── Studio chart tokens (brand 11.11) ─────────────────────────────────────
// Ink line on paper, terracotta for the primary series, ink-soft for the rest.
// Hairline grid, .sc-tiny axes. No <defs> gradients, no area fills.

const COLORS = {
  primary: 'var(--sc-accent)',
  series: 'var(--sc-ink)',
  rest: 'var(--sc-ink-soft)',
  grid: 'var(--sc-line)',
  text: 'var(--sc-ink)',
  textDim: 'var(--sc-ink-soft)',
}

/** Primary slice terracotta; remaining slices ink-soft. */
const DONUT_PALETTE = [COLORS.primary, COLORS.rest, COLORS.rest, COLORS.rest, COLORS.rest, COLORS.rest, COLORS.rest]
const DEFAULT_CHART_WIDTH = 320

const AXIS_TICK = {
  className: 'sc-tiny',
  fill: COLORS.textDim,
  fontSize: 11,
} as const

// ── Custom Tooltip ───────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="st-panel !p-2 !shadow-none border border-[var(--sc-line)] text-[0.75rem]">
      {label && <p className="sc-tiny text-[var(--sc-ink-soft)] mb-1">{label}</p>}
      {payload.map((entry: any, i: number) => (
        <p key={i} className="sc-body text-[var(--sc-ink)]" style={{ color: entry.color }}>
          {entry.name}: {formatter ? formatter(entry.value) : entry.value.toLocaleString()}
        </p>
      ))}
    </div>
  )
}

// ── Stat Card with inline mini chart ─────────────────────────────────────

interface StatCardWithChartProps {
  label: string
  value: string | number
  sub?: string
  trend?: 'up' | 'down'
  accent?: boolean
  data?: { value: number }[]
  chartType?: 'bar' | 'area'
}

export function StatCardWithChart({
  label, value, sub, trend, accent, data, chartType = 'bar',
}: StatCardWithChartProps) {
  return (
    <div className="pib-stat-card flex items-end justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="sc-tiny mb-2">
          {label}
        </p>
        <p
          className="st-num text-[1.75rem] mb-1"
          style={{ color: accent ? COLORS.primary : COLORS.text }}
        >
          {value}
        </p>
        {sub && (
          <p className="sc-body text-[0.75rem] text-[var(--sc-ink-soft)] flex items-center gap-1">
            {trend === 'up' && <span className="text-[var(--st-success)] text-xs">↑</span>}
            {trend === 'down' && <span className="text-[var(--st-danger)] text-xs">↓</span>}
            {sub}
          </p>
        )}
      </div>
      {data && data.length > 0 && (
        <div className="w-24 h-14 shrink-0">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 96, height: 56 }}>
            {chartType === 'area' ? (
              <LineChart data={data}>
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={COLORS.primary}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            ) : (
              <BarChart data={data}>
                <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                  {data.map((_, i) => (
                    <Cell
                      key={i}
                      fill={i === data.length - 1 ? COLORS.primary : COLORS.rest}
                    />
                  ))}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── Revenue-style Bar Chart ──────────────────────────────────────────────

interface RevenueBarChartProps {
  data: { label: string; value: number }[]
  target?: number
  valueFormatter?: (v: number) => string
  height?: number
  highlightLast?: boolean
}

export function RevenueBarChart({
  data, target, valueFormatter, height = 250, highlightLast = true,
}: RevenueBarChartProps) {
  const fmt = valueFormatter ?? ((v: number) => v.toLocaleString())

  return (
    <ResponsiveContainer width="100%" height={height} initialDimension={{ width: DEFAULT_CHART_WIDTH, height }}>
      <BarChart data={data} barCategoryGap="20%">
        <CartesianGrid vertical={false} stroke={COLORS.grid} strokeWidth={1} />
        <XAxis
          dataKey="label"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          tickFormatter={fmt}
          width={60}
        />
        <Tooltip content={<ChartTooltip formatter={fmt} />} cursor={false} />
        {target && (
          <ReferenceLine
            y={target}
            stroke={COLORS.rest}
            strokeDasharray="6 3"
            label={{
              value: fmt(target),
              position: 'right',
              fill: COLORS.textDim,
              fontSize: 10,
              className: 'sc-tiny',
            }}
          />
        )}
        <Bar dataKey="value" radius={[4, 4, 0, 0]} name="Revenue">
          {data.map((_, i) => (
            <Cell
              key={i}
              fill={highlightLast && i === data.length - 1 ? COLORS.primary : COLORS.rest}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Trend chart (line only — no area fill / gradients) ───────────────────

interface TrendAreaChartProps {
  data: { label: string; value: number }[]
  height?: number
  color?: string
  valueFormatter?: (v: number) => string
}

export function TrendAreaChart({
  data, height = 200, color = COLORS.primary, valueFormatter,
}: TrendAreaChartProps) {
  const fmt = valueFormatter ?? ((v: number) => v.toLocaleString())

  return (
    <ResponsiveContainer width="100%" height={height} initialDimension={{ width: DEFAULT_CHART_WIDTH, height }}>
      <LineChart data={data}>
        <CartesianGrid vertical={false} stroke={COLORS.grid} strokeWidth={1} />
        <XAxis
          dataKey="label"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          tickFormatter={fmt}
          width={50}
        />
        <Tooltip content={<ChartTooltip formatter={fmt} />} />
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={false}
          name="Value"
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ── Donut Chart ──────────────────────────────────────────────────────────

interface DonutChartProps {
  data: { name: string; value: number; color?: string }[]
  height?: number
  innerRadius?: number
  outerRadius?: number
  centerLabel?: string
  centerValue?: string | number
}

export function DonutChart({
  data, height = 220, innerRadius = 55, outerRadius = 80, centerLabel, centerValue,
}: DonutChartProps) {
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height} initialDimension={{ width: DEFAULT_CHART_WIDTH, height }}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={2}
            dataKey="value"
            strokeWidth={0}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color ?? DONUT_PALETTE[i % DONUT_PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      {(centerLabel || centerValue) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {centerValue && (
            <span className="st-num text-2xl text-[var(--sc-ink)]">{centerValue}</span>
          )}
          {centerLabel && (
            <span className="sc-tiny text-[var(--sc-ink-soft)]">{centerLabel}</span>
          )}
        </div>
      )}
      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2">
        {data.map((entry, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 shrink-0"
              style={{
                borderRadius: 2,
                background: entry.color ?? DONUT_PALETTE[i % DONUT_PALETTE.length],
              }}
            />
            <span className="sc-tiny text-[var(--sc-ink-soft)]">
              {entry.name} ({entry.value})
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Horizontal Bar Chart ─────────────────────────────────────────────────

interface HorizontalBarChartProps {
  data: { label: string; value: number; color?: string }[]
  height?: number
  valueFormatter?: (v: number) => string
}

export function HorizontalBarChart({
  data, height, valueFormatter,
}: HorizontalBarChartProps) {
  const fmt = valueFormatter ?? ((v: number) => v.toLocaleString())
  const chartHeight = height ?? Math.max(data.length * 40, 120)

  return (
    <ResponsiveContainer width="100%" height={chartHeight} initialDimension={{ width: DEFAULT_CHART_WIDTH, height: chartHeight }}>
      <BarChart data={data} layout="vertical" barCategoryGap="25%">
        <CartesianGrid horizontal={false} stroke={COLORS.grid} strokeWidth={1} />
        <XAxis
          type="number"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          tickFormatter={fmt}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ ...AXIS_TICK, fill: COLORS.text }}
          tickLine={false}
          axisLine={false}
          width={90}
        />
        <Tooltip content={<ChartTooltip formatter={fmt} />} cursor={false} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} name="Value">
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={entry.color ?? (i === 0 ? COLORS.primary : COLORS.rest)}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
