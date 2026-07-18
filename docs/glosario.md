# Glosario — FibraNexus Manager

Definiciones simples para clientes ISP, inversionistas y equipo técnico.

---

## Plataforma y negocio

| Término | Definición |
|---------|------------|
| **FibraNexus Manager** | Producto SaaS que centraliza CRM, cobranza interna y operación de red de un ISP. |
| **Plataforma** | Capa FibraNexus que administra a todos los ISPs contratantes o en prueba. |
| **SaaS** | Software como servicio: el ISP no instala el sistema completo en su oficina; usa la nube (con agentes/scripts en sus routers). |
| **Multi-tenant** | Una sola instalación sirve a muchos ISPs; los datos de cada uno están aislados. |
| **Tenant / Organización** | Una cuenta de ISP en FibraNexus (`organizations`). Sinónimo operativo de “el ISP cliente”. |
| **ISP** | *Internet Service Provider*: empresa que vende acceso a internet (fibra, WISP, etc.). |
| **WISP** | ISP que usa sobre todo radioenlaces (wireless) en vez de solo fibra. |
| **Suscripción (SaaS)** | Lo que el ISP paga a FibraNexus por usar la plataforma (hoy gestionado fuera o manualmente). |
| **Trial** | Período de prueba (p. ej. 14 días) sin plan de pago activo. |
| **Plan (de plataforma)** | Etiqueta comercial del tenant (`trial`, u otros strings); no confundir con plan de internet del abonado. |
| **MVP** | Producto mínimo vendible: lo esencial para operar y cobrar, sin todas las integraciones futuras. |

---

## Personas y roles

| Término | Definición |
|---------|------------|
| **Superadmin** | Usuario FibraNexus que ve y administra organizaciones. |
| **Admin (ISP)** | Administrador del tenant: comercial + técnico. |
| **Technician / Técnico** | Rol del ISP con foco en red y soporte; sin alta comercial completa. |
| **Administrativo** | Rol deseado (solo oficina/cobranza); **aún no existe en el código**. |
| **Abonado / Cliente final** | Persona o empresa que contrata internet al ISP. En código: rol `client` + ficha `clients`. |
| **Staff** | Usuarios del ISP que no son abonados (`admin` / `technician`). |
| **Portal** | Interfaz del abonado para deuda, facturas internas y tickets. |

---

## Comercial y cobranza

| Término | Definición |
|---------|------------|
| **Plan de internet** | Producto que vende el ISP (velocidad, precio, tipo). Tabla `plans`. |
| **Servicio / Suscripción** | Instancia contratada por un abonado (plan + IP/MAC/router + estado). |
| **Estados de servicio** | `active`, `suspended`, `cut`, `cancelled`, `pending`. |
| **Factura interna** | Cobro registrado en FibraNexus; **no** es automáticamente un DTE del SII. |
| **Boleta / Factura tributaria** | Documento fiscal chileno; integración SII = **planificado**. |
| **DTE** | Documento Tributario Electrónico (SII Chile). |
| **SII** | Servicio de Impuestos Internos. |
| **Vencimiento / overdue** | Factura pasada de fecha de pago. |
| **Pago manual** | Admin registra que el abonado pagó (efectivo, transferencia, etc.). |
| **Pasarela de pago** | Integración online (Flow, Webpay…); **planificado**. |
| **Webhook** | Aviso automático de un tercero (p. ej. “pago OK”) a nuestra API; **planificado**. |
| **Mora** | Deuda vencida sin pagar. |
| **Suspensión** | Corte lógico/red del servicio por mora u operación; suele redirigir o bloquear acceso. |
| **Reconexión / reactivación** | Restablecer el servicio tras pago o decisión del ISP. |
| **Walled garden** | Red restringida (p. ej. solo portal de aviso) mientras está suspendido. |
| **Prorrateo** | Cobro proporcional de días cuando el alta no cae en ciclo completo. |
| **IVA** | Impuesto; el sistema calcula 19% en facturas internas actuales. |

---

## Red y equipos

| Término | Definición |
|---------|------------|
| **Nodo / Sitio** | Ubicación lógica o física en la topología (`sites`), con jerarquía `parentId`. |
| **Topología** | Mapa de cómo se conectan sitios, routers y CPE. |
| **CPE** | *Customer Premises Equipment*: equipo en casa/empresa del abonado (antena, ONT, router). |
| **OLT** | *Optical Line Terminal*: cabecera de fibra GPON en el ISP. |
| **ONU / ONT** | Equipo óptico en el abonado (terminación GPON). En inventario como tipos; monitoreo profundo **planificado**. |
| **Router** | Equipo de enrutamiento del ISP (MikroTik, EdgeRouter, etc.). |
| **Switch** | Conmutador de red L2/L3. |
| **AP** | *Access Point*: punto de acceso inalámbrico. |
| **Antena / radioenlace** | Enlace PtP o PtMP (p. ej. Ubiquiti airMAX). |
| **MikroTik** | Marca/router OS; FibraNexus habla por API REST. |
| **EdgeRouter / EdgeOS** | Routers Ubiquiti con sistema EdgeOS; se integran por **heartbeat** (agente). |
| **Heartbeat** | Señal periódica del router al servidor (“sigo vivo”) y canal para recibir comandos. |
| **Agente** | Script/proceso en el router que habla con FibraNexus (p. ej. heartbeat.sh). |
| **SNMP** | Protocolo para consultar estado de equipos (señal, uptime, etc.). |
| **airMAX** | Línea Ubiquiti de radio; el poller usa OIDs específicos. |
| **CCQ** | *Client Connection Quality*: indicador de calidad de enlace wireless. |
| **RSSI / señal / ruido** | Medidas de radio; más ruido o menos señal ⇒ peor enlace. |
| **ARP** | Tabla de IPs conocidas asociadas a MAC en un segmento. |
| **DHCP** | Asignación automática de IPs; los *leases* alimentan la detección. |
| **PPPoE** | Autenticación de abonado por usuario/contraseña en muchos WISP/ISPs. |
| **Queue / cola** | Límite de ancho de banda en el router (MikroTik simple queues, etc.). |
| **IPAM** | Gestión de pool de direcciones IP. |
| **Dispositivo detectado** | MAC/IP vista en DHCP/ARP aún no adoptada como servicio de abonado. |
| **Túnel Cloudflare** | Forma de exponer el router a la nube de forma segura para gestión. |
| **Online / offline** | Estado según last_seen, heartbeat o SNMP. |

---

## Soporte y seguridad

| Término | Definición |
|---------|------------|
| **Ticket** | Caso de soporte (falla, consulta, instalación). |
| **CRM** | Gestión de la relación/ficha del abonado. |
| **JWT** | Token de sesión tras login. |
| **Credenciales** | Usuario/clave o token guardados para hablar con un equipo. Hoy en JSON; cifrado **planificado**. |
| **Auditoría / activity log** | Registro de quién hizo qué; tabla preparada, uso **planificado**. |
| **RBAC** | Control de acceso por roles (el modelo actual es lista de roles por ruta). |

---

## Infraestructura

| Término | Definición |
|---------|------------|
| **API** | Backend Express que expone `/api/...`. |
| **SPA** | Aplicación web de una página (React). |
| **PostgreSQL** | Base de datos relacional. |
| **Drizzle** | ORM usado para el esquema y consultas. |
| **Render / Vercel / Supabase** | Proveedores típicos de API, frontend y Postgres. |
| **Worker** | Proceso aparte para trabajos pesados (preparado; cola Redis aún stub). |
| **Scheduler** | Tareas periódicas (facturación, SNMP, scans) dentro del servidor. |

---

## Siglas rápidas

| Sigla | Significado |
|-------|-------------|
| ISP | Proveedor de internet |
| SaaS | Software as a Service |
| CRM | Customer Relationship Management |
| SNMP | Simple Network Management Protocol |
| MAC | Dirección física del equipo de red |
| IP | Dirección lógica en la red |
| GPON | Tecnología de fibra pasiva |
| NOC | Network Operations Center |
| MRR | Monthly Recurring Revenue |
