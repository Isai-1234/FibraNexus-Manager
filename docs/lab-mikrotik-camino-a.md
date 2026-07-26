# Lab MikroTik — Camino A (IP pública)

**Estado:** Conectado y validado  
**Fecha:** 2026-07-24  
**Org de prueba:** Nexus Sur QA (id 3)  
**Equipo:** L009UiGS · RouterOS 7.23.1 · `L009 Lab Camino A` (equipment id 1)

---

## Topología del lab

```
Internet
   │
   ▼
MikroTik borde (producción, IP pública fija)
   IP: 190.217.242.4/23
   │  dst-nat tcp/44300 → 192.168.3.253:443
   ▼
L009 lab (192.168.3.253)
   www-ssl + cert fn-https
   usuario API: fibranexus
   allowlist: solo 134.209.43.175/32 (VPS FibraNexus)
```

## Qué se validó

| Paso | Resultado |
|------|-----------|
| NAT borde `44300` → L009 `:443` | OK |
| Certificado `www-ssl` (`fn-https`) | OK (sin cert → handshake failure) |
| REST API desde VPS | OK (`/rest/system/resource` HTTP 200) |
| `POST /api/routers/1/test-connection` | OK |
| Estado en plataforma | **online** |
| DHCP `dhcp2` en ether3 | OK · LiteBeam tomó `172.16.11.254` |
| Detectados → adopción | OK · MAC `6C:63:F8:D8:7A:DC`, CPE equipment id 2 |
| Acceso web desde IP en plataforma | Implementado en Detectados y perfil del abonado |
| SNMP vía L009 (`/tool/snmp-get`) | OK · community lab `internetsur-lab` · pollMethod `router` |
| Nodo sitio | `Torre Lab Camino A` (site id 1) con L009 + CPE |

## Incidentes / aprendizajes

1. Cable suelto en el L009 → caída intermitente; no confundir con fallo de NAT.
2. Sin `certificate=` en `www-ssl` → `sslv3 alert handshake failure` desde el VPS.
3. Usuario `fibranexus` mal creado → `401 Unauthorized` / login failure en log del router.
4. Consumo ~21–29 Mbps con solo Winbox → probable container `cloudflared` residual del lab anterior; en Camino A se detiene.
5. El L009 ve la IP real del VPS (`134.209.43.175`) tras dst-nat → el allowlist por IP funciona.
6. La IP DHCP de la LiteBeam es su IP de **gestión**. No debe usarse automáticamente como target de la Simple Queue PPPoE del abonado.
7. Las communities SNMP cifradas deben descifrarse antes de enviarlas al agente EdgeRouter; nunca enviar el ciphertext como community.
8. CPE en LAN privada (`172.16.11.x`) **no** es alcanzable por SNMP directo desde el VPS: hace falta puente vía MikroTik del mismo sitio/`parentId`. Sin sitio, el poll da timeout aunque SNMP esté bien en airOS.
9. MIB wireless en 0/0/0 con sysDescr OK = antena sin enlace airMAX (p.ej. solo cableada a ether3); no es fallo de community.

## Decisión de producto (IP pública)

Dos modos en onboarding:

1. **Segura automática (default)** — un script: cert `fn-https` + www-ssl + usuario `fibranexus` + allowlist `FIBRANEXUS_EGRESS_CIDRS` + heartbeat + (si aplica) NAT sugerido del borde.
2. **Manual** — ISP ya tiene API; solo IP/puerto/usuario/clave + “Probar conexión”. Advertir si queda abierto a `0.0.0.0/0`.

La allowlist **no crece por ISP**: todos los MikroTik permiten las mismas IPs de control de FibraNexus.

Sin IP pública → túnel Cloudflare / agente saliente (no es este camino).

## Checkpoint 2026-07-24/25 (wall garden + mora ISP) — pausado

**Estado en prod:** commit reciente en `main` desplegado en VPS (`pm2 fibranexus-api`).  
**Lab:** servicio **83** (Abonado Antena Lab) queda **suspendido** con wall garden.

### Hecho y validado
- Wall garden MikroTik: `FN-SUSPENDED` = IP PPPoE `172.16.11.251`; garden = portal + DNS (8.8.8.8/8.8.4.4 + 1.1.1.1 + DoT 853); resto drop. Sin accept TCP/443 global.
- Captive HTTP: dst-nat TCP/80 → VPS; nginx `default_server` + probes → `GET /api/public/captive` → portal del ISP por IP WAN del router.
- Página de mora **por ISP**: `https://app.fibranexus.cl/mora/{slug}` (lab: `/mora/nexus-sur-qa`) con marca del ISP.
- Login abonados **por ISP** (no SaaS genérico): `https://app.fibranexus.cl/portal/{slug}` — botón “Entrar y pagar” de la mora apunta ahí.
- Login genérico `/login` queda para admin ISP / SaaS.
- HTTPS / YouTube / Chrome HTTPS-First: **no redirigen** (solo bloqueo). El aviso llega por sheet Wi‑Fi o HTTP (`neverssl.com`).

### Siguiente (acordado, no implementado)
- Botón grande **“Pagar ahora”** en mora → crear checkout Flow/pasarela **sin login** (identificar abonado por IP suspendida o token) + link secundario “Ya tengo cuenta” → `/portal/{slug}`.
- Requiere endpoint público tipo `/api/public/pay/:slug` + factura pendiente + `createCheckout` + webhook de reactivación (ya existe post-pago).

### Señales / antenas — resuelto 2026-07-25
En **Centro del Abonado → Abonado Antena Lab** el panel RADIO ENLACE quedaba en **Sin enlace** aunque el abonado tenía internet (PPPoE `fn83s83` activo).

**Causa (lab):**
1. El panel lee el CPE vinculado al abonado (`Loco Cliente Lab`), no el sectorial.
2. IP inventariada `.253` **no responde SNMP** desde el L009 (sin lease/ARP; timeout vía `/tool/snmp-get`).
3. El enlace airMAX **sí existía**: en el AP `Loco Sectorial Lab` (`.254`) la tabla de estaciones Ubiquiti (`1.3.6.1.4.1.41112.1.4.7.1`) tenía MAC `6c:63:f8:d8:78:18`, señal **−48 dBm**, IP remota **`.251`** (misma que PPPoE).
4. Internet ≠ gestión SNMP: el router WiFi Mercusys (`.252`) sin community no aporta radio; no es un fallo de WAN.

**Fix producto:** si el CPE no responde SNMP pero tiene MAC, FibraNexus lee la fila de estación del AP Ubiquiti del mismo sitio (`pollMethod: ap-station`) y rellena señal/CCQ/SNR. Validado: cliente online −48 dBm / CCQ 32 / SNR 37.

**Detección de caída rápida (2026-07-25):** al desenchufar el CPE, antes tardaba ~6-9 min en verse offline (3 fallos SNMP consecutivos con polls cada ~2 min). Ahora, si el AP responde y su tabla de estaciones ya no lista la MAC del CPE, es evidencia directa: se marca **offline en el primer poll** (`apConfirmedDown`), se limpia la señal vieja y el panel muestra “El AP ya no reporta esta estación: enlace caído o CPE apagado”. Validado en vivo desenchufando el Loco Cliente Lab (~2 min hasta reflejarse, el tiempo del ciclo de poll).

**Qué configurar en un ISP nuevo para que el panel funcione:**
1. Sectorial/AP en el mismo **sitio** que el CPE, con SNMP ON + community en FibraNexus.
2. CPE abonado con **MAC correcta** (sirve para matchear la estación del AP).
3. Ideal: CPE también con SNMP + IP de gestión alcanzable desde el MikroTik (si no, el fallback AP cubre la señal).
4. No confundir IP de gestión CPE / IP remota airMAX / IP PPPoE.

### URLs lab
| Qué | URL |
|-----|-----|
| Mora ISP | `https://app.fibranexus.cl/mora/nexus-sur-qa` |
| Login abonado ISP | `https://app.fibranexus.cl/portal/nexus-sur-qa` |
| Captive API | `GET /api/public/captive` |
| Branding JSON | `GET /api/public/mora/nexus-sur-qa` |

### Pendiente inmediato (lab anterior)

- [x] L009 online vía Camino A (NAT + www-ssl + allowlist VPS).
- [x] Perfil `fn-pppoe` + servidor PPPoE `internet` en **ether3** (pool `dhcp_pool1` 172.16.11.0/24, sin rate-limit).
- [x] Wizard Camino A: **Segura automática** (default) vs **Manual**; script con cert + www-ssl + usuario + allowlist + hint NAT (`FIBRANEXUS_EGRESS_CIDRS`).
- [x] Conectar LiteBeam a ether3 → DHCP + Detectados + adopción.
- [x] SNMP airOS community `internetsur-lab` + poll online vía L009 (sysName NanoStation 5AC loco).
- [ ] Separar IP de gestión CPE vs IP remota PPPoE al provisionar Simple Queue (evitar que sync pise la IP remota con la de gestión).
- [x] Lab: suspensión wall garden servicio 83 → IP `172.16.11.251` en `FN-SUSPENDED`; reglas forward garden/DNS/drop; PPPoE sigue activo.
- [x] Quitar accept TCP/443 global (dejaba YouTube/Google); garden solo a IPs del portal + DNS.
- [x] Captive + mora/login por slug ISP (`/mora/{slug}`, `/portal/{slug}`).
- [ ] Mora: pagar directo a Flow/pasarela sin login (siguiente sesión).
- [ ] Ayuda contextual tipo UISP (ver `docs/ayuda-contextual.md`).
- [x] Lab: loco sectorial + CPE cliente Station + PPPoE `fn83s83` → `172.16.11.251` + Simple Queue 25M/25M.
- [x] Service-name PPPoE en airOS debe coincidir con el server del L009 (`internet`).

## Credenciales / secretos

- No documentar contraseñas en este archivo.
- Usuario API en router: `fibranexus` (group full en lab; endurecer group en producto).
- VPS FibraNexus: `134.209.43.175`.
