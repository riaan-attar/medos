/** Print the current page's .print-area as a narrow thermal receipt (80 mm) or normal A4. */
export function printDoc(kind: 'thermal' | 'a4' = 'a4') {
  const id = 'print-page-size'
  document.getElementById(id)?.remove()
  if (kind === 'thermal') {
    const st = document.createElement('style')
    st.id = id
    st.textContent = '@page { size: 80mm auto; margin: 3mm } @media print { .print-area.receipt { width: 72mm !important; max-width: 72mm !important; border: 0 !important; font-size: 11px !important; padding: 0 !important } }'
    document.head.appendChild(st)
  }
  const cleanup = () => { document.getElementById(id)?.remove(); window.removeEventListener('afterprint', cleanup) }
  window.addEventListener('afterprint', cleanup)
  window.print()
}
