import sharp from 'sharp'
import {getFileMetadata} from "#server/utils/file-metadata-store.ts";

export default defineEventHandler(async (event) => {
    const id = Number(getRouterParam(event, 'id'))
    if (!id || id < 1) throw createError({ statusCode: 400, statusMessage: 'Invalid file id' })

    const {contentRoot} = useRuntimeConfig()

    const row = (await useDatabase().prepare(
        'SELECT path, mime FROM files WHERE id = ?',
    ).get(id)) as { path: string; mime: string } | undefined

    if (!row) throw createError({ statusCode: 404, statusMessage: 'File not found' })
    if (!row.mime.startsWith('image/')) throw createError({ statusCode: 415, statusMessage: 'Not an image' })

    const absolutePath = `${contentRoot}/${row.path}`

    try {
        const buffer = await sharp(absolutePath)
            .resize({ width: 800, withoutEnlargement: true })
            .webp({ quality: 75 })
            .toBuffer()

        setHeaders(event, {
            'Content-Type': 'image/webp',
            'Cache-Control': 'public, max-age=86400',
        })
        return buffer
    } catch {
        throw createError({ statusCode: 500, statusMessage: 'Failed to generate preview' })
    }
})
