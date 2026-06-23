import { useMemo, useState } from 'react'
import { MapPin, Radio, ZoomIn, ZoomOut } from 'lucide-react'
import { openDeviceWeb } from '../lib/deviceWeb'

type SiteNode = {
  id: number
  name: string
  type?: string
  city?: string
  parentId?: number | null
  latitude?: string | number | null
  longitude?: string | number | null
  equipment?: any[]
  children?: SiteNode[]
}

type Props = {
  tree: SiteNode[]
  selectedSiteId?: number | null
  onSelectSite: (site: SiteNode) => void
}

type LayoutNode = {
  kind: 'site' | 'cpe'
  id: string
  siteId?: number
  clientId?: number
  name: string
  sub?: string
  online?: boolean
  x: number
  y: number
  w: number
  h: number
  site?: SiteNode
  equip?: any
}

type LayoutEdge = { x1: number; y1: number; x2: number; y2: number; dashed?: boolean }

const SITE_W = 152
const SITE_H = 76
const CPE_W = 118
const CPE_H = 52
const ROW_GAP = 100
const COL_GAP = 36
const PAD = 48

function isOnline(eq: any) {
  return eq.agentConnected || eq.status === 'online'
}

function siteOnline(site: SiteNode) {
  const eq = site.equipment || []
  const routers = eq.filter((e) => e.type === 'router')
  if (routers.length) return routers.some(isOnline)
  return eq.some((e) => e.type === 'cpe' && isOnline(e))
}

function flattenSites(nodes: SiteNode[], parentId: number | null = null, depth = 0, out: { site: SiteNode; depth: number; parentId: number | null }[] = []) {
  for (const site of nodes) {
    out.push({ site, depth, parentId })
    if (site.children?.length) flattenSites(site.children, site.id, depth + 1, out)
  }
  return out
}

function computeLayout(tree: SiteNode[]) {
  const flat = flattenSites(tree)
  const nodes: LayoutNode[] = []
  const edges: LayoutEdge[] = []
  const posBySiteId = new Map<number, { x: number; y: number; cx: number; cy: number; bottom: number }>()

  const byDepth = new Map<number, typeof flat>()
  for (const row of flat) {
    if (!byDepth.has(row.depth)) byDepth.set(row.depth, [])
    byDepth.get(row.depth)!.push(row)
  }

  const depths = [...byDepth.keys()].sort((a, b) => a - b)
  let maxX = PAD
  let maxY = PAD

  for (const depth of depths) {
    const row = byDepth.get(depth)!
    const rowWidth = row.length * SITE_W + (row.length - 1) * COL_GAP
    let x = PAD + Math.max(0, (800 - rowWidth) / 2)
    const y = PAD + depth * (SITE_H + ROW_GAP + CPE_H + 24)

    for (const { site, parentId } of row) {
      const routers = (site.equipment || []).filter((e) => e.type === 'router')
      const cpes = (site.equipment || []).filter((e) => e.type === 'cpe')
      const cx = x + SITE_W / 2
      const cy = y + SITE_H / 2
      const bottom = y + SITE_H

      posBySiteId.set(site.id, { x, y, cx, cy, bottom })

      nodes.push({
        kind: 'site',
        id: `site-${site.id}`,
        siteId: site.id,
        name: site.name,
        sub: site.city || site.type || 'nodo',
        online: siteOnline(site),
        x,
        y,
        w: SITE_W,
        h: SITE_H,
        site,
      })

      if (parentId != null && posBySiteId.has(parentId)) {
        const p = posBySiteId.get(parentId)!
        edges.push({ x1: p.cx, y1: p.bottom, x2: cx, y2: y })
      }

      cpes.forEach((eq, i) => {
        const cpeX = x + (SITE_W - Math.min(cpes.length, 3) * (CPE_W + 8)) / 2 + (i % 3) * (CPE_W + 8)
        const cpeY = y + SITE_H + 18 + Math.floor(i / 3) * (CPE_H + 10)
        nodes.push({
          kind: 'cpe',
          id: `cpe-${eq.id}`,
          siteId: site.id,
          clientId: eq.clientId,
          name: eq.clientName || eq.name,
          sub: eq.ipAddress ? String(eq.ipAddress).split('/')[0] : 'sin IP',
          online: isOnline(eq),
          x: cpeX,
          y: cpeY,
          w: CPE_W,
          h: CPE_H,
          equip: eq,
        })
        edges.push({
          x1: cx,
          y1: bottom,
          x2: cpeX + CPE_W / 2,
          y2: cpeY,
          dashed: true,
        })
      })

      maxX = Math.max(maxX, x + SITE_W + cpes.length * (CPE_W + 8))
      maxY = Math.max(maxY, y + SITE_H + 18 + Math.ceil(cpes.length / 3) * (CPE_H + 10))
      x += SITE_W + COL_GAP
    }
  }

  return {
    nodes,
    edges,
    width: Math.max(720, maxX + PAD),
    height: Math.max(420, maxY + PAD),
    routerCount: flat.reduce((n, r) => n + (r.site.equipment || []).filter((e) => e.type === 'router').length, 0),
    cpeCount: flat.reduce((n, r) => n + (r.site.equipment || []).filter((e) => e.type === 'cpe').length, 0),
  }
}

export default function NetworkTopologyMap({ tree, selectedSiteId, onSelectSite }: Props) {
  const [zoom, setZoom] = useState(1)
  const layout = useMemo(() => computeLayout(tree), [tree])

  if (!tree.length) {
    return (
      <div className="h-full min-h-[420px] bg-white rounded-xl border flex flex-col items-center justify-center text-gray-400 p-8">
        <Radio className="h-14 w-14 mb-3 opacity-25" />
        <p className="font-medium text-gray-600">Sin nodos en el mapa</p>
        <p className="text-sm mt-1 text-center max-w-sm">Crea tu primer sitio (torre o POP) en la pestaña Árbol para ver la topología aquí.</p>
      </div>
    )
  }

  return (
    <div className="h-full min-h-[420px] bg-white rounded-xl border flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2 bg-slate-50/80">
        <div>
          <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-blue-600" /> Topología de red
          </p>
          <p className="text-xs text-gray-500">
            {layout.routerCount} router(s) · {layout.cpeCount} CPE(s) — clic en nodo para gestionar · clic en antena para abrir en el navegador
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))} className="p-2 rounded-lg border bg-white hover:bg-gray-50" title="Alejar">
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="text-xs text-gray-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(1.4, z + 0.1))} className="p-2 rounded-lg border bg-white hover:bg-gray-50" title="Acercar">
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-[radial-gradient(circle_at_1px_1px,#e2e8f0_1px,transparent_0)] [background-size:20px_20px]">
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="min-w-full"
          style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: layout.width * zoom, height: layout.height * zoom }}
        >
          <g>
            {layout.edges.map((e, i) => (
              <line
                key={`e-${i}`}
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
                stroke={e.dashed ? '#94a3b8' : '#3b82f6'}
                strokeWidth={e.dashed ? 1.5 : 2}
                strokeDasharray={e.dashed ? '6 4' : undefined}
                opacity={0.7}
              />
            ))}

            {layout.nodes.map((n) => {
              const selected = n.kind === 'site' && n.siteId === selectedSiteId
              const fill = n.kind === 'site'
                ? (selected ? '#eff6ff' : '#ffffff')
                : (n.online ? '#f0fdf4' : '#fafafa')
              const stroke = n.kind === 'site'
                ? (selected ? '#2563eb' : n.online ? '#22c55e' : '#cbd5e1')
                : (n.online ? '#86efac' : '#e2e8f0')

              const handleClick = () => {
                if (n.kind === 'site' && n.site) onSelectSite(n.site)
                else if (n.kind === 'cpe') {
                  const ip = n.equip?.ipAddress
                  if (ip) openDeviceWeb(ip)
                  else if (n.siteId) {
                    const site = findSite(tree, n.siteId)
                    if (site) onSelectSite(site)
                  }
                }
              }

              return (
                <g key={n.id} onClick={handleClick} className="cursor-pointer">
                  <rect
                    x={n.x}
                    y={n.y}
                    width={n.w}
                    height={n.h}
                    rx={10}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={selected ? 2.5 : 1.5}
                    className="transition-all hover:brightness-[0.98]"
                  />
                  <circle
                    cx={n.x + n.w - 12}
                    cy={n.y + 12}
                    r={5}
                    fill={n.online ? '#22c55e' : '#94a3b8'}
                  />
                  {n.kind === 'site' ? (
                    <>
                      <rect x={n.x + 12} y={n.y + 16} width={14} height={10} rx={2} fill="#6366f1" opacity={0.85} />
                      <circle cx={n.x + 19} cy={n.y + 14} r={2} fill="#6366f1" />
                      <text x={n.x + 32} y={n.y + 28} fill="#111827" style={{ fontSize: 12, fontWeight: 600 }}>
                        {truncate(n.name, 14)}
                      </text>
                      <text x={n.x + 14} y={n.y + 48} fill="#6b7280" style={{ fontSize: 10 }}>
                        {truncate(n.sub || '', 18)}
                      </text>
                      <text x={n.x + 14} y={n.y + 64} fill="#9ca3af" style={{ fontSize: 9 }}>
                        {(n.site?.equipment || []).filter((e) => e.type === 'router').length} router · {(n.site?.equipment || []).filter((e) => e.type === 'cpe').length} CPE
                      </text>
                    </>
                  ) : (
                    <>
                      <path d={`M ${n.x + 18} ${n.y + 12} L ${n.x + 24} ${n.y + 22} L ${n.x + 12} ${n.y + 22} Z`} fill="#f97316" opacity={0.9} />
                      <text x={n.x + 30} y={n.y + 24} fill="#111827" style={{ fontSize: 11, fontWeight: 600 }}>
                        {truncate(n.name, 12)}
                      </text>
                      <text x={n.x + 10} y={n.y + 40} fill="#2563eb" style={{ fontSize: 10, fontFamily: 'ui-monospace, monospace' }}>
                        {n.sub}
                      </text>
                    </>
                  )}
                </g>
              )
            })}
          </g>
        </svg>
      </div>
    </div>
  )
}

function truncate(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function findSite(nodes: SiteNode[], id: number): SiteNode | null {
  for (const s of nodes) {
    if (s.id === id) return s
    if (s.children?.length) {
      const found = findSite(s.children, id)
      if (found) return found
    }
  }
  return null
}
