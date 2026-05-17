/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { LinkedinTargetingEditor } from '@/components/ads/LinkedinTargetingEditor'
import type { LinkedinTargetingValue } from '@/components/ads/LinkedinTargetingEditor'

describe('LinkedinTargetingEditor', () => {
  it('renders with US country chip when default value is provided', () => {
    const value: LinkedinTargetingValue = {
      canonical: { geo: { countries: ['US'] }, demographics: { ageMin: 18, ageMax: 65 } },
    }
    const onChange = jest.fn()

    render(<LinkedinTargetingEditor value={value} onChange={onChange} />)

    // Country chip visible
    expect(screen.getByText('US')).toBeInTheDocument()
    // Locations input pre-filled
    expect(screen.getByLabelText('Locations (ISO country codes)')).toHaveValue('US')
  })

  it('pasting valid JSON into the LI-specific textarea updates liTargetingCriteria', () => {
    const value: LinkedinTargetingValue = {
      canonical: { geo: { countries: ['US'] }, demographics: { ageMin: 18, ageMax: 65 } },
    }
    const onChange = jest.fn()

    render(<LinkedinTargetingEditor value={value} onChange={onChange} />)

    const textarea = screen.getByLabelText('LinkedIn targeting criteria JSON')
    const jsonStr = '{"include":{"and":[{"or":{"foo":["bar"]}}]}}'

    fireEvent.change(textarea, { target: { value: jsonStr } })
    fireEvent.blur(textarea)

    expect(onChange).toHaveBeenCalled()
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as LinkedinTargetingValue
    expect(lastCall.liTargetingCriteria).toEqual({
      include: { and: [{ or: { foo: ['bar'] } }] },
    })
  })
})
