import {opendir} from 'node:fs/promises'
import {join} from 'node:path'

async function* walkDir(dir: string): AsyncGenerator<string> {
    const d = await opendir(dir)
    for await (const entry of d) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
            yield* walkDir(fullPath)
        } else {
            yield fullPath
        }
    }
}

export default defineNitroPlugin((nitroApp) => {
    const config = useRuntimeConfig()

    if (!config.contentRoot) {
        throw new Error('NUXT_CONTENT_ROOT is required')
    }


    let running = true

    async function run() {
        while (running) {
            try {

                for await (const filePath of walkDir(config.contentRoot)) {
                    await tick(filePath)
                }

            } catch (err) {
                console.error('[file-indexer]', err)
            }
            await new Promise((r) => setTimeout(r, 30_000))
        }
    }

    async function tick(filePath: string) {
        console.log(`[file-indexer] tick: ${filePath}`)
    }

    run()

    nitroApp.hooks.hook('close', () => {
        running = false
    })
})
