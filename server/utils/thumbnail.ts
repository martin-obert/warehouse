import sharp from 'sharp'

export async function generateThumbnail(
    absolutePath: string,
    mime: string,
): Promise<{ data: Buffer; width: number; height: number } | null> {
    if (!mime.startsWith('image/')) return null

    try {
        const result = await sharp(absolutePath)
            .resize({ width: 64, withoutEnlargement: true })
            .webp({ quality: 50 })
            .toBuffer({ resolveWithObject: true })

        return { data: result.data, width: result.info.width, height: result.info.height }
    } catch {
        return null
    }
}
