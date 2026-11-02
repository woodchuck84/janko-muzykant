import { handleDrive } from '../functions/_lib/drive.js'
export default {
  async fetch(request, env) {
    const response = await handleDrive(request, { cache: caches.default, limiter: env.DRIVE_RATE_LIMIT })
    const result = new Response(response.body, response)
    result.headers.set('Access-Control-Allow-Origin', '*')
    return result
  },
}
