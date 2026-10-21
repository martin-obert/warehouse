import { cp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { defineNuxtModule, useLogger } from 'nuxt/kit'

/**
 * Ships sharp's WASM runtime with the production build. Local modules in `modules/` are
 * registered automatically — no nuxt.config change needed.
 *
 * On 32-bit ARM + musl (e.g. Raspberry Pi 2 running Alpine) sharp has no native binary at all —
 * `@img/sharp-wasm32` is the only runtime that can ever work there. Its loader
 * (`lib/*.node.js`) pulls in the actual `.wasm` binary through a runtime-computed
 * `fs.readFileSync` call that Nitro's dependency tracer can't follow, so `.output` would ship
 * the small JS loader but not the ~9MB binary it needs — sharp then fails with an ENOENT for the
 * `.wasm` file at startup. This copies the whole package into `.output/server/node_modules`.
 */
export default defineNuxtModule({
  meta: { name: 'sharp-wasm32-output' },
  setup(_options, nuxt) {
    if (nuxt.options.dev) return
    const logger = useLogger('sharp-wasm32')

    nuxt.hook('nitro:init', (nitro) => {
      if (nitro.options.static) return
      nitro.hooks.hook('compiled', async () => {
        const fromRoot = createRequire(join(nuxt.options.rootDir, 'package.json'))
        let source: string
        try {
          // `@img/sharp-wasm32`'s own `exports` map only exposes `./package` (not the literal
          // `./package.json` subpath) as an alias for its package.json.
          source = dirname(fromRoot.resolve('@img/sharp-wasm32/package'))
        } catch {
          logger.warn('@img/sharp-wasm32 not found: sharp WASM fallback will be missing from .output')
          return
        }
        await cp(source, join(nitro.options.output.serverDir, 'node_modules', '@img', 'sharp-wasm32'), { recursive: true })
      })
    })
  },
})
