export const GST_STATES: { code: string; name: string }[] = [
  ['01', 'Jammu & Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'], ['05', 'Uttarakhand'], ['06', 'Haryana'],
  ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'], ['12', 'Arunachal Pradesh'],
  ['13', 'Nagaland'], ['14', 'Manipur'], ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'], ['18', 'Assam'], ['19', 'West Bengal'],
  ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'], ['24', 'Gujarat'], ['26', 'Dadra & Nagar Haveli and Daman & Diu'],
  ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'], ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'],
  ['35', 'Andaman & Nicobar Islands'], ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'],
].map(([code, name]) => ({ code, name }))

export const stateName = (code: string | null | undefined) => GST_STATES.find(s => s.code === code)?.name ?? ''

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function below1000(n: number): string {
  const parts: string[] = []
  if (n >= 100) { parts.push(ONES[Math.floor(n / 100)] + ' Hundred'); n %= 100 }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '')) }
  else if (n > 0) parts.push(ONES[n])
  return parts.join(' ')
}

/** 123456.5 -> "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only" (Indian numbering) */
export function amountInWords(amount: number): string {
  const total = Math.round(Math.abs(amount) * 100)
  let rupees = Math.floor(total / 100)
  const paise = total % 100
  if (rupees === 0 && paise === 0) return 'Rupees Zero Only'
  const units: [number, string][] = [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']]
  const out: string[] = []
  for (const [v, label] of units) {
    if (rupees >= v) { out.push(below1000(Math.floor(rupees / v)) + ' ' + label); rupees %= v }
  }
  if (rupees > 0) out.push(below1000(rupees))
  const r = out.join(' ')
  return `Rupees ${r || 'Zero'}${paise ? ` and ${below1000(paise)} Paise` : ''} Only`
}

export interface TaxLine { rate: number; taxable: number; tax: number }
/** CGST+SGST when the supply is within one state (or a state is unknown), IGST otherwise. */
export function splitTax(lines: TaxLine[], sellerState: string, buyerState: string) {
  const intra = !sellerState || !buyerState || sellerState === buyerState
  const tax = Math.round(lines.reduce((s, l) => s + l.tax, 0) * 100) / 100
  const cgst = intra ? Math.round((tax / 2) * 100) / 100 : 0
  return { intra, cgst, sgst: intra ? Math.round((tax - cgst) * 100) / 100 : 0, igst: intra ? 0 : tax, tax }
}
