// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { analyzeXML, decodeMusicXML, inspect, suggestion, wavBytes } from './score'

const xml = readFileSync(join('backend', 'tests', 'fixtures', 'unnamed.musicxml'), 'utf8')
describe('on-device MusicXML', () => {
  it('inspects generic staves and proposes F clef without changing the user selection', () => {
    const parts = inspect(xml)
    expect(parts).toHaveLength(3)
    expect(parts.map(part => part.id)).toEqual(['P1', 'P2', 'P3'])
    expect(suggestion(parts, 'B')).toBe('P3')
    expect(suggestion([{ ...parts[2], id: 'upper-bass', bass: true }, { ...parts[0], id: 'lower-treble' }], 'B')).toBe('upper-bass')
    expect(suggestion(parts.map(part => ({ ...part, bass: false })), 'B')).toBe('P3')
    expect(suggestion(parts, 'AII')).toBe('P2')
  })
  it('analyzes selected bass and transposes without a backend', () => {
    const result = analyzeXML(xml, 'P3', '1', 'B', 60, 2)
    expect(result.notes.length).toBeGreaterThan(0)
    expect(result.range.low_midi).toBe(50)
    expect(result.notes[0].duration).toBe(2)
    expect(result.selected_part.id).toBe('P3')
    expect(result.warnings[0]).toContain('repetycje')
    const bytes = wavBytes(result), view = new DataView(bytes.buffer)
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF')
    expect(view.getUint32(24, true)).toBe(22050)
    expect(view.getUint32(40, true)).toBe(bytes.length - 44)
    expect(bytes.some((value, index) => index > 44 && value !== 0)).toBe(true)
  })
  it('decodes an MXL with a declared score path and rejects unsafe entity declarations', () => {
    const archive = zipSync({ 'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>'), 'score.xml': strToU8(xml) })
    expect(inspect(decodeMusicXML(archive))).toHaveLength(3)
    expect(() => inspect('<!ENTITY secret SYSTEM "file:///private">' + xml)).toThrow('Niebezpieczny')
    expect(() => decodeMusicXML(zipSync({ '../unsafe': strToU8(xml) }))).toThrow('Niebezpieczna')
  })
  it('refuses chords instead of choosing a note, and rejects invalid playback limits', () => {
    const chord = xml.replace('<pitch><step>C</step><octave>3</octave></pitch>', '<chord/><pitch><step>C</step><octave>3</octave></pitch>')
    expect(() => analyzeXML(chord, 'P3', '1', 'B', 100, 0)).toThrow('akordy')
    expect(() => analyzeXML(xml, 'unknown', '1', 'B', 100, 0)).toThrow('Wybierz')
    expect(() => analyzeXML(xml, 'P3', '1', 'B', 0, 0)).toThrow('Tempo')
  })
  it('offers explicit chord bounds and renders the selected pitch without guessing', () => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    const original = doc.querySelector('part[id="P3"] note')!
    const upper = original.cloneNode(true) as Element
    upper.insertBefore(doc.createElement('chord'), upper.firstChild)
    upper.querySelector('step')!.textContent = 'E'
    original.after(upper)
    const score = new XMLSerializer().serializeToString(doc)
    expect(inspect(score).find(p => p.id === 'P3')!.line_choices.map(c => c.id)).toEqual(['upper', 'lower'])
    expect(() => analyzeXML(score, 'P3', '1', 'B', 100, 0)).toThrow('akordy')
    const low = analyzeXML(score, 'P3', 'voice:1', 'B', 100, 0, 'lower')
    const high = analyzeXML(score, 'P3', 'voice:1', 'B', 100, 0, 'upper')
    expect(low.notes[0].midi).toBe(48)
    expect(high.notes[0].midi).toBe(52)
    expect(low.notes[0].duration).toBe(high.notes[0].duration)
    expect(wavBytes(low)).not.toEqual(wavBytes(high))
  })
  it('retains errors for overlapping non-chord layers even with a chord policy', () => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    const original = doc.querySelector('part[id="P3"] note')!
    const backup = doc.createElement('backup'), duration = doc.createElement('duration')
    duration.textContent = original.querySelector('duration')!.textContent
    backup.append(duration)
    original.after(backup)
    backup.after(original.cloneNode(true))
    const score = new XMLSerializer().serializeToString(doc)
    expect(() => analyzeXML(score, 'P3', '1', 'B', 100, 0, 'lower')).toThrow('niezależne warstwy')
    expect(inspect(score).find(p => p.id === 'P3')!.line_choices).toEqual([])
  })
  const realPath = join('data', 'cache', 'omr-be24fe3e4645276e778f04de.mxl')
  it.skipIf(!existsSync(realPath))('analyzes actual cached Wojence bass without switching internal voices', () => {
    const real = decodeMusicXML(new Uint8Array(readFileSync(realPath)))
    const staff = inspect(real).find(p => p.id === 'P3')!
    expect(staff.bass).toBe(true)
    expect(staff.line_choices.map(c => c.id)).toEqual(['voice:1', 'voice:2'])
    const result = analyzeXML(real, 'P3', 'voice:2', 'B', 100, 0)
    expect([...new Set(result.notes.map(n => n.bar))]).toEqual([12, 14])
    expect(result.notes).toHaveLength(8) // Android intentionally follows written order once.
    expect(result.range.low_midi).toBe(43)
    expect(result.range.high_midi).toBe(50)
    expect(() => analyzeXML(real, 'P3', 'voice:3', 'B', 100, 0)).toThrow('Wybierz')
    expect(wavBytes(result).length).toBeGreaterThan(44)
  })
})
