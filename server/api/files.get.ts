export default defineEventHandler(async (event) => {
    const query = getQuery(event)
    const page = Math.max(1, Number(query.page) || 1)
    const pageSize = Math.max(1, Math.min(Number(query.pageSize) || 20, 200))
    const directory = typeof query.path === 'string' ? query.path : ''

    const { rows, total } = await listFiles({ page, pageSize, directory })

    return { rows, total, page, pageSize }
})
