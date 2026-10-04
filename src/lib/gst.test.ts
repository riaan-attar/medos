import { describe, expect, it } from 'vitest'
import { amountInWords, splitTax } from './gst'

describe('amountInWords', () => {
  it('uses Indian numbering', () => {
    expect(amountInWords(123456.5)).toBe('Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only')
    expect(amountInWords(10000000)).toBe('Rupees One Crore Only')
    expect(amountInWords(0)).toBe('Rupees Zero Only')
    expect(amountInWords(19)).toBe('Rupees Nineteen Only')
  })
})
describe('splitTax', () => {
  const lines = [{ rate: 12, taxable: 1000, tax: 120 }, { rate: 5, taxable: 200, tax: 10 }]
  it('splits intra-state into CGST+SGST', () => { expect(splitTax(lines, '27', '27')).toMatchObject({ intra: true, cgst: 65, sgst: 65, igst: 0 }) })
  it('uses IGST across states', () => { expect(splitTax(lines, '27', '36')).toMatchObject({ intra: false, cgst: 0, sgst: 0, igst: 130 }) })
  it('treats an unknown state as intra-state', () => { expect(splitTax(lines, '', '36').intra).toBe(true) })
})
