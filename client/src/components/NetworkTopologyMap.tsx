import { useMemo, useState } from 'react'
import type { MouseEvent } from 'react'
import { ArrowLeft, ChevronRight, MapPin, Radio, ZoomIn, ZoomOut } from 'lucide-react'
import { cleanDeviceHost, openDeviceWeb } from '../lib/deviceWeb'

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
}

type NodeKind = 'site' | 'router' | 'cpe' | 'site-label'

type LayoutNode = {
  kind: NodeKind
  id: string
  siteId?: number
  clientId?: number
  name: string
  sub?: string
  host?: string | null
  online?: boolean
  x: number
  y: number
  w: number
  h: number
  site?: SiteNode
  equip?: any
  enterable?: boolean
}

type LayoutEdge = { fromId: string; toId: string; dashed?: boolean }

const SITE_W = 176
const SITE_H = 76
const ROUTER_W = 140
const ROUTER_H = 52
const CPE_W = 124
const CPE_H = 54
const COL_GAP = 32
const ROW_GAP = 44
const PAD = 56

function isOnline(eq: any) {
  return eq.agentConnected || eq.status === 'online'
}

function siteOnline(site: SiteNode) {
  const eq = site.equipment || []
  const routers = eq.filter((e) => e.type === 'router')
  if (routers.length) return routers.some(isOnline)
  return eq.some((e) => e.type === 'cpe' && isOnline(e))
}

function routerHost(eq: any): string | null {
  return cleanDeviceHost(eq.ipAddress || eq.credentials?.tunnelHostname || null)
}

function countEquip(site: SiteNode) {
  const eq = site.equipment || []
  return {
    routers: eq.filter((e) => e.type === 'router').length,
    cpes: eq.filter((e) => e.type === 'cpe').length,
  }
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

function measureSiteBranch(site: SiteNode): number {
  const children = site.children || []
  if (!children.length) return SITE_W
  return children.reduce((sum, c, i) => sum + measureSiteBranch(c) + (i ? COL_GAP : 0), 0)
}

type BuildCtx = { nodes: LayoutNode[]; edges: LayoutEdge[]; maxX: number; maxY: number }

function placeSiteNode(
  ctx: BuildCtx,
  site: SiteNode,
  x: number,
  y: number,
  parentId: string | null,
  parentBottom?: { cx: number; y: number },
) {
  const id = `site-${site.id}`
  const cx = x + SITE_W / 2
  const bottom = y + SITE_H
  const counts = countEquip(site)

  ctx.nodes.push({
    kind: 'site',
    id,
    siteId: site.id,
    name: site.name,
    sub: site.city || site.type || 'nodo',
    online: siteOnline(site),
    x,
    y,
    w: SITE_W,
    h: SITE_H,
    site,
    enterable: true,
  })

  if (parentId && parentBottom) {
    ctx.edges.push({ fromId: parentId, toId: id })
  }

  ctx.maxX = Math.max(ctx.maxX, x + SITE_W + PAD)
  ctx.maxY = Math.max(ctx.maxY, bottom + PAD)

  const children = site.children || []
  if (!children.length) return bottom

  const branchW = children.reduce((sum, c, i) => sum + measureSiteBranch(c) + (i ? COL_GAP : 0), 0)
  let childX = cx - branchW / 2
  const childY = bottom + ROW_GAP

  for (const child of children) {
    const w = measureSiteBranch(child)
    placeSiteNode(ctx, child, childX + (w - SITE_W) / 2, childY, id, { cx, y: bottom })
    childX += w + COL_GAP
    ctx.maxX = Math.max(ctx.maxX, childX)
  }

  ctx.maxY = Math.max(ctx.maxY, childY + SITE_H + ROW_GAP)
}

function computeOverviewLayout(tree: SiteNode[]) {
  const ctx: BuildCtx = { nodes: [], edges: [], maxX: PAD, maxY: PAD }
  if (!tree.length) {
    return { nodes: [], edges: [], width: 720, height: 480, routerCount: 0, cpeCount: 0 }
  }

  const branchW = tree.reduce((sum, r, i) => sum + measureSiteBranch(r) + (i ? COL_GAP * 2 : 0), 0)
  let x = Math.max(PAD, (720 - branchW) / 2)
  for (const root of tree) {
    const w = measureSiteBranch(root)
    placeSiteNode(ctx, root, x + (w - SITE_W) / 2, PAD, null)
    x += w + COL_GAP * 2
  }

  let routerCount = 0
  let cpeCount = 0
  function walk(sites: SiteNode[]) {
    for (const s of sites) {
      routerCount += countEquip(s).routers
      cpeCount += countEquip(s).cpes
      if (s.children?.length) walk(s.children)
    }
  }
  walk(tree)

  return {
    nodes: ctx.nodes,
    edges: ctx.edges,
    width: Math.max(720, ctx.maxX + PAD),
    height: Math.max(420, ctx.maxY + PAD),
    routerCount,
    cpeCount,
  }
}

function routerParentId(r: any, routerIds: Set<number>): number | null {
  const pid = r.parentId || r.credentials?.parentRouterId
  if (pid && routerIds.has(Number(pid))) return Number(pid)
  return null
}

function assignCpesToRouters(cpes: any[], routers: any[]) {
  const map = new Map<number, any[]>()
  for (const r of routers) map.set(r.id, [])

  for (const cpe of cpes) {
    const pid = cpe.parentId || cpe.credentials?.routerId
    if (pid != null && map.has(Number(pid))) {
      map.get(Number(pid))!.push(cpe)
    }
  }

  const unassigned = cpes.filter((c) => {
    const pid = c.parentId || c.credentials?.routerId
    return pid == null || !routers.some((r) => r.id === Number(pid))
  })

  if (unassigned.length && routers.length) {
    const routerIds = new Set(routers.map((r) => r.id))
    const upstream = routers.find((r) => !routerParentId(r, routerIds)) || routers[0]
    map.get(upstream.id)!.push(...unassigned)
  }

  return map
}

function measureRouterBranch(router: any, cpeMap: Map<number, any[]>, childRouters: any[]): number {
  const cpes = cpeMap.get(router.id) || []
  const cpeW = cpes.length
    ? cpes.reduce((sum, c, i) => sum + CPE_W + (i ? 10 : 0), 0)
    : 0
  const childW = childRouters.length
    ? childRouters.reduce((sum, r, i) => sum + measureRouterBranch(r, cpeMap, []) + (i ? COL_GAP : 0), 0)
    : 0
  return Math.max(ROUTER_W, cpeW, childW)
}

function placeRouterTree(
  ctx: BuildCtx,
  router: any,
  cpeMap: Map<number, any[]>,
  childRouters: any[],
  allRouters: any[],
  x: number,
  y: number,
  parentId: string | null,
  parentBottom?: { cx: number; y: number },
) {
  const id = `router-${router.id}`
  const cx = x + ROUTER_W / 2
  const bottom = y + ROUTER_H
  const host = routerHost(router)

  ctx.nodes.push({
    kind: 'router',
    id,
    siteId: router.siteId,
    name: router.name || 'Router',
    sub: host || 'sin IP',
    host,
    online: isOnline(router),
    x,
    y,
    w: ROUTER_W,
    h: ROUTER_H,
    equip: router,
  })

  if (parentId && parentBottom) {
    ctx.edges.push({ fromId: parentId, toId: id, dashed: parentId.startsWith('router-') })
  }

  ctx.maxX = Math.max(ctx.maxX, x + ROUTER_W + PAD)
  ctx.maxY = Math.max(ctx.maxY, bottom + PAD)

  const routerCpes = cpeMap.get(router.id) || []
  let subtreeBottom = bottom

  if (routerCpes.length) {
    const rowW = routerCpes.reduce((sum, c, i) => sum + CPE_W + (i ? 10 : 0), 0)
    let cxPos = cx - rowW / 2
    const cpeY = bottom + 28

    for (const eq of routerCpes) {
      const hostCpe = cleanDeviceHost(eq.ipAddress)
      const cpeId = `cpe-${eq.id}`
      ctx.nodes.push({
        kind: 'cpe',
        id: cpeId,
        siteId: router.siteId,
        clientId: eq.clientId,
        name: eq.clientName || eq.name,
        sub: hostCpe || 'sin IP',
        host: hostCpe,
        online: isOnline(eq),
        x: cxPos,
        y: cpeY,
        w: CPE_W,
        h: CPE_H,
        equip: eq,
      })
      ctx.edges.push({ fromId: id, toId: cpeId, dashed: true })
      cxPos += CPE_W + 10
      ctx.maxX = Math.max(ctx.maxX, cxPos)
    }
    subtreeBottom = cpeY + CPE_H
    ctx.maxY = Math.max(ctx.maxY, subtreeBottom + PAD)
  }

  if (childRouters.length) {
    const branchW = childRouters.reduce((sum, r, i) => sum + measureRouterBranch(r, cpeMap, []) + (i ? COL_GAP : 0), 0)
    let childX = cx - branchW / 2
    const childY = subtreeBottom + 28
    const routerIds = new Set(allRouters.map((r) => r.id))

    for (const child of childRouters) {
      const w = measureRouterBranch(child, cpeMap, [])
      placeRouterTree(
        ctx,
        child,
        cpeMap,
        allRouters.filter((r) => routerParentId(r, routerIds) === child.id),
        allRouters,
        childX + (w - ROUTER_W) / 2,
        childY,
        id,
        { cx, y: subtreeBottom },
      )
      childX += w + COL_GAP
    }
    ctx.maxY = Math.max(ctx.maxY, childY + ROUTER_H + PAD)
  }

  return subtreeBottom
}

function computeFocusLayout(site: SiteNode) {
  const ctx: BuildCtx = { nodes: [], edges: [], maxX: PAD, maxY: PAD }
  const routers = (site.equipment || []).filter((e) => e.type === 'router')
  const cpes = (site.equipment || []).filter((e) => e.type === 'cpe')
  const routerIds = new Set(routers.map((r) => r.id))

  const labelId = `label-${site.id}`
  ctx.nodes.push({
    kind: 'site-label',
    id: labelId,
    siteId: site.id,
    name: site.name,
    sub: site.city || site.type || 'nodo',
    online: siteOnline(site),
    x: PAD,
    y: PAD,
    w: Math.max(SITE_W, 240),
    h: 40,
    site,
  })

  let y = PAD + 52

  if (!routers.length && !cpes.length) {
    ctx.maxY = y + 80
    return {
      nodes: ctx.nodes,
      edges: ctx.edges,
      width: 640,
      height: 280,
      routerCount: 0,
      cpeCount: 0,
    }
  }

  if (!routers.length) {
    const rowW = cpes.reduce((sum, c, i) => sum + CPE_W + (i ? 10 : 0), 0)
    let x = PAD + Math.max(0, (640 - rowW) / 2)
    for (const eq of cpes) {
      const host = cleanDeviceHost(eq.ipAddress)
      const id = `cpe-${eq.id}`
      ctx.nodes.push({
        kind: 'cpe',
        id,
        siteId: site.id,
        clientId: eq.clientId,
        name: eq.clientName || eq.name,
        sub: host || 'sin IP',
        host,
        online: isOnline(eq),
        x,
        y,
        w: CPE_W,
        h: CPE_H,
        equip: eq,
      })
      ctx.edges.push({ fromId: labelId, toId: id, dashed: true })
      x += CPE_W + 10
    }
    ctx.maxX = x + PAD
    ctx.maxY = y + CPE_H + PAD
    return {
      nodes: ctx.nodes,
      edges: ctx.edges,
      width: Math.max(640, ctx.maxX),
      height: Math.max(320, ctx.maxY),
      routerCount: 0,
      cpeCount: cpes.length,
    }
  }

  const roots = routers.filter((r) => !routerParentId(r, routerIds))
  const cpeMap = assignCpesToRouters(cpes, routers)

  const branchW = roots.reduce((sum, r, i) => {
    const w = measureRouterBranch(r, cpeMap, routers.filter((x) => routerParentId(x, routerIds) === r.id))
    return sum + w + (i ? COL_GAP : 0)
  }, 0)

  let rx = PAD + Math.max(0, (Math.max(720, branchW + PAD * 2) - branchW) / 2)
  const routerY = y

  for (const router of roots) {
    const childRouters = routers.filter((r) => routerParentId(r, routerIds) === router.id)
    const branch = measureRouterBranch(router, cpeMap, childRouters)
    placeRouterTree(
      ctx,
      router,
      cpeMap,
      childRouters,
      routers,
      rx + (branch - ROUTER_W) / 2,
      routerY,
      labelId,
      { cx: PAD + 120, y: PAD + 40 },
    )
    rx += branch + COL_GAP
  }

  return {
    nodes: ctx.nodes,
    edges: ctx.edges,
    width: Math.max(720, ctx.maxX + PAD),
    height: Math.max(420, ctx.maxY + PAD),
    routerCount: routers.length,
    cpeCount: cpes.length,
  }
}

function nodeAnchor(n: LayoutNode) {
  return {
    cx: n.x + n.w / 2,
    top: n.y,
    bottom: n.y + n.h,
  }
}

function truncate(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export default function NetworkTopologyMap({ tree, selectedSiteId, onSelectSite }: Props) {
  const [zoom, setZoom] = useState(1)
  const [focusSiteId, setFocusSiteId] = useState<number | null>(null)

  const focusSite = focusSiteId ? findSite(tree, focusSiteId) : null
  const breadcrumb = focusSiteId ? sitePath(tree, focusSiteId) : []

  const layout = useMemo(() => {
    if (focusSite) return computeFocusLayout(focusSite)
    return computeOverviewLayout(tree)
  }, [tree, focusSite])

  const edgesDrawn = useMemo(() => {
    const posById = new Map(layout.nodes.map((n) => [n.id, n]))
    return layout.edges.map((e) => {
      const from = posById.get(e.fromId)
      const to = posById.get(e.toId)
      if (!from || !to) return null
      const fa = nodeAnchor(from)
      const ta = nodeAnchor(to)
      return {
        ...e,
        x1: fa.cx,
        y1: fa.bottom,
        x2: ta.cx,
        y2: ta.top,
      }
    }).filter(Boolean) as (LayoutEdge & { x1: number; y1: number; x2: number; y2: number })[]
  }, [layout])

  function enterSite(site: SiteNode) {
    setFocusSiteId(site.id)
    onSelectSite(site)
  }

  function backToOverview() {
    setFocusSiteId(null)
  }

  function handleNodeClick(ev: MouseEvent, n: LayoutNode) {
    if (n.kind === 'site' && n.site) {
      enterSite(n.site)
      return
    }
    if ((n.kind === 'router' || n.kind === 'cpe') && n.host) {
      ev.stopPropagation()
      openDeviceWeb(n.host)
    }
  }

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
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-sm flex-wrap">
            <button
              type="button"
              onClick={backToOverview}
              className={`font-semibold ${focusSite ? 'text-blue-600 hover:underline' : 'text-gray-800'}`}
            >
              Red ISP
            </button>
            {breadcrumb.map((s) => (
              <span key={s.id} className="flex items-center gap-1 text-gray-500">
                <ChevronRight className="h-3.5 w-3.5" />
                <span className={s.id === focusSiteId ? 'font-semibold text-gray-800' : ''}>{s.name}</span>
              </span>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {focusSite
              ? `${layout.routerCount} router(s) · ${layout.cpeCount} CPE(s) dentro del nodo — clic IP = interfaz web`
              : `${layout.routerCount} router(s) · ${layout.cpeCount} CPE(s) — clic en nodo para entrar y ver equipos`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {focusSite && (
            <button
              type="button"
              onClick={backToOverview}
              className="px-2.5 py-1.5 rounded-lg border bg-white hover:bg-gray-50 text-xs font-medium flex items-center gap-1"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Volver al árbol
            </button>
          )}
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
          className="min-w-full select-none"
          style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: layout.width * zoom, height: layout.height * zoom }}
        >
          <g>
            {edgesDrawn.map((e, i) => (
              <line
                key={`e-${i}`}
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
                stroke={e.dashed ? '#94a3b8' : '#3b82f6'}
                strokeWidth={e.dashed ? 1.5 : 2.5}
                strokeDasharray={e.dashed ? '6 4' : undefined}
                opacity={0.8}
              />
            ))}

            {layout.nodes.map((n) => {
              const selected = (n.kind === 'site' || n.kind === 'site-label') && n.siteId === selectedSiteId
              const fill =
                n.kind === 'site' || n.kind === 'site-label'
                  ? (selected ? '#eff6ff' : '#ffffff')
                  : n.kind === 'router'
                    ? (n.online ? '#f5f3ff' : '#fafafa')
                    : (n.online ? '#f0fdf4' : '#fafafa')
              const stroke =
                n.kind === 'site' || n.kind === 'site-label'
                  ? (selected ? '#2563eb' : n.online ? '#22c55e' : '#cbd5e1')
                  : n.kind === 'router'
                    ? (n.online ? '#a78bfa' : '#e2e8f0')
                    : (n.online ? '#86efac' : '#e2e8f0')

              return (
                <g
                  key={n.id}
                  onClick={(ev) => handleNodeClick(ev, n)}
                  className={n.kind === 'site' ? 'cursor-pointer' : n.host ? 'cursor-pointer' : 'cursor-default'}
                >
                  <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={10} fill={fill} stroke={stroke} strokeWidth={selected ? 2.5 : 1.5} />
                  {(n.kind === 'site' || n.kind === 'router' || n.kind === 'cpe') && (
                    <circle cx={n.x + n.w - 12} cy={n.y + 12} r={5} fill={n.online ? '#22c55e' : '#94a3b8'} />
                  )}

                  {n.kind === 'site-label' && (
                    <>
                      <text x={n.x + 14} y={n.y + 26} fill="#111827" style={{ fontSize: 14, fontWeight: 700 }}>
                        {truncate(n.name, 28)}
                      </text>
                    </>
                  )}

                  {n.kind === 'site' && n.site && (
                    <>
                      <rect x={n.x + 12} y={n.y + 18} width={14} height={10} rx={2} fill="#6366f1" opacity={0.85} />
                      <circle cx={n.x + 19} cy={n.y + 16} r={2} fill="#6366f1" />
                      <text x={n.x + 32} y={n.y + 30} fill="#111827" style={{ fontSize: 12, fontWeight: 600 }}>
                        {truncate(n.name, 16)}
                      </text>
                      <text x={n.x + 14} y={n.y + 48} fill="#6b7280" style={{ fontSize: 10 }}>
                        {truncate(n.sub || '', 22)}
                      </text>
                      <text x={n.x + 14} y={n.y + 64} fill="#2563eb" style={{ fontSize: 9, fontWeight: 500 }}>
                        {countEquip(n.site).routers} router · {countEquip(n.site).cpes} CPE — clic para entrar
                      </text>
                    </>
                  )}

                  {n.kind === 'router' && (
                    <>
                      <rect x={n.x + 10} y={n.y + 14} width={12} height={9} rx={1.5} fill="#7c3aed" opacity={0.9} />
                      <text x={n.x + 28} y={n.y + 24} fill="#111827" style={{ fontSize: 10, fontWeight: 600 }}>
                        {truncate(n.name, 12)}
                      </text>
                      <text
                        x={n.x + 10}
                        y={n.y + 42}
                        fill={n.host ? '#7c3aed' : '#9ca3af'}
                        style={{ fontSize: 9, fontFamily: 'ui-monospace, monospace', textDecoration: n.host ? 'underline' : undefined }}
                      >
                        {truncate(n.sub || '', 20)}
                      </text>
                    </>
                  )}

                  {n.kind === 'cpe' && (
                    <>
                      <path d={`M ${n.x + 18} ${n.y + 14} L ${n.x + 24} ${n.y + 24} L ${n.x + 12} ${n.y + 24} Z`} fill="#f97316" opacity={0.9} />
                      <text x={n.x + 30} y={n.y + 26} fill="#111827" style={{ fontSize: 11, fontWeight: 600 }}>
                        {truncate(n.name, 12)}
                      </text>
                      <text
                        x={n.x + 10}
                        y={n.y + 42}
                        fill={n.host ? '#2563eb' : '#9ca3af'}
                        style={{ fontSize: 10, fontFamily: 'ui-monospace, monospace', textDecoration: n.host ? 'underline' : undefined }}
                      >
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
