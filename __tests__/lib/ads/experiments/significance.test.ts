// __tests__/lib/ads/experiments/significance.test.ts

import {
  normalCdf,
  zTestProportions,
  welchTTest,
  computeSignificance,
} from '@/lib/ads/experiments/significance'

// ─── normalCdf tests ──────────────────────────────────────────────────────────

// Test 9
it('normalCdf(0) ≈ 0.5', () => {
  expect(normalCdf(0)).toBeCloseTo(0.5, 5)
})

// Test 10
it('normalCdf(1.96) ≈ 0.975 — 95% CI', () => {
  expect(normalCdf(1.96)).toBeCloseTo(0.975, 2)
})

// ─── zTestProportions tests ───────────────────────────────────────────────────

// Test 11
it('zTestProportions returns 1.0 when either total is 0', () => {
  expect(zTestProportions(10, 0, 5, 100)).toBe(1.0)
  expect(zTestProportions(10, 100, 5, 0)).toBe(1.0)
})

// Test 12
it('zTestProportions: clear winner — pValue < 0.05 for very different proportions', () => {
  // 1000 samples: a = 5%, b = 20% conversion — clearly different
  const p = zTestProportions(50, 1000, 200, 1000)
  expect(p).toBeLessThan(0.05)
})

// Test 13
it('zTestProportions: identical proportions — pValue close to 1.0', () => {
  // same proportion
  const p = zTestProportions(100, 1000, 100, 1000)
  // p-value should be 1.0 when se=0 or very high (no difference)
  expect(p).toBeGreaterThan(0.99)
})

// ─── welchTTest tests ─────────────────────────────────────────────────────────

// Test 14
it('welchTTest returns 1.0 when N < 2', () => {
  expect(welchTTest(1.5, 0.5, 1, 2.0, 0.5, 100)).toBe(1.0)
  expect(welchTTest(1.5, 0.5, 100, 2.0, 0.5, 1)).toBe(1.0)
})

// ─── computeSignificance tests ────────────────────────────────────────────────

// Test 15
it('computeSignificance: notConfident when control is best (cpc lower-better, control wins)', () => {
  const result = computeSignificance({
    input: {
      metric: 'cpc',
      variants: [
        { id: 'a', impressions: 1000, clicks: 100, conversions: 10, spendCents: 500 },  // cpc=5 (lower=better)
        { id: 'b', impressions: 1000, clicks: 100, conversions: 10, spendCents: 1000 }, // cpc=10
      ],
    },
    threshold: 0.05,
  })
  expect(result.confident).toBe(false)
  expect(result.reason).toMatch(/Control is best/)
})

// Test 16
it('computeSignificance: confident winner for clearly different conv_rate', () => {
  // a: 5% conv_rate, b: 25% conv_rate — large sample → significant
  const result = computeSignificance({
    input: {
      metric: 'conv_rate',
      variants: [
        { id: 'a', impressions: 10000, clicks: 1000, conversions: 50, spendCents: 10000 },  // 5%
        { id: 'b', impressions: 10000, clicks: 1000, conversions: 250, spendCents: 10000 }, // 25%
      ],
    },
    threshold: 0.05,
  })
  expect(result.confident).toBe(true)
  expect(result.winnerVariantId).toBe('b')
  expect(result.pValue).toBeLessThan(0.05)
})

// Test 17
it('computeSignificance: notConfident on insufficient data (missing variant metric)', () => {
  // roas is not supported → returns null → notConfident
  const result = computeSignificance({
    input: {
      metric: 'roas',
      variants: [
        { id: 'a', impressions: 1000, clicks: 100, conversions: 10, spendCents: 5000 },
        { id: 'b', impressions: 1000, clicks: 100, conversions: 10, spendCents: 5000 },
      ],
    },
    threshold: 0.05,
  })
  expect(result.confident).toBe(false)
  expect(result.reason).toMatch(/lack data/)
})

// Test 18
it('computeSignificance: handles roas as not supported — deferred to v2', () => {
  const result = computeSignificance({
    input: {
      metric: 'roas',
      variants: [
        { id: 'a', impressions: 5000, clicks: 500, conversions: 50, spendCents: 50000 },
        { id: 'b', impressions: 6000, clicks: 600, conversions: 80, spendCents: 60000 },
      ],
    },
    threshold: 0.05,
  })
  // roas returns null from metricFor — so "some variants lack data"
  expect(result.pValue).toBe(1.0)
  expect(result.confident).toBe(false)
})

// Test 19: fewer than 2 variants
it('computeSignificance: returns notConfident with reason when < 2 variants', () => {
  const result = computeSignificance({
    input: {
      metric: 'ctr',
      variants: [{ id: 'a', impressions: 1000, clicks: 50, conversions: 5, spendCents: 5000 }],
    },
    threshold: 0.05,
  })
  expect(result.confident).toBe(false)
  expect(result.reason).toMatch(/2 variants/)
})

// Test 20: ctr significant
it('computeSignificance: confident winner for clearly different ctr', () => {
  // a: 2% CTR, b: 10% CTR — large sample
  const result = computeSignificance({
    input: {
      metric: 'ctr',
      variants: [
        { id: 'a', impressions: 10000, clicks: 200, conversions: 20, spendCents: 5000 },  // 2%
        { id: 'b', impressions: 10000, clicks: 1000, conversions: 100, spendCents: 5000 }, // 10%
      ],
    },
    threshold: 0.05,
  })
  expect(result.confident).toBe(true)
  expect(result.winnerVariantId).toBe('b')
})
