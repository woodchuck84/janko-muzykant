import { strFromU8, unzipSync } from 'fflate'
import type { Analysis, NoteEvent, Part, ScoreLineChoice } from '../src/types'

const MAX_XML = 10 * 1024 * 1024
const pitchSteps: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
export interface Staff {
  id: string; name: string; bass: boolean; voices: string[]; low: number | null; high: number | null
  line_choices: ScoreLineChoice[]
}
const text = (node: Element, query: string) => node.querySelector(query)?.textContent?.trim() ?? ''
const children = (node: Element, tag: string) => [...node.children].filter(child => child.localName === tag)
function number(node: Element, query: string, fallback: number) {
  const value = Number(text(node, query))
  return text(node, query) && Number.isFinite(value) ? value : fallback
}
export function pitchName(midi: number) {
  return ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1)
}
function midi(note: Element): number | null {
  const pitch = note.querySelector('pitch')
  if (!pitch) return null
  const step = pitchSteps[text(pitch, 'step')]
  const octave = number(pitch, 'octave', NaN)
  const value = step + (octave + 1) * 12 + number(pitch, 'alter', 0)
  if (!Number.isInteger(value) || value < 0 || value > 127) throw new Error('Partytura zawiera nieobsługiwaną wysokość lub mikrotony.')
  return value
}
export function decodeMusicXML(bytes: Uint8Array): string {
  if (bytes.length > MAX_XML) throw new Error('MusicXML przekracza 10 MB.')
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return new TextDecoder().decode(bytes)
  let total = 0, count = 0
  const files = unzipSync(bytes, { filter: entry => {
    total += entry.originalSize; count++
    if (total > 60 * 1024 * 1024 || count > 500 || entry.originalSize > 25 * 1024 * 1024) throw new Error('Archiwum MXL jest zbyt duże.')
    if (entry.name.split(/[\\/]/).some(segment => segment === '..') || entry.name.startsWith('/')) throw new Error('Niebezpieczna ścieżka w MXL.')
    return true
  } })
  const container = files['META-INF/container.xml']
  if (!container) throw new Error('MXL nie zawiera META-INF/container.xml.')
  const metadata = new DOMParser().parseFromString(strFromU8(container), 'application/xml')
  const root = metadata.querySelector('rootfile')?.getAttribute('full-path')
  if (!root || !files[root]) throw new Error('Nie znaleziono partytury w MXL.')
  const xml = strFromU8(files[root])
  if (xml.length > MAX_XML) throw new Error('MusicXML po rozpakowaniu przekracza 10 MB.')
  return xml
}
function document(xml: string): Document {
  if (xml.length > MAX_XML || /<!ENTITY/i.test(xml)) throw new Error('Niebezpieczny lub zbyt duży MusicXML.')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'score-partwise') throw new Error('Potrzebny jest poprawny MusicXML score-partwise.')
  if (doc.querySelectorAll('note').length > 20000 || doc.querySelectorAll('measure').length > 5000) throw new Error('Partytura jest zbyt duża do przetworzenia na telefonie.')
  return doc
}
export function inspect(xml: string): Staff[] {
  return inspectDocument(document(xml), xml)
}
function inspectDocument(doc: Document, xml?: string): Staff[] {
  return children(doc.documentElement, 'part').map(part => {
    const id = part.getAttribute('id') ?? ''
    const descriptor = [...doc.querySelectorAll('score-part')].find(item => item.getAttribute('id') === id)
    const pitches = [...part.querySelectorAll('note')].map(midi).filter((value): value is number => value !== null)
    const voices = [...new Set([...part.querySelectorAll('note')].filter(note => midi(note) !== null).map(note => text(note, 'voice') || '1'))]
    const info: Staff = { id, name: descriptor ? text(descriptor, 'part-name') || id : id,
      bass: [...part.querySelectorAll('clef')].some(clef => text(clef, 'sign') === 'F'),
      voices, line_choices: [],
      low: pitches.length ? Math.min(...pitches) : null, high: pitches.length ? Math.max(...pitches) : null }
    if (xml) {
      const candidates = voices.map(voice => ({ id: `voice:${voice}`, name: `Głos wewnętrzny ${voice}`, voice, policy: undefined as 'upper' | 'lower' | undefined }))
      if (voices.length === 1 && part.querySelector('chord')) candidates.push(
        { id: 'upper', name: 'Górna nuta akordu', voice: voices[0], policy: 'upper' },
        { id: 'lower', name: 'Dolna nuta akordu', voice: voices[0], policy: 'lower' })
      for (const candidate of candidates) {
        try {
          const analysis = analyzeXML(xml, id, candidate.voice, 'B', 100, 0, candidate.policy)
          info.line_choices.push({ id: candidate.id, name: candidate.name, range: analysis.range })
        } catch { /* Unsupported layers are never advertised as extractable choices. */ }
      }
    }
    return info
  })
}
export function suggestion(parts: Staff[], requested: Part) {
  if (requested === 'B') return parts.filter(part => part.bass).at(-1)?.id ?? parts.at(-1)?.id ?? ''
  return parts[requested.startsWith('S') ? 0 : parts.length >= 3 ? 1 : Math.max(0, parts.length - 1)]?.id ?? ''
}
export function analyzeXML(xml: string, staffId: string, voice: string, requested: Part, tempo: number, transpose: number,
  chordPolicy?: 'upper' | 'lower'): Analysis {
  if (!Number.isFinite(tempo) || tempo < 30 || tempo > 240 || !Number.isInteger(transpose) || Math.abs(transpose) > 12) throw new Error('Tempo 30–240 BPM; transpozycja od −12 do +12 półtonów.')
  const doc = document(xml), parts = inspectDocument(doc)
  voice = voice.replace(/^voice:/, '')
  if (chordPolicy !== undefined && chordPolicy !== 'upper' && chordPolicy !== 'lower') throw new Error('Wybierz górną lub dolną nutę akordu.')
  const staff = children(doc.documentElement, 'part').find(part => part.getAttribute('id') === staffId)
  const info = parts.find(part => part.id === staffId)
  if (!staff || !info || !info.voices.includes(voice)) throw new Error('Wybierz pięciolinię i linię głosu.')
  const notes: NoteEvent[] = [], breaths: Analysis['breaths'] = []
  let divisions = 1, beats = 4, beatType = 4, offset = 0
  let warnings = ['Odtwarzanie w kolejności zapisanych taktów: repetycje, volta, D.C./D.S., fermaty i zmiany tempa nie są rozwijane. Ustal stałe tempo i porównaj z PDF.']
  warnings.push('Tylko wybrany głos wewnętrzny jest uwzględniany. OMR może zmieniać identyfikatory między taktami; brakujących taktów nie uzupełniamy innym głosem. Porównaj z PDF.')
  if (staff.querySelector('transpose')) throw new Error('Instrument transponujący w MusicXML nie jest jeszcze obsługiwany. Zaimportuj zapis w wysokości koncertowej.')
  for (const [index, measure] of children(staff, 'measure').entries()) {
    divisions = number(measure, 'attributes > divisions', divisions)
    beats = number(measure, 'attributes > time > beats', beats)
    beatType = number(measure, 'attributes > time > beat-type', beatType)
    if (divisions <= 0 || divisions > 100000 || beats <= 0 || beatType <= 0) throw new Error('Nieprawidłowe divisions lub metrum.')
    let cursor = 0, extent = 0, previousStart = 0
    const groups: { items: Element[]; start: number; duration: number }[] = []
    let previousGroup: typeof groups[number] | undefined
    const bar = Number(measure.getAttribute('number')) || index + 1
    for (const item of measure.children) {
      const duration = number(item, 'duration', 0) / divisions
      if (item.localName === 'backup') { cursor -= duration; if (cursor < -0.001) throw new Error('Nieprawidłowy rytm MusicXML.'); continue }
      if (item.localName === 'forward') { cursor += duration; extent = Math.max(extent, cursor); continue }
      if (item.localName !== 'note') continue
      if (item.querySelector('grace')) continue
      const chord = !!item.querySelector('chord')
      const start = chord ? previousStart : cursor
      if (!chord) { previousStart = start; cursor += duration }
      extent = Math.max(extent, cursor)
      if (!chord) previousGroup = undefined
      if ((text(item, 'voice') || '1') !== voice) continue
      if (chord && midi(item) !== null) {
        if (!chordPolicy) throw new Error('Ta linia zawiera akordy. Wybierz jawnie górną lub dolną nutę akordu.')
        if (!previousGroup || previousGroup.start !== start || previousGroup.duration !== duration ||
          previousGroup.items.some(note => midi(note) === null)) throw new Error('Akord zawiera nieobsługiwane niezależne warstwy lub różne długości nut.')
        previousGroup.items.push(item)
        continue
      }
      previousGroup = { items: [item], start, duration }
      groups.push(previousGroup)
    }
    for (const group of groups) {
      const { start, duration } = group
      const item = [...group.items].sort((a, b) => (midi(a) ?? 0) - (midi(b) ?? 0))[chordPolicy === 'lower' ? 0 : group.items.length - 1]
      if (item.querySelector('rest')) {
        if (duration >= 0.5) breaths.push({ bar, beat: start + 1, reason: 'Pauza w wybranej linii — możliwy oddech.' })
        continue
      }
      const value = midi(item)
      if (value === null || duration <= 0) continue
      const transposed = value + transpose
      if (transposed < 21 || transposed > 108) throw new Error('Wysokość poza zakresem generatora (A0–C8).')
      const event: NoteEvent = { time: (offset + start) * 60 / tempo, duration: duration * 60 / tempo,
        midi: transposed, pitch: pitchName(transposed), bar, beat: start + 1,
        lyric: [...(item.querySelector('lyric') ? item : group.items[0]).querySelectorAll('lyric text')].map(lyric => lyric.textContent ?? '').join(' ') }
      const previous = notes.at(-1)
      const tieStop = [...item.querySelectorAll('tie')].some(tie => tie.getAttribute('type') === 'stop')
      if (tieStop && previous && previous.midi === transposed && Math.abs(previous.time + previous.duration - event.time) < 0.005) previous.duration += event.duration
      else notes.push(event)
    }
    // Implicit pickup bars must not be padded to a full measure.
    offset += measure.getAttribute('implicit') === 'yes' || index === 0 && extent < beats * 4 / beatType ?
      extent : Math.max(extent, beats * 4 / beatType)
  }
  notes.sort((a, b) => a.time - b.time)
  if (!notes.length) throw new Error('Brak nut w wybranej linii.')
  for (let index = 1; index < notes.length; index++) if (notes[index].time < notes[index - 1].time + notes[index - 1].duration - 0.005) {
    throw new Error('Linia zawiera jednoczesne nuty lub niezależne warstwy. Wybierz osobny głos w MusicXML.')
  }
  const duration = Math.max(offset * 60 / tempo, ...notes.map(note => note.time + note.duration))
  if (duration > 900) throw new Error('Przewodnik przekracza limit 15 minut.')
  const values = notes.map(note => note.midi), low = Math.min(...values), high = Math.max(...values)
  const bars = [...new Set(notes.map(note => note.bar))].map(bar => {
    const items = notes.filter(note => note.bar === bar)
    const jumps = items.filter((note, i) => i && Math.abs(note.midi - items[i - 1].midi) >= 5).length
    const fast = items.filter(note => note.duration < 0.3).length
    return { number: bar, difficulty: Math.min(100, jumps * 20 + fast * 8), reasons: [jumps ? 'Skoki interwałowe' : '', fast ? 'Krótkie wartości' : ''].filter(Boolean) }
  })
  if (staff.querySelector('grace')) warnings = [...warnings, 'Przednutki są pomijane.']
  return { parts, selected_part: { id: staffId, name: `${info.name} · głos ${voice}` }, requested_part: requested,
    warning: null, warnings, range: { low: pitchName(low), high: pitchName(high), low_midi: low, high_midi: high },
    tempo, duration, notes, bars, breaths, entrances: notes.filter((note, index) => !index ||
      note.time - (notes[index - 1].time + notes[index - 1].duration) >= 0.3).map(note => ({ bar: note.bar, beat: note.beat, pitch: note.pitch, cue: 'Wejście po pauzie.' })),
    lyrics: notes.filter(note => note.lyric).map(note => ({ bar: note.bar, beat: note.beat, text: note.lyric })),
    source_id: '', musicxml_url: '' }
}
export function wavBytes(analysis: Analysis) {
  const rate = 22050, length = Math.ceil((analysis.duration + 0.3) * rate)
  if (length > 901 * rate) throw new Error('Nagranie jest zbyt długie.')
  const buffer = new ArrayBuffer(44 + length * 2), view = new DataView(buffer)
  function ascii(offset: number, value: string) { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)) }
  ascii(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  ascii(36, 'data'); view.setUint32(40, length * 2, true)
  for (const note of analysis.notes) {
    const start = Math.round(note.time * rate), end = Math.min(length, Math.round((note.time + note.duration) * rate))
    const frequency = 440 * 2 ** ((note.midi - 69) / 12)
    for (let frame = start; frame < end; frame++) {
      const time = (frame - start) / rate
      const envelope = Math.min(1, time / 0.015, (end - frame) / (rate * 0.04))
      const sample = Math.sin(2 * Math.PI * frequency * time) + 0.2 * Math.sin(4 * Math.PI * frequency * time)
      view.setInt16(44 + frame * 2, Math.round(sample * envelope * 15000), true)
    }
  }
  return new Uint8Array(buffer)
}
export function base64(bytes: Uint8Array) {
  let value = ''
  for (let index = 0; index < bytes.length; index += 16384) value += String.fromCharCode(...bytes.subarray(index, index + 16384))
  return btoa(value)
}
