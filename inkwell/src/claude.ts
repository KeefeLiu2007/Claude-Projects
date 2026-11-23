import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import type { ChatMessage } from './types'

export const MODEL = 'claude-opus-5-5'
// Server-side refusal fallback: if Opus 5.5 declines, the API re-routes to a suitable model in the same call.
const BETAS = ['server-side-fallback-2026-07-01']

const SYSTEM = `You are the study assistant built into Inkwell, a handwritten note-taking app.
The user may attach a snapshot of their current notebook page (handwriting, highlights, diagrams, images, mind maps).
Read handwriting carefully. Be clear and well structured, and keep answers a comfortable length for reading inside a narrow side panel.
Use plain text with simple "-" bullets and short headings; avoid wide tables.`

function client(apiKey: string) {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
}

function toParams(history: ChatMessage[]): Anthropic.Beta.BetaMessageParam[] {
  return history.map((m) => {
    if (m.role === 'user' && m.image) {
      return {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: m.image } },
          { type: 'text', text: m.text || 'Here is my current page.' },
        ],
      }
    }
    return { role: m.role, content: m.text }
  })
}

export async function streamChat(opts: {
  apiKey: string
  effort: 'low' | 'medium' | 'high'
  history: ChatMessage[]
  onText: (fullText: string) => void
  signal?: AbortSignal
}): Promise<string> {
  const stream = client(opts.apiKey).beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 64000,
      betas: BETAS,
      fallbacks: 'default',
      output_config: { effort: opts.effort },
      system: SYSTEM,
      messages: toParams(opts.history),
    },
    { signal: opts.signal },
  )
  let text = ''
  for await (const ev of stream) {
    if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
      text += ev.delta.text
      opts.onText(text)
    }
  }
  const final = await stream.finalMessage()
  if (final.stop_reason === 'refusal') {
    text += '\n\n(Claude declined to answer this one.)'
    opts.onText(text)
  }
  return text
}

const Ideas = z.object({ ideas: z.array(z.string()) })

/** Ask Claude for child ideas to branch off a mind-map node. */
export async function expandNode(apiKey: string, path: string[], siblings: string[]): Promise<string[]> {
  const res = await client(apiKey).beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: BETAS,
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaZodOutputFormat(Ideas) },
    messages: [
      {
        role: 'user',
        content: `I'm building a mind map. Path from the root to the node I want to expand: ${path
          .map((p) => `"${p}"`)
          .join(' > ')}.
${siblings.length ? `It already has these children: ${siblings.join(', ')}.\n` : ''}Suggest 3 to 5 new child ideas for the last node. Each idea must be 1-5 words.`,
      },
    ],
  })
  if (res.stop_reason === 'refusal') throw new Error('Claude declined this request.')
  return res.parsed_output?.ideas.slice(0, 6) ?? []
}

const MapSchema = z.object({
  root: z.string(),
  branches: z.array(z.object({ label: z.string(), children: z.array(z.string()) })),
})
export type MapOutline = z.infer<typeof MapSchema>

/** Ask Claude to draft a whole two-level mind map for a topic. */
export async function generateMindmap(apiKey: string, topic: string, pageImage?: string | null): Promise<MapOutline> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = []
  if (pageImage) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: pageImage } })
  content.push({
    type: 'text',
    text: `Create a mind map ${topic ? `about: ${topic}` : 'summarising the attached notes page'}.
Use a short root label, 4 to 6 branches, and 2 to 4 children per branch. Every label must be 1-5 words.`,
  })
  const res = await client(apiKey).beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: BETAS,
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaZodOutputFormat(MapSchema) },
    messages: [{ role: 'user', content }],
  })
  if (res.stop_reason === 'refusal' || !res.parsed_output) throw new Error('Claude could not produce a mind map.')
  return res.parsed_output
}

export function friendlyError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'Your API key was rejected. Check it in Settings.'
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited — wait a moment and try again.'
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API. Check your connection.'
  if (e instanceof Anthropic.APIError) return `Claude API error ${e.status ?? ''}: ${e.message}`
  if (e instanceof Error) return e.message
  return String(e)
}
