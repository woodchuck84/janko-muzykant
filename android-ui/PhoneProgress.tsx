import { useEffect, useState } from 'react'
import { ChevronDown, Play, Square, Timer, X } from 'lucide-react'
import { timeLabel } from '../src/api'
import { minutes } from '../src/practice'

export const LABELS: Record<string, string> = { '': 'Nie zaczęte', listened: 'Przesłuchane', score: 'Z nutami', memory: 'Z pamięci', concert: 'Gotowe na koncert' }
export default function PhoneProgress({ status, started, total, onStatus, onTimer }: {
  status: string; started: number | null; total: number
  onStatus: (status: string) => void
  onTimer: (started: number | null, seconds: number) => void
}) {
  const [expanded, setExpanded] = useState(false), [tick, setTick] = useState(Date.now())
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!started) return
    setTick(Date.now())
    const timer = window.setInterval(() => setTick(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [started])
  function stop() {
    if (!started) return
    const elapsed = Math.max(0, Math.round((Date.now() - started) / 1000))
    const seconds = Math.min(elapsed, 4 * 3600)
    onTimer(null, seconds)
    setNotice(`Zapisano ${minutes(seconds)} ćwiczenia na telefonie.${elapsed > seconds ? ' Sesję ograniczono do 4 godzin.' : ''}`)
  }
  return <div className={`progress-disclosure${expanded ? ' expanded' : ''}`}>
    <button className="phone-progress-toggle secondary" aria-expanded={expanded} aria-controls="song-progress-content" onClick={() => setExpanded(value => !value)}>Postęp i czas ćwiczenia <ChevronDown size={16}/></button>
    <section id="song-progress-content" className="panel planning-song-progress" aria-label="Postęp utworu">
      <div className="planning-progress-head"><p className="muted">Łącznie ćwiczone: {minutes(total)}</p><div className="planning-timer">
        <span className="planning-clock"><Timer size={15}/>{timeLabel(started ? Math.max(0, Math.round((tick - started) / 1000)) : 0)}</span>
        {started ? <><button className="primary" onClick={stop}><Square size={14}/> Zakończ i zapisz</button><button className="icon-button" aria-label="Odrzuć pomiar" onClick={() => { onTimer(null, 0); setNotice('Pomiar odrzucony.') }}><X size={15}/></button></> :
          <button className="secondary" onClick={() => { onTimer(Date.now(), 0); setNotice('') }}><Play size={14}/> Zacznij ćwiczenie</button>}
      </div></div>
      <label>Moja gotowość<select value={status} onChange={event => onStatus(event.target.value)}>{Object.entries(LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {notice && <p role="status">{notice}</p>}
    </section>
  </div>
}
