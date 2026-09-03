import { render, screen } from '@testing-library/react'
import { Card, MetricCard } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { HudChip, SignalMeter, GlassBar, LiveDot } from '@/components/ui/HudChip'
import { ModuleShell } from '@/components/ui/ModuleShell'
import { CssAurora } from '@/components/ui/atmosphere/CssAurora'
import { NeuralField } from '@/components/ui/atmosphere/NeuralField'

describe('Card / MetricCard Studio re-skin', () => {
  it('Card emits st-panel', () => {
    const { container } = render(<Card>Body</Card>)
    expect(container.firstChild).toHaveClass('st-panel')
    expect(screen.getByText('Body')).toBeInTheDocument()
  })

  it('MetricCard uses sc-tiny label and st-num value; accent is ignored', () => {
    const { container } = render(
      <MetricCard label="Revenue" value="R12k" accent sub="vs last week" />,
    )
    expect(container.firstChild).toHaveClass('st-panel')
    expect(screen.getByText('Revenue')).toHaveClass('sc-tiny')
    expect(screen.getByText('R12k')).toHaveClass('st-num')
    expect(screen.getByText('R12k').className).not.toMatch(/accent|pib-accent/)
  })
})

describe('StatCard Studio re-skin', () => {
  it('emits st-panel with sc-tiny label and st-num value', () => {
    const { container } = render(<StatCard label="Open deals" value={14} accent="violet" />)
    expect(container.firstChild).toHaveClass('st-panel')
    expect(screen.getByText('Open deals')).toHaveClass('sc-tiny')
    expect(screen.getByText('14')).toHaveClass('st-num')
  })
})

describe('HudChip Studio re-skin', () => {
  it('emits st-status markup', () => {
    render(<HudChip tone="success">Live</HudChip>)
    const el = screen.getByText('Live')
    expect(el).toHaveClass('st-status')
    expect(el).toHaveClass('sc-tiny')
    expect(el).toHaveClass('st-status--success')
  })

  it('maps warning tones', () => {
    render(<HudChip tone="warn">Attention</HudChip>)
    expect(screen.getByText('Attention')).toHaveClass('st-status--warning')
  })

  it('deprecated SignalMeter and LiveDot render nothing', () => {
    const { container: a } = render(<SignalMeter />)
    const { container: b } = render(<LiveDot />)
    expect(a).toBeEmptyDOMElement()
    expect(b).toBeEmptyDOMElement()
  })

  it('deprecated GlassBar renders children without chrome', () => {
    const { container } = render(<GlassBar><span>Inside</span></GlassBar>)
    expect(screen.getByText('Inside')).toBeInTheDocument()
    expect(container.querySelector('.pib-glass-bar')).toBeNull()
  })
})

describe('ModuleShell Studio re-skin', () => {
  it('renders children in Stack without atmosphere', () => {
    const { container } = render(
      <ModuleShell tier={2} accent="violet" showScanlines fieldTestId="field">
        <p>Workspace</p>
      </ModuleShell>,
    )
    expect(screen.getByText('Workspace')).toBeInTheDocument()
    expect(container.querySelector('.st-stack')).not.toBeNull()
    expect(container.querySelector('.pib-aurora-fallback')).toBeNull()
    expect(container.querySelector('.pib-neural-field')).toBeNull()
    expect(container.querySelector('.pib-scanlines')).toBeNull()
  })
})

describe('atmosphere stubs', () => {
  it('CssAurora and NeuralField return null', () => {
    const { container: a } = render(<CssAurora />)
    const { container: b } = render(<NeuralField />)
    expect(a).toBeEmptyDOMElement()
    expect(b).toBeEmptyDOMElement()
  })
})
