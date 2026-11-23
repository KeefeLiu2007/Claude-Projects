const P: Record<string, string> = {
  select: 'M5 3l6 17 2.2-7.2L20 10.5z',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
  highlighter: 'M9 11l-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 01-2.8 0l-5.2-5.2a2 2 0 010-2.8L14 4',
  eraser: 'M7 21h13M5.6 15.4l9-9a2 2 0 012.8 0l3.2 3.2a2 2 0 010 2.8L12 21H8.6l-3-3a1.8 1.8 0 010-2.6zM9.5 11.5l5 5',
  text: 'M4 7V4h16v3M9 20h6M12 4v16',
  mindmap:
    'M12 9a3 3 0 100 6 3 3 0 000-6zM5 3.5a2 2 0 100 4 2 2 0 000-4zM19 16.5a2 2 0 100 4 2 2 0 000-4zM19 3.5a2 2 0 100 4 2 2 0 000-4zM5 16.5a2 2 0 100 4 2 2 0 000-4zM6.6 6.9l3.2 3M14.2 14.1l3.2 3M14.2 9.9l3.2-3M6.6 17.1l3.2-3',
  image: 'M3 5h18v14H3zM8.5 10.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-5-5L5 19',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3',
  page: 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h7M9 17h7',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  settings: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  upload: 'M12 15V3M7 8l5-5 5 5M5 21h14',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 18l-6-6 6-6',
  sidebar: 'M3 4h18v16H3zM9 4v16',
  zoomIn: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.3-4.3M8 11h6M11 8v6',
  zoomOut: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.3-4.3M8 11h6',
  send: 'M4 12l16-8-6 16-2.5-6.5z',
  close: 'M6 6l12 12M18 6L6 18',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  front: 'M4 14h10V4H4zM10 10h10v10H10z',
  book: 'M4 4h11a3 3 0 013 3v13H7a3 3 0 01-3-3zM4 17a3 3 0 013-3h11',
  stop: 'M7 7h10v10H7z',
  print: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z',
}

export function Icon({ name, size = 20 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name]} />
    </svg>
  )
}
