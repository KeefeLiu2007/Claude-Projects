import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { PAGE_H, PAGE_W, uid, type ImageItem, type Item, type MindNode, type Page, type PageStyle, type Point, type Stroke, type TextItem, type Tool } from '../types'
import { edgePath, strokeHit, strokePath } from '../geometry'
import { LINED_TOP, MARGIN_X } from '../render'
import { Icon } from './Icon'

export interface ToolOpts {
  penColor: string
  penSize: number
  hlColor: string
  hlSize: number
  eraserSize: number
  textSize: number
  textColor: string
}

export type NodeAction = 'child' | 'sibling' | 'expand'

interface Props {
  page: Page
  index: number
  zoom: number
  tool: Tool
  opts: ToolOpts
  pencilOnly: boolean
  selectedId: string | null
  editingId: string | null
  busyNodeId: string | null
  setSelected: (id: string | null) => void
  setEditing: (id: string | null) => void
  /** push an undo snapshot */
  begin: () => void
  /** mutate this page without recording history */
  update: (pageId: string, fn: (p: Page) => Page) => void
  onActivate: (index: number) => void
  scrollEl: React.RefObject<HTMLDivElement | null>
  onNodeAction: (pageId: string, node: MindNode, action: NodeAction) => void
  onDownloadImage: (img: ImageItem) => void
}

/* ---------- background ---------- */

const Background = memo(function Background({ s }: { s: PageStyle }) {
  const d = useMemo(() => {
    const sp = s.spacing
    const parts: string[] = []
    if (s.template === 'lined') {
      for (let y = LINED_TOP(sp); y < PAGE_H - sp / 2; y += sp) parts.push(`M0 ${y}H${PAGE_W}`)
    } else if (s.template === 'grid') {
      for (let x = sp; x < PAGE_W; x += sp) parts.push(`M${x} 0V${PAGE_H}`)
      for (let y = sp; y < PAGE_H; y += sp) parts.push(`M0 ${y}H${PAGE_W}`)
    }
    return parts.join('')
  }, [s.template, s.spacing])
  const pid = `dots-${s.spacing}-${s.lineWidth}-${s.lineColor.slice(1)}`
  return (
    <svg className="layer" width={PAGE_W} height={PAGE_H} style={{ background: s.paper }}>
      {s.template === 'dotted' && (
        <>
          <defs>
            <pattern id={pid} width={s.spacing} height={s.spacing} patternUnits="userSpaceOnUse">
              <circle cx={s.spacing} cy={s.spacing} r={Math.max(0.8, s.lineWidth * 1.4)} fill={s.lineColor} />
              <circle cx={0} cy={0} r={Math.max(0.8, s.lineWidth * 1.4)} fill={s.lineColor} />
              <circle cx={s.spacing} cy={0} r={Math.max(0.8, s.lineWidth * 1.4)} fill={s.lineColor} />
              <circle cx={0} cy={s.spacing} r={Math.max(0.8, s.lineWidth * 1.4)} fill={s.lineColor} />
            </pattern>
          </defs>
          <rect width={PAGE_W} height={PAGE_H} fill={`url(#${pid})`} />
        </>
      )}
      {d && <path d={d} stroke={s.lineColor} strokeWidth={s.lineWidth} fill="none" shapeRendering="crispEdges" />}
      {s.template === 'lined' && s.margin && <path d={`M${MARGIN_X} 0V${PAGE_H}`} stroke="#e8a0a0" strokeWidth={s.lineWidth} />}
    </svg>
  )
})

const StrokePath = memo(function StrokePath({ s }: { s: Stroke }) {
  const d = useMemo(() => strokePath(s), [s])
  return <path d={d} fill={s.color} />
})

/* ---------- helpers ---------- */

function descendants(items: Item[], id: string): Set<string> {
  const out = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const it of items)
      if (it.kind === 'node' && it.parentId && out.has(it.parentId) && !out.has(it.id)) {
        out.add(it.id)
        grew = true
      }
  }
  return out
}

function bbox(it: Item): { x: number; y: number; w: number; h: number } {
  switch (it.kind) {
    case 'stroke': {
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity
      for (const [x, y] of it.points) {
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
      const p = it.size / 2 + 6
      return { x: x0 - p, y: y0 - p, w: x1 - x0 + 2 * p, h: y1 - y0 + 2 * p }
    }
    case 'image':
      return { x: it.x, y: it.y, w: it.w, h: it.h }
    case 'text':
      return { x: it.x, y: it.y, w: it.w, h: 40 }
    case 'node':
      return { x: it.x - 60, y: it.y - 30, w: 120, h: 60 }
  }
}

type DragMode = 'move' | 'resize' | 'width'

function applyDrag(items: Item[], id: string, mode: DragMode, dx: number, dy: number): Item[] {
  const target = items.find((i) => i.id === id)
  if (!target) return items
  const moveIds = target.kind === 'node' && mode === 'move' ? descendants(items, id) : new Set([id])
  return items.map((it) => {
    if (!moveIds.has(it.id)) return it
    if (mode === 'resize' && it.kind === 'image') {
      const ratio = it.h / it.w
      const w = Math.max(40, it.w + dx)
      return { ...it, w, h: w * ratio }
    }
    if (mode === 'width' && it.kind === 'text') return { ...it, w: Math.max(80, it.w + dx) }
    if (it.kind === 'stroke') return { ...it, points: it.points.map(([x, y, p]) => [x + dx, y + dy, p] as Point) }
    return { ...it, x: it.x + dx, y: it.y + dy }
  })
}

function AutoTextarea(props: {
  value: string
  onChange: (v: string) => void
  onDone: () => void
  onTab?: () => void
  enterFinishes?: boolean
  style?: React.CSSProperties
  className?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = el.scrollHeight + 'px'
  }, [props.value])
  return (
    <textarea
      ref={ref}
      className={props.className}
      style={props.style}
      value={props.value}
      rows={1}
      spellCheck
      onChange={(e) => props.onChange(e.target.value)}
      onBlur={props.onDone}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') ref.current?.blur()
        if (props.enterFinishes && e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          ref.current?.blur()
        }
        if (props.onTab && e.key === 'Tab') {
          e.preventDefault()
          props.onTab()
        }
      }}
    />
  )
}

/* ---------- page ---------- */

export const PageView = memo(function PageView(props: Props) {
  const { page, zoom, tool, opts, selectedId, editingId } = props
  const innerRef = useRef<HTMLDivElement>(null)
  const liveRef = useRef<Stroke | null>(null)
  const [, setTick] = useState(0)
  const raf = useRef(0)
  const panRef = useRef<{ x: number; y: number } | null>(null)
  const erasedRef = useRef(false)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)

  const rerender = () => {
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      setTick((t) => t + 1)
    })
  }

  const toPage = (cx: number, cy: number): [number, number] => {
    const r = innerRef.current!.getBoundingClientRect()
    return [(cx - r.left) / zoom, (cy - r.top) / zoom]
  }

  const drawing = tool === 'pen' || tool === 'highlighter' || tool === 'eraser'

  /* ----- drawing / erasing ----- */

  const eraseAt = (x: number, y: number) => {
    const r = opts.eraserSize / 2
    const hit = page.items.some((it) => it.kind === 'stroke' && strokeHit(it, x, y, r))
    if (!hit) return
    if (!erasedRef.current) {
      erasedRef.current = true
      props.begin()
    }
    props.update(page.id, (p) => ({ ...p, items: p.items.filter((it) => !(it.kind === 'stroke' && strokeHit(it, x, y, r))) }))
  }

  const onDrawDown = (e: React.PointerEvent) => {
    props.onActivate(props.index)
    if (props.pencilOnly && e.pointerType === 'touch') {
      panRef.current = { x: e.clientX, y: e.clientY }
      ;(e.target as Element).setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const [x, y] = toPage(e.clientX, e.clientY)
    if (tool === 'eraser') {
      erasedRef.current = false
      eraseAt(x, y)
      return
    }
    const pressure = e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5
    liveRef.current = {
      id: uid(),
      kind: 'stroke',
      tool: tool === 'highlighter' ? 'highlighter' : 'pen',
      color: tool === 'highlighter' ? opts.hlColor : opts.penColor,
      size: tool === 'highlighter' ? opts.hlSize : opts.penSize,
      points: [[x, y, pressure]],
    }
    rerender()
  }

  const onDrawMove = (e: React.PointerEvent) => {
    if (panRef.current) {
      const el = props.scrollEl.current
      el?.scrollBy(panRef.current.x - e.clientX, panRef.current.y - e.clientY)
      panRef.current = { x: e.clientX, y: e.clientY }
      return
    }
    const [hx, hy] = toPage(e.clientX, e.clientY)
    if (tool === 'eraser') {
      setCursor({ x: hx, y: hy })
      if (e.buttons & 1 || e.pointerType !== 'mouse') {
        if (e.pressure > 0 || e.buttons) eraseAt(hx, hy)
      }
      return
    }
    const live = liveRef.current
    if (!live) return
    const evs = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [e.nativeEvent]
    for (const ev of evs.length ? evs : [e.nativeEvent]) {
      const [x, y] = toPage(ev.clientX, ev.clientY)
      const pressure = ev.pointerType === 'pen' ? ev.pressure || 0.5 : 0.5
      live.points.push([x, y, pressure])
    }
    rerender()
  }

  const onDrawUp = () => {
    panRef.current = null
    const live = liveRef.current
    liveRef.current = null
    if (live) {
      props.begin()
      props.update(page.id, (p) => ({ ...p, items: [...p.items, live] }))
    }
  }

  /* ----- dragging items ----- */

  const startDrag = (e: React.PointerEvent, id: string, mode: DragMode) => {
    e.stopPropagation()
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const [sx, sy] = toPage(e.clientX, e.clientY)
    const orig = page.items
    let begun = false
    const move = (ev: PointerEvent) => {
      const [x, y] = toPage(ev.clientX, ev.clientY)
      const dx = x - sx,
        dy = y - sy
      if (!begun) {
        if (Math.hypot(dx, dy) < 3) return
        begun = true
        props.begin()
      }
      props.update(page.id, (p) => ({ ...p, items: applyDrag(orig, id, mode, dx, dy) }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const onBackgroundDown = (e: React.PointerEvent) => {
    props.onActivate(props.index)
    if (drawing) return
    const [x, y] = toPage(e.clientX, e.clientY)
    if (editingId) {
      // first tap just ends editing
      ;(document.activeElement as HTMLElement | null)?.blur()
      props.setEditing(null)
      return
    }
    if (tool === 'select') {
      const hit = [...page.items].reverse().find((it) => it.kind === 'stroke' && strokeHit(it, x, y, 8))
      if (hit) {
        props.setSelected(hit.id)
        startDrag(e, hit.id, 'move')
      } else props.setSelected(null)
    } else if (tool === 'text') {
      e.preventDefault() // keep focus in the new textarea after pointerup
      const t: TextItem = {
        id: uid(),
        kind: 'text',
        x: x - 4,
        y: y - opts.textSize * 0.75,
        w: Math.min(560, PAGE_W - x - 20),
        text: '',
        fontSize: opts.textSize,
        color: opts.textColor,
      }
      if (t.w < 120) {
        t.w = 300
        t.x = PAGE_W - 320
      }
      props.begin()
      props.update(page.id, (p) => ({ ...p, items: [...p.items, t] }))
      props.setSelected(t.id)
      props.setEditing(t.id)
    } else if (tool === 'mindmap') {
      if (selectedId) return props.setSelected(null) // first tap on empty space just deselects
      e.preventDefault()
      const n: MindNode = { id: uid(), kind: 'node', x, y, text: '', color: '#4f46e5', parentId: null }
      props.begin()
      props.update(page.id, (p) => ({ ...p, items: [...p.items, n] }))
      props.setSelected(n.id)
      props.setEditing(n.id)
    }
  }

  const setItem = (id: string, patch: { text: string }) =>
    props.update(page.id, (p) => ({ ...p, items: p.items.map((it) => (it.id === id ? ({ ...it, ...patch } as Item) : it)) }))

  const editingRef = useRef(editingId)
  editingRef.current = editingId
  const finishEdit = (id: string) => {
    if (editingRef.current === id) props.setEditing(null)
    props.update(page.id, (p) => {
      const it = p.items.find((i) => i.id === id)
      if (it && (it.kind === 'text' || it.kind === 'node') && !it.text.trim()) {
        if (it.kind === 'node' && p.items.some((c) => c.kind === 'node' && c.parentId === id)) return p
        return { ...p, items: p.items.filter((i) => i.id !== id) }
      }
      return p
    })
  }

  const itemDown = (e: React.PointerEvent, it: Item) => {
    props.onActivate(props.index)
    if (drawing) return
    e.stopPropagation()
    if (editingId === it.id) return
    if (editingId) props.setEditing(null)
    props.setSelected(it.id)
    if (tool === 'text' && it.kind === 'text') {
      e.preventDefault()
      props.begin()
      props.setEditing(it.id)
      return
    }
    startDrag(e, it.id, 'move')
  }

  const startEditing = (it: Item) => {
    if (it.kind !== 'text' && it.kind !== 'node') return
    props.begin()
    props.setSelected(it.id)
    props.setEditing(it.id)
  }

  const nodes = page.items.filter((i): i is MindNode => i.kind === 'node')
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const selected = page.items.find((i) => i.id === selectedId)
  const live = liveRef.current

  const deleteSelected = () => {
    if (!selected) return
    const ids = selected.kind === 'node' ? descendants(page.items, selected.id) : new Set([selected.id])
    props.begin()
    props.update(page.id, (p) => ({ ...p, items: p.items.filter((i) => !ids.has(i.id)) }))
    props.setSelected(null)
  }
  const duplicateSelected = () => {
    if (!selected || selected.kind === 'node') return
    const copy = { ...selected, id: uid() } as Item
    const moved = applyDrag([copy], copy.id, 'move', 30, 30)[0]
    props.begin()
    props.update(page.id, (p) => ({ ...p, items: [...p.items, moved] }))
    props.setSelected(moved.id)
  }
  const reorder = (front: boolean) => {
    if (!selected) return
    props.begin()
    props.update(page.id, (p) => {
      const rest = p.items.filter((i) => i.id !== selected.id)
      return { ...p, items: front ? [...rest, selected] : [selected, ...rest] }
    })
  }

  const sb = selected ? bbox(selected) : null

  return (
    <div className="page-shell" style={{ width: PAGE_W * zoom, height: PAGE_H * zoom }} data-page={page.id}>
      <div
        ref={innerRef}
        className={`page tool-${tool}`}
        style={{ transform: `scale(${zoom})`, touchAction: drawing ? 'none' : 'pan-x pan-y' }}
        onPointerDown={onBackgroundDown}
      >
        <Background s={page.style} />

        {page.items.map(
          (it) =>
            it.kind === 'image' && (
              <div
                key={it.id}
                className={'item image' + (selectedId === it.id ? ' selected' : '')}
                style={{ left: it.x, top: it.y, width: it.w, height: it.h }}
                onPointerDown={(e) => itemDown(e, it)}
              >
                <img src={it.src} draggable={false} alt="" crossOrigin={it.src.startsWith('data:') ? undefined : 'anonymous'} />
                {selectedId === it.id && (
                  <div className="handle se" style={{ transform: `scale(${1 / zoom})` }} onPointerDown={(e) => startDrag(e, it.id, 'resize')} />
                )}
              </div>
            ),
        )}

        <svg className="layer ink" width={PAGE_W} height={PAGE_H}>
          {nodes.map((n) => {
            const p = n.parentId ? nodeById.get(n.parentId) : undefined
            return p ? <path key={'e' + n.id} d={edgePath(p, n)} stroke={n.color} strokeWidth={3} fill="none" /> : null
          })}
          <g className="hl">
            {page.items.map((it) => it.kind === 'stroke' && it.tool === 'highlighter' && <StrokePath key={it.id} s={it} />)}
            {live?.tool === 'highlighter' && <path d={strokePath(live)} fill={live.color} />}
          </g>
          {page.items.map((it) => it.kind === 'stroke' && it.tool === 'pen' && <StrokePath key={it.id} s={it} />)}
          {live?.tool === 'pen' && <path d={strokePath(live)} fill={live.color} />}
          {selected?.kind === 'stroke' && sb && <rect className="sel-rect" x={sb.x} y={sb.y} width={sb.w} height={sb.h} />}
        </svg>

        {nodes.map((n) => {
          const isRoot = !n.parentId || !nodeById.has(n.parentId)
          const isSel = selectedId === n.id
          return (
            <div
              key={n.id}
              className={'item node' + (isRoot ? ' root' : '') + (isSel ? ' selected' : '') + (props.busyNodeId === n.id ? ' busy' : '')}
              style={{ left: n.x, top: n.y, borderColor: n.color, background: isRoot ? n.color : '#fff' }}
              onPointerDown={(e) => itemDown(e, n)}
              onDoubleClick={() => startEditing(n)}
            >
              {editingId === n.id ? (
                <AutoTextarea
                  className="node-input"
                  value={n.text}
                  enterFinishes
                  onChange={(v) => setItem(n.id, { text: v })}
                  onDone={() => finishEdit(n.id)}
                  onTab={() => {
                    props.setEditing(null)
                    props.onNodeAction(page.id, n, 'child')
                  }}
                />
              ) : (
                <span>{n.text || ' '}</span>
              )}
              {isSel && editingId !== n.id && (tool === 'mindmap' || tool === 'select') && (
                <>
                  <button className="node-add right" title="Add child (Tab)" onPointerDown={(e) => e.stopPropagation()} onClick={() => props.onNodeAction(page.id, n, 'child')}>
                    +
                  </button>
                  {!isRoot && (
                    <button className="node-add bottom" title="Add sibling" onPointerDown={(e) => e.stopPropagation()} onClick={() => props.onNodeAction(page.id, n, 'sibling')}>
                      +
                    </button>
                  )}
                </>
              )}
            </div>
          )
        })}

        {page.items.map(
          (it) =>
            it.kind === 'text' && (
              <div
                key={it.id}
                className={'item text' + (selectedId === it.id ? ' selected' : '') + (editingId === it.id ? ' editing' : '')}
                style={{ left: it.x, top: it.y, width: it.w, fontSize: it.fontSize, color: it.color }}
                onPointerDown={(e) => itemDown(e, it)}
                onDoubleClick={() => startEditing(it)}
              >
                {editingId === it.id ? (
                  <AutoTextarea className="text-input" value={it.text} onChange={(v) => setItem(it.id, { text: v })} onDone={() => finishEdit(it.id)} />
                ) : (
                  <div className="text-body">{it.text}</div>
                )}
                {selectedId === it.id && editingId !== it.id && (
                  <div className="handle e" style={{ transform: `translateY(-50%) scale(${1 / zoom})` }} onPointerDown={(e) => startDrag(e, it.id, 'width')} />
                )}
              </div>
            ),
        )}

        {selected && sb && !editingId && !drawing && (
          <div
            className="sel-bar"
            style={{ left: Math.max(0, sb.x), top: Math.max(0, sb.y), transform: `translateY(calc(-100% - ${8 / zoom}px)) scale(${1 / zoom})` }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {(selected.kind === 'text' || selected.kind === 'node') && <button onClick={() => startEditing(selected)}>Edit</button>}
            {selected.kind === 'node' && (
              <button className="claude-btn" disabled={!!props.busyNodeId} onClick={() => props.onNodeAction(page.id, selected, 'expand')} title="Ask Claude for child ideas">
                <Icon name="sparkle" size={15} /> Expand
              </button>
            )}
            {selected.kind === 'image' && (
              <button onClick={() => props.onDownloadImage(selected)} title="Download image">
                <Icon name="download" size={15} />
              </button>
            )}
            {selected.kind !== 'node' && (
              <button onClick={duplicateSelected} title="Duplicate">
                <Icon name="copy" size={15} />
              </button>
            )}
            <button onClick={() => reorder(true)} title="Bring to front">
              <Icon name="front" size={15} />
            </button>
            <button className="danger" onClick={deleteSelected} title="Delete">
              <Icon name="trash" size={15} />
            </button>
          </div>
        )}

        {drawing && (
          <div
            className="capture"
            onPointerDown={onDrawDown}
            onPointerMove={onDrawMove}
            onPointerUp={onDrawUp}
            onPointerCancel={onDrawUp}
            onPointerLeave={() => setCursor(null)}
          >
            {tool === 'eraser' && cursor && (
              <div className="eraser-cursor" style={{ left: cursor.x, top: cursor.y, width: opts.eraserSize, height: opts.eraserSize }} />
            )}
          </div>
        )}
      </div>
    </div>
  )
})
