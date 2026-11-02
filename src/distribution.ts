export function validApkUrl(value: unknown): value is string {
  return typeof value === 'string' && !value.split('/').some(segment => segment === '.' || segment === '..') && (
    /^\/(?:[\w.-]+\/)*downloads\/Janko-Muzykant-debug\.apk$/.test(value) ||
    /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/latest\/download\/Janko-Muzykant-debug\.apk$/.test(value))
}
