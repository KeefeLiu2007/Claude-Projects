import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { PAGE_H, PAGE_W, newNotebook, newPage, uid, type ChatMessage, type ImageItem, type Item, type MindNode, type Notebook, type Page, type PageStyle, type Template, type Tool } from './types'
import { blobToDataURL, downloadBlob, importImageFromUrl, loadNotebooks, loadSettings, measureImage, saveNotebooksSoon, saveSettings, type Settings } from './storage'
import { canvasToBlob, pageSnapshotBase64, renderPage } from './render'
import { expandNode, friendlyError, generateMindmap, streamChat, type MapOutline } from './claude'
import { PageView, type NodeAction, type ToolOpts } from './components/PageView'
import { ClaudePanel } from './components/ClaudePanel'
import { Library } from './components/Library'
import { Thumb } from './components/Thumb'
import { Icon } from './components/Icon'

const PEN_COLORS = ['#1d2433', '#1d4ed8', '#dc2626', '#16a34a', '#7c3aed', '#ea580c']
const HL_COLORS = ['#fde047', '#86efac', '#f9a8d4', '#93c5fd', '#fdba74']
const BRANCH_COLORS = ['#e11d48', '#0891b2', '#16a34a', '#d97706', '#7c3aed', '#db2777', '#2563eb']
const PAPERS = ['#ffffff', '#fbf7ee', '#f3f6fb', '#1f2430']
const LINE_COLORS = ['#b9c6d8', '#cfcfcf', '#9fb7a1', '#e3b5b5', '#3a4256']

const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: 'select', icon: 'select', label: 'Select & move', key: 'v' },
  { id: 'pen', icon: 'pen', label: 'Pen', key: 'p' },
  { id: 'highlighter', icon: 'highlighter', label: 'Highlighter', key: 'h' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser', key: 'e' },
  { id: 'text', icon: 'text', label: 'Text', key: 't' },
  { id: 'mindmap', icon: 'mindmap', label: 'Mind map', key: 'm' },
]

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/** Where a new child node should go next to its parent. */
function placeChild(items: Item[], parent: MindNode): { x: number; y: number; color: string } {
  const nodes = items.filter((i): i is MindNode => i.kind === 'node')
  const grand = parent.parentId ? nodes.find((n) => n.id === parent.parentId) : undefined
  const kids = nodes.filter((n) => n.parentId === parent.id)
  let dir = grand ? Math.sign(parent.x - grand.x) || 1 : 0
  if (!dir) {
    const right = kids.filter((k) => k.x >= parent.x).length
    dir = right <= kids.length - right ? 1 : -1
  }
  const side = kids.filter((k) => Math.sign(k.x - parent.x) === dir)
  const x = clamp(parent.x + dir * (grand ? 250 : 300), 140, PAGE_W - 140)
  const y = clamp(side.length ? Math.max(...side.map((k) => k.y)) + 80 : parent.y, 40, PAGE_H - 40)
  const color = grand ? parent.color : BRANCH_COLORS[kids.length % BRANCH_COLORS.length]
  return { x, y, color }
}

function layoutMindmap(outline: MapOutline): MindNode[] {
  const cx = PAGE_W / 2,
    cy = PAGE_H / 2
  const root: MindNode = { id: uid(), kind: 'node', x: cx, y: cy, text: outline.root, color: '#4f46e5', parentId: null }
  const out: MindNode[] = [root]
  const sides: MapOutline['branches'][] = [[], []]
  outline.branches.forEach((b, i) => sides[i % 2].push(b))
  const ROW = 72
  sides.forEach((branches, s) => {
    const dir = s === 0 ? 1 : -1
    const rows = branches.reduce((n, b) => n + Math.max(1, b.children.length), 0) + (branches.length - 1) * 0.6
    let y = cy - ((rows - 1) * ROW) / 2
    branches.forEach((b, bi) => {
      const color = BRANCH_COLORS[(bi * 2 + s) % BRANCH_COLORS.length]
      const n = Math.max(1, b.children.length)
      const branch: MindNode = { id: uid(), kind: 'node', x: cx + dir * 290, y: y + ((n - 1) * ROW) / 2, text: b.label, color, parentId: root.id }
      out.push(branch)
      b.children.forEach((c, ci) => out.push({ id: uid(), kind: 'node', x: cx + dir * 490, y: y + ci * ROW, text: c, color, parentId: branch.id }))
      y += n * ROW + ROW * 0.6
    })
  })
  return out
}

export default function App() {
  const [books, setBooks] = useState<Notebook[]>([])
  const [loaded, setLoaded] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [showSettings, setShowSettings] = useState(false)

  const [tool, setTool] = useState<Tool>('pen')
  const [opts, setOpts] = useState<ToolOpts>({ penColor: PEN_COLORS[0], penSize: 4, hlColor: HL_COLORS[0], hlSize: 26, eraserSize: 30, textSize: 26, textColor: PEN_COLORS[0] })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const [zoom, setZoom] = useState(0.6)
  const [fit, setFit] = useState(true)
  const [showPages, setShowPages] = useState(true)
  const [showClaude, setShowClaude] = useState(false)
  const [popover, setPopover] = useState<null | 'page' | 'export' | 'image'>(null)
  const [streaming, setStreaming] = useState<string | null>(null)
  const [claudeError, setClaudeError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyNodeId, setBusyNodeId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [, setHistTick] = useState(0)

  const scrollRef = useRef<HTMLDivElement>(null)
  const past = useRef<Notebook[]>([])
  const future = useRef<Notebook[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const nb = books.find((b) => b.id === openId) ?? null
  const nbRef = useRef(nb)
  nbRef.current = nb
  const activePage = nb ? nb.pages[Math.min(activeIdx, nb.pages.length - 1)] : null

  /* ---------- persistence ---------- */
  useEffect(() => {
    loadNotebooks().then((bs) => {
      setBooks(bs.length ? bs : [newNotebook('My first notebook')])
      setLoaded(true)
    })
  }, [])
  useEffect(() => {
    if (loaded) saveNotebooksSoon(books)
  }, [books, loaded])
  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  const flash = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200)
  }

  /* ---------- notebook mutation + undo ---------- */
  const setNb = useCallback(
    (fn: (n: Notebook) => Notebook) => {
      setBooks((bs) => bs.map((b) => (b.id === openId ? { ...fn(b), updatedAt: Date.now() } : b)))
    },
    [openId],
  )
  const begin = useCallback(() => {
    if (!nbRef.current) return
    past.current.push(nbRef.current)
    if (past.current.length > 150) past.current.shift()
    future.current = []
    setHistTick((t) => t + 1)
  }, [])
  const updatePage = useCallback((pageId: string, fn: (p: Page) => Page) => setNb((n) => ({ ...n, pages: n.pages.map((p) => (p.id === pageId ? fn(p) : p)) })), [setNb])
  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev || !nbRef.current) return
    future.current.push(nbRef.current)
    setNb((n) => ({ ...prev, chat: n.chat, title: n.title }))
    setSelectedId(null)
    setEditingId(null)
    setHistTick((t) => t + 1)
  }, [setNb])
  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next || !nbRef.current) return
    past.current.push(nbRef.current)
    setNb((n) => ({ ...next, chat: n.chat, title: n.title }))
    setSelectedId(null)
    setHistTick((t) => t + 1)
  }, [setNb])

  const openBook = (id: string) => {
    past.current = []
    future.current = []
    setOpenId(id)
    setActiveIdx(0)
    setSelectedId(null)
    setEditingId(null)
    setFit(true)
  }

  /* ---------- zoom / fit ---------- */
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !fit) return
    const ro = new ResizeObserver(() => setZoom(clamp((el.clientWidth - 48) / PAGE_W, 0.2, 1.4)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit, openId])

  const zoomBy = (f: number) => {
    setFit(false)
    setZoom((z) => clamp(+(z * f).toFixed(3), 0.2, 3))
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setFit(false)
      setZoom((z) => clamp(z * (e.deltaY < 0 ? 1.08 : 1 / 1.08), 0.2, 3))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [openId])

  // track which page is in view
  const onScroll = () => {
    const el = scrollRef.current
    if (!el || !nb) return
    const mid = el.getBoundingClientRect().top + el.clientHeight / 2
    let best = 0,
      bestD = Infinity
    el.querySelectorAll<HTMLElement>('[data-page]').forEach((p, i) => {
      const r = p.getBoundingClientRect()
      const d = mid < r.top ? r.top - mid : mid > r.bottom ? mid - r.bottom : 0
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    if (best !== activeIdx) setActiveIdx(best)
  }

  const scrollToPage = (i: number) => {
    setActiveIdx(i)
    const el = scrollRef.current?.querySelectorAll<HTMLElement>('[data-page]')[i]
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /** centre of the visible part of the active page, in page coordinates */
  const viewCenter = (): { x: number; y: number } => {
    const el = scrollRef.current
    const pageEl = el?.querySelectorAll<HTMLElement>('[data-page]')[activeIdx]
    if (!el || !pageEl) return { x: PAGE_W / 2, y: PAGE_H / 3 }
    const vr = el.getBoundingClientRect()
    const pr = pageEl.getBoundingClientRect()
    return {
      x: clamp((vr.left + vr.width / 2 - pr.left) / zoom, 100, PAGE_W - 100),
      y: clamp((vr.top + vr.height / 2 - pr.top) / zoom, 100, PAGE_H - 100),
    }
  }

  /* ---------- tool options (also restyle selected text) ---------- */
  const setOpt = <K extends keyof ToolOpts>(k: K, v: ToolOpts[K]) => {
    setOpts((o) => ({ ...o, [k]: v }))
    if ((k === 'textSize' || k === 'textColor') && selectedId && activePage) {
      const sel = activePage.items.find((i) => i.id === selectedId)
      if (sel?.kind === 'text') {
        begin()
        updatePage(activePage.id, (p) => ({
          ...p,
          items: p.items.map((i) => (i.id === selectedId ? { ...i, [k === 'textSize' ? 'fontSize' : 'color']: v } : i)),
        }))
      }
    }
  }

  const pickTool = (t: Tool) => {
    setTool(t)
    setEditingId(null)
    if (t !== 'select') setSelectedId(null)
  }

  /* ---------- pages ---------- */
  const addPage = (after = activeIdx) => {
    if (!nb) return
    begin()
    const p = newPage(nb.pages[after]?.style)
    setNb((n) => ({ ...n, pages: [...n.pages.slice(0, after + 1), p, ...n.pages.slice(after + 1)] }))
    setTimeout(() => scrollToPage(after + 1), 50)
  }
  const deletePage = (i: number) => {
    if (!nb) return
    if (nb.pages.length === 1) {
      begin()
      setNb((n) => ({ ...n, pages: [newPage(n.pages[0].style)] }))
      return
    }
    begin()
    setNb((n) => ({ ...n, pages: n.pages.filter((_, j) => j !== i) }))
    setActiveIdx((a) => clamp(a >= i ? a - 1 : a, 0, nb.pages.length - 2))
  }
  const setStyle = (patch: Partial<PageStyle>, all = false) => {
    if (!nb || !activePage) return
    begin()
    setNb((n) => ({ ...n, pages: n.pages.map((p) => (all || p.id === activePage.id ? { ...p, style: { ...p.style, ...patch } } : p)) }))
  }

  /* ---------- images ---------- */
  const addImage = async (src: string) => {
    if (!activePage) return
    try {
      const { w, h } = await measureImage(src)
      const scale = Math.min(1, 640 / w, 800 / h)
      const iw = w * scale,
        ih = h * scale
      const c = viewCenter()
      const img: ImageItem = { id: uid(), kind: 'image', x: clamp(c.x - iw / 2, 0, PAGE_W - iw), y: clamp(c.y - ih / 2, 0, PAGE_H - ih), w: iw, h: ih, src }
      begin()
      updatePage(activePage.id, (p) => ({ ...p, items: [...p.items, img] }))
      setTool('select')
      setSelectedId(img.id)
    } catch {
      flash("Couldn't load that image.")
    }
  }
  const addImageFile = async (f: File) => addImage(await blobToDataURL(f))
  const addImageUrl = async (url: string) => {
    flash('Fetching image…')
    const src = await importImageFromUrl(url)
    if (!src.startsWith('data:')) flash("That site blocks copying, so the image is linked instead (it may not export).")
    await addImage(src)
  }
  const downloadImage = async (img: ImageItem) => {
    try {
      const blob = await (await fetch(img.src)).blob()
      const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg')
      downloadBlob(blob, `image-${img.id}.${ext}`)
    } catch {
      window.open(img.src, '_blank')
    }
  }

  // paste images / image links
  useEffect(() => {
    if (!nb) return
    const onPaste = (e: ClipboardEvent) => {
      const tgt = e.target as HTMLElement
      if (tgt.closest('textarea, input')) return
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      if (file) {
        e.preventDefault()
        addImageFile(file)
        return
      }
      const text = e.clipboardData?.getData('text/plain')?.trim()
      if (text && /^https?:\/\/\S+$/i.test(text)) {
        e.preventDefault()
        addImageUrl(text)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'))
    if (file) return void addImageFile(file)
    const html = e.dataTransfer.getData('text/html')
    const fromHtml = html.match(/<img[^>]+src="([^"]+)"/i)?.[1]
    const url = fromHtml || e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    if (url && /^(https?:|data:image)/.test(url.trim())) addImageUrl(url.trim())
  }

  /* ---------- export ---------- */
  const exportPng = async () => {
    if (!activePage || !nb) return
    try {
      const blob = await canvasToBlob(await renderPage(activePage, 2))
      downloadBlob(blob, `${nb.title || 'page'} - p${activeIdx + 1}.png`)
    } catch {
      flash('Export blocked by a linked web image. Re-insert it via upload to export.')
    }
  }
  const exportPdf = async () => {
    if (!nb) return
    const w = window.open('', '_blank')
    if (!w) return flash('Allow pop-ups to print / save as PDF.')
    w.document.write('<p style="font-family:sans-serif">Preparing pages…</p>')
    const imgs: string[] = []
    for (const p of nb.pages) {
      try {
        imgs.push((await renderPage(p, 1.5)).toDataURL('image/png'))
      } catch {
        imgs.push('')
      }
    }
    w.document.open()
    w.document.write(`<!doctype html><title>${nb.title.replace(/</g, '')}</title>
<style>@page{size:A4;margin:0}body{margin:0}img{width:100%;display:block;page-break-after:always}</style>
${imgs.map((s) => (s ? `<img src="${s}">` : '<p>(page skipped: contains a linked web image)</p>')).join('')}
<script>window.onload=()=>setTimeout(()=>print(),300)</script>`)
    w.document.close()
  }
  const exportJson = () => {
    if (!nb) return
    downloadBlob(new Blob([JSON.stringify(nb)], { type: 'application/json' }), `${nb.title || 'notebook'}.inkwell.json`)
  }
  const importJson = async (f: File) => {
    try {
      const data = JSON.parse(await f.text()) as Notebook
      if (!Array.isArray(data.pages)) throw new Error()
      const book: Notebook = { ...newNotebook(data.title), ...data, id: uid(), chat: data.chat ?? [], updatedAt: Date.now() }
      setBooks((bs) => [...bs, book])
      flash(`Imported "${book.title}"`)
    } catch {
      flash("That file isn't an Inkwell notebook.")
    }
  }

  /* ---------- Claude ---------- */
  const needKey = () => {
    if (settings.apiKey) return false
    setShowClaude(true)
    setShowSettings(true)
    return true
  }

  const ask = async (text: string, attach: boolean) => {
    if (!nb || !activePage || needKey()) return
    setClaudeError(null)
    const image = attach ? await pageSnapshotBase64(activePage) : null
    if (attach && !image) flash('Page snapshot skipped (contains a linked web image).')
    const userMsg: ChatMessage = { role: 'user', text, ...(image ? { image } : {}) }
    const history = [...nb.chat, userMsg]
    setNb((n) => ({ ...n, chat: history }))
    setStreaming('')
    setBusy(true)
    const ac = new AbortController()
    abortRef.current = ac
    let partial = ''
    try {
      const full = await streamChat({
        apiKey: settings.apiKey,
        effort: settings.effort,
        history,
        signal: ac.signal,
        onText: (t) => {
          partial = t
          setStreaming(t)
        },
      })
      setNb((n) => ({ ...n, chat: [...n.chat, { role: 'assistant', text: full }] }))
    } catch (e) {
      if (ac.signal.aborted) {
        if (partial) setNb((n) => ({ ...n, chat: [...n.chat, { role: 'assistant', text: partial + ' …(stopped)' }] }))
      } else setClaudeError(friendlyError(e))
    } finally {
      setStreaming(null)
      setBusy(false)
      abortRef.current = null
    }
  }

  const insertText = (text: string) => {
    if (!activePage) return
    const c = viewCenter()
    const w = 760
    const t: Item = { id: uid(), kind: 'text', x: clamp(c.x - w / 2, 20, PAGE_W - w - 20), y: c.y - 100, w, text, fontSize: 24, color: '#1d2433' }
    begin()
    updatePage(activePage.id, (p) => ({ ...p, items: [...p.items, t] }))
    setTool('select')
    setSelectedId(t.id)
    flash('Added to page — drag to move, use the handle to resize.')
  }

  const makeMindmap = async (topic: string, attach: boolean) => {
    if (!nb || !activePage || needKey()) return
    setClaudeError(null)
    setBusy(true)
    setStreaming('')
    try {
      const image = attach || !topic ? await pageSnapshotBase64(activePage) : null
      const outline = await generateMindmap(settings.apiKey, topic, image)
      const nodes = layoutMindmap(outline)
      begin()
      const empty = activePage.items.length === 0
      if (empty) updatePage(activePage.id, (p) => ({ ...p, items: nodes }))
      else {
        const p: Page = { ...newPage({ ...activePage.style, template: 'dotted' }), items: nodes }
        setNb((n) => {
          const i = n.pages.findIndex((x) => x.id === activePage.id)
          return { ...n, pages: [...n.pages.slice(0, i + 1), p, ...n.pages.slice(i + 1)] }
        })
        setTimeout(() => scrollToPage(activeIdx + 1), 60)
      }
      setTool('mindmap')
      setNb((n) => ({ ...n, chat: [...n.chat, { role: 'user', text: `🧠 Mind map: ${topic || 'from this page'}` }, { role: 'assistant', text: `Added a mind map "${outline.root}" with ${outline.branches.length} branches${empty ? ' to this page' : ' on a new page'}.` }] }))
    } catch (e) {
      setClaudeError(friendlyError(e))
    } finally {
      setBusy(false)
      setStreaming(null)
    }
  }

  const onNodeAction = useCallback(
    async (pageId: string, node: MindNode, action: NodeAction) => {
      const page = nbRef.current?.pages.find((p) => p.id === pageId)
      if (!page) return
      const parent = action === 'sibling' ? (page.items.find((i) => i.id === node.parentId) as MindNode | undefined) : node
      if (!parent) return
      if (action === 'expand') {
        if (!settings.apiKey) {
          setShowSettings(true)
          return
        }
        const nodes = page.items.filter((i): i is MindNode => i.kind === 'node')
        const path: string[] = []
        for (let n: MindNode | undefined = node; n; n = nodes.find((x) => x.id === n!.parentId)) path.unshift(n.text || '(untitled)')
        const siblings = nodes.filter((n) => n.parentId === node.id).map((n) => n.text)
        setBusyNodeId(node.id)
        try {
          const ideas = await expandNode(settings.apiKey, path, siblings)
          begin()
          updatePage(pageId, (p) => {
            let items = p.items
            for (const idea of ideas) {
              const pos = placeChild(items, node)
              items = [...items, { id: uid(), kind: 'node', x: pos.x, y: pos.y, color: pos.color, text: idea, parentId: node.id }]
            }
            return { ...p, items }
          })
        } catch (e) {
          flash(friendlyError(e))
        } finally {
          setBusyNodeId(null)
        }
        return
      }
      const pos = placeChild(page.items, parent)
      const child: MindNode = { id: uid(), kind: 'node', x: pos.x, y: pos.y, color: pos.color, text: '', parentId: parent.id }
      begin()
      updatePage(pageId, (p) => ({ ...p, items: [...p.items, child] }))
      setSelectedId(child.id)
      setEditingId(child.id)
    },
    [begin, updatePage, settings.apiKey],
  )

  /* ---------- keyboard ---------- */
  useEffect(() => {
    if (!nb) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t.closest('textarea, select, [contenteditable]') || (t.tagName === 'INPUT' && !['range', 'checkbox', 'color', 'radio'].includes((t as HTMLInputElement).type))
      if (typing) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (mod) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && activePage) {
        const items = activePage.items
        const ids = new Set([selectedId])
        let grew = true
        while (grew) {
          grew = false
          for (const i of items) if (i.kind === 'node' && i.parentId && ids.has(i.parentId) && !ids.has(i.id)) ((grew = true), ids.add(i.id))
        }
        begin()
        updatePage(activePage.id, (p) => ({ ...p, items: p.items.filter((i) => !ids.has(i.id)) }))
        setSelectedId(null)
        return
      }
      if (e.key === 'Escape') {
        setSelectedId(null)
        setPopover(null)
        return
      }
      const tl = TOOLS.find((x) => x.key === e.key.toLowerCase())
      if (tl) pickTool(tl.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onActivate = useCallback((i: number) => setActiveIdx(i), [])

  const hasSelection = useMemo(() => !!selectedId, [selectedId])

  /* ---------- render ---------- */
  if (!loaded) return <div className="loading">Loading…</div>

  if (!nb) {
    return (
      <>
        <Library
          books={books}
          onOpen={openBook}
          onCreate={() => {
            const b = newNotebook()
            setBooks((bs) => [...bs, b])
            openBook(b.id)
          }}
          onDelete={(id) => setBooks((bs) => bs.filter((b) => b.id !== id))}
          onRename={(id, title) => setBooks((bs) => bs.map((b) => (b.id === id ? { ...b, title } : b)))}
          onImport={importJson}
          onSettings={() => setShowSettings(true)}
        />
        {showSettings && <SettingsModal settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} />}
        {toast && <div className="toast">{toast}</div>}
      </>
    )
  }

  const style = activePage!.style

  return (
    <div className="app">
      <header className="toolbar">
        <div className="tb-group">
          <button className="icon-btn" title="Library" onClick={() => setOpenId(null)}>
            <Icon name="back" />
          </button>
          <button className={'icon-btn' + (showPages ? ' on' : '')} title="Pages" onClick={() => setShowPages((s) => !s)}>
            <Icon name="sidebar" />
          </button>
          <input className="title-input" value={nb.title} onChange={(e) => setNb((n) => ({ ...n, title: e.target.value }))} />
          <button className="icon-btn" title="Undo (Ctrl+Z)" disabled={!past.current.length} onClick={undo}>
            <Icon name="undo" />
          </button>
          <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!future.current.length} onClick={redo}>
            <Icon name="redo" />
          </button>
        </div>

        <div className="tb-group tools">
          {TOOLS.map((t) => (
            <button key={t.id} className={'icon-btn tool' + (tool === t.id ? ' on' : '')} title={`${t.label} (${t.key.toUpperCase()})`} onClick={() => pickTool(t.id)}>
              <Icon name={t.icon} size={22} />
            </button>
          ))}
          <div className="pop-anchor">
            <button className={'icon-btn tool' + (popover === 'image' ? ' on' : '')} title="Insert image" onClick={() => setPopover(popover === 'image' ? null : 'image')}>
              <Icon name="image" size={22} />
            </button>
            {popover === 'image' && <ImagePopover onFile={addImageFile} onUrl={addImageUrl} onClose={() => setPopover(null)} />}
          </div>
        </div>

        <div className="tb-group">
          <div className="pop-anchor">
            <button className={'icon-btn' + (popover === 'page' ? ' on' : '')} title="Paper style" onClick={() => setPopover(popover === 'page' ? null : 'page')}>
              <Icon name="page" />
            </button>
            {popover === 'page' && <PagePopover style={style} onChange={setStyle} />}
          </div>
          <button className="icon-btn hide-sm" title="Zoom out" onClick={() => zoomBy(1 / 1.15)}>
            <Icon name="zoomOut" />
          </button>
          <button className="zoom-label hide-sm" title="Fit width" onClick={() => setFit(true)}>
            {Math.round(zoom * 100)}%
          </button>
          <button className="icon-btn hide-sm" title="Zoom in" onClick={() => zoomBy(1.15)}>
            <Icon name="zoomIn" />
          </button>
          <div className="pop-anchor">
            <button className={'icon-btn' + (popover === 'export' ? ' on' : '')} title="Export" onClick={() => setPopover(popover === 'export' ? null : 'export')}>
              <Icon name="download" />
            </button>
            {popover === 'export' && (
              <div className="popover menu right" onClick={() => setPopover(null)}>
                <button onClick={exportPng}>
                  <Icon name="image" size={16} /> This page as PNG
                </button>
                <button onClick={exportPdf}>
                  <Icon name="print" size={16} /> Print / save as PDF
                </button>
                <button onClick={exportJson}>
                  <Icon name="book" size={16} /> Notebook file (.json)
                </button>
              </div>
            )}
          </div>
          <button className="icon-btn" title="Settings" onClick={() => setShowSettings(true)}>
            <Icon name="settings" />
          </button>
          <button className={'claude-toggle' + (showClaude ? ' on' : '')} onClick={() => setShowClaude((s) => !s)}>
            <Icon name="sparkle" size={18} /> <span className="hide-sm">Ask Claude</span>
          </button>
        </div>
      </header>

      <ToolOptions tool={tool} opts={opts} setOpt={setOpt} hasSelection={hasSelection} />

      <div className="workspace" onPointerDown={() => popover && setPopover(null)}>
        {showPages && (
          <nav className="pages-panel">
            {nb.pages.map((p, i) => (
              <div key={p.id} className={'thumb' + (i === activeIdx ? ' on' : '')} onClick={() => scrollToPage(i)}>
                <Thumb page={p} />
                <div className="thumb-foot">
                  <span>{i + 1}</span>
                  <button
                    className="icon-btn small"
                    title="Delete page"
                    onClick={(e) => {
                      e.stopPropagation()
                      deletePage(i)
                    }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
            ))}
            <button className="add-page" onClick={() => addPage(nb.pages.length - 1)}>
              <Icon name="plus" /> Page
            </button>
          </nav>
        )}

        <main className="canvas-scroll" ref={scrollRef} onScroll={onScroll} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          {nb.pages.map((p, i) => (
            <PageView
              key={p.id}
              page={p}
              index={i}
              zoom={zoom}
              tool={tool}
              opts={opts}
              pencilOnly={settings.pencilOnly}
              selectedId={selectedId}
              editingId={editingId}
              busyNodeId={busyNodeId}
              setSelected={setSelectedId}
              setEditing={setEditingId}
              begin={begin}
              update={updatePage}
              onActivate={onActivate}
              scrollEl={scrollRef}
              onNodeAction={onNodeAction}
              onDownloadImage={downloadImage}
            />
          ))}
          <button className="add-page big" onClick={() => addPage(nb.pages.length - 1)}>
            <Icon name="plus" /> Add page
          </button>
        </main>

        {showClaude && (
          <ClaudePanel
            chat={nb.chat}
            streaming={streaming}
            error={claudeError}
            hasKey={!!settings.apiKey}
            busy={busy}
            onSend={ask}
            onStop={() => abortRef.current?.abort()}
            onMindmap={makeMindmap}
            onInsert={insertText}
            onClear={() => setNb((n) => ({ ...n, chat: [] }))}
            onClose={() => setShowClaude(false)}
            onSettings={() => setShowSettings(true)}
          />
        )}
      </div>

      <div className="page-indicator">
        {activeIdx + 1} / {nb.pages.length}
      </div>
      {showSettings && <SettingsModal settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

/* ================= sub-components ================= */

function Swatches({ colors, value, onPick }: { colors: string[]; value: string; onPick: (c: string) => void }) {
  return (
    <div className="swatches">
      {colors.map((c) => (
        <button key={c} className={'swatch' + (value === c ? ' on' : '')} style={{ background: c }} onClick={() => onPick(c)} title={c} />
      ))}
      <label className="swatch custom" title="Custom colour">
        <input type="color" value={value} onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  )
}

function Slider({ label, min, max, step = 1, value, onChange }: { label: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
      <b>{value}</b>
    </label>
  )
}

function ToolOptions({ tool, opts, setOpt, hasSelection }: { tool: Tool; opts: ToolOpts; setOpt: <K extends keyof ToolOpts>(k: K, v: ToolOpts[K]) => void; hasSelection: boolean }) {
  let body: React.ReactNode = null
  if (tool === 'pen')
    body = (
      <>
        <Swatches colors={PEN_COLORS} value={opts.penColor} onPick={(c) => setOpt('penColor', c)} />
        <div className="sizes">
          {[2, 4, 7, 12].map((s) => (
            <button key={s} className={'size-dot' + (opts.penSize === s ? ' on' : '')} onClick={() => setOpt('penSize', s)}>
              <i style={{ width: s + 2, height: s + 2, background: opts.penColor }} />
            </button>
          ))}
        </div>
        <Slider label="Width" min={1} max={30} value={opts.penSize} onChange={(v) => setOpt('penSize', v)} />
      </>
    )
  else if (tool === 'highlighter')
    body = (
      <>
        <Swatches colors={HL_COLORS} value={opts.hlColor} onPick={(c) => setOpt('hlColor', c)} />
        <Slider label="Width" min={8} max={60} value={opts.hlSize} onChange={(v) => setOpt('hlSize', v)} />
      </>
    )
  else if (tool === 'eraser') body = <Slider label="Eraser size" min={6} max={120} value={opts.eraserSize} onChange={(v) => setOpt('eraserSize', v)} />
  else if (tool === 'text' || (tool === 'select' && hasSelection))
    body = (
      <>
        <Swatches colors={PEN_COLORS} value={opts.textColor} onPick={(c) => setOpt('textColor', c)} />
        <Slider label="Text size" min={12} max={72} value={opts.textSize} onChange={(v) => setOpt('textSize', v)} />
        <span className="hint">{tool === 'text' ? 'Tap the page to type' : 'Applies to selected text'}</span>
      </>
    )
  else if (tool === 'mindmap') body = <span className="hint">Tap empty space for a central idea · select a node and press + (or Tab while typing) to branch · ✨ Expand asks Claude for ideas</span>
  else body = <span className="hint">Tap to select · drag to move · double-tap text to edit · paste or drop images anywhere</span>
  return <div className="tool-options">{body}</div>
}

const TEMPLATES: { id: Template; label: string }[] = [
  { id: 'blank', label: 'Blank' },
  { id: 'lined', label: 'Lined' },
  { id: 'dotted', label: 'Dotted' },
  { id: 'grid', label: 'Grid' },
]

function TemplatePreview({ t, paper, line }: { t: Template; paper: string; line: string }) {
  const els: React.ReactNode[] = []
  if (t === 'lined') for (let y = 12; y < 60; y += 8) els.push(<line key={y} x1={0} x2={44} y1={y} y2={y} stroke={line} />)
  if (t === 'grid') {
    for (let y = 6; y < 60; y += 6) els.push(<line key={'h' + y} x1={0} x2={44} y1={y} y2={y} stroke={line} strokeWidth={0.7} />)
    for (let x = 6; x < 44; x += 6) els.push(<line key={'v' + x} y1={0} y2={60} x1={x} x2={x} stroke={line} strokeWidth={0.7} />)
  }
  if (t === 'dotted') for (let y = 6; y < 60; y += 6) for (let x = 6; x < 44; x += 6) els.push(<circle key={x + '-' + y} cx={x} cy={y} r={0.9} fill={line} />)
  return (
    <svg width={44} height={60} style={{ background: paper }}>
      {els}
    </svg>
  )
}

function PagePopover({ style, onChange }: { style: PageStyle; onChange: (p: Partial<PageStyle>, all?: boolean) => void }) {
  return (
    <div className="popover page-pop right" onPointerDown={(e) => e.stopPropagation()}>
      <h4>Paper</h4>
      <div className="templates">
        {TEMPLATES.map((t) => (
          <button key={t.id} className={'tpl' + (style.template === t.id ? ' on' : '')} onClick={() => onChange({ template: t.id })}>
            <TemplatePreview t={t.id} paper={style.paper} line={style.lineColor} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      {style.template !== 'blank' && (
        <>
          <Slider label={style.template === 'lined' ? 'Line spacing' : style.template === 'grid' ? 'Cell size' : 'Dot spacing'} min={16} max={100} step={2} value={style.spacing} onChange={(v) => onChange({ spacing: v })} />
          <Slider label={style.template === 'dotted' ? 'Dot size' : 'Line width'} min={0.5} max={4} step={0.25} value={style.lineWidth} onChange={(v) => onChange({ lineWidth: v })} />
          <div className="row">
            <span>Line colour</span>
            <Swatches colors={LINE_COLORS} value={style.lineColor} onPick={(c) => onChange({ lineColor: c })} />
          </div>
        </>
      )}
      {style.template === 'lined' && (
        <label className="check">
          <input type="checkbox" checked={style.margin} onChange={(e) => onChange({ margin: e.target.checked })} /> Margin line
        </label>
      )}
      <div className="row">
        <span>Paper colour</span>
        <Swatches colors={PAPERS} value={style.paper} onPick={(c) => onChange({ paper: c })} />
      </div>
      <button className="btn ghost small full" onClick={() => onChange({ ...style }, true)}>
        Apply to all pages
      </button>
    </div>
  )
}

function ImagePopover({ onFile, onUrl, onClose }: { onFile: (f: File) => void; onUrl: (u: string) => void; onClose: () => void }) {
  const [url, setUrl] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <div className="popover image-pop" onPointerDown={(e) => e.stopPropagation()}>
      <button className="btn primary full" onClick={() => fileRef.current?.click()}>
        <Icon name="upload" size={18} /> Upload from device
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
          onClose()
        }}
      />
      <div className="or">or from the internet</div>
      <form
        className="url-row"
        onSubmit={(e) => {
          e.preventDefault()
          if (url.trim()) onUrl(url.trim())
          onClose()
        }}
      >
        <input placeholder="https://…/image.png" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <button className="btn ghost small" type="submit">
          Add
        </button>
      </form>
      <p className="hint">Tip: you can also paste (Ctrl/⌘+V) or drag images straight from a web page.</p>
    </div>
  )
}

function SettingsModal({ settings, onChange, onClose }: { settings: Settings; onChange: (s: Settings) => void; onClose: () => void }) {
  const [key, setKey] = useState(settings.apiKey)
  return (
    <div className="modal-bg" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <h3>Settings</h3>
        <label className="field">
          <span>Anthropic API key</span>
          <input type="password" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          <small>
            Stored only in this browser. Requests go straight from your device to the Anthropic API. Get a key at console.anthropic.com.
          </small>
        </label>
        <label className="field">
          <span>Claude effort</span>
          <select value={settings.effort} onChange={(e) => onChange({ ...settings, effort: e.target.value as Settings['effort'] })}>
            <option value="low">Low — fastest, cheapest</option>
            <option value="medium">Medium — balanced (default)</option>
            <option value="high">High — deepest answers</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.pencilOnly} onChange={(e) => onChange({ ...settings, pencilOnly: e.target.checked })} />
          Stylus-only drawing (fingers scroll) — great for iPad + Apple Pencil
        </label>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => {
              onChange({ ...settings, apiKey: key.trim() })
              onClose()
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
