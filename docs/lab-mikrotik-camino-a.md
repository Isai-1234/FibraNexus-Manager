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

1. **Segura automática (default)** — un script: cert + www-ssl + usuario dedicado + allowlist solo IPs FibraNexus + heartbeat + (si aplica) NAT sugerido del borde.
2. **Manual** — ISP ya tiene API; solo IP/puerto/usuario/clave + “Probar conexión”. Advertir si queda abierto a `0.0.0.0/0`.

Sin IP pública → túnel Cloudflare / agente saliente (no es este camino).

## Pendiente inmediato

- [x] L009 online vía Camino A (NAT + www-ssl + allowlist VPS).
- [x] Perfil `fn-pppoe` + servidor PPPoE `internet` en **ether3** (pool `dhcp_pool1` 172.16.11.0/24, sin rate-limit).
- [ ] Reescribir script Camino A del wizard (`mikrotik-script`) con allowlist + cert + usuario.
- [ ] UI: separar “Segura automática” vs “Manual” bajo “Tengo IP pública”.
- [x] Conectar LiteBeam a ether3 → DHCP + Detectados + adopción.
- [x] SNMP airOS community `internetsur-lab` + poll online vía L009 (sysName NanoStation 5AC loco).
- [ ] Separar IP de gestión CPE vs IP remota PPPoE al provisionar Simple Queue.
- [ ] Probar suspensión wall garden + reactivación.
- [ ] Ayuda contextual tipo UISP (ver `docs/ayuda-contextual.md`).

## Credenciales / secretos

- No documentar contraseñas en este archivo.
- Usuario API en router: `fibranexus` (group full en lab; endurecer group en producto).
- VPS FibraNexus: `134.209.43.175`.
