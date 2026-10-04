import { useEffect, useRef, useState } from 'react'
import { Modal } from './ui'
import { Alert } from './ui'

interface BarcodeDetectorLike { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> }
declare global { interface Window { BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike } }

/** Camera barcode scanner: native BarcodeDetector when available, ZXing otherwise. Calls onScan for every distinct read. */
export default function BarcodeScanner({ onScan, onClose }: { onScan: (code: string) => 'ok' | 'miss' | void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [err, setErr] = useState('')
  const [last, setLast] = useState<{ code: string; ok: boolean } | null>(null)
  const cb = useRef(onScan)
  cb.current = onScan

  useEffect(() => {
    let stopped = false
    let stream: MediaStream | null = null
    let controls: { stop: () => void } | null = null
    let lastCode = '', lastAt = 0
    const handle = (code: string) => {
      const now = Date.now()
      if (code === lastCode && now - lastAt < 2500) return
      lastCode = code; lastAt = now
      const r = cb.current(code)
      setLast({ code, ok: r !== 'miss' })
      try { navigator.vibrate?.(60) } catch { /* not supported */ }
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { setErr('Camera access is not available in this browser (it needs HTTPS or localhost).'); return }
      try {
        if (window.BarcodeDetector) {
          const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] })
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
          if (stopped) { stream.getTracks().forEach(t => t.stop()); return }
          const v = video.current!
          v.srcObject = stream
          await v.play()
          const tick = async () => {
            if (stopped) return
            try { const codes = await det.detect(v); if (codes[0]) handle(codes[0].rawValue) } catch { /* frame not ready */ }
            setTimeout(tick, 250)
          }
          void tick()
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser')
          const reader = new BrowserMultiFormatReader()
          controls = await reader.decodeFromVideoDevice(undefined, video.current!, res => { if (res) handle(res.getText()) })
          if (stopped) controls.stop()
        }
      } catch (e) {
        const name = (e as { name?: string }).name
        setErr(name === 'NotAllowedError' ? 'Camera permission was denied.' : name === 'NotFoundError' ? 'No camera found on this device.' : 'Could not start the camera.')
      }
    }
    void start()
    return () => { stopped = true; stream?.getTracks().forEach(t => t.stop()); controls?.stop() }
  }, [])

  return (
    <Modal title="Scan barcode" onClose={onClose}>
      <div className="stack">
        {err ? <Alert tone="err">{err}</Alert> : <div className="scanner"><video ref={video} muted playsInline /><div className="scan-line" /></div>}
        {last && <Alert tone={last.ok ? 'ok' : 'warn'}>{last.ok ? 'Added' : 'Not in stock / unknown'}: <b>{last.code}</b></Alert>}
        <p className="muted small">Point the camera at the barcode on the pack. Each scan adds one unit; keep scanning, then close when done.</p>
        <div className="row end"><button className="btn primary" onClick={onClose}>Done</button></div>
      </div>
    </Modal>
  )
}
