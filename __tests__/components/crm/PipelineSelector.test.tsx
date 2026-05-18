import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { PipelineSelector, PIPELINE_ALL_SENTINEL } from '@/components/crm/PipelineSelector'
import type { Pipeline } from '@/lib/pipelines/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: 'pipe-1',
    orgId: 'org-1',
    name: 'Sales',
    stages: [],
    isDefault: false,
    archived: false,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

const defaultPipeline = makePipeline({ id: 'pipe-default', name: 'Sales', isDefault: true })
const customPipeline  = makePipeline({ id: 'pipe-custom',  name: 'Renewals', isDefault: false })
const archivedPipeline = makePipeline({ id: 'pipe-archived', name: 'Old', archived: true })

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PipelineSelector', () => {
  const noop = jest.fn()

  beforeEach(() => jest.clearAllMocks())

  it('renders all non-archived pipelines', () => {
    render(
      <PipelineSelector
        pipelines={[defaultPipeline, customPipeline, archivedPipeline]}
        onChange={noop}
      />,
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    const texts = Array.from(select.options).map((o) => o.text)
    expect(texts.some((t) => t.includes('Sales'))).toBe(true)
    expect(texts.some((t) => t.includes('Renewals'))).toBe(true)
    // archived pipeline should NOT be visible
    expect(texts.some((t) => t.includes('Old'))).toBe(false)
  })

  it('marks the default pipeline with "(default)" suffix', () => {
    render(
      <PipelineSelector
        pipelines={[defaultPipeline, customPipeline]}
        onChange={noop}
      />,
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    const texts = Array.from(select.options).map((o) => o.text)
    expect(texts.some((t) => t.includes('(default)'))).toBe(true)
  })

  it('reflects selectedId in the select value', () => {
    render(
      <PipelineSelector
        pipelines={[defaultPipeline, customPipeline]}
        selectedId="pipe-custom"
        onChange={noop}
      />,
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('pipe-custom')
  })

  it('calls onChange with the selected pipeline id', () => {
    render(
      <PipelineSelector
        pipelines={[defaultPipeline, customPipeline]}
        selectedId="pipe-default"
        onChange={noop}
      />,
    )
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'pipe-custom' } })
    expect(noop).toHaveBeenCalledWith('pipe-custom')
  })

  it('prepends "All pipelines" option when includeAll is true', () => {
    render(
      <PipelineSelector
        pipelines={[defaultPipeline, customPipeline]}
        includeAll
        onChange={noop}
      />,
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    const texts = Array.from(select.options).map((o) => o.text)
    expect(texts[0]).toBe('All pipelines')
  })

  it('emits __all__ sentinel when "All pipelines" is selected', () => {
    render(
      <PipelineSelector
        pipelines={[defaultPipeline]}
        includeAll
        onChange={noop}
      />,
    )
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: PIPELINE_ALL_SENTINEL } })
    expect(noop).toHaveBeenCalledWith(PIPELINE_ALL_SENTINEL)
  })

  it('does not prepend "All pipelines" when includeAll is false (default)', () => {
    render(
      <PipelineSelector
        pipelines={[defaultPipeline]}
        onChange={noop}
      />,
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    const texts = Array.from(select.options).map((o) => o.text)
    expect(texts).not.toContain('All pipelines')
  })

  it('renders select as disabled when disabled prop is true', () => {
    render(
      <PipelineSelector
        pipelines={[defaultPipeline]}
        onChange={noop}
        disabled
      />,
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select).toBeDisabled()
  })

  it('places default pipeline first even when not first in input array', () => {
    render(
      <PipelineSelector
        pipelines={[customPipeline, defaultPipeline]}
        onChange={noop}
      />,
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.options[0].value).toBe('pipe-default')
  })
})
