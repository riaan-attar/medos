import { describe, expect, it } from 'vitest'
import { outstanding, pct, money, initials } from './format'
import { parseCsv, toCsv } from './csv'

describe('format helpers', () => {
  it('computes outstanding balance without going negative', () => {
    expect(outstanding({ total: 1000, credit_total: 100, paid_total: 400 })).toBe(500)
    expect(outstanding({ total: 100, credit_total: 100, paid_total: 50 })).toBe(0)
    expect(outstanding({ total: 100, credit_total: 0, paid_total: 0, status: 'void' })).toBe(0)
  })
  it('percent handles zero denominators', () => {
    expect(pct(1, 4)).toBe(25)
    expect(pct(1, 0)).toBe(0)
  })
  it('formats money in INR', () => { expect(money(1234.5)).toContain('1,234.50') })
  it('builds initials', () => { expect(initials('Shah Medical Wholesalers')).toBe('SM') })
})

describe('csv', () => {
  it('round-trips quotes and commas', () => {
    const csv = toCsv(['a', 'b'], [['x,y', 'he said "hi"'], [1, null]])
    expect(parseCsv(csv)).toEqual([['a', 'b'], ['x,y', 'he said "hi"'], ['1', '']])
  })
})
