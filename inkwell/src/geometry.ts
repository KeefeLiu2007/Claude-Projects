import { getStroke } from 'perfect-freehand'
import type { Point, Stroke, MindNode } from './types'

export function strokeOutline(points: Point[], size: number, highlighter: boolean) {
  return getStroke(points, {
    size,
    thinning: highlighter ? 0 : 0.55,
    smoothing: 0.5,
    streamline: 0.45,
    simulatePressure: points.every((p) => p[2] === 0.5),
    last: true,
    start: { cap: !highlighter },
    end: { cap: !highlighter },
  })
}

export function outlineToPath(outline: number[][]): string {
  if (!outline.length) return ''
  const d = outline.reduce<(string | number)[]>(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
      return acc
    },
    ['M', ...outline[0], 'Q'],
  )
  d.push('Z')
  return d.join(' ')
}

export function strokePath(s: Stroke) {
  return outlineToPath(strokeOutline(s.points, s.size, s.tool === 'highlighter'))
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax,
    dy = by - ay
  const l2 = dx * dx + dy * dy
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx,
    cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

export function strokeHit(s: Stroke, x: number, y: number, r: number) {
  const pts = s.points
  const tol = r + s.size / 2
  if (pts.length === 1) return Math.hypot(pts[0][0] - x, pts[0][1] - y) < tol
  for (let i = 1; i < pts.length; i++) {
    if (distToSeg(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) < tol) return true
  }
  return false
}

export function edgePath(a: MindNode, b: MindNode) {
  const mx = (a.x + b.x) / 2
  return `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`
}
