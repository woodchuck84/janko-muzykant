import { handleDrive } from '../_lib/drive.js'
export const onRequest = context => handleDrive(context.request, {
  cache: caches.default, limiter: context.env.DRIVE_RATE_LIMIT,
})
