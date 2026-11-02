export interface Session {
  hosted: boolean; user_id: string; email: string | null; admin: boolean; csrf: string | null
}
let session: Session | null = null
export function setSession(value: Session) { session = value }
export function getSession() { return session }
export function personalKey(key: string) {
  return session?.hosted ? `account.${session.user_id}.${key}` : key
}
export const userStorage = {
  getItem: (key: string) => window.localStorage.getItem(personalKey(key)),
  setItem: (key: string, value: string) => window.localStorage.setItem(personalKey(key), value),
  removeItem: (key: string) => window.localStorage.removeItem(personalKey(key))
}
