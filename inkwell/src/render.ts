import { PAGE_H, PAGE_W, type Page, type MindNode, type TextItem } from './types'
import { strokePath } from './geometry'

export const LINED_TOP = (spacing: number) => Math.max(120, spacing * 3)
export const MARGIN_X = 130

export const NODE_FONT = 22
export const NODE_PAD_X = 18
export const NODE_PAD_Y = 10

function drawBackground(ctx: CanvasRenderingContext2D, page: Page) {
  const s = page.style
  ctx.fillStyle = s.paper
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)
  ctx.strokeStyle = s.lineColor
  ctx.fillStyle = s.lineColor
  ctx.lineWidth = s.lineWidth
  const sp = s.spacing
  if (s.template === 'lined') {
    ctx.beginPath()
    for (let y = LINED_TOP(sp); y < PAGE_H - sp / 2; y += sp) {
      ctx.moveTo(0, y)
      ctx.lineTo(PAGE_W, y)
    }
    ctx.stroke()
    if (s.margin) {
      ctx.strokeStyle = '#e8a0a0'
      ctx.beginPath()
      ctx.moveTo(MARGIN_X, 0)
      ctx.lineTo(MARGIN_X, PAGE_H)
      ctx.stroke()
    }
  } else if (s.template === 'grid') {
    ctx.beginPath()
    for (let x = sp; x < PAGE_W; x += sp) {
      ctx.moveTo(x, 0)
      ctx.lineTo(x, PAGE_H)
    }
    for (let y = sp; y < PAGE_H; y += sp) {
      ctx.moveTo(0, y)
      ctx.lineTo(PAGE_W, y)
    }
    ctx.stroke()
  } else if (s.template === 'dotted') {
    const r = Math.max(0.8, s.lineWidth * 1.4)
    for (let x = sp; x < PAGE_W; x += sp)
      for (let y = sp; y < PAGE_H; y += sp) {
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
  }
}

const imgCache = new Map<string, Promise<HTMLImageElement | null>>()
function loadImg(src: string) {
  let p = imgCache.get(src)
  if (!p) {
    p = new Promise((res) => {
      const img = new Image()
      if (!src.startsWith('data:')) img.crossOrigin = 'anonymous'
      img.onload = () => res(img)
      img.onerror = () => res(null)
      img.src = src
    })
    imgCache.set(src, p)
  }
  return p
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const out: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/)
    let line = ''
    for (const w of words) {
      const test = line + w
      if (ctx.measureText(test).width > maxW && line.trim()) {
        out.push(line.trimEnd())
        line = w.trimStart()
      } else line = test
    }
    out.push(line)
  }
  return out
}

function drawText(ctx: CanvasRenderingContext2D, t: TextItem) {
  ctx.fillStyle = t.color
  ctx.font = `${t.fontSize}px ${FONT}`
  ctx.textBaseline = 'top'
  const lh = t.fontSize * 1.35
  wrapLines(ctx, t.text, t.w - 8).forEach((l, i) => ctx.fillText(l, t.x + 4, t.y + 4 + i * lh))
}

export const FONT = `"Inter", system-ui, -apple-system, "Segoe UI", sans-serif`

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawNode(ctx: CanvasRenderingContext2D, n: MindNode, isRoot: boolean) {
  const fs = isRoot ? NODE_FONT + 4 : NODE_FONT
  ctx.font = `${isRoot ? 700 : 500} ${fs}px ${FONT}`
  const lines = wrapLines(ctx, n.text || ' ', 260)
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + NODE_PAD_X * 2
  const lh = fs * 1.3
  const h = lines.length * lh + NODE_PAD_Y * 2
  const x = n.x - w / 2,
    y = n.y - h / 2
  ctx.fillStyle = isRoot ? n.color : '#ffffff'
  ctx.strokeStyle = n.color
  ctx.lineWidth = 3
  roundRect(ctx, x, y, w, h, 14)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = isRoot ? '#ffffff' : '#1d2433'
  ctx.textBaseline = 'top'
  ctx.textAlign = 'center'
  lines.forEach((l, i) => ctx.fillText(l, n.x, y + NODE_PAD_Y + i * lh))
  ctx.textAlign = 'left'
}

/** Render a page to a canvas. `scale` 1 = 1240x1754. */
export async function renderPage(page: Page, scale = 1): Promise<HTMLCanvasElement> {
  const c = document.createElement('canvas')
  c.width = Math.round(PAGE_W * scale)
  c.height = Math.round(PAGE_H * scale)
  const ctx = c.getContext('2d')!
  ctx.scale(scale, scale)
  drawBackground(ctx, page)

  for (const it of page.items) {
    if (it.kind !== 'image') continue
    const img = await loadImg(it.src)
    if (img) ctx.drawImage(img, it.x, it.y, it.w, it.h)
  }

  const nodes = page.items.filter((i): i is MindNode => i.kind === 'node')
  const byId = new Map(nodes.map((n) => [n.id, n]))
  ctx.lineWidth = 3
  for (const n of nodes) {
    const p = n.parentId ? byId.get(n.parentId) : undefined
    if (!p) continue
    ctx.strokeStyle = n.color
    const mx = (p.x + n.x) / 2
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.bezierCurveTo(mx, p.y, mx, n.y, n.x, n.y)
    ctx.stroke()
  }

  for (const pass of ['highlighter', 'pen'] as const) {
    for (const it of page.items) {
      if (it.kind !== 'stroke' || it.tool !== pass) continue
      ctx.save()
      if (pass === 'highlighter') {
        ctx.globalAlpha = 0.38
        ctx.globalCompositeOperation = 'multiply'
      }
      ctx.fillStyle = it.color
      ctx.fill(new Path2D(strokePath(it)))
      ctx.restore()
    }
  }

  for (const n of nodes) drawNode(ctx, n, !n.parentId || !byId.has(n.parentId))
  for (const it of page.items) if (it.kind === 'text') drawText(ctx, it)
  return c
}

export function canvasToBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => {
    try {
      c.toBlob((b) => (b ? res(b) : rej(new Error('export failed'))), 'image/png')
    } catch (e) {
      rej(e)
    }
  })
}

/** Base64 PNG (no prefix) of a page, for sending to Claude. Returns null if a cross-origin image taints the canvas. */
export async function pageSnapshotBase64(page: Page): Promise<string | null> {
  const c = await renderPage(page, 0.6)
  try {
    return c.toDataURL('image/png').split(',')[1]
  } catch {
    return null
  }
}
