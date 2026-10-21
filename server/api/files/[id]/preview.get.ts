import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'

export default defineEventHandler(async (event) => {
    const id = Number(getRouterParam(event, 'id'))
    if (!id || id < 1) throw createError({ statusCode: 400, statusMessage: 'Invalid file id' })

    const { contentRoot } = useRuntimeConfig()

    const row = (await useDatabase().prepare(
        'SELECT path, mime FROM files WHERE id = ?',
    ).get(id)) as { path: string; mime: string } | undefined

    if (!row) throw createError({ statusCode: 404, statusMessage: 'File not found' })
    if (!row.mime.startsWith('image/')) throw createError({ statusCode: 415, statusMessage: 'Not an image' })

    const absolutePath = `${contentRoot}/${row.path}`

    let st
    try {
        st = await stat(absolutePath)
    } catch {
        throw createError({ statusCode: 404, statusMessage: 'File not found on disk' })
    }

    const etag = `W/"${st.size}-${st.mtimeMs}"`

    if (handleCacheHeaders(event, { etag, modifiedTime: st.mtime, maxAge: 86400 })) {
        return
    }

    setHeaders(event, {
        'Content-Type': row.mime,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=86400',
    })

    const rangeHeader = getRequestHeader(event, 'range')
    if (rangeHeader) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader)
        if (match) {
            const start = Number(match[1])
            const end = match[2] ? Number(match[2]) : st.size - 1
            if (start >= st.size || end >= st.size || start > end) {
                setResponseStatus(event, 416)
                setHeader(event, 'Content-Range', `bytes */${st.size}`)
                return
            }
            setResponseStatus(event, 206)
            setHeaders(event, {
                'Content-Range': `bytes ${start}-${end}/${st.size}`,
                'Content-Length': String(end - start + 1),
            })
            return createReadStream(absolutePath, { start, end })
        }
    }

    setHeader(event, 'Content-Length', String(st.size))
    return createReadStream(absolutePath)
})
