# Quickstart: Validar 001-red-isp-topology

## Prerrequisitos

- Lab Internetsur o tenant con ≥2 sitios y routers
- Login admin en https://app.fibranexus.cl (o local)
- Deploy ≥ **1.2.8** (`GET /api/health`)

## 1. Jerarquía de sitios (US1)

1. Red ISP → **Árbol** → editar **Nodo2** → Nodo padre = **Torre Pangui** → Guardar
2. **Topología** → ver Torre Pangui arriba, Nodo2 abajo, línea curva/bus
3. **Volver al árbol** si entraste a un nodo

**Esperado**: padre centrado arriba, hijo debajo, sin líneas diagonales rectas fea.

## 2. Drill-down equipos (US2)

1. Topología → clic **Torre Pangui**
2. Ver MikroTik y EdgeRouter en **columna vertical** bajo el título
3. Clic IP MikroTik → nueva pestaña interfaz web
4. Si hay CPE en Nodo2, entrar a Nodo2 → CPE bajo su router

**Esperado**: layout centrado, conexiones curvas, IPs clicables.

## 3. Edición nodos (US3)

1. Árbol → seleccionar sitio → ícono **lápiz**
2. Cambiar ciudad o nombre → Guardar
3. Reflejado en Topología y panel lateral

## 4. Routers y agentes (regresión)

1. Menú **Routers y agentes**
2. Lista carga sin pantalla en blanco
3. Host clicable en cada tarjeta

## 5. Deploy

```bash
curl -s https://app.fibranexus.cl/api/health | jq .version
# debe ser >= 1.2.8
```

Hard refresh: Ctrl+Shift+R
