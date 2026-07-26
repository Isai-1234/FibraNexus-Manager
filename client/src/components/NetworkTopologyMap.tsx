import { useMemo, useState } from 'react'
import {
  ArrowLeft, ChevronRight, Globe2, Router as RouterIcon, Network, ZoomIn, ZoomOut,
} from 'lucide-react'
import { cleanDeviceHost } from '../lib/deviceWeb'

type SiteNode = {
  id: number
  name: string
  type?: string
  city?: string
  parentId?: number | null
  equipment?: any[]
  children?: SiteNode[]
}

type Props = {
  tree: SiteNode[]
  selectedSiteId?: number | null
  onSelectSite: (site: SiteNode) => void
  focusSiteId?: number | null
  onFocusSiteChange?: (siteId: number | null) => void
  selectedEquipId?: number | null
  onSelectEquip?: (equip: any | null) => void
  onOpenClient?: (clientId: number) => void
}

type GraphKind = 'internet' | 'site' | 'router' | 'ap' | 'station' | 'homeRouter' | 'other'

type GraphNode = {
  id: string
  kind: GraphKind
  name: string
  sub: string
  online: boolean
  enterable?: boolean
  site?: SiteNode
  equip?: any
  clientId?: number | null
  wireless?: boolean
  x: number
  y: number
  w: number
  h: number
}

type GraphEdge = {
  fromId: string
  toId: string
  wireless?: boolean
  quality?: 'good' | 'ok' | 'poor' | 'down'
}

const CARD_W = 176
const CARD_H = 56
const H_GAP = 72
const V_GAP = 18
const PAD = 40

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

/** Panel sectorial sobre mástil, con lóbulo de radiación. */
function SectorAntennaIcon({ className }: { className?: string }) {
  return (
    <svg {...svgProps} className={className}>
      <rect x="7" y="3" width="4.5" height="9" rx="1.4" />
      <path d="M9.25 12v8" />
      <path d="M6.25 20h6" />
      <path d="M15 5.6a6.5 6.5 0 0 1 0 6.8" />
      <path d="M18.2 3.6a10.5 10.5 0 0 1 0 10.8" />
    </svg>
  )
}

/** Antena direccional (plato) del abonado. */
function CpeDishIcon({ className }: { className?: string }) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M3.5 19.5A11.5 11.5 0 0 1 15 8" />
      <path d="M3.5 19.5 15 8" />
      <path d="M9.25 13.75 12.4 16.9" />
      <circle cx="13.7" cy="18.2" r="1.6" />
      <path d="M17.6 4.6a10.5 10.5 0 0 1 2.4 2.4" />
    </svg>
  )
}

/** Router WiFi dentro de la casa del abonado. */
function HomeWifiRouterIcon({ className }: { className?: string }) {
  return (
    <svg {...svgProps} className={className}>
      <rect x="3" y="13.5" width="18" height="7" rx="2.2" />
      <circle cx="7" cy="17" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="10.2" cy="17" r="0.9" fill="currentColor" stroke="none" />
      <path d="M8.6 6.1a6.5 6.5 0 0 1 6.8 0" />
      <path d="M10.4 9.1a3.2 3.2 0 0 1 3.2 0" />
      <path d="M12 11v2.5" />
    </svg>
  )
}

const ANTENNA_HINT = /nanostation|litebeam|powerbeam|airgrid|rocket|\bloco\b|airmax|airos|iso.?station|sxt|\blhg\b|antena|antenna|sectorial/i
const HOME_ROUTER_HINT = /mercusys|tp-?link|tplink|tenda|archer|deco|nexxt|totolink|xiaomi|huawei|zte|\bonu\b|\bont\b|\bwifi\b|wi-?fi/i

function isOnline(eq: any) {
  return Boolean(eq?.agentConnected || eq?.status === 'online')
}

/** Equipo del abonado que es router WiFi doméstico (no antena de enlace). */
function isHomeRouterEquip(eq: any): boolean {
  if (!eq) return false
  const blob = `${eq.brand || ''} ${eq.model || ''} ${eq.name || ''}`
  if (ANTENNA_HINT.test(blob)) return false
  if (HOME_ROUTER_HINT.test(blob)) return true
  return eq.type !== 'cpe'
}

function isSectorialEquip(eq: any): boolean {
  if (!eq || eq.type === 'router') return false
  if (eq.type === 'ap') return true
  if (eq.clientId) return false
  const blob = `${eq.name || ''} ${eq.notes || ''}`
  if (/sector|ap\b|base|tower|torre/i.test(blob)) return true
  return eq.type === 'cpe' && /ubiquiti|airmax|airos|nanostation|litebeam|powerbeam|rocket|iso.?station|\bloco\b/i.test(
    `${eq.brand || ''} ${eq.model || ''} ${eq.name || ''}`,
  )
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

function sitePath(tree: SiteNode[], id: number): SiteNode[] {
  for (const s of tree) {
    if (s.id === id) return [s]
    if (s.children?.length) {
      const sub = sitePath(s.children, id)
      if (sub.length) return [s, ...sub]
    }
  }
  return []
}

function siteDeviceCount(site: SiteNode): number {
  return (site.equipment || []).filter((e) => e.type !== 'switch').length
    + (site.children || []).reduce((n, c) => n + siteDeviceCount(c), 0)
}

function siteHasOnline(site: SiteNode): boolean {
  const eq = site.equipment || []
  if (eq.some(isOnline)) return true
  return (site.children || []).some(siteHasOnline)
}

function linkQuality(equip?: any): GraphEdge['quality'] {
  if (!equip || !isOnline(equip)) return 'down'
  const signal = equip.wirelessSignal
  if (signal == null) return 'good'
  if (signal >= -60) return 'good'
  if (signal >= -70) return 'ok'
  return 'poor'
}

function edgeColor(q?: GraphEdge['quality'], wireless?: boolean) {
  if (q === 'down') return '#ef4444'
  if (q === 'poor') return '#f97316'
  if (q === 'ok') return '#eab308'
  if (wireless) return '#0d9488'
  return '#64748b'
}

/** Layout horizontal tipo árbol (padre izquierda → hijos derecha). */
function layoutHorizontal(
  roots: Array<Omit<GraphNode, 'x' | 'y' | 'w' | 'h'> & { children?: any[] }>,
  edges: Array<{ fromId: string; toId: string; wireless?: boolean; quality?: GraphEdge['quality'] }>,
) {
  type T = Omit<GraphNode, 'x' | 'y' | 'w' | 'h'> & { children: T[] }
  const byId = new Map<string, T>()
  const raw: T[] = []

  function ensure(n: Omit<GraphNode, 'x' | 'y' | 'w' | 'h'>): T {
    if (!byId.has(n.id)) {
      const t: T = { ...n, children: [] }
      byId.set(n.id, t)
      raw.push(t)
    }
    return byId.get(n.id)!
  }

  for (const r of roots) ensure(r)
  for (const e of edges) {
    const parent = byId.get(e.fromId)
    const child = byId.get(e.toId)
    if (parent && child && !parent.children.includes(child)) parent.children.push(child)
  }

  const childIds = new Set(edges.map((e) => e.toId))
  const rootNodes = roots.map((r) => byId.get(r.id)!).filter((n) => n && !childIds.has(n.id))
  if (!rootNodes.length && roots[0]) rootNodes.push(byId.get(roots[0].id)!)
  const positions = new Map<string, { x: number; y: number }>()

  function subtreeHeight(node: T): number {
    if (!node.children.length) return CARD_H
    return node.children.reduce((sum, c, i) => sum + subtreeHeight(c) + (i ? V_GAP : 0), 0)
  }

  function place(node: T, depth: number, top: number) {
    const h = subtreeHeight(node)
    const x = PAD + depth * (CARD_W + H_GAP)
    const y = top + (h - CARD_H) / 2
    positions.set(node.id, { x, y })
    let childTop = top
    for (const c of node.children) {
      const ch = subtreeHeight(c)
      place(c, depth + 1, childTop)
      childTop += ch + V_GAP
    }
  }

  let forestTop = PAD
  let maxX = PAD + CARD_W
  let maxY = PAD + CARD_H
  for (const r of rootNodes) {
    const h = subtreeHeight(r)
    place(r, 0, forestTop)
    forestTop += h + V_GAP * 2
  }
  for (const [id, pos] of positions) {
    maxX = Math.max(maxX, pos.x + CARD_W)
    maxY = Math.max(maxY, pos.y + CARD_H)
    void id
  }

  const nodes: GraphNode[] = raw.map((n) => {
    const pos = positions.get(n.id) || { x: PAD, y: PAD }
    return { ...n, x: pos.x, y: pos.y, w: CARD_W, h: CARD_H, children: undefined as any }
  })

  return {
    nodes,
    edges: edges as GraphEdge[],
    width: maxX + PAD,
    height: Math.max(420, maxY + PAD),
  }
}

function buildOverviewGraph(tree: SiteNode[]) {
  const nodes: Array<Omit<GraphNode, 'x' | 'y' | 'w' | 'h'>> = [{
    id: 'internet',
    kind: 'internet',
    name: 'Internet',
    sub: 'Salida WAN',
    online: true,
  }]
  const edges: GraphEdge[] = []

  function walk(sites: SiteNode[], parentId: string) {
    for (const s of sites) {
      const id = `site-${s.id}`
      const count = siteDeviceCount(s)
      nodes.push({
        id,
        kind: 'site',
        name: s.name,
        sub: count === 1 ? '1 equipo' : `${count} equipos`,
        online: siteHasOnline(s),
        enterable: true,
        site: s,
      })
      edges.push({ fromId: parentId, toId: id, wireless: false, quality: siteHasOnline(s) ? 'good' : 'down' })
      if (s.children?.length) walk(s.children, id)
    }
  }
  walk(tree, 'internet')
  return layoutHorizontal(nodes, edges)
}

function buildFocusGraph(site: SiteNode) {
  const eq = site.equipment || []
  const routers = eq.filter((e) => e.type === 'router')
  const sectorials = eq.filter(isSectorialEquip)
  const clientEquip = eq.filter((e) => e.clientId)
  const stations = clientEquip.filter((e) => !isHomeRouterEquip(e))
  const homeRouters = clientEquip.filter(isHomeRouterEquip)
  const rest = eq.filter((e) => e.type !== 'router' && !isSectorialEquip(e) && !e.clientId)

  const nodes: Array<Omit<GraphNode, 'x' | 'y' | 'w' | 'h'>> = [{
    id: 'internet',
    kind: 'internet',
    name: 'Internet',
    sub: 'WAN',
    online: true,
  }]
  const edges: GraphEdge[] = []

  const routerIds: string[] = []
  for (const r of routers) {
    const id = `router-${r.id}`
    routerIds.push(id)
    nodes.push({
      id,
      kind: 'router',
      name: r.name || 'Router',
      sub: cleanDeviceHost(r.ipAddress) || 'borde',
      online: isOnline(r),
      equip: r,
    })
    edges.push({
      fromId: 'internet',
      toId: id,
      wireless: false,
      quality: isOnline(r) ? 'good' : 'down',
    })
  }

  const parentForAp = routerIds[0] || 'internet'
  const apIds: string[] = []
  for (const ap of sectorials) {
    const id = `ap-${ap.id}`
    apIds.push(id)
    const kids = stations.length
    nodes.push({
      id,
      kind: 'ap',
      name: ap.name || 'Sectorial',
      sub: kids === 1 ? '1 estación' : `${kids} estaciones`,
      online: isOnline(ap),
      equip: ap,
      wireless: true,
    })
    edges.push({
      fromId: parentForAp,
      toId: id,
      wireless: true,
      quality: linkQuality(ap),
    })
  }

  const stationParent = apIds[0] || parentForAp
  const stationIdByClient = new Map<number, string>()
  for (const st of stations) {
    const id = `station-${st.id}`
    if (st.clientId != null && !stationIdByClient.has(st.clientId)) {
      stationIdByClient.set(st.clientId, id)
    }
    nodes.push({
      id,
      kind: 'station',
      name: st.clientName || st.name || 'Abonado',
      sub: st.wirelessSignal != null
        ? `${st.wirelessSignal} dBm`
        : (cleanDeviceHost(st.displayIp || st.ipAddress) || (isOnline(st) ? 'enlazado' : 'sin enlace')),
      online: isOnline(st),
      equip: st,
      clientId: st.clientId,
      wireless: true,
    })
    edges.push({
      fromId: stationParent,
      toId: id,
      wireless: true,
      quality: linkQuality(st),
    })
  }

  // Router WiFi del abonado: cuelga por cable del CPE de su misma casa.
  for (const hr of homeRouters) {
    const id = `home-${hr.id}`
    const parentId = (hr.clientId != null && stationIdByClient.get(hr.clientId)) || stationParent
    nodes.push({
      id,
      kind: 'homeRouter',
      name: hr.name || 'Router WiFi',
      sub: cleanDeviceHost(hr.displayIp || hr.ipAddress) || 'router WiFi',
      online: isOnline(hr),
      equip: hr,
      clientId: hr.clientId,
    })
    edges.push({
      fromId: parentId,
      toId: id,
      wireless: false,
      quality: isOnline(hr) ? 'good' : 'down',
    })
  }

  for (const o of rest) {
    const id = `other-${o.id}`
    nodes.push({
      id,
      kind: 'other',
      name: o.name || 'Equipo',
      sub: cleanDeviceHost(o.ipAddress) || o.model || 'equipo',
      online: isOnline(o),
      equip: o,
    })
    edges.push({
      fromId: parentForAp,
      toId: id,
      wireless: false,
      quality: isOnline(o) ? 'good' : 'down',
    })
  }

  if (!routers.length && !sectorials.length && !stations.length && !homeRouters.length && !rest.length) {
    nodes.push({
      id: 'empty',
      kind: 'other',
      name: site.name,
      sub: 'Sin equipos',
      online: false,
      site,
    })
    edges.push({ fromId: 'internet', toId: 'empty', quality: 'down' })
  }

  return layoutHorizontal(nodes, edges)
}

const KIND_TONE: Record<GraphKind, string> = {
  internet: 'bg-slate-600 text-white',
  site: 'bg-slate-500 text-white',
  router: 'bg-violet-600 text-white',
  ap: 'bg-teal-600 text-white',
  station: 'bg-sky-600 text-white',
  homeRouter: 'bg-indigo-500 text-white',
  other: 'bg-slate-500 text-white',
}

function KindGlyph({ kind, className }: { kind: GraphKind; className?: string }) {
  if (kind === 'ap') return <SectorAntennaIcon className={className} />
  if (kind === 'station') return <CpeDishIcon className={className} />
  if (kind === 'homeRouter') return <HomeWifiRouterIcon className={className} />
  if (kind === 'internet') return <Globe2 className={className} strokeWidth={2.1} />
  if (kind === 'router') return <RouterIcon className={className} strokeWidth={2.1} />
  return <Network className={className} strokeWidth={2.1} />
}

function NodeIcon({ kind, online }: { kind: GraphKind; online: boolean }) {
  const tone = online ? KIND_TONE[kind] : 'bg-red-500 text-white'
  return (
    <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tone}`}>
      <KindGlyph kind={kind} className="h-[18px] w-[18px]" />
    </span>
  )
}

function connectorPath(
  from: GraphNode,
  to: GraphNode,
): string {
  const x1 = from.x + from.w
  const y1 = from.y + from.h / 2
  const x2 = to.x
  const y2 = to.y + to.h / 2
  const mid = x1 + (x2 - x1) / 2
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`
}

function truncate(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export default function NetworkTopologyMap({
  tree,
  selectedSiteId,
  onSelectSite,
  focusSiteId: focusSiteIdProp,
  onFocusSiteChange,
  selectedEquipId,
  onSelectEquip,
  onOpenClient,
}: Props) {
  const [zoom, setZoom] = useState(1)
  const [internalFocusSiteId, setInternalFocusSiteId] = useState<number | null>(null)
  const focusSiteId = focusSiteIdProp !== undefined ? focusSiteIdProp : internalFocusSiteId

  function setFocusSiteId(id: number | null) {
    if (onFocusSiteChange) onFocusSiteChange(id)
    else setInternalFocusSiteId(id)
  }

  const focusSite = focusSiteId ? findSite(tree, focusSiteId) : null
  const breadcrumb = focusSiteId ? sitePath(tree, focusSiteId) : []

  const graph = useMemo(
    () => (focusSite ? buildFocusGraph(focusSite) : buildOverviewGraph(tree)),
    [tree, focusSite],
  )

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes])

  function enterSite(site: SiteNode) {
    setFocusSiteId(site.id)
    onSelectSite(site)
    const sectorial = (site.equipment || []).find(isSectorialEquip) || null
    onSelectEquip?.(sectorial)
  }

  function backToOverview() {
    setFocusSiteId(null)
    onSelectEquip?.(null)
  }

  function onCardClick(n: GraphNode) {
    if (n.kind === 'site' && n.site) {
      enterSite(n.site)
      return
    }
    if (n.equip) {
      onSelectEquip?.(n.equip)
      return
    }
  }

  function onCardDoubleClick(n: GraphNode) {
    if (n.kind === 'station' && n.clientId && onOpenClient) onOpenClient(n.clientId)
  }

  if (!tree.length) {
    return (
      <div className="h-full min-h-[420px] bg-white rounded-xl border flex flex-col items-center justify-center text-slate-400 p-8">
        <Globe2 className="h-14 w-14 mb-3 opacity-25" />
        <p className="font-medium text-slate-600">Sin nodos en el mapa</p>
        <p className="text-sm mt-1 text-center max-w-sm">Crea tu primer sitio (torre o POP) en la pestaña Árbol.</p>
      </div>
    )
  }

  return (
    <div className="h-full min-h-[480px] bg-white rounded-xl border flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2 bg-white">
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-sm flex-wrap">
            <button
              type="button"
              onClick={backToOverview}
              className={`font-semibold ${focusSite ? 'text-teal-700 hover:underline' : 'text-slate-800'}`}
            >
              Red ISP
            </button>
            {breadcrumb.map((s) => (
              <span key={s.id} className="flex items-center gap-1 text-slate-400">
                <ChevronRight className="h-3.5 w-3.5" />
                <button
                  type="button"
                  onClick={() => enterSite(s)}
                  className={s.id === focusSiteId ? 'font-semibold text-slate-800' : 'hover:text-teal-700 hover:underline'}
                >
                  {s.name}
                </button>
              </span>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {focusSite
              ? 'Clic en un equipo para seleccionar · doble clic en estación = abonado'
              : 'Clic en un nodo para entrar a su topología'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {focusSite && (
            <button
              type="button"
              onClick={backToOverview}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium flex items-center gap-1 text-slate-700"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Toda la red
            </button>
          )}
          <button type="button" onClick={() => setZoom((z) => Math.max(0.55, z - 0.1))} className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50" title="Alejar">
            <ZoomOut className="h-4 w-4 text-slate-600" />
          </button>
          <span className="text-xs text-slate-500 w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(1.35, z + 0.1))} className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50" title="Acercar">
            <ZoomIn className="h-4 w-4 text-slate-600" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-[#f7f8fa]">
        <div
          className="relative origin-top-left"
          style={{
            width: graph.width * zoom,
            height: graph.height * zoom,
          }}
        >
          <div
            className="absolute top-0 left-0"
            style={{
              width: graph.width,
              height: graph.height,
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
            }}
          >
            <svg
              width={graph.width}
              height={graph.height}
              className="absolute inset-0 pointer-events-none"
              aria-hidden
            >
              {graph.edges.map((e) => {
                const from = byId.get(e.fromId)
                const to = byId.get(e.toId)
                if (!from || !to) return null
                const color = edgeColor(e.quality, e.wireless)
                return (
                  <path
                    key={`${e.fromId}-${e.toId}`}
                    d={connectorPath(from, to)}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeDasharray={e.wireless ? '6 5' : undefined}
                    strokeLinecap="round"
                    opacity={0.85}
                  />
                )
              })}
            </svg>

            {graph.nodes.map((n) => {
              const selected = Boolean(
                (n.kind === 'site' && n.site?.id === selectedSiteId)
                || (n.equip && n.equip.id === selectedEquipId),
              )
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onCardClick(n)}
                  onDoubleClick={() => onCardDoubleClick(n)}
                  className={`absolute flex items-center gap-2.5 rounded-xl bg-white px-2.5 text-left shadow-[0_1px_3px_rgba(15,23,42,0.08)] border transition-shadow hover:shadow-md ${
                    selected ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-slate-200/90'
                  }`}
                  style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
                  title={n.enterable ? 'Entrar al nodo' : n.name}
                >
                  <NodeIcon kind={n.kind} online={n.online} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-slate-900 leading-tight truncate">
                      {truncate(n.name, 16)}
                    </span>
                    <span className="block text-[11px] text-slate-500 leading-tight truncate mt-0.5">
                      {n.sub}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="px-4 py-2 border-t bg-white flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
        <span className="font-medium text-slate-600">Equipos</span>
        {([
          ['router', 'router borde'],
          ['ap', 'sectorial'],
          ['station', 'CPE abonado'],
          ['homeRouter', 'router WiFi casa'],
        ] as Array<[GraphKind, string]>).map(([kind, label]) => (
          <span key={kind} className="inline-flex items-center gap-1.5">
            <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full ${KIND_TONE[kind]}`}>
              <KindGlyph kind={kind} className="h-2.5 w-2.5" />
            </span>
            {label}
          </span>
        ))}
      </div>

      <div className="px-4 py-2 border-t bg-white flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
        <span className="font-medium text-slate-600">Enlace</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5 bg-slate-500 rounded" /> cable</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 border-t-2 border-dashed border-teal-600" /> radio</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-teal-600" /> bueno</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-yellow-500" /> regular</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-orange-500" /> flojo</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> offline</span>
      </div>
    </div>
  )
}
