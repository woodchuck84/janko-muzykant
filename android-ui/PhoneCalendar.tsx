import { useState } from 'react'
import { getDocument } from 'pdfjs-dist'
import type { Library, Material } from '../src/types'
import { calendarDates, type CalendarDate } from './calendar'

export default function PhoneCalendar({ library, cache, confirm }: {
  library: Library | null; cache: (file: Material) => Promise<Material>
  confirm: (event: string, date: string) => void
}) {
  const files = library?.other.filter(file => file.kind === 'pdf') ?? []
  const [source, setSource] = useState(files[0]?.id ?? '')
  const [dates, setDates] = useState<CalendarDate[]>([]), [event, setEvent] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  async function read() {
    setBusy(true); setError(''); setNotice(''); setDates([])
    try {
      const file = files.find(item => item.id === source)
      if (!file) throw new Error('Wybierz kalendarz PDF.')
      const saved = await cache(file)
      const task = getDocument(saved.url)
      try {
        const document = await task.promise
        if (document.numPages > 20) throw new Error('Kalendarz ma więcej niż 20 stron. Użyj dat ręcznych.')
        const found: CalendarDate[] = []
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
          const page = await document.getPage(pageNumber)
          const content = await page.getTextContent()
          const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('')
          found.push(...calendarDates(text, pageNumber))
          page.cleanup()
        }
        setDates(found)
        setNotice(found.length ? `Znaleziono ${found.length} dat. Sprawdź rok, kontekst i przypisz wydarzenie.` :
          'Brak pełnych dat liczbowych w warstwie tekstowej PDF. Skan, nazwy miesięcy lub daty bez roku wymagają ręcznego wpisania.')
      } finally { await task.destroy() }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <section className="panel"><h3>Kalendarz z PDF na telefonie</h3>
    <p className="muted">Odczyt warstwy tekstowej, nie rozpoznawanie skanu. Obsługujemy pełne daty liczbowe (np. 20.09.26). Rok z pliku nie jest poprawiany na podstawie tytułu. Zawsze potwierdź datę — przypisanie zastępuje Twoją poprzednią datę wydarzenia, bez zmian na Drive.</p>
    <label>Kalendarz PDF<select value={source} onChange={e => { setSource(e.target.value); setDates([]) }}><option value="">Wybierz PDF…</option>{files.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}</select></label>
    <button className="secondary" disabled={!source || busy} onClick={() => void read()}>Odczytaj daty z PDF</button>
    {busy && <p role="status">Odczyt kalendarza na telefonie…</p>}
    {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!!dates.length && <><label>Przypisz do wydarzenia<select value={event} onChange={e => setEvent(e.target.value)}><option value="">Wybierz wydarzenie…</option>{library?.events.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <details className="phone-calendar-dates"><summary>Lista dat z kontekstem · {dates.length}</summary>{dates.map((date, index) => <div key={`${date.page}.${index}`}><strong>{date.date} · strona {date.page}</strong><p className="muted">{date.excerpt}</p><button className="secondary" disabled={!event} onClick={() => { confirm(event, date.date); setNotice(`Zapisano Twoją datę: ${date.date}.`) }}>Potwierdź {date.date}</button></div>)}</details>
    </>}
  </section>
}
