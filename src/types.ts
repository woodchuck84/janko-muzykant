export type Part = 'SI' | 'SII' | 'AI' | 'AII' | 'B'
export const PARTS: Part[] = ['SI', 'SII', 'AI', 'AII', 'B']
export const PART_LABELS: Record<Part, string> = { SI: 'Sopran I', SII: 'Sopran II', AI: 'Alt I', AII: 'Alt II', B: 'Bas / baryton' }
export interface Material {
  id: string; song_id: string | null; event_id: string | null; name: string
  kind: 'audio' | 'pdf' | 'musicxml' | 'document'; part: string | null
  slow: boolean; full: boolean; section: string; cached: boolean; url: string; drive_url: string | null
}
export interface Song { id: string; name: string; files: Material[]; event_ids: string[] }
export interface Library { events: { id: string; name: string }[]; songs: Song[]; other: Material[]; last_sync: string | null }
export interface Config { root_id: string; client_id: string; connected: boolean; last_sync: string | null
  sync: { running: boolean; message: string; warnings: string[]; folders: number; files: number } }
export interface NoteEvent { time: number; duration: number; midi: number; pitch: string; bar: number; beat: number; lyric: string }
export interface ScoreLineChoice {
  id: string; name: string
  range: { low: string; high: string; low_midi: number; high_midi: number } | null
}
export interface ScoreStaff {
  id: string; name: string; code?: string | null; staff: number
  range: { low: string; high: string } | null
  multiple_lines: boolean; bass_clef: boolean; line_choices: ScoreLineChoice[]
}
export interface ScoreInfo {
  parts: ScoreStaff[]; automatic_part_id: string | null; suggested_part_id: string | null
  source_id: string; musicxml_url: string
}
export interface Analysis {
  parts: { id: string; name: string }[]; selected_part: { id: string; name: string }; requested_part: string
  warning: string | null; warnings: string[]
  range: { low: string; high: string; low_midi: number; high_midi: number }
  tempo: number; duration: number; notes: NoteEvent[]
  bars: { number: number; difficulty: number; reasons: string[] }[]
  breaths: { bar: number; beat: number; reason: string }[]
  entrances: { bar: number; beat: number; pitch: string; cue: string }[]
  lyrics: { bar: number; beat: number; text: string }[]
  source_id: string; musicxml_url: string
}
export interface Bookmark { time: number; label: string }
