import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../types'
import { MODEL } from '../claude'
import { Icon } from './Icon'

interface Props {
  chat: ChatMessage[]
  streaming: string | null
  error: string | null
  hasKey: boolean
  busy: boolean
  onSend: (text: string, attachPage: boolean) => void
  onStop: () => void
  onMindmap: (topic: string, attachPage: boolean) => void
  onInsert: (text: string) => void
  onClear: () => void
  onClose: () => void
  onSettings: () => void
}

export function ClaudePanel(p: Props) {
  const [text, setText] = useState('')
  const [attach, setAttach] = useState(true)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [p.chat.length, p.streaming])

  const send = () => {
    if (!text.trim() || p.busy) return
    p.onSend(text.trim(), attach)
    setText('')
  }

  return (
    <aside className="claude-panel">
      <div className="cp-head">
        <div className="cp-title">
          <Icon name="sparkle" size={18} /> Ask Claude <span className="model-tag">{MODEL}</span>
        </div>
        <div>
          {p.chat.length > 0 && (
            <button className="icon-btn small" title="Clear conversation" onClick={p.onClear}>
              <Icon name="trash" size={16} />
            </button>
          )}
          <button className="icon-btn small" title="Close" onClick={p.onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>

      <div className="cp-body">
        {!p.hasKey && (
          <div className="cp-empty">
            <p>Add your Anthropic API key to start asking Claude about your notes.</p>
            <button className="btn primary" onClick={p.onSettings}>
              Open settings
            </button>
          </div>
        )}
        {p.hasKey && p.chat.length === 0 && !p.streaming && (
          <div className="cp-empty">
            <p>Ask anything — Claude can read the page you're on (handwriting included).</p>
            <div className="suggestions">
              {['Summarise this page', 'Explain the hardest idea here more simply', 'Quiz me on these notes', 'Check my working for mistakes'].map((s) => (
                <button key={s} onClick={() => p.onSend(s, true)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {p.chat.map((m, i) => (
          <div key={i} className={'msg ' + m.role}>
            {m.image && <div className="msg-attach">📄 page attached</div>}
            <div className="msg-text">{m.text}</div>
            {m.role === 'assistant' && (
              <div className="msg-actions">
                <button onClick={() => p.onInsert(m.text)}>
                  <Icon name="plus" size={14} /> Add to page
                </button>
                <button onClick={() => navigator.clipboard?.writeText(m.text)}>
                  <Icon name="copy" size={14} /> Copy
                </button>
              </div>
            )}
          </div>
        ))}
        {p.streaming !== null && (
          <div className="msg assistant">
            <div className="msg-text">{p.streaming || <span className="dots">Thinking</span>}</div>
          </div>
        )}
        {p.error && <div className="cp-error">{p.error}</div>}
        <div ref={endRef} />
      </div>

      <div className="cp-input">
        <textarea
          value={text}
          placeholder={p.hasKey ? 'Ask about your notes…' : 'Add an API key in settings first'}
          disabled={!p.hasKey}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="cp-row">
          <label className="check">
            <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} /> Attach current page
          </label>
          <div className="cp-buttons">
            <button
              className="btn ghost small"
              disabled={!p.hasKey || p.busy}
              title="Build a mind map from your text (or from the page if the box is empty)"
              onClick={() => {
                p.onMindmap(text.trim(), attach)
                setText('')
              }}
            >
              <Icon name="mindmap" size={16} /> Mind map
            </button>
            {p.streaming !== null ? (
              <button className="btn primary small" onClick={p.onStop}>
                <Icon name="stop" size={16} /> Stop
              </button>
            ) : (
              <button className="btn primary small" disabled={!p.hasKey || !text.trim() || p.busy} onClick={send}>
                <Icon name="send" size={16} /> Send
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
