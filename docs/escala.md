# Escala — FibraNexus Manager

Guía para crecer sin reescribir. Stack actual: **GitHub → Vercel (UI) + Render (API) + Supabase (Postgres) + Cloudflare (túneles)**.

---

## Etapas

| Etapa | ISPs | Abonados totales | Infra | Costo aprox. |
|-------|------|------------------|-------|--------------|
| **0 — Lab** | 1–5 | &lt;500 | Todo free | $0 |
| **1 — Lanzamiento** | 5–20 | 500–2.000 | Render Starter + Supabase Pro | ~$32/mes |
| **2 — Crecimiento** | 20–100 | 2.000–20.000 | + pooler Supabase, más RAM Render | ~$50–95/mes |
| **3 — Escala seria** | 100+ | 20.000+ | Workers + Redis + API/worker separados | ~$100+/mes |
| **4 — Plataforma grande** | 500+ | 100.000+ | Multi-instancia, CF API túneles, SRE | $500+/mes |

---

## Señales de que pasaste de etapa

### Etapa 0 → 1
- Render free duerme (cold start)
- Supabase &gt;400 MB o conexiones &gt;40 frecuentes
- Primeros ISPs pagando

### Etapa 1 → 2
- Listados lentos (&gt;500 abonados por org)
- Scheduler de morosos compite con API en hora pico
- SNMP poll tarda mucho

### Etapa 2 → 3 (~20 ISPs)
- Activar **cola de jobs** (`REDIS_URL` + `USE_JOB_QUEUE=true`)
- Separar **PROCESS_ROLE=api** y **PROCESS_ROLE=worker** en Render
- Supabase **connection pooler** (puerto 6543)

### Etapa 3 → 4
- Automatizar túneles Cloudflare vía API
- Read replica Supabase/RDS para reportes
- Rate limit por organización

---

## Variables de entorno (portabilidad)

Ver `server/.env.example`. Lo crítico:

| Variable | Uso |
|----------|-----|
| `DATABASE_URL` | Supabase Postgres (luego pooler `:6543`) |
| `VITE_API_URL` | Vercel → URL de Render |
| `FRONTEND_URL` | CORS |
| `JWT_SECRET` | Auth |
| `PROCESS_ROLE` | `all` (default), `api` o `worker` |
| `REDIS_URL` | Upstash/Railway cuando actives colas |
| `USE_JOB_QUEUE` | `true` para encolar jobs pesados |

**Migrar de proveedor** = cambiar URLs en env + DNS. El código no cambia.

---

## Checklist antes del ISP #20

- [ ] Backups Supabase activos (Pro o export manual)
- [ ] `DATABASE_URL` con **pooler** si conexiones &gt;30
- [ ] Índices en `organization_id` (migración automática al arrancar)
- [ ] Health check con prueba de DB (`GET /api/health`)
- [ ] Paginación en listados (`?page=1&limit=50`)
- [ ] Jobs pesados vía `dispatch()` en `server/src/lib/jobs/`
- [ ] Documentar hostnames Cloudflare por ISP

---

## Activar workers (cuando llegue el momento)

1. Crear Redis (Upstash free → paid).
2. En Render, segundo servicio:
   - Mismo repo, root `server`
   - Start: `pnpm --filter fibranexus-server run worker`
   - Env: `PROCESS_ROLE=worker`, `REDIS_URL=...`, `USE_JOB_QUEUE=true`
3. En servicio API:
   - `PROCESS_ROLE=api`, `USE_JOB_QUEUE=true`
4. Implementar consumidor Redis en `server/src/lib/jobs/redisQueue.js` (stub listo).

Hoy los jobs corren **síncronos** (mismo comportamiento). La capa `dispatch()` ya apunta al mismo sitio.

---

## Migraciones comunes

| De → A | Esfuerzo | Pasos |
|--------|----------|-------|
| Supabase Free → Pro | 5 min | Upgrade en dashboard |
| Supabase → Neon/RDS | 2–4 h | `pg_dump` / restore, nueva URL |
| Render → Railway/Fly | 1–2 h | Nuevo deploy, env, DNS |
| Vercel → otro static | 1 h | Build Vite, env `VITE_API_URL` |
| Monolito → API + worker | 1–2 sem | Redis + `pnpm --filter fibranexus-server run worker` |

---

## Lo que NO hay que hacer

- Reescribir en otro lenguaje “por escala”
- Usar Supabase Auth/Realtime para el core (ataca portabilidad)
- Poner cloudflared en **cada** torre si ya tienes OSPF/hub
- Kubernetes antes de 100 ISPs con ingresos

---

## Modelo de ingresos vs infra (referencia)

| ISPs × $50/mes | MRR | Infra sugerida |
|----------------|-----|----------------|
| 10 | $500 | Etapa 1 (~$32) |
| 50 | $2.500 | Etapa 2 (~$95) |
| 100 | $5.000 | Etapa 3 (~$150) |

La infra debe ser **&lt;10% del MRR** en etapa 2–3.
