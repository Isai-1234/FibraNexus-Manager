import fs from 'fs'
import path from 'path'

const roots = [
  'client/src/pages/admin',
  'client/src/components',
  'client/src/pages/technician',
]

const pairs = [
  ['hover:bg-gray-50', 'hover:bg-surface-raised'],
  ['hover:bg-white', 'hover:bg-surface-card'],
  ['bg-white', 'bg-surface-card'],
  ['bg-gray-50', 'bg-surface'],
  ['bg-gray-100', 'bg-surface-raised'],
  ['text-gray-900', 'text-ink'],
  ['text-gray-700', 'text-ink-soft'],
  ['text-gray-500', 'text-ink-muted'],
  ['border-gray-200', 'border-line'],
  ['border-gray-100', 'border-line'],
  ['bg-slate-950', 'bg-surface'],
  ['bg-slate-900/95', 'bg-surface-card/95'],
  ['bg-slate-900/80', 'bg-surface-card/80'],
  ['bg-slate-900/60', 'bg-surface-card/60'],
  ['bg-slate-900', 'bg-surface-card'],
  ['bg-slate-800/80', 'bg-surface-raised/80'],
  ['bg-slate-800/40', 'bg-surface-raised/40'],
  ['bg-slate-800', 'bg-surface-raised'],
  ['border-slate-800', 'border-line'],
  ['border-slate-700/80', 'border-line'],
  ['border-slate-700', 'border-line'],
  ['border-slate-600', 'border-line'],
  ['text-slate-100', 'text-ink'],
  ['text-slate-200', 'text-ink'],
  ['text-slate-300', 'text-ink-soft'],
  ['text-slate-400', 'text-ink-muted'],
  ['text-slate-500', 'text-ink-muted'],
]

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(tsx|jsx)$/.test(e.name) && e.name !== 'ThemeToggle.tsx') out.push(p)
  }
  return out
}

let files = []
for (const r of roots) files = files.concat(walk(r))

for (const file of files) {
  let s = fs.readFileSync(file, 'utf8')
  const orig = s
  for (const [a, b] of pairs) s = s.split(a).join(b)
  if (s !== orig) {
    fs.writeFileSync(file, s)
    console.log('updated', file)
  }
}
console.log('done', files.length, 'files scanned')
