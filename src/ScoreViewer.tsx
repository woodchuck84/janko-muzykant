import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, FileMusic, Minus, Moon, Plus } from 'lucide-react'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { errorMessage } from './api'
import type { Material } from './types'

GlobalWorkerOptions.workerSrc = pdfWorker

export default function ScoreViewer({ files }: { files: Material[] }) {
  const pdfs = files.filter(f => f.kind === 'pdf')
  const [id, setId] = useState(pdfs[0]?.id ?? '')
  const file = pdfs.find(f => f.id === id) ?? pdfs[0]
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [dark, setDark] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(700)

  useEffect(() => {
    const node = frame.current
    if (!node) return
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width - (window.matchMedia('(max-width:680px)').matches ? 0 : 36)))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const node = frame.current
    if (!node) return
    let gesture: { x: number; y: number; distance: number; scale: number; pinched: boolean } | null = null
    const distance = (touches: TouchList) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
    function start(event: TouchEvent) {
      gesture = { x: event.touches[0].clientX, y: event.touches[0].clientY,
        distance: event.touches.length > 1 ? distance(event.touches) : 0, scale: zoom, pinched: event.touches.length > 1 }
    }
    function move(event: TouchEvent) {
      if (!gesture) return
      if (event.touches.length > 1 && gesture.distance > 0) {
        event.preventDefault()
        gesture.pinched = true
        gesture.scale = Math.max(0.5, Math.min(2.5, zoom * distance(event.touches) / gesture.distance))
        if (canvas.current) { canvas.current.style.transformOrigin = 'top left'; canvas.current.style.transform = `scale(${gesture.scale / zoom})` }
      } else if (zoom <= 1 && Math.abs(event.touches[0].clientX - gesture.x) > Math.abs(event.touches[0].clientY - gesture.y) * 1.5) {
        event.preventDefault()
      }
    }
    function end(event: TouchEvent) {
      if (!gesture || event.touches.length) return
      if (canvas.current) canvas.current.style.transform = ''
      if (gesture.pinched) setZoom(gesture.scale)
      else if (zoom <= 1 && event.changedTouches.length) {
        const dx = event.changedTouches[0].clientX - gesture.x, dy = event.changedTouches[0].clientY - gesture.y
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          setPage(value => Math.max(1, Math.min(document?.numPages ?? 1, value + (dx < 0 ? 1 : -1))))
        }
      }
      gesture = null
    }
    function cancel() { gesture = null; if (canvas.current) canvas.current.style.transform = '' }
    node.addEventListener('touchstart', start, { passive: true })
    node.addEventListener('touchmove', move, { passive: false })
    node.addEventListener('touchend', end)
    node.addEventListener('touchcancel', cancel)
    return () => { node.removeEventListener('touchstart', start); node.removeEventListener('touchmove', move); node.removeEventListener('touchend', end); node.removeEventListener('touchcancel', cancel); cancel() }
  }, [zoom, document])

  useEffect(() => {
    if (!file) return
    let cancelled = false
    setLoading(true); setDocument(null); setPage(1); setError('')
    const task = getDocument({ url: file.url })
    void task.promise.then(pdf => { if (!cancelled) { setDocument(pdf); setLoading(false) } })
      .catch(err => { if (!cancelled) { setError(`Nie można otworzyć PDF: ${errorMessage(err)}. Sprawdź dostęp Google Drive.`); setLoading(false) } })
    return () => { cancelled = true; void task.destroy() }
  }, [file?.url])

  useEffect(() => {
    if (!document || !canvas.current) return
    let cancelled = false
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
    void document.getPage(page).then(pdfPage => {
      if (cancelled || !canvas.current) return
      const base = pdfPage.getViewport({ scale: 1 })
      const viewport = pdfPage.getViewport({ scale: Math.max(0.2, width / base.width) * zoom })
      const ratio = window.devicePixelRatio || 1
      const node = canvas.current
      node.width = Math.floor(viewport.width * ratio); node.height = Math.floor(viewport.height * ratio)
      node.style.width = `${viewport.width}px`; node.style.height = `${viewport.height}px`
      renderTask = pdfPage.render({ canvas: node, viewport, transform: [ratio, 0, 0, ratio, 0, 0] })
      return renderTask.promise
    }).catch(err => { if (!cancelled) setError(errorMessage(err)) })
    return () => { cancelled = true; renderTask?.cancel() }
  }, [document, page, zoom, width])

  return <section className="panel score-panel">
    <div className="score-toolbar"><h3><FileMusic size={18}/> Partytura</h3><div>
      <button className="icon-button" aria-label="Zmniejsz partyturę" onClick={() => setZoom(Math.max(0.5, zoom - 0.15))}><Minus size={17}/></button><span>{Math.round(zoom * 100)}%</span>
      <button className="icon-button" aria-label="Powiększ partyturę" onClick={() => setZoom(Math.min(2.5, zoom + 0.15))}><Plus size={17}/></button>
      <button className="fit-score icon-button" aria-label="Dopasuj partyturę do szerokości" onClick={() => setZoom(1)}>↔</button>
      <button className={`icon-button ${dark ? 'active' : ''}`} aria-label="Ciemna partytura" onClick={() => setDark(!dark)}><Moon size={17}/></button>
      {file && <a aria-label="Otwórz PDF w nowej karcie" href={file.url} target="_blank" rel="noreferrer"><ExternalLink size={16}/></a>}
    </div></div>
    {pdfs.length > 1 && <select aria-label="Wybierz partyturę" className="score-select" value={file?.id} onChange={e => setId(e.target.value)}>{pdfs.map(f => <option key={f.id} value={f.id}>{f.name}{f.section ? ` · ${f.section}` : ''}</option>)}</select>}
    <div ref={frame} className={`pdf-frame ${dark ? 'dark-score' : ''}`}>
      {!file && <div className="empty"><FileMusic size={40}/><h3>Brak partytury PDF</h3><p>Folder może wymagać logowania. Jeśli masz MusicXML, zaimportuj go w zakładce Analiza.</p></div>}
      {loading && <div className="empty"><div className="spinner"/><p>Pobieranie partytury…</p></div>}
      {error && <p className="error" role="alert">{error}</p>}
      <canvas ref={canvas} hidden={!document || !!error} aria-label={`Partytura — strona ${page}`}/>
    </div>
    <p className="muted pdf-gesture-hint">Rozsuń dwa palce, aby przybliżyć. Przy 100% przesuń w bok, aby zmienić stronę. ↔ dopasowuje szerokość.</p>
    <div className="page-controls"><span>{file?.name ?? 'Brak pliku'}</span><div><button className="icon-button" aria-label="Poprzednia strona" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={17}/></button><span>{page} / {document?.numPages ?? '—'}</span><button className="icon-button" aria-label="Następna strona" disabled={!document || page >= document.numPages} onClick={() => setPage(page + 1)}><ChevronRight size={17}/></button></div></div>
  </section>
}
