# Data Model: 001-red-isp-topology

## Site (tabla `sites`)

| Field | Type | Notes |
|-------|------|-------|
| id | serial PK | |
| organizationId | FK | multi-tenant |
| name | varchar | "Torre Pangui" |
| type | enum | pop, tower, node, office |
| parentId | integer nullable | FK → sites.id (jerarquía) |
| city, address | text | metadata UI |
| latitude, longitude | decimal | opcional mapa |

**Tree API**: `GET /sites` → `{ tree: SiteNode[], unassigned, stats }`  
`buildSiteTree()` agrupa por `parentId`.

## Equipment (tabla `equipment`)

| Field | Type | Notes |
|-------|------|-------|
| id | serial PK | |
| siteId | FK nullable | nodo al que pertenece |
| type | enum | router, cpe, switch, … |
| ipAddress | varchar | UI + openDeviceWeb |
| parentId | integer nullable | FK → equipment.id (CPE→router) |
| credentials | jsonb | tunnelHostname, parentRouterId, … |
| clientId | FK nullable | abonado en CPE |

## Topology UI State (cliente, no persistido)

| State | Type | Notes |
|-------|------|-------|
| focusSiteId | number \| null | null = overview; id = drill-down |
| zoom | number | 0.6–1.4 |
| selectedSiteId | number | panel lateral NetworkManager |

## Relationships

```text
Site (root, parentId=null)
  └── Site (child, parentId=root.id)
        └── equipment[] (routers, cpes)

Router A (credentials.parentRouterId=null)
  └── Router B (parentRouterId=A.id)   [opcional]
        └── CPE (parentId=B.id or A.id)
```
