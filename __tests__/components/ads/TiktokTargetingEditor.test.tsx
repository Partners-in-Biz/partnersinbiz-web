/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { TiktokTargetingEditor } from '@/components/ads/TiktokTargetingEditor'
import type { TiktokTargetingValue } from '@/components/ads/TiktokTargetingEditor'

const DEFAULT_VALUE: TiktokTargetingValue = {
  canonical: {
    geo: { countries: [] },
    demographics: { ageMin: 18, ageMax: 65 },
  },
  tkTargeting: {},
}

describe('TiktokTargetingEditor', () => {
  it('renders all 6 age group checkboxes, gender radios, and locations input', () => {
    const onChange = jest.fn()
    render(<TiktokTargetingEditor value={DEFAULT_VALUE} onChange={onChange} />)

    // Locations input
    expect(screen.getByLabelText('Locations')).toBeInTheDocument()

    // All 6 age group checkboxes
    expect(screen.getByLabelText('AGE_13_17')).toBeInTheDocument()
    expect(screen.getByLabelText('AGE_18_24')).toBeInTheDocument()
    expect(screen.getByLabelText('AGE_25_34')).toBeInTheDocument()
    expect(screen.getByLabelText('AGE_35_44')).toBeInTheDocument()
    expect(screen.getByLabelText('AGE_45_54')).toBeInTheDocument()
    expect(screen.getByLabelText('AGE_55_100')).toBeInTheDocument()

    // Gender radios
    expect(screen.getByLabelText('GENDER_UNLIMITED')).toBeInTheDocument()
    expect(screen.getByLabelText('GENDER_MALE')).toBeInTheDocument()
    expect(screen.getByLabelText('GENDER_FEMALE')).toBeInTheDocument()

    // Languages input
    expect(screen.getByLabelText('Languages')).toBeInTheDocument()

    // Advanced JSON textarea
    expect(screen.getByLabelText('Advanced TikTok targeting JSON')).toBeInTheDocument()
  })

  it('toggling an age group fires onChange with the updated age_groups array', () => {
    const onChange = jest.fn()
    render(<TiktokTargetingEditor value={DEFAULT_VALUE} onChange={onChange} />)

    // Check AGE_18_24
    fireEvent.click(screen.getByLabelText('AGE_18_24'))

    expect(onChange).toHaveBeenCalled()
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as TiktokTargetingValue
    expect(lastCall.tkTargeting?.age_groups).toContain('AGE_18_24')

    // Reset mock + render with AGE_18_24 already selected — then untoggle
    onChange.mockClear()
    const valueWithAge: TiktokTargetingValue = {
      ...DEFAULT_VALUE,
      tkTargeting: { age_groups: ['AGE_18_24', 'AGE_25_34'] },
    }
    const { unmount } = render(
      <TiktokTargetingEditor value={valueWithAge} onChange={onChange} />
    )

    // Uncheck AGE_18_24 (it will be the second rendered instance — find by component)
    const checkboxes = screen.getAllByLabelText('AGE_18_24')
    fireEvent.click(checkboxes[checkboxes.length - 1])

    expect(onChange).toHaveBeenCalled()
    const afterRemove = onChange.mock.calls[onChange.mock.calls.length - 1][0] as TiktokTargetingValue
    expect(afterRemove.tkTargeting?.age_groups).not.toContain('AGE_18_24')
    expect(afterRemove.tkTargeting?.age_groups).toContain('AGE_25_34')

    unmount()
  })
})
