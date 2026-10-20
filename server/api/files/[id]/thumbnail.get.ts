import {getThumbnail} from "#server/utils/file-metadata-store.ts";

export default defineEventHandler(async (event) => {
    const id = Number(getRouterParam(event, 'id'))
    if (!id || id < 1) throw createError({ statusCode: 400, statusMessage: 'Invalid file id' })

    const data = await getThumbnail(id)
    if (!data) throw createError({ statusCode: 404, statusMessage: 'Thumbnail not found' })

    setHeaders(event, {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=86400',
    })
    return data
})
