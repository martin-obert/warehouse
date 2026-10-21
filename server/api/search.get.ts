export default defineEventHandler(async (event) => {
    const query = getQuery(event)
    const q = typeof query.q === 'string' ? query.q : undefined

    const hits = await searchFiles({ q })

    return { hits }
})
