import { memo, useEffect, useState } from 'react'
import type { Page } from '../types'
import { renderPage } from '../render'

export const Thumb = memo(function Thumb({ page }: { page: Page }) {
  const [src, setSrc] = useState<string>('')
  useEffect(() => {
    let dead = false
    const t = window.setTimeout(async () => {
      const c = await renderPage(page, 0.12)
      if (dead) return
      try {
        setSrc(c.toDataURL('image/png'))
      } catch {
        setSrc('')
      }
    }, 600)
    return () => {
      dead = true
      window.clearTimeout(t)
    }
  }, [page])
  return src ? <img src={src} alt="" draggable={false} /> : <div className="thumb-blank" style={{ background: page.style.paper }} />
})
