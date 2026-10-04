import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react'
import { downloadCsv, toCsv } from '../lib/csv'
import { Empty } from './ui'

export interface Column<T> {
  key: string
  header: string
  render?: (row: T) => ReactNode
  /** value used for sorting, searching and CSV (falls back to row[key]) */
  value?: (row: T) => string | number | null | undefined
  align?: 'right'
  noSort?: boolean
  noCsv?: boolean
}

interface Props<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  pageSize?: number
  searchable?: boolean
  searchPlaceholder?: string
  exportName?: string
  toolbar?: ReactNode
  empty?: { title: string; hint?: string; action?: ReactNode }
  onRowClick?: (row: T) => void
  initialSort?: { key: string; dir: 'asc' | 'desc' }
}

export default function DataTable<T>({
  rows, columns, rowKey, pageSize = 10, searchable = true, searchPlaceholder = 'Search…', exportName, toolbar, empty, onRowClick, initialSort,
}: Props<T>) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort ?? null)
  const [page, setPage] = useState(0)

  const val = (c: Column<T>, r: T) => c.value ? c.value(r) : ((r as Record<string, unknown>)[c.key] as string | number | null | undefined)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter(r => columns.some(c => String(val(c, r) ?? '').toLowerCase().includes(needle)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, columns])

  const sorted = useMemo(() => {
    if (!sort) return filtered
    const col = columns.find(c => c.key === sort.key)
    if (!col) return filtered
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const x = val(col, a), y = val(col, b)
      if (x == null && y == null) return 0
      if (x == null) return 1
      if (y == null) return -1
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return String(x).localeCompare(String(y), undefined, { numeric: true }) * dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort, columns])

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const cur = Math.min(page, pages - 1)
  const slice = sorted.slice(cur * pageSize, cur * pageSize + pageSize)

  function exportCsv() {
    const cols = columns.filter(c => !c.noCsv)
    downloadCsv(exportName ?? 'export', toCsv(cols.map(c => c.header), sorted.map(r => cols.map(c => val(c, r) ?? ''))))
  }

  return (
    <div className="dt">
      {(searchable || exportName || toolbar) && (
        <div className="dt-bar">
          {searchable && (
            <div className="search-box">
              <Search size={16} />
              <input value={q} onChange={e => { setQ(e.target.value); setPage(0) }} placeholder={searchPlaceholder} aria-label="Search table" />
            </div>
          )}
          <div className="row gap wrap">
            {toolbar}
            {exportName && <button className="btn ghost sm" onClick={exportCsv} disabled={sorted.length === 0}><Download size={14} /> CSV</button>}
          </div>
        </div>
      )}
      {sorted.length === 0 ? (
        <Empty title={q ? 'No matches' : empty?.title ?? 'Nothing here yet'} hint={q ? 'Try a different search.' : empty?.hint} action={q ? undefined : empty?.action} />
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {columns.map(c => (
                    <th key={c.key} className={c.align === 'right' ? 'r' : ''}>
                      {c.noSort ? c.header : (
                        <button className="th-btn" onClick={() => setSort(s => s?.key === c.key ? (s.dir === 'asc' ? { key: c.key, dir: 'desc' } : null) : { key: c.key, dir: 'asc' })}>
                          {c.header}
                          {sort?.key === c.key && (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slice.map(r => (
                  <tr key={rowKey(r)} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                    {columns.map(c => <td key={c.key} className={c.align === 'right' ? 'r' : ''}>{c.render ? c.render(r) : String(val(c, r) ?? '—')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dt-foot">
            <span className="muted small">{sorted.length} row{sorted.length === 1 ? '' : 's'}</span>
            {pages > 1 && (
              <div className="row gap">
                <button className="icon-btn" disabled={cur === 0} onClick={() => setPage(cur - 1)} aria-label="Previous page"><ChevronLeft size={18} /></button>
                <span className="small">Page {cur + 1} / {pages}</span>
                <button className="icon-btn" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} aria-label="Next page"><ChevronRight size={18} /></button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
