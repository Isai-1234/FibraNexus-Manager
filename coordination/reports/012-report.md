# ORDEN 012 — QA + lab L009 / Loco AC (en curso)

**status:** partial — lab RF operativo en AP; CPE físico pendiente  
**by:** cursor  
**updated:** 2026-09-01T20:35Z

## Plataforma (VPS verificado ahora)

| Check | Resultado |
|-------|-----------|
| `fibranexus-api` / `worker` systemd | active |
| Health commit | `c4b341f` ok |
| Scheduler en worker | SNMP + ap-station + ip-resolve despachando |
| Heartbeat L009 | 200 cada ~30s |
| Dominios HTTPS | 200 |

## Lab hardware real (Nexus Sur QA, org 3)

| ID | Equipo | IP | Estado | RF |
|----|--------|-----|--------|-----|
| 1 | L009 Lab Camino A | 190.217.242.4 | online | router poll |
| 2 | Loco AC AP Lab | 172.16.11.253 | online | **-45 dBm, CCQ 33** (pollMethod router) |
| 3 | Loco AC CPE Lab | 172.16.11.252 | offline | AP no reporta estación (sin enlace físico) |

Inventario depurado: sin equipos fantasma. **Falta registrar el 3.er Loco AC** cuando tenga IP/MAC fija.

## Fixes ya en producción (VPS)

- `parseDateOnly` + auto-suspensión mora (`f50331e`)
- JSONB doble-codificación + normalización filas (`c4b341f`)
- systemd + roles API/worker separados
- Botón OT campo visible (`FieldWorkOrders`)

## QA pendiente (orden 012)

- [ ] Usuarios/roles end-to-end
- [ ] Flow/webhooks reales (sigue stub)
- [ ] SMTP reset password
- [ ] 3.er Loco AC en inventario + abonado vinculado

## Siguiente paso físico

1. Conectar **Loco CPE** (.252) al AP con enlace airMAX (station → AP).
2. SNMP `public` en las 3 Locos.
3. Avisar IP/MAC del **3.er Loco** para alta en inventario.
