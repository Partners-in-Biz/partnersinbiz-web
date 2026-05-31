import React from 'react'
import { render, screen } from '@testing-library/react'
import { CustomFieldValue } from '@/components/crm/CustomFieldValue'
import type { CustomFieldDefinition } from '@/lib/customFields/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDef(overrides: Partial<CustomFieldDefinition>): CustomFieldDefinition {
  return {
    id: 'def-1',
    orgId: 'org-1',
    resource: 'contact',
    key: 'test_field',
    label: 'Test Field',
    type: 'text',
    required: false,
    order: 0,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CustomFieldValue', () => {
  it('names an undefined text value as not captured', () => {
    render(
      <CustomFieldValue
        definition={makeDef({ type: 'text' })}
        value={undefined}
      />,
    )
    expect(screen.getByText('Not captured')).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('names a null number value as not captured', () => {
    render(
      <CustomFieldValue
        definition={makeDef({ type: 'number' })}
        value={null}
      />,
    )
    expect(screen.getByText('Not captured')).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('names an empty string value as not captured', () => {
    render(
      <CustomFieldValue
        definition={makeDef({ type: 'text' })}
        value=""
      />,
    )
    expect(screen.getByText('Not captured')).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('renders plain text for type "text"', () => {
    render(
      <CustomFieldValue
        definition={makeDef({ type: 'text' })}
        value="Hello World"
      />,
    )
    expect(screen.getByText('Hello World')).toBeInTheDocument()
  })

  it('renders a link for type "url"', () => {
    render(
      <CustomFieldValue
        definition={makeDef({ type: 'url' })}
        value="https://example.com"
      />,
    )
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://example.com')
  })

  it('renders a mailto link for type "email"', () => {
    render(
      <CustomFieldValue
        definition={makeDef({ type: 'email' })}
        value="user@example.com"
      />,
    )
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'mailto:user@example.com')
  })

  it('formats number with toLocaleString', () => {
    render(
      <CustomFieldValue
        definition={makeDef({ type: 'number' })}
        value={1500}
      />,
    )
    expect(screen.getByText((1500).toLocaleString())).toBeInTheDocument()
  })

  it('formats currency with Intl.NumberFormat', () => {
    render(
      <CustomFieldValue
        definition={makeDef({ type: 'currency' })}
        value={{ amount: 250, currency: 'USD' }}
      />,
    )
    // The formatted string will include $ and 250 — just check it's rendered
    expect(screen.getByText(/250/)).toBeInTheDocument()
  })

  it('falls back gracefully on bad currency code', () => {
    render(
      <CustomFieldValue
        definition={makeDef({ type: 'currency' })}
        value={{ amount: 99, currency: 'BADCUR' }}
      />,
    )
    // fallback: "${currency} ${amount}"
    expect(screen.getByText(/99/)).toBeInTheDocument()
  })

  it('resolves dropdown option label from value', () => {
    render(
      <CustomFieldValue
        definition={makeDef({
          type: 'dropdown',
          options: [
            { value: 'a', label: 'Alpha' },
            { value: 'b', label: 'Beta' },
          ],
        })}
        value="b"
      />,
    )
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })

  it('names unknown dropdown values as stale CRM options', () => {
    render(
      <CustomFieldValue
        definition={makeDef({
          label: 'Buying committee role',
          type: 'dropdown',
          options: [{ value: 'a', label: 'Alpha' }],
        })}
        value="unknown"
      />,
    )
    expect(screen.getByText('Unknown Buying committee role option')).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('renders one chip per matched option for multi_select', () => {
    render(
      <CustomFieldValue
        definition={makeDef({
          type: 'multi_select',
          options: [
            { value: 'x', label: 'X Option' },
            { value: 'y', label: 'Y Option' },
            { value: 'z', label: 'Z Option' },
          ],
        })}
        value={['x', 'z']}
      />,
    )
    expect(screen.getByText('X Option')).toBeInTheDocument()
    expect(screen.getByText('Z Option')).toBeInTheDocument()
    expect(screen.queryByText('Y Option')).not.toBeInTheDocument()
  })

  it('renders "Yes" for checkbox true', () => {
    render(
      <CustomFieldValue
        definition={makeDef({ type: 'checkbox' })}
        value={true}
      />,
    )
    expect(screen.getByText('Yes')).toBeInTheDocument()
  })

  it('renders "No" for checkbox false', () => {
    render(
      <CustomFieldValue
        definition={makeDef({ type: 'checkbox' })}
        value={false}
      />,
    )
    expect(screen.getByText('No')).toBeInTheDocument()
  })

  it('formats date value with toLocaleDateString', () => {
    const dateStr = '2026-06-15'
    render(
      <CustomFieldValue
        definition={makeDef({ type: 'date' })}
        value={dateStr}
      />,
    )
    const expected = new Date(dateStr).toLocaleDateString()
    expect(screen.getByText(expected)).toBeInTheDocument()
  })

  it('names invalid date values as CRM data cleanup work', () => {
    render(
      <CustomFieldValue
        definition={makeDef({ type: 'date', label: 'Contract start date' })}
        value="not-a-date"
      />,
    )

    expect(screen.getByText('Invalid Contract start date date')).toBeInTheDocument()
    expect(screen.queryByText('Invalid Date')).not.toBeInTheDocument()
  })
})
