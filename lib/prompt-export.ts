import type { Prompt } from '@/lib/types'

function triggerDownload(filename: string, mimeType: string, data: string) {
  const blob = new Blob([data], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10)
}

export function exportPromptsAsJson(prompts: Prompt[]) {
  triggerDownload(
    `promptvault-${stamp()}.json`,
    'application/json',
    JSON.stringify(prompts, null, 2)
  )
}

export function exportPromptsAsMarkdown(prompts: Prompt[]) {
  const body = prompts
    .map((p) => {
      const lines = [`## ${p.title}`]
      if (p.description) lines.push('', `_${p.description}_`)
      if (p.tags.length) lines.push('', `Tags: ${p.tags.join(', ')}`)
      lines.push('', '```', p.content, '```')
      return lines.join('\n')
    })
    .join('\n\n---\n\n')

  triggerDownload(`promptvault-${stamp()}.md`, 'text/markdown', `# PromptVault export\n\n${body}\n`)
}
