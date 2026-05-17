// __tests__/lib/customFields/validation.test.ts
import type { CustomFieldDefinition } from '@/lib/customFields/types'

// validateCustomFields will be imported once the module is implemented
let validateCustomFields: (
  definitions: CustomFieldDefinition[],
  values: Record<string, unknown> | undefined,
) => { key: string; message: string }[]

beforeAll(async () => {
  const mod = await import('@/lib/customFields/validation')
  validateCustomFields = mod.validateCustomFields
})

// Shared definitions used across tests
const dropdownDef: CustomFieldDefinition = {
  id: 'def-v-001',
  orgId: 'org-val-test',
  resource: 'contact',
  key: 'tier',
  label: 'Tier',
  type: 'dropdown',
  required: true,
  options: [
    { value: 'gold', label: 'Gold' },
    { value: 'silver', label: 'Silver' },
  ],
  order: 0,
  createdAt: null,
  updatedAt: null,
}

const textDef: CustomFieldDefinition = {
  id: 'def-v-002',
  orgId: 'org-val-test',
  resource: 'contact',
  key: 'sales_rep',
  label: 'Sales Rep',
  type: 'text',
  required: false,
  order: 1,
  createdAt: null,
  updatedAt: null,
}

const currencyDef: CustomFieldDefinition = {
  id: 'def-v-003',
  orgId: 'org-val-test',
  resource: 'contact',
  key: 'budget',
  label: 'Budget',
  type: 'currency',
  required: false,
  currencyCode: 'USD',
  min: 0,
  order: 2,
  createdAt: null,
  updatedAt: null,
}

const multiSelectDef: CustomFieldDefinition = {
  id: 'def-v-004',
  orgId: 'org-val-test',
  resource: 'contact',
  key: 'interests',
  label: 'Interests',
  type: 'multi_select',
  required: true,
  options: [
    { value: 'tech', label: 'Tech' },
    { value: 'sports', label: 'Sports' },
    { value: 'music', label: 'Music' },
  ],
  order: 3,
  createdAt: null,
  updatedAt: null,
}

const numberDef: CustomFieldDefinition = {
  id: 'def-v-005',
  orgId: 'org-val-test',
  resource: 'contact',
  key: 'age',
  label: 'Age',
  type: 'number',
  required: false,
  min: 0,
  max: 150,
  order: 4,
  createdAt: null,
  updatedAt: null,
}

const emailDef: CustomFieldDefinition = {
  id: 'def-v-006',
  orgId: 'org-val-test',
  resource: 'contact',
  key: 'work_email',
  label: 'Work Email',
  type: 'email',
  required: false,
  order: 5,
  createdAt: null,
  updatedAt: null,
}

const urlDef: CustomFieldDefinition = {
  id: 'def-v-007',
  orgId: 'org-val-test',
  resource: 'contact',
  key: 'website',
  label: 'Website',
  type: 'url',
  required: false,
  order: 6,
  createdAt: null,
  updatedAt: null,
}

const checkboxDef: CustomFieldDefinition = {
  id: 'def-v-008',
  orgId: 'org-val-test',
  resource: 'contact',
  key: 'opted_in',
  label: 'Opted In',
  type: 'checkbox',
  required: false,
  order: 7,
  createdAt: null,
  updatedAt: null,
}

const dateDef: CustomFieldDefinition = {
  id: 'def-v-009',
  orgId: 'org-val-test',
  resource: 'contact',
  key: 'renewal_date',
  label: 'Renewal Date',
  type: 'date',
  required: false,
  order: 8,
  createdAt: null,
  updatedAt: null,
}

const phoneDef: CustomFieldDefinition = {
  id: 'def-v-010',
  orgId: 'org-val-test',
  resource: 'contact',
  key: 'mobile_phone',
  label: 'Mobile Phone',
  type: 'phone',
  required: false,
  order: 9,
  createdAt: null,
  updatedAt: null,
}

const longtextDef: CustomFieldDefinition = {
  id: 'def-v-011',
  orgId: 'org-val-test',
  resource: 'contact',
  key: 'notes_extra',
  label: 'Extra Notes',
  type: 'longtext',
  required: false,
  maxLength: 200,
  order: 10,
  createdAt: null,
  updatedAt: null,
}

const datetimeDef: CustomFieldDefinition = {
  id: 'def-v-012',
  orgId: 'org-val-test',
  resource: 'contact',
  key: 'last_contact_dt',
  label: 'Last Contact At',
  type: 'datetime',
  required: false,
  order: 11,
  createdAt: null,
  updatedAt: null,
}

describe('validateCustomFields', () => {
  describe('no errors', () => {
    it('returns no errors when required values are present and types match', () => {
      const defs = [dropdownDef, textDef, currencyDef, multiSelectDef]
      const values = {
        tier: 'gold',
        sales_rep: 'Alice',
        budget: { amount: 5000, currency: 'USD' },
        interests: ['tech', 'sports'],
      }
      const errors = validateCustomFields(defs, values)
      expect(errors).toHaveLength(0)
    })

    it('returns no errors when optional fields are missing', () => {
      const defs = [textDef, currencyDef]
      const errors = validateCustomFields(defs, {})
      expect(errors).toHaveLength(0)
    })
  })

  describe('required field errors', () => {
    it('reports REQUIRED error when required dropdown field is undefined', () => {
      const errors = validateCustomFields([dropdownDef], {})
      expect(errors).toHaveLength(1)
      expect(errors[0].key).toBe('tier')
      expect(errors[0].message).toMatch(/required/i)
    })

    it('reports REQUIRED error when required field is empty string', () => {
      const requiredText: CustomFieldDefinition = { ...textDef, key: 'req_text', label: 'Req Text', id: 'def-v-013', required: true }
      const errors = validateCustomFields([requiredText], { req_text: '' })
      expect(errors).toHaveLength(1)
      expect(errors[0].key).toBe('req_text')
    })

    it('reports REQUIRED error when required field is null', () => {
      const requiredText: CustomFieldDefinition = { ...textDef, key: 'req_text2', label: 'Req Text', id: 'def-v-014', required: true }
      const errors = validateCustomFields([requiredText], { req_text2: null })
      expect(errors).toHaveLength(1)
    })

    it('reports REQUIRED error when required multi_select is empty array', () => {
      const errors = validateCustomFields([multiSelectDef], { interests: [] })
      expect(errors).toHaveLength(1)
      expect(errors[0].key).toBe('interests')
    })
  })

  describe('dropdown validation', () => {
    it('rejects dropdown value not in options', () => {
      const errors = validateCustomFields([dropdownDef], { tier: 'platinum' })
      expect(errors).toHaveLength(1)
      expect(errors[0].key).toBe('tier')
    })

    it('accepts dropdown value that IS in options', () => {
      const errors = validateCustomFields([dropdownDef], { tier: 'silver' })
      expect(errors).toHaveLength(0)
    })
  })

  describe('multi_select validation', () => {
    it('rejects multi_select with element not in options', () => {
      const errors = validateCustomFields([multiSelectDef], { interests: ['tech', 'yoga'] })
      expect(errors).toHaveLength(1)
      expect(errors[0].key).toBe('interests')
    })

    it('rejects multi_select with duplicate elements', () => {
      const errors = validateCustomFields([multiSelectDef], { interests: ['tech', 'tech'] })
      expect(errors).toHaveLength(1)
      expect(errors[0].key).toBe('interests')
    })

    it('accepts multi_select with all valid unique elements', () => {
      const errors = validateCustomFields([multiSelectDef], { interests: ['tech', 'music'] })
      expect(errors).toHaveLength(0)
    })
  })

  describe('number validation', () => {
    it('rejects number that is not finite (NaN)', () => {
      const errors = validateCustomFields([numberDef], { age: NaN })
      expect(errors).toHaveLength(1)
      expect(errors[0].key).toBe('age')
    })

    it('rejects number that is not finite (Infinity)', () => {
      const errors = validateCustomFields([numberDef], { age: Infinity })
      expect(errors).toHaveLength(1)
    })

    it('rejects number below min', () => {
      const errors = validateCustomFields([numberDef], { age: -1 })
      expect(errors).toHaveLength(1)
    })

    it('rejects number above max', () => {
      const errors = validateCustomFields([numberDef], { age: 200 })
      expect(errors).toHaveLength(1)
    })

    it('accepts valid number within range', () => {
      const errors = validateCustomFields([numberDef], { age: 30 })
      expect(errors).toHaveLength(0)
    })
  })

  describe('currency validation', () => {
    it('rejects currency missing amount', () => {
      const errors = validateCustomFields([currencyDef], { budget: { currency: 'USD' } })
      expect(errors).toHaveLength(1)
      expect(errors[0].key).toBe('budget')
    })

    it('rejects currency missing currency field', () => {
      const errors = validateCustomFields([currencyDef], { budget: { amount: 100 } })
      expect(errors).toHaveLength(1)
    })

    it('rejects currency with invalid 3-letter code', () => {
      const errors = validateCustomFields([currencyDef], { budget: { amount: 100, currency: 'us' } })
      expect(errors).toHaveLength(1)
    })

    it('rejects currency amount below min', () => {
      const errors = validateCustomFields([currencyDef], { budget: { amount: -100, currency: 'USD' } })
      expect(errors).toHaveLength(1)
    })

    it('accepts valid currency object', () => {
      const errors = validateCustomFields([currencyDef], { budget: { amount: 500, currency: 'USD' } })
      expect(errors).toHaveLength(0)
    })
  })

  describe('email validation', () => {
    it('rejects email that does not match regex', () => {
      const errors = validateCustomFields([emailDef], { work_email: 'not-an-email' })
      expect(errors).toHaveLength(1)
      expect(errors[0].key).toBe('work_email')
    })

    it('accepts email that matches regex', () => {
      const errors = validateCustomFields([emailDef], { work_email: 'alice@example.com' })
      expect(errors).toHaveLength(0)
    })
  })

  describe('url validation', () => {
    it('rejects url that is not parseable', () => {
      const errors = validateCustomFields([urlDef], { website: 'not a url' })
      expect(errors).toHaveLength(1)
      expect(errors[0].key).toBe('website')
    })

    it('accepts valid url', () => {
      const errors = validateCustomFields([urlDef], { website: 'https://example.com' })
      expect(errors).toHaveLength(0)
    })
  })

  describe('checkbox validation', () => {
    it('accepts boolean true for checkbox', () => {
      const errors = validateCustomFields([checkboxDef], { opted_in: true })
      expect(errors).toHaveLength(0)
    })

    it('accepts boolean false for checkbox', () => {
      const errors = validateCustomFields([checkboxDef], { opted_in: false })
      expect(errors).toHaveLength(0)
    })

    it('rejects checkbox non-boolean (string)', () => {
      const errors = validateCustomFields([checkboxDef], { opted_in: 'yes' })
      expect(errors).toHaveLength(1)
      expect(errors[0].key).toBe('opted_in')
    })

    it('rejects checkbox non-boolean (number)', () => {
      const errors = validateCustomFields([checkboxDef], { opted_in: 1 })
      expect(errors).toHaveLength(1)
    })
  })

  describe('date validation', () => {
    it('rejects date string that is not valid ISO date', () => {
      const errors = validateCustomFields([dateDef], { renewal_date: 'not-a-date' })
      expect(errors).toHaveLength(1)
      expect(errors[0].key).toBe('renewal_date')
    })

    it('accepts valid ISO date string', () => {
      const errors = validateCustomFields([dateDef], { renewal_date: '2025-12-31' })
      expect(errors).toHaveLength(0)
    })
  })

  describe('datetime validation', () => {
    it('rejects datetime that is not parseable', () => {
      const errors = validateCustomFields([datetimeDef], { last_contact_dt: 'garbage-time' })
      expect(errors).toHaveLength(1)
      expect(errors[0].key).toBe('last_contact_dt')
    })

    it('accepts valid ISO datetime string', () => {
      const errors = validateCustomFields([datetimeDef], { last_contact_dt: '2025-12-31T10:00:00Z' })
      expect(errors).toHaveLength(0)
    })
  })

  describe('text / longtext validation', () => {
    it('rejects text that exceeds maxLength', () => {
      const errors = validateCustomFields([longtextDef], { notes_extra: 'x'.repeat(201) })
      expect(errors).toHaveLength(1)
      expect(errors[0].key).toBe('notes_extra')
    })

    it('accepts text within maxLength', () => {
      const errors = validateCustomFields([longtextDef], { notes_extra: 'x'.repeat(100) })
      expect(errors).toHaveLength(0)
    })
  })

  describe('phone validation', () => {
    it('accepts valid phone number', () => {
      const errors = validateCustomFields([phoneDef], { mobile_phone: '+27 82 123 4567' })
      expect(errors).toHaveLength(0)
    })

    it('rejects too-short phone number', () => {
      const errors = validateCustomFields([phoneDef], { mobile_phone: '123' })
      expect(errors).toHaveLength(1)
      expect(errors[0].key).toBe('mobile_phone')
    })
  })

  describe('edge cases', () => {
    it('skips fields that have no definition (legacy/orphan values are ignored)', () => {
      const errors = validateCustomFields([textDef], { orphan_field: 'some-value', sales_rep: 'Bob' })
      expect(errors).toHaveLength(0)
    })

    it('handles values=undefined as empty object (optional fields pass, required fail)', () => {
      const errors = validateCustomFields([dropdownDef], undefined)
      expect(errors).toHaveLength(1)
      expect(errors[0].key).toBe('tier')
    })

    it('handles values=null as empty object', () => {
      const errors = validateCustomFields([dropdownDef], null as never)
      expect(errors).toHaveLength(1)
    })

    it('returns empty array when definitions is empty', () => {
      const errors = validateCustomFields([], { some_key: 'value' })
      expect(errors).toHaveLength(0)
    })
  })
})
