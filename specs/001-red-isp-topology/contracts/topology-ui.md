# UI Contract: NetworkTopologyMap

## Overview mode (`focusSiteId === null`)

| Element | Interaction | Result |
|---------|-------------|--------|
| Site card | click | `enterSite(site)` → drill-down + `onSelectSite` |
| Connection | — | `flowPath` o bus desde padre a hijos |
| Breadcrumb | "Red ISP" | permanece en overview |

## Focus mode (`focusSiteId === site.id`)

| Element | Interaction | Result |
|---------|-------------|--------|
| site-label | — | título centrado arriba |
| Router card | click IP | `openDeviceWeb(host)` |
| CPE card | click IP | `openDeviceWeb(host)` |
| Breadcrumb / Volver | click | `backToOverview()` |
| Connection | — | vertical column, curvas violetas |

## NetworkManager integration

- Props: `tree`, `selectedSiteId`, `onSelectSite`
- Tab Topología monta `<NetworkTopologyMap />`
- Edición sitio: lápiz → modal con `parentId` select

## Visual

- Puertos: círculo arriba (input) / abajo (output) en nodos conectados
- Stroke principal: `#818cf8` (CONN)
- CPE edges: dashed gris
