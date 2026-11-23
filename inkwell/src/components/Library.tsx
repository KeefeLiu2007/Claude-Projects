import { useRef } from 'react'
import type { Notebook } from '../types'
import { Icon } from './Icon'

interface Props {
  books: Notebook[]
  onOpen: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  onImport: (file: File) => void
  onSettings: () => void
}

export function Library({ books, onOpen, onCreate, onDelete, onRename, onImport, onSettings }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const sorted = [...books].sort((a, b) => b.updatedAt - a.updatedAt)
  return (
    <div className="library">
      <header className="lib-head">
        <div className="brand">
          <img src="/favicon.svg" width={34} height={34} alt="" />
          <h1>Inkwell</h1>
        </div>
        <div className="lib-actions">
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={18} /> Import
          </button>
          <button className="btn ghost" onClick={onSettings}>
            <Icon name="settings" size={18} /> Settings
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onImport(f)
              e.target.value = ''
            }}
          />
        </div>
      </header>
      <div className="shelf">
        <button className="book new" onClick={onCreate}>
          <div className="cover">
            <Icon name="plus" size={40} />
          </div>
          <div className="book-title">New notebook</div>
        </button>
        {sorted.map((b) => (
          <div className="book" key={b.id}>
            <button className="cover" style={{ background: b.cover }} onClick={() => onOpen(b.id)}>
              <span className="cover-title">{b.title}</span>
            </button>
            <input className="book-title" value={b.title} onChange={(e) => onRename(b.id, e.target.value)} />
            <div className="book-meta">
              {b.pages.length} page{b.pages.length === 1 ? '' : 's'} · {new Date(b.updatedAt).toLocaleDateString()}
              <button
                className="icon-btn small"
                title="Delete notebook"
                onClick={() => {
                  if (confirm(`Delete "${b.title}"? This can't be undone.`)) onDelete(b.id)
                }}
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
