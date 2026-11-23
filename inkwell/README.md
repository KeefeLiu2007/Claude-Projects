# Inkwell ✒️

A GoodNotes / Concepts-style notebook that runs in the browser (desktop, iPad, or phone), with Claude Opus 5.5 built in.

## Features
- **Paper:** blank, lined (with optional margin), dotted, and grid. Spacing, line width or dot size, line colour, and paper colour are all adjustable, per page or for every page.
- **Ink:** pressure-sensitive pen (works with Apple Pencil and other styluses), highlighter, stroke eraser, select and move, and undo/redo.
- **Text:** tap to type, drag to move, and drag the side handle to resize. Size and colour can be changed.
- **Images:** upload from your device, add from a URL, paste (Ctrl/⌘+V), or drag one in from a web page. Images can be resized and downloaded.
- **Mind maps:** tap to add a central idea, use `+` or Tab to branch, and drag a node to move it together with its children. **✨ Expand** asks Claude for child ideas.
- **Ask Claude:** a chat side panel that can see the page you're on, handwriting included. It streams answers, and **Add to page** drops an answer onto your page. **Mind map** builds a whole map from a topic or from your notes.
- **Library and export:** multiple notebooks, autosave in the browser (IndexedDB), export a page as PNG, print or save the notebook as PDF, and export or import notebook files (.json).

## Run it
```bash
cd inkwell
npm install
npm run dev        # open the printed URL (add --host to open it from an iPad on the same Wi-Fi)
npm run build      # static build in dist/ (deploys to any static host)
```

Open **Settings**, paste your Anthropic API key (from console.anthropic.com), and you can start asking Claude questions. The key is stored only in your browser, and requests go directly from your device to the Anthropic API. For a public deployment, put the API calls behind your own server instead of shipping keys to the browser.

## Shortcuts
`V` select · `P` pen · `H` highlighter · `E` eraser · `T` text · `M` mind map · `Ctrl/⌘+Z` undo · `Ctrl/⌘+Shift+Z` redo · `Delete` removes the selection · `Ctrl/⌘+scroll` zooms

On iPad, turn on **Stylus-only drawing** in Settings so your finger scrolls while the Pencil draws.

## Code map
- `src/App.tsx`: app state, toolbar, page and image popovers, the Claude wiring, and undo/redo
- `src/components/PageView.tsx`: one page. Handles drawing, erasing, dragging, text and mind-map nodes
- `src/render.ts`: canvas renderer used for PNG/PDF export, thumbnails, and the page snapshots sent to Claude
- `src/claude.ts`: Anthropic SDK calls (streaming chat plus structured outputs for mind maps), model `claude-opus-5-5`
