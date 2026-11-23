export type Template = 'blank' | 'lined' | 'dotted' | 'grid'

export interface PageStyle {
  template: Template
  /** distance between lines / dots / grid cells, in page units */
  spacing: number
  /** stroke width of the lines (or dot radius for dotted) */
  lineWidth: number
  paper: string
  lineColor: string
  /** red margin line on lined paper */
  margin: boolean
}

export type Point = [number, number, number] // x, y, pressure

export interface Stroke {
  id: string
  kind: 'stroke'
  tool: 'pen' | 'highlighter'
  color: string
  size: number
  points: Point[]
}

export interface TextItem {
  id: string
  kind: 'text'
  x: number
  y: number
  w: number
  text: string
  fontSize: number
  color: string
}

export interface ImageItem {
  id: string
  kind: 'image'
  x: number
  y: number
  w: number
  h: number
  src: string
}

export interface MindNode {
  id: string
  kind: 'node'
  x: number // centre
  y: number // centre
  text: string
  color: string
  parentId: string | null
}

export type Item = Stroke | TextItem | ImageItem | MindNode

export interface Page {
  id: string
  style: PageStyle
  items: Item[]
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  /** base64 PNG (no data: prefix) of the page snapshot attached to this turn */
  image?: string
}

export interface Notebook {
  id: string
  title: string
  cover: string
  pages: Page[]
  chat: ChatMessage[]
  updatedAt: number
}

export type Tool = 'select' | 'pen' | 'highlighter' | 'eraser' | 'text' | 'mindmap'

export const PAGE_W = 1240
export const PAGE_H = 1754

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export const defaultStyle = (): PageStyle => ({
  template: 'lined',
  spacing: 40,
  lineWidth: 1,
  paper: '#ffffff',
  lineColor: '#b9c6d8',
  margin: true,
})

export const newPage = (style?: PageStyle): Page => ({
  id: uid(),
  style: style ? { ...style } : defaultStyle(),
  items: [],
})

const COVERS = ['#1f2a44', '#3d5a80', '#7b2d26', '#2d6a4f', '#5f0f40', '#e07a5f', '#264653']

export const newNotebook = (title = 'Untitled notebook'): Notebook => ({
  id: uid(),
  title,
  cover: COVERS[Math.floor(Math.random() * COVERS.length)],
  pages: [newPage()],
  chat: [],
  updatedAt: Date.now(),
})
