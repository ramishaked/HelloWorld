// Placeholders let a saved prompt act as a reusable template, e.g.
// "Summarize {{topic}} for a {{audience}}". We detect {{name}} tokens so the
// UI can offer to fill them in before copying/sharing.

const PLACEHOLDER_RE = /\{\{\s*([^}]+?)\s*\}\}/g

export function extractPlaceholders(content: string): string[] {
  const seen = new Set<string>()
  for (const match of content.matchAll(PLACEHOLDER_RE)) {
    const name = match[1].trim()
    if (name) seen.add(name)
  }
  return Array.from(seen)
}

export function applyPlaceholders(content: string, values: Record<string, string>): string {
  return content.replace(PLACEHOLDER_RE, (whole, rawName) => {
    const name = String(rawName).trim()
    const value = values[name]
    return value && value.length > 0 ? value : whole
  })
}
