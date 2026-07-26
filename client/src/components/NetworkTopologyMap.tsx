import { useMemo, useState } from 'react'
import type { MouseEvent } from 'react'
import { ArrowLeft, ChevronRight, Radio, ZoomIn, ZoomOut } from 'lucide-react'
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
  focusSiteId?: number | null
  onFocusSiteChange?: (siteId: number | null) => void
  selectedEquipId?: number | null
  onSelectEquip?: (equip: any | null) => void
  onOpenClient?: (clientId: number) => void
}

type NodeKind = 'site' | 'router' | 'cpe' | 'ap' | 'site-label'

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

const SITE_W = 200
const SITE_H = 96
const ROUTER_W = 156
const ROUTER_H = 64
const CPE_W = 148
const CPE_H = 64
const COL_GAP = 48
const ROW_GAP = 80
const V_GAP = 48
const PAD = 56
const CONN = '#6366f1'

function isOnline(eq: any) {
  return eq.agentConnected || eq.status === 'online'
}

function siteOnline(site: SiteNode) {
  const eq = site.equipment || []
  const routers = eq.filter((e) => e.type === 'router')
  if (routers.length) return routers.some(isOnline)
  return eq.some((e) => (e.type === 'cpe' || e.type === 'ap') && isOnline(e))
}

function routerHost(eq: any): string | null {
  return cleanDeviceHost(eq.ipAddress || eq.credentials?.tunnelHostname || null)
}

function countEquip(site: SiteNode) {
  const eq = site.equipment || []
  return {
    routers: eq.filter((e) => e.type === 'router').length,
    cpes: eq.filter((e) => e.type !== 'router' && e.type !== 'switch').length,
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

function siteStationStats(site: SiteNode) {
  const eq = site.equipment || []
  const stations = eq.filter((e) => e.clientId)
  const online = stations.filter(isOnline).length
  return {
    routers: eq.filter((e) => e.type === 'router').length,
    sectorials: eq.filter(isSectorialEquip).length,
    stations: stations.length,
    online,
    offline: stations.length - online,
  }
}

type HierarchyRow = {
  key: string
  depth: number
  role: 'router' | 'ap' | 'station' | 'other'
  name: string
  sub: string
  online: boolean
  equip: any
  signal?: number | null
}

function buildSiteHierarchy(site: SiteNode): HierarchyRow[] {
  const eq = site.equipment || []
  const routers = eq.filter((e) => e.type === 'router')
  const sectorials = eq.filter(isSectorialEquip)
  const stations = eq.filter((e) => e.clientId)
  const rest = eq.filter((e) => e.type !== 'router' && !isSectorialEquip(e) && !e.clientId)
  const rows: HierarchyRow[] = []

  const push = (equip: any, depth: number, role: HierarchyRow['role']) => {
    rows.push({
      key: `${role}-${equip.id}`,
      depth,
      role,
      name: equip.clientName || equip.name || 'Equipo',
      sub: cleanDeviceHost(equip.displayIp || equip.ipAddress) || equip.model || role,
      online: isOnline(equip),
      equip,
      signal: equip.wirelessSignal ?? null,
    })
  }

  for (const r of routers) push(r, 0, 'router')

  const apDepth = routers.length ? 1 : 0
  for (const s of sectorials) push(s, apDepth, 'ap')

  const stDepth = sectorials.length ? apDepth + 1 : (routers.length ? 1 : 0)
  for (const st of stations) push(st, stDepth, 'station')

  const otherDepth = routers.length || sectorials.length ? 1 : 0
  for (const o of rest) push(o, otherDepth, 'other')

  return rows
}

function roleLabel(role: HierarchyRow['role']) {
  if (role === 'router') return 'Router'
  if (role === 'ap') return 'Sectorial'
  if (role === 'station') return 'EstaciÃ³n'
  return 'Equipo'
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

function measureEquipRow(items: any[]): number {
  if (!items.length) return 0
  return items.reduce((sum, _c, i) => sum + CPE_W + (i ? COL_GAP : 0), 0)
}

function measureRouterBranch(
  router: any,
  cpeMap: Map<number, any[]>,
  allRouters: any[],
  routerIds: Set<number>,
): number {
  const gear = cpeMap.get(router.id) || []
  const sectorials = gear.filter(isSectorialEquip)
  const stations = gear.filter((e) => e.clientId)
  const rest = gear.filter((e) => !isSectorialEquip(e) && !e.clientId)
  const cpeW = sectorials.length
    ? Math.max(
      measureEquipRow(sectorials),
      measureEquipRow(stations),
      measureEquipRow(rest),
    )
    : measureEquipRow(gear)
  const children = allRouters.filter((r) => routerParentId(r, routerIds) === router.id)
  const childW = children.length
    ? children.reduce(
      (sum, r, i) => sum + measureRouterBranch(r, cpeMap, allRouters, routerIds) + (i ? COL_GAP : 0),
      0,
    )
    : 0
  return Math.max(ROUTER_W, cpeW, childW)
}

function pushEquipNode(
  ctx: BuildCtx,
  eq: any,
  x: number,
  y: number,
  kind: 'cpe' | 'ap',
) {
  const hostCpe = cleanDeviceHost(eq.ipAddress || eq.displayIp)
  const id = `${kind}-${eq.id}`
  ctx.nodes.push({
    kind,
    id,
    siteId: eq.siteId,
    clientId: eq.clientId,
    name: eq.clientName || eq.name,
    sub: hostCpe || (kind === 'ap' ? 'sectorial' : 'sin IP'),
    host: hostCpe,
    online: isOnline(eq),
    x,
    y,
    w: CPE_W,
    h: CPE_H,
    equip: eq,
  })
  ctx.maxX = Math.max(ctx.maxX, x + CPE_W + PAD)
  ctx.maxY = Math.max(ctx.maxY, y + CPE_H + PAD)
  return id
}

function placeEquipRow(
  ctx: BuildCtx,
  parentId: string,
  parentCx: number,
  parentBottom: number,
  items: any[],
  kind: 'cpe' | 'ap',
): number {
  if (!items.length) return parentBottom
  const rowW = measureEquipRow(items)
  let cxPos = parentCx - rowW / 2
  const y = parentBottom + V_GAP + 16
  for (const eq of items) {
    const id = pushEquipNode(ctx, eq, cxPos, y, kind)
    ctx.edges.push({ fromId: parentId, toId: id, dashed: true })
    cxPos += CPE_W + COL_GAP
  }
  return y + CPE_H
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

  const gear = cpeMap.get(router.id) || []
  const sectorials = gear.filter(isSectorialEquip)
  const stations = gear.filter((e) => e.clientId)
  const rest = gear.filter((e) => !isSectorialEquip(e) && !e.clientId)
  let subtreeBottom = bottom

  if (sectorials.length) {
    // Estilo UISP: router â†’ sectorial â†’ estaciones del abonado
    subtreeBottom = placeEquipRow(ctx, id, cx, bottom, sectorials, 'ap')
    const primaryAp = ctx.nodes.find((n) => n.kind === 'ap' && n.equip?.id === sectorials[0].id)
    if (primaryAp && stations.length) {
      subtreeBottom = placeEquipRow(
        ctx,
        primaryAp.id,
        primaryAp.x + primaryAp.w / 2,
        primaryAp.y + primaryAp.h,
        stations,
        'cpe',
      )
    }
    if (rest.length) {
      subtreeBottom = placeEquipRow(ctx, id, cx, subtreeBottom, rest, 'cpe')
    }
  } else if (gear.length) {
    subtreeBottom = placeEquipRow(ctx, id, cx, bottom, gear, 'cpe')
  }

  if (childRouters.length) {
    const routerIds = new Set(allRouters.map((r) => r.id))
    const branchW = childRouters.reduce(
      (sum, r, i) => sum + measureRouterBranch(r, cpeMap, allRouters, routerIds) + (i ? COL_GAP : 0),
      0,
    )
    let childX = cx - branchW / 2
    const childY = subtreeBottom + V_GAP + 20

    for (const child of childRouters) {
      const w = measureRouterBranch(child, cpeMap, allRouters, routerIds)
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
  // Incluir CPE/AP/other (WiFi abonado): no solo type=cpe
  const cpes = (site.equipment || []).filter((e) => e.type !== 'router' && e.type !== 'switch' && e.type !== 'olt')
  const routerIds = new Set(routers.map((r) => r.id))
  const cpeMap = assignCpesToRouters(cpes, routers)
  const roots = routers.filter((r) => !routerParentId(r, routerIds))

  const labelW = 220
  const labelH = 52
  const labelId = `label-${site.id}`

  const rootsBranchW = roots.length
    ? roots.reduce(
      (sum, r, i) => sum + measureRouterBranch(r, cpeMap, routers, routerIds) + (i ? COL_GAP * 2 : 0),
      0,
    )
    : cpes.length
      ? cpes.reduce((sum, c, i) => sum + CPE_W + (i ? COL_GAP : 0), 0)
      : 0

  const canvasW = Math.max(720, rootsBranchW + PAD * 3)
  const centerX = canvasW / 2
  const labelBottom = { cx: centerX, y: PAD + labelH }

  ctx.nodes.push({
    kind: 'site-label',
    id: labelId,
    siteId: site.id,
    name: site.name,
    sub: site.city || site.type || 'nodo',
    online: siteOnline(site),
    x: centerX - labelW / 2,
    y: PAD,
    w: labelW,
    h: labelH,
    site,
  })

  const startY = PAD + labelH + ROW_GAP

  if (!routers.length && !cpes.length) {
    return {
      nodes: ctx.nodes,
      edges: ctx.edges,
      width: canvasW,
      height: startY + 80,
      routerCount: 0,
      cpeCount: 0,
    }
  }

  if (!routers.length) {
    const sectorials = cpes.filter(isSectorialEquip)
    const stations = cpes.filter((e) => e.clientId)
    const rest = cpes.filter((e) => !isSectorialEquip(e) && !e.clientId)
    if (sectorials.length) {
      const rowW = measureEquipRow(sectorials)
      let x = centerX - rowW / 2
      const apIds: string[] = []
      for (const eq of sectorials) {
        const id = pushEquipNode(ctx, eq, x, startY, 'ap')
        ctx.edges.push({ fromId: labelId, toId: id, dashed: true })
        apIds.push(id)
        x += CPE_W + COL_GAP
      }
      let bottom = startY + CPE_H
      if (stations.length && apIds[0]) {
        const apNode = ctx.nodes.find((n) => n.id === apIds[0])!
        bottom = placeEquipRow(
          ctx,
          apIds[0],
          apNode.x + apNode.w / 2,
          apNode.y + apNode.h,
          stations,
          'cpe',
        )
      }
      if (rest.length) {
        bottom = placeEquipRow(ctx, labelId, centerX, bottom, rest, 'cpe')
      }
      return {
        nodes: ctx.nodes,
        edges: ctx.edges,
        width: Math.max(canvasW, ctx.maxX),
        height: Math.max(bottom + PAD, ctx.maxY),
        routerCount: 0,
        cpeCount: cpes.length,
      }
    }
    const rowW = cpes.reduce((sum, c, i) => sum + CPE_W + (i ? COL_GAP : 0), 0)
    let x = centerX - rowW / 2
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
        y: startY,
        w: CPE_W,
        h: CPE_H,
        equip: eq,
      })
      ctx.edges.push({ fromId: labelId, toId: id, dashed: true })
      x += CPE_W + COL_GAP
    }
    ctx.maxX = Math.max(ctx.maxX, x + PAD)
    ctx.maxY = startY + CPE_H + PAD
    return {
      nodes: ctx.nodes,
      edges: ctx.edges,
      width: Math.max(canvasW, ctx.maxX),
      height: ctx.maxY,
      routerCount: 0,
      cpeCount: cpes.length,
    }
  }

  if (roots.length === 1) {
    const root = roots[0]
    const w = measureRouterBranch(root, cpeMap, routers, routerIds)
    const childRouters = routers.filter((r) => routerParentId(r, routerIds) === root.id)
    placeRouterTree(
      ctx,
      root,
      cpeMap,
      childRouters,
      routers,
      centerX - ROUTER_W / 2,
      startY,
      labelId,
      labelBottom,
    )
  } else {
    let x = centerX - rootsBranchW / 2
    for (const root of roots) {
      const w = measureRouterBranch(root, cpeMap, routers, routerIds)
      const childRouters = routers.filter((r) => routerParentId(r, routerIds) === root.id)
      placeRouterTree(
        ctx,
        root,
        cpeMap,
        childRouters,
        routers,
        x + (w - ROUTER_W) / 2,
        startY,
        labelId,
        labelBottom,
      )
      x += w + COL_GAP * 2
      ctx.maxX = Math.max(ctx.maxX, x)
    }
  }

  return {
    nodes: ctx.nodes,
    edges: ctx.edges,
    width: Math.max(canvasW, ctx.maxX + PAD),
    height: Math.max(520, ctx.maxY + PAD * 2),
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

/** Ruta suave estilo n8n: vertical â†’ curva â†’ vertical */
function flowPath(x1: number, y1: number, x2: number, y2: number) {
  if (Math.abs(x1 - x2) < 3) {
    return `M ${x1} ${y1} C ${x1} ${y1 + 24} ${x2} ${y2 - 24} ${x2} ${y2}`
  }
  const midY = y1 + (y2 - y1) / 2
  return `M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`
}

type DrawnPath = { d: string; dashed?: boolean; key: string; strokeWidth?: number }

function buildConnectionPaths(edges: LayoutEdge[], nodes: LayoutNode[]): DrawnPath[] {
  const posById = new Map(nodes.map((n) => [n.id, n]))
  const byParent = new Map<string, LayoutEdge[]>()
  for (const e of edges) {
    if (!byParent.has(e.fromId)) byParent.set(e.fromId, [])
    byParent.get(e.fromId)!.push(e)
  }

  const paths: DrawnPath[] = []

  for (const [fromId, group] of byParent) {
    const from = posById.get(fromId)
    if (!from) continue
    const fa = nodeAnchor(from)

    const children = group
      .map((e) => {
        const to = posById.get(e.toId)
        if (!to) return null
        return { edge: e, ta: nodeAnchor(to) }
      })
      .filter(Boolean) as { edge: LayoutEdge; ta: ReturnType<typeof nodeAnchor> }[]

    if (!children.length) continue

    if (children.length === 1) {
      const { edge, ta } = children[0]
      paths.push({
        key: `${fromId}-${edge.toId}`,
        d: flowPath(fa.cx, fa.bottom, ta.cx, ta.top),
        dashed: edge.dashed,
        strokeWidth: edge.dashed ? 2 : 2.5,
      })
      continue
    }

    const busY = fa.bottom + V_GAP / 2
    const minCx = Math.min(...children.map((c) => c.ta.cx))
    const maxCx = Math.max(...children.map((c) => c.ta.cx))

    paths.push({
      key: `${fromId}-trunk`,
      d: `M ${fa.cx} ${fa.bottom} L ${fa.cx} ${busY} M ${minCx} ${busY} L ${maxCx} ${busY}`,
      dashed: group[0].dashed,
      strokeWidth: 2.5,
    })

    for (const { edge, ta } of children) {
      paths.push({
        key: `${fromId}-${edge.toId}`,
        d: flowPath(ta.cx, busY, ta.cx, ta.top),
        dashed: edge.dashed,
        strokeWidth: edge.dashed ? 2 : 2.5,
      })
    }
  }

  return paths
}

function truncate(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1)}â€¦` : s
}

export default function NetworkTopologyMap({
  tree, selectedSiteId, onSelectSite, focusSiteId: focusSiteIdProp, onFocusSiteChange,
  selectedEquipId, onSelectEquip, onOpenClient,
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

  const layout = useMemo(() => {
    if (focusSite) return computeFocusLayout(focusSite)
    return computeOverviewLayout(tree)
  }, [tree, focusSite])

  const connectionPaths = useMemo(
    () => buildConnectionPaths(layout.edges, layout.nodes),
    [layout],
  )

  const siteZone = useMemo(() => {
    if (!focusSite) return null
    const inner = layout.nodes.filter((n) => n.kind !== 'site-label')
    if (!inner.length) return null
    const minX = Math.min(...inner.map((n) => n.x))
    const minY = Math.min(...inner.map((n) => n.y))
    const maxX = Math.max(...inner.map((n) => n.x + n.w))
    const maxY = Math.max(...inner.map((n) => n.y + n.h))
    const padX = 22
    const padY = 14
    return {
      x: minX - padX,
      y: minY - padY,
      w: maxX - minX + padX * 2,
      h: maxY - minY + padY * 2,
    }
  }, [layout.nodes, focusSite])

  const edgeTargets = useMemo(() => {
    const ins = new Set<string>()
    const outs = new Set<string>()
    for (const e of layout.edges) {
      outs.add(e.fromId)
      ins.add(e.toId)
    }
    return { ins, outs }
  }, [layout.edges])

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

  function handleNodeClick(ev: MouseEvent, n: LayoutNode) {
    if (n.kind === 'site' && n.site) {
      enterSite(n.site)
      return
    }
    if ((n.kind === 'router' || n.kind === 'cpe' || n.kind === 'ap') && n.equip) {
      ev.stopPropagation()
      onSelectEquip?.(n.equip)
      if (n.kind === 'cpe' && n.clientId && onOpenClient && ev.detail >= 2) {
        onOpenClient(n.clientId)
        return
      }
      if (ev.shiftKey && n.host) openDeviceWeb(n.host)
    }
  }

  const hierarchy = useMemo(
    () => (focusSite ? buildSiteHierarchy(focusSite) : []),
    [focusSite],
  )
  const focusStats = focusSite ? siteStationStats(focusSite) : null

  if (!tree.length) {
    return (
      <div className="h-full min-h-[420px] bg-surface-card rounded-xl border flex flex-col items-center justify-center text-gray-400 p-8">
        <Radio className="h-14 w-14 mb-3 opacity-25" />
        <p className="font-medium text-gray-600">Sin nodos en el mapa</p>
        <p className="text-sm mt-1 text-center max-w-sm">Crea tu primer sitio (torre o POP) en la pestaÃ±a Ãrbol para ver la topologÃ­a aquÃ­.</p>
      </div>
    )
  }

  return (
    <div className="h-full min-h-[420px] bg-surface-card rounded-xl border flex flex-col overflow-hidden">
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
              <span key={s.id} className="flex items-center gap-1 text-ink-muted">
                <ChevronRight className="h-3.5 w-3.5" />
                <button
                  type="button"
                  onClick={() => enterSite(s)}
                  className={s.id === focusSiteId ? 'font-semibold text-gray-800' : 'hover:text-blue-600 hover:underline'}
                >
                  {s.name}
                </button>
              </span>
            ))}
          </div>
          <p className="text-xs text-ink-muted mt-0.5">
            {focusSite && focusStats
              ? `${focusStats.routers} router Â· ${focusStats.sectorials} sectorial Â· ${focusStats.online} online Â· ${focusStats.offline} offline â€” clic en un equipo para ver detalle`
              : 'Clic en un nodo para entrar y ver su jerarquÃ­a (quiÃ©n estÃ¡ online / offline)'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {focusSite && (
            <button
              type="button"
              onClick={backToOverview}
              className="px-2.5 py-1.5 rounded-lg border bg-surface-card hover:bg-surface-raised text-xs font-medium flex items-center gap-1"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Toda la red
            </button>
          )}
          {!focusSite && (
            <>
              <button type="button" onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))} className="p-2 rounded-lg border bg-surface-card hover:bg-surface-raised" title="Alejar">
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="text-xs text-ink-muted w-10 text-center">{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => setZoom((z) => Math.min(1.4, z + 0.1))} className="p-2 rounded-lg border bg-surface-card hover:bg-surface-raised" title="Acercar">
                <ZoomIn className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {focusSite ? (
        <div className="flex-1 overflow-auto bg-slate-50/40 p-4 space-y-3">
          {/* Resumen del nodo */}
          <div className="rounded-xl border bg-white px-4 py-3 flex flex-wrap items-center gap-3 shadow-sm">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">Nodo</p>
              <h3 className="text-base font-bold text-slate-900 truncate">{focusSite.name}</h3>
              <p className="text-xs text-slate-500">{focusSite.city || focusSite.type || 'torre'}</p>
            </div>
            <div className="flex gap-2 text-center">
              <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-1.5 min-w-[64px]">
                <p className="text-lg font-bold text-emerald-700 tabular-nums">{focusStats?.online ?? 0}</p>
                <p className="text-[10px] text-emerald-600/80 uppercase">online</p>
              </div>
              <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-1.5 min-w-[64px]">
                <p className="text-lg font-bold text-red-600 tabular-nums">{focusStats?.offline ?? 0}</p>
                <p className="text-[10px] text-red-500/80 uppercase">offline</p>
              </div>
            </div>
          </div>

          {/* JerarquÃ­a legible estilo UISP */}
          <div className="rounded-xl border bg-white overflow-hidden shadow-sm">
            <div className="px-4 py-2.5 border-b bg-slate-50/80 flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">JerarquÃ­a del nodo</p>
              <p className="text-[10px] text-slate-400">Router â†’ sectorial â†’ estaciones</p>
            </div>
            {hierarchy.length === 0 ? (
              <p className="px-4 py-8 text-sm text-slate-400 text-center">Este nodo aÃºn no tiene equipos.</p>
            ) : (
              <ul className="divide-y">
                {hierarchy.map((row) => {
                  const selected = row.equip?.id === selectedEquipId
                  return (
                    <li key={row.key}>
                      <button
                        type="button"
                        onClick={() => onSelectEquip?.(row.equip)}
                        onDoubleClick={() => {
                          if (row.role === 'station' && row.equip?.clientId && onOpenClient) {
                            onOpenClient(row.equip.clientId)
                          }
                        }}
                        className={`w-full text-left px-3 py-3 flex items-center gap-3 transition-colors ${
                          selected ? 'bg-blue-50/80' : 'hover:bg-slate-50'
                        }`}
                        style={{ paddingLeft: `${12 + row.depth * 22}px` }}
                      >
                        {row.depth > 0 && (
                          <span className="text-slate-300 font-mono text-xs w-3 shrink-0" aria-hidden>
                            {row.depth === 1 ? 'â””' : 'Â·'}
                          </span>
                        )}
                        <span
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-white ${
                            row.online ? 'bg-emerald-500' : 'bg-red-500'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                              {roleLabel(row.role)}
                            </span>
                            <span className="text-sm font-semibold text-slate-900 truncate">{row.name}</span>
                          </div>
                          <p className="text-xs text-slate-500 font-mono truncate mt-0.5">
                            {row.sub}
                            {row.signal != null ? ` Â· ${row.signal} dBm` : ''}
                          </p>
                        </div>
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wide shrink-0 ${
                            row.online ? 'text-emerald-600' : 'text-red-600'
                          }`}
                        >
                          {row.online ? 'online' : 'offline'}
                        </span>
                        {row.role === 'station' && row.equip?.clientId && onOpenClient && (
                          <span
                            role="link"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation()
                              onOpenClient(row.equip.clientId)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.stopPropagation()
                                onOpenClient(row.equip.clientId)
                              }
                            }}
                            className="text-xs text-blue-600 hover:underline shrink-0"
                          >
                            Ver
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Mapa compacto del nodo (referencia visual) */}
          <details className="rounded-xl border bg-white shadow-sm group">
            <summary className="px-4 py-2.5 text-xs font-semibold text-slate-600 cursor-pointer select-none list-none flex items-center justify-between">
              <span>Vista diagrama</span>
              <span className="text-slate-400 font-normal group-open:hidden">mostrar</span>
              <span className="text-slate-400 font-normal hidden group-open:inline">ocultar</span>
            </summary>
            <div className="border-t overflow-auto bg-[radial-gradient(circle_at_1px_1px,#e2e8f0_1px,transparent_0)] [background-size:16px_16px] max-h-[280px]">
              <svg
                width={layout.width}
                height={layout.height}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                className="block select-none mx-auto"
              >
                <g>
                  {siteZone && (
                    <rect
                      x={siteZone.x}
                      y={siteZone.y}
                      width={siteZone.w}
                      height={siteZone.h}
                      rx={14}
                      fill="#f8fafc"
                      stroke="#cbd5e1"
                      strokeWidth={1.5}
                      strokeDasharray="6 4"
                    />
                  )}
                  {connectionPaths.map((p) => (
                    <path
                      key={p.key}
                      d={p.d}
                      fill="none"
                      stroke={p.dashed ? '#94a3b8' : CONN}
                      strokeWidth={p.strokeWidth ?? 2.5}
                      strokeDasharray={p.dashed ? '6 5' : undefined}
                      strokeLinecap="round"
                      opacity={0.9}
                    />
                  ))}
                  {layout.nodes.map((n) => {
                    const equipSelected = (n.kind === 'cpe' || n.kind === 'ap' || n.kind === 'router')
                      && n.equip?.id != null
                      && n.equip.id === selectedEquipId
                    const statusFill = n.online ? '#22c55e' : '#ef4444'
                    const fill = n.kind === 'router'
                      ? '#f5f3ff'
                      : n.kind === 'ap'
                        ? '#fff7ed'
                        : n.online ? '#f0fdf4' : '#fef2f2'
                    const stroke = equipSelected
                      ? '#2563eb'
                      : n.kind === 'router'
                        ? '#a78bfa'
                        : n.kind === 'ap'
                          ? '#fdba74'
                          : n.online ? '#86efac' : '#fca5a5'
                    return (
                      <g key={n.id} onClick={(ev) => handleNodeClick(ev, n)} className="cursor-pointer">
                        <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={12} fill={fill} stroke={stroke} strokeWidth={equipSelected ? 2.5 : 1.5} />
                        {(n.kind === 'router' || n.kind === 'cpe' || n.kind === 'ap') && (
                          <circle cx={n.x + n.w - 12} cy={n.y + 12} r={5} fill={statusFill} />
                        )}
                        <text x={n.x + 12} y={n.y + 28} fill="#111827" style={{ fontSize: 11, fontWeight: 600 }}>
                          {truncate(n.name, 14)}
                        </text>
                        <text x={n.x + 12} y={n.y + 46} fill="#64748b" style={{ fontSize: 9 }}>
                          {truncate(n.sub || '', 18)}
                        </text>
                      </g>
                    )
                  })}
                </g>
              </svg>
            </div>
          </details>
        </div>
      ) : (
        <div className="flex-1 overflow-auto bg-[radial-gradient(circle_at_1px_1px,#e2e8f0_1px,transparent_0)] [background-size:20px_20px] flex justify-center">
          <svg
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            className="block select-none shrink-0"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top center', width: layout.width * zoom, height: layout.height * zoom }}
          >
            <g>
              {connectionPaths.map((p) => (
                <path
                  key={p.key}
                  d={p.d}
                  fill="none"
                  stroke={CONN}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  opacity={0.9}
                />
              ))}
              {layout.nodes.map((n) => {
                if (n.kind !== 'site' || !n.site) return null
                const selected = n.siteId === selectedSiteId
                const stats = siteStationStats(n.site)
                return (
                  <g key={n.id} onClick={(ev) => handleNodeClick(ev, n)} className="cursor-pointer">
                    <rect
                      x={n.x}
                      y={n.y}
                      width={n.w}
                      height={n.h}
                      rx={14}
                      fill={selected ? '#eff6ff' : '#ffffff'}
                      stroke={selected ? '#2563eb' : n.online ? '#22c55e' : '#cbd5e1'}
                      strokeWidth={selected ? 2.5 : 1.5}
                      filter="drop-shadow(0 2px 4px rgb(0 0 0 / 0.08))"
                    />
                    <circle cx={n.x + n.w - 14} cy={n.y + 14} r={6} fill={n.online ? '#22c55e' : '#94a3b8'} />
                    <text x={n.x + 14} y={n.y + 28} fill="#0f172a" style={{ fontSize: 13, fontWeight: 700 }}>
                      {truncate(n.name, 18)}
                    </text>
                    <text x={n.x + 14} y={n.y + 46} fill="#64748b" style={{ fontSize: 10 }}>
                      {truncate(n.sub || '', 22)}
                    </text>
                    <text x={n.x + 14} y={n.y + 66} fill="#059669" style={{ fontSize: 10, fontWeight: 600 }}>
                      {stats.online} online
                    </text>
                    <text x={n.x + 90} y={n.y + 66} fill="#dc2626" style={{ fontSize: 10, fontWeight: 600 }}>
                      {stats.offline} offline
                    </text>
                    <text x={n.x + 14} y={n.y + 84} fill="#2563eb" style={{ fontSize: 9, fontWeight: 500 }}>
                      Clic para entrar â†’
                    </text>
                  </g>
                )
              })}
            </g>
          </svg>
        </div>
      )}
    </div>
  )
}
