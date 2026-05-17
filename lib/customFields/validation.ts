// lib/customFields/validation.ts
import type { CustomFieldDefinition, CustomFieldValidationError } from './types'

// ------------------------------------------------------------------ helpers

function validateText(
  val: unknown,
  label: string,
  key: string,
  minLength = 0,
  maxLength = 500,
): CustomFieldValidationError | null {
  if (typeof val !== 'string') {
    return { key, message: `${label} must be a string` }
  }
  if (val.length < minLength) {
    return { key, message: `${label} must be at least ${minLength} characters` }
  }
  if (val.length > maxLength) {
    return { key, message: `${label} must be at most ${maxLength} characters` }
  }
  return null
}

function validateNumber(
  val: unknown,
  label: string,
  key: string,
  min?: number,
  max?: number,
): CustomFieldValidationError | null {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    return { key, message: `${label} must be a finite number` }
  }
  if (min !== undefined && val < min) {
    return { key, message: `${label} must be at least ${min}` }
  }
  if (max !== undefined && val > max) {
    return { key, message: `${label} must be at most ${max}` }
  }
  return null
}

function validateCurrency(
  val: unknown,
  label: string,
  key: string,
  min?: number,
  max?: number,
): CustomFieldValidationError | null {
  if (
    typeof val !== 'object' ||
    val === null ||
    typeof (val as Record<string, unknown>).amount !== 'number' ||
    !Number.isFinite((val as Record<string, unknown>).amount as number) ||
    typeof (val as Record<string, unknown>).currency !== 'string' ||
    !/^[A-Z]{3}$/.test((val as Record<string, unknown>).currency as string)
  ) {
    return { key, message: `${label} must be an object with amount (number) and currency (3-letter ISO code)` }
  }
  const amount = (val as Record<string, unknown>).amount as number
  if (min !== undefined && amount < min) {
    return { key, message: `${label} amount must be at least ${min}` }
  }
  if (max !== undefined && amount > max) {
    return { key, message: `${label} amount must be at most ${max}` }
  }
  return null
}

function validateDropdown(
  val: unknown,
  label: string,
  key: string,
  options: { value: string }[],
): CustomFieldValidationError | null {
  if (!options.some(o => o.value === val)) {
    return { key, message: `${label} must be one of the allowed options` }
  }
  return null
}

function validateMultiSelect(
  val: unknown,
  label: string,
  key: string,
  options: { value: string }[],
): CustomFieldValidationError | null {
  if (!Array.isArray(val)) {
    return { key, message: `${label} must be an array` }
  }
  const validValues = new Set(options.map(o => o.value))
  for (const item of val) {
    if (!validValues.has(item)) {
      return { key, message: `${label} contains an invalid option: ${item}` }
    }
  }
  // Check for duplicates
  if (new Set(val).size !== val.length) {
    return { key, message: `${label} must not contain duplicate values` }
  }
  return null
}

function validateDateLike(val: unknown, label: string, key: string): CustomFieldValidationError | null {
  if (typeof val !== 'string') {
    return { key, message: `${label} must be a string` }
  }
  if (Number.isNaN(new Date(val).getTime())) {
    return { key, message: `${label} must be a valid date string` }
  }
  return null
}

function validateUrl(val: unknown, label: string, key: string): CustomFieldValidationError | null {
  if (typeof val !== 'string') {
    return { key, message: `${label} must be a string` }
  }
  try {
    new URL(val)
    return null
  } catch {
    return { key, message: `${label} must be a valid URL` }
  }
}

function validateEmail(val: unknown, label: string, key: string): CustomFieldValidationError | null {
  if (typeof val !== 'string') {
    return { key, message: `${label} must be a string` }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
    return { key, message: `${label} must be a valid email address` }
  }
  return null
}

function validatePhone(val: unknown, label: string, key: string): CustomFieldValidationError | null {
  if (typeof val !== 'string') {
    return { key, message: `${label} must be a string` }
  }
  if (!/^[+]?[0-9()\-.\s]{4,30}$/.test(val)) {
    return { key, message: `${label} must be a valid phone number (4-30 digits/symbols)` }
  }
  return null
}

// ------------------------------------------------------------------ required check

function isRequiredMissing(val: unknown): boolean {
  return (
    val === undefined ||
    val === null ||
    val === '' ||
    (Array.isArray(val) && val.length === 0)
  )
}

// ------------------------------------------------------------------ main export

export function validateCustomFields(
  definitions: CustomFieldDefinition[],
  values: Record<string, unknown> | undefined,
): CustomFieldValidationError[] {
  const vals: Record<string, unknown> = values ?? {}
  const errors: CustomFieldValidationError[] = []

  for (const def of definitions) {
    const val = vals[def.key]

    // Required check
    if (def.required && isRequiredMissing(val)) {
      errors.push({ key: def.key, message: `${def.label} is required` })
      continue
    }

    // If value is not present and not required, skip type check
    if (val === undefined || val === null) continue

    // Type-specific validation
    let err: CustomFieldValidationError | null = null
    switch (def.type) {
      case 'text':
        err = validateText(val, def.label, def.key, def.minLength ?? 0, def.maxLength ?? 500)
        break
      case 'longtext':
        err = validateText(val, def.label, def.key, def.minLength ?? 0, def.maxLength ?? 10000)
        break
      case 'number':
        err = validateNumber(val, def.label, def.key, def.min, def.max)
        break
      case 'currency':
        err = validateCurrency(val, def.label, def.key, def.min, def.max)
        break
      case 'date':
        err = validateDateLike(val, def.label, def.key)
        break
      case 'datetime':
        err = validateDateLike(val, def.label, def.key)
        break
      case 'dropdown':
        err = validateDropdown(val, def.label, def.key, def.options ?? [])
        break
      case 'multi_select':
        err = validateMultiSelect(val, def.label, def.key, def.options ?? [])
        break
      case 'checkbox':
        if (typeof val !== 'boolean') {
          err = { key: def.key, message: `${def.label} must be a boolean` }
        }
        break
      case 'url':
        err = validateUrl(val, def.label, def.key)
        break
      case 'email':
        err = validateEmail(val, def.label, def.key)
        break
      case 'phone':
        err = validatePhone(val, def.label, def.key)
        break
    }

    if (err) errors.push(err)
  }

  return errors
}
