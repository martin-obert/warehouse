import { cp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { defineNuxtModule, useLogger } from 'nuxt/kit'

/**
 * Ships the bundled ExifTool with the production build. Local modules in `modules/` are
 * registered automatically — no nuxt.config change needed.
 *
 * exiftool-vendored loads ExifTool from the `exiftool-vendored.pl` package (`.exe` on Windows)
 * through a computed dynamic import that Nitro's dependency tracer can't follow, so `.output`
 * would be built without it (and without the ~300 Perl modules it loads at runtime). Every
 * ExifTool read would then fail as soon as the app runs outside the project directory
 * (Docker image, CI artifact…). This copies the package into `.output/server/node_modules`.
 *
 * Build on the platform you deploy to: this package and sharp's libvips binary are picked at install time.
 */
export default defineNuxtModule({
  meta: { name: 'exiftool-vendored-output' },
  setup(_options, nuxt) {
    if (nuxt.options.dev) return
    const logger = useLogger('exiftool-vendored')

    nuxt.hook('nitro:init', (nitro) => {
      if (nitro.options.static) return
      nitro.hooks.hook('compiled', async () => {
        // Resolve from exiftool-vendored itself: pnpm doesn't hoist its dependencies to the root.
        const fromRoot = createRequire(join(nuxt.options.rootDir, 'package.json'))
        const fromExiftool = createRequire(fromRoot.resolve('exiftool-vendored'))
        let copied = false
        for (const name of ['exiftool-vendored.pl', 'exiftool-vendored.exe']) {
          let source: string
          try {
            source = dirname(fromExiftool.resolve(`${name}/package.json`))
          } catch {
            continue // only the package for the build platform is installed
          }
          await cp(source, join(nitro.options.output.serverDir, 'node_modules', name), { recursive: true })
          copied = true
        }
        if (!copied) logger.warn('exiftool-vendored.pl/.exe not found: ExifTool will be missing from .output')
      })
    })
  },
})
