import sharp from 'sharp'
import { configureFileMetadata, shutdownExifTool } from '../lib/file-metadata'

sharp.cache(false)
sharp.concurrency(1)

/**
 * ExifTool runs as long-lived perl child processes (a warm process answers in ~10–30 ms instead of
 * 100+ ms per spawn). Nitro calls `close` on graceful shutdown and when the dev server reloads,
 * so end them there instead of leaving orphans behind.
 */
export default defineNitroPlugin((nitroApp) => {
  const { indexerConcurrency } = useRuntimeConfig()
  configureFileMetadata({ maxConcurrent: Number(indexerConcurrency) || 1 })

  nitroApp.hooks.hook('close', shutdownExifTool)
})
