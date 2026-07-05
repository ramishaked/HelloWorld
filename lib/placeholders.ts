// Placeholders let a saved prompt act as a reusable template, e.g.
// "Summarize {{topic}} for a {{audience}}". We detect fill-in tokens so the UI
// can offer to fill them in before copying/sharing.
//
// Only three *unambiguous* notations are matched by pattern: {{name}}, ${name},
// and [name]. Bare {name} (JSON/code), <name> (HTML) and unbracketed CAPS words
// are intentionally NOT matched here — they collide with ordinary prompt text,
// so they're normalized to {{name}} by the AI at analyze time instead.

// name = a plausible fill-in label: starts with a letter, then letters/digits/
// spaces/underscores/hyphens.
const LABEL = '[A-Za-z][A-Za-z0-9 _-]{0,40}'
const DOUBLE_BRACE = new RegExp(`\\{\\{\\s*(${LABEL})\\s*\\}\\}`, 'g')
const DOLLAR_BRACE = new RegExp(`\\$\\{\\s*(${LABEL})\\s*\\}`, 'g')
// [name] but NOT markdown links [text](url) — enforced via a negative lookahead
// on the trailing "(". Citations like [1] are excluded because LABEL must start
// with a letter.
const SQUARE = new RegExp(`\\[\\s*(${LABEL})\\s*\\](?!\\()`, 'g')

function eachMatch(content: string, re: RegExp, fn: (name: string) => void) {
  for (const match of content.matchAll(re)) {
    const name = match[1].trim()
    if (name) fn(name)
  }
}

export function extractPlaceholders(content: string): string[] {
  const seen = new Set<string>()
  eachMatch(content, DOUBLE_BRACE, (n) => seen.add(n))
  eachMatch(content, DOLLAR_BRACE, (n) => seen.add(n))
  eachMatch(content, SQUARE, (n) => seen.add(n))
  return Array.from(seen)
}

export function applyPlaceholders(content: string, values: Record<string, string>): string {
  const replace = (whole: string, rawName: string) => {
    const value = values[String(rawName).trim()]
    return value && value.length > 0 ? value : whole
  }
  return content
    .replace(DOUBLE_BRACE, replace)
    .replace(DOLLAR_BRACE, replace)
    .replace(SQUARE, replace)
}
