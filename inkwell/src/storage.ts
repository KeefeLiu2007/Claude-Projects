import { get, set } from 'idb-keyval'
import type { Notebook } from './types'

const KEY = 'inkwell:notebooks:v1'

export async function loadNotebooks(): Promise<Notebook[]> {
  try {
    return ((await get(KEY)) as Notebook[] | undefined) ?? []
  } catch {
    return []
  }
}

let timer: number | undefined
export function saveNotebooksSoon(books: Notebook[]) {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    set(KEY, books).catch((e) => console.error('save failed', e))
  }, 400)
}

export interface Settings {
  apiKey: string
  effort: 'low' | 'medium' | 'high'
  pencilOnly: boolean
}

const SKEY = 'inkwell:settings'
export function loadSettings(): Settings {
  const d: Settings = { apiKey: '', effort: 'medium', pencilOnly: false }
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(SKEY) || '{}') }
  } catch {
    return d
  }
}
export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SKEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result as string)
    r.onerror = rej
    r.readAsDataURL(blob)
  })
}

/** Try to pull an image from the web as a data URL (so it persists and exports). Falls back to the raw URL if CORS blocks it. */
export async function importImageFromUrl(url: string): Promise<string> {
  try {
    const r = await fetch(url, { mode: 'cors' })
    if (!r.ok) throw new Error(String(r.status))
    const blob = await r.blob()
    if (!blob.type.startsWith('image/')) throw new Error('not an image')
    return await blobToDataURL(blob)
  } catch {
    return url
  }
}

export function measureImage(src: string): Promise<{ w: number; h: number }> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => rej(new Error('Could not load image'))
    img.src = src
  })
}
