export default defineEventHandler(async (event) => {
    const query = getQuery(event)
    const path = typeof query.path === 'string' ? query.path : ''

    const folders = await listChildFolders(path)

    return { folders }
})
