// Client-side image helpers (browser APIs only). Shared by the paste flow and
// the example-image upload so both shrink images before hitting the server.

// We only need enough resolution for Gemini to OCR text / for a preview, not
// full photo quality, so downscale before upload. This keeps every upload well
// under the Server Action / platform request-size limits.
export const MAX_IMAGE_DIMENSION = 2000
export const IMAGE_QUALITY = 0.9
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

type CanvasSource = {
  width: number
  height: number
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
  cleanup: () => void
}

// Decode an image file into something drawable. Tries createImageBitmap first,
// then falls back to an <img> element (which on iOS Safari can render formats
// like HEIC that createImageBitmap may refuse). Returns null if neither works.
async function decodeImage(file: File): Promise<CanvasSource | null> {
  if (typeof createImageBitmap !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(file)
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
        cleanup: () => bitmap.close(),
      }
    } catch {
      // fall through to the <img> path
    }
  }

  try {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.src = url
    await img.decode()
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
      cleanup: () => URL.revokeObjectURL(url),
    }
  } catch {
    return null
  }
}

// Best-effort: shrink the image so it fits under the upload limit. If anything
// fails (unsupported format, canvas quirk, memory), fall back to the original
// bytes — a decode hiccup must never block the upload, since Gemini and Storage
// accept png/jpeg/webp/heic/heif directly.
export async function downscaleImage(file: File): Promise<File> {
  try {
    const src = await decodeImage(file)
    if (!src) return file
    try {
      const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(src.width, src.height))
      const width = Math.round(src.width * scale)
      const height = Math.round(src.height * scale)

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return file
      src.draw(ctx, width, height)

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', IMAGE_QUALITY)
      )
      return blob ? new File([blob], 'pasted.jpg', { type: 'image/jpeg' }) : file
    } finally {
      src.cleanup()
    }
  } catch {
    return file
  }
}
