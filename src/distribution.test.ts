import { describe, expect, it } from 'vitest'
import { validApkUrl } from './distribution'
describe('installer URL validation', () => {
  it('accepts local downloads and a fixed GitHub Release asset', () => {
    expect(validApkUrl('/downloads/Janko-Muzykant-debug.apk')).toBe(true)
    expect(validApkUrl('/choir/downloads/Janko-Muzykant-debug.apk')).toBe(true)
    expect(validApkUrl('https://github.com/personal-user/choir/releases/latest/download/Janko-Muzykant-debug.apk')).toBe(true)
  })
  it('rejects arbitrary hosts, credentials, scripts, fragments and different assets', () => {
    for (const value of ['javascript:alert(1)', '//evil.test/downloads/Janko-Muzykant-debug.apk',
      'https://github.com.evil.test/u/r/releases/latest/download/Janko-Muzykant-debug.apk',
      'https://github.com/u/r/releases/latest/download/other.apk',
      'https://github.com/u/r/releases/latest/download/Janko-Muzykant-debug.apk?redirect=evil',
      '/../../downloads/Janko-Muzykant-debug.apk', null, {}]) expect(validApkUrl(value)).toBe(false)
  })
})
