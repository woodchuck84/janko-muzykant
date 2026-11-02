export class ApiError extends Error {
  detail: unknown
  constructor(message: string, detail: unknown) { super(message); this.detail = detail }
}
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  const csrf = getSession()?.csrf
  if (csrf && init?.method && !['GET', 'HEAD', 'OPTIONS'].includes(init.method.toUpperCase())) headers.set('X-CSRF-Token', csrf)
  const response = await fetch(url, { ...init, headers })
  if (response.status === 401 && getSession()?.hosted) window.location.assign('/auth/login')
  if (!response.ok) {
    if (getSession()?.hosted && [504, 524].includes(response.status)) {
      throw new ApiError('Przekroczono czas oczekiwania serwera lub tunelu. OMR dużego PDF może trwać kilka minut. Spróbuj ponownie po chwili; administrator może zamiast tego zaimportować gotowy MusicXML.', { status: response.status })
    }
    const payload = await response.json().catch(() => ({ detail: `HTTP ${response.status}` })) as { detail?: unknown }
    const detail = payload.detail
    const message = typeof detail === 'string' ? detail :
      detail && typeof detail === 'object' && 'message' in detail ? String(detail.message) :
      `Żądanie nie powiodło się (HTTP ${response.status}).`
    throw new ApiError(message, detail)
  }
  return response.json() as Promise<T>
}
export function post<T>(url: string, body: unknown): Promise<T> {
  return api<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
export function isMyPart(track: string | null, part: string) {
  return track === part || track === part[0]
}
export function timeLabel(value: number) {
  if (!Number.isFinite(value)) return '0:00'
  return `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, '0')}`
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
import { getSession } from './session'
