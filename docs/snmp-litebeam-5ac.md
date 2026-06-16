# SNMP – Ubiquiti LiteBeam 5AC + FibraNexus

Guía de integración para obtener métricas de señal airMAX desde una LiteBeam 5AC
a través del heartbeat del EdgeRouter hacia el dashboard FibraNexus.

---

## 1. Requisitos previos

### En la LiteBeam 5AC (airOS)

1. Acceder a la interfaz web de la antena (`https://<ip-antena>`)
2. Ir a **Services → SNMP**
3. Activar SNMP y configurar:
   - **Community:** debe coincidir exactamente con el campo SNMP del equipo en FibraNexus (ej. `internetsur-lab`)
   - **Contact / Location:** opcionales
4. Guardar y aplicar cambios

> **Importante:** La LiteBeam 5AC solo responde a **SNMP v1**. Aunque airOS aparenta soportar v2c, en la práctica el `snmpget -v2c` falla con este modelo. El heartbeat prueba v2c primero y hace fallback automático a v1.

### En FibraNexus (panel)

- El equipo CPE debe tener:
  - **IP** asignada (la IP de la antena, accesible desde el EdgeRouter del nodo)
  - **Community SNMP** configurada (misma que airOS)
  - **MAC** registrada (para detección ARP)
  - Estar asignado al mismo **Nodo/Site** que el EdgeRouter

### En el EdgeRouter

- Herramientas disponibles: `snmpget`, `snmpwalk` (incluidas en EdgeOS, sin necesidad de Python)
- Script heartbeat activo en `/config/scripts/fibranexus/heartbeat.sh`
- Demonio corriendo (verificar con `ps aux | grep heartbeat`)

---

## 2. OIDs confirmados – LiteBeam 5AC (airMAX)

MIB base: `1.3.6.1.4.1.41112.1.4.5` (Ubiquiti airMAX Station MIB)

| Métrica        | OID completo                          | Valor ejemplo | Unidad |
|----------------|---------------------------------------|---------------|--------|
| Señal RX       | `.1.3.6.1.4.1.41112.1.4.5.1.5.1`    | `-61`         | dBm    |
| Ruido          | `.1.3.6.1.4.1.41112.1.4.5.1.8.1`    | `-89`         | dBm    |
| CCQ            | `.1.3.6.1.4.1.41112.1.4.5.1.6.1`    | `35`          | %      |
| CINR           | `.1.3.6.1.4.1.41112.1.4.5.1.14.1`   | `20`          | dB     |
| TX rate        | `.1.3.6.1.4.1.41112.1.4.5.1.9.1`    | `78000000`    | bps    |
| RX rate        | `.1.3.6.1.4.1.41112.1.4.5.1.10.1`   | `78000000`    | bps    |

> **Índice de instancia:** siempre `.1` (no `.0`). La tabla `.1.4.5.1.*` tiene una sola fila (el enlace activo).
>
> **OIDs descartados:** `.1.3.6.1.4.1.41112.1.4.7.1.*` corresponde a otra tabla que requiere índice basado en MAC; no funciona con `snmpget` directo en este modelo.

---

## 3. Comandos de diagnóstico desde el EdgeRouter

### Ver TODOS los OIDs disponibles (snmpwalk completo)

```bash
snmpwalk -v1 -c <community> <ip-antena>
```

Esto muestra toda la MIB. Útil para explorar qué soporta el equipo. La salida es larga — redirigir a archivo o filtrar:

```bash
snmpwalk -v1 -c <community> <ip-antena> | grep "41112"
```

Solo OIDs Ubiquiti (airMAX).

### Verificar las 6 métricas en un solo comando

```bash
snmpget -v1 -c <community> -t 3 -r 1 -Oqv <ip-antena> \
  .1.3.6.1.4.1.41112.1.4.5.1.5.1 \
  .1.3.6.1.4.1.41112.1.4.5.1.8.1 \
  .1.3.6.1.4.1.41112.1.4.5.1.6.1 \
  .1.3.6.1.4.1.41112.1.4.5.1.14.1 \
  .1.3.6.1.4.1.41112.1.4.5.1.9.1 \
  .1.3.6.1.4.1.41112.1.4.5.1.10.1
```

Salida esperada (una línea por OID, en orden):
```
-61       ← señal dBm
-89       ← ruido dBm
35        ← CCQ %
20        ← CINR dB
78000000  ← TX bps
78000000  ← RX bps
```

### Probar SNMP v2c primero (para saber si responde)

```bash
snmpget -v2c -c <community> -t 2 -r 0 -Oqv <ip-antena> .1.3.6.1.4.1.41112.1.4.5.1.5.1
```

Si devuelve `Timeout` → usar `-v1`.

### Verificar que el heartbeat está enviando métricas

En el EdgeRouter, ejecutar el script manualmente y ver output:

```bash
sudo bash /config/scripts/fibranexus/heartbeat.sh
```

O ver los logs en Render: buscar líneas con `[heartbeat-metrics]`:
```
[heartbeat-metrics] router=9 cpe=12 sig=-61dBm ccq=35% cinr=20dB
```

---

## 4. Cómo se actualizan las métricas

1. EdgeRouter corre heartbeat cada ~28 segundos
2. Hace `snmpget` a cada CPE en la lista `snmpTargets` (que el servidor envía en la respuesta del heartbeat)
3. Empaqueta: `"equipId,signal,noise,ccq,cinr,txBps,rxBps;"` → campo `cpeMetrics` del POST
4. Servidor guarda en `equipment.credentials.lastMetrics` y en tabla `device_metrics` (retención 7 días)
5. `attachSnmpDisplay` en `equipmentStatus.js` expone `wirelessSignal`, `wirelessCcq`, `wirelessSnr` al frontend
6. `CpeLinkVisualizer` muestra los valores en el dashboard del abonado

---

## 5. Notas para otros modelos Ubiquiti

| Modelo              | MIB base esperada         | SNMP v1 requerido | Notas                                 |
|---------------------|---------------------------|-------------------|---------------------------------------|
| LiteBeam 5AC        | `.1.4.5` (confirmado)     | Sí                | Índice `.1`                           |
| NanoStation M5 (M)  | `.1.4.7` (probable)       | Depende           | Índice basado en MAC — snmpwalk para confirmar |
| airMAX AC (gen 2)   | `.1.4.5` o `.1.4.8`       | No (v2c funciona) | Verificar con snmpwalk                |
| NanoBeam M5         | `.1.4.5` (probable)       | Probable v1       | Misma MIB que LiteBeam 5AC            |

> Para cualquier modelo nuevo: correr `snmpwalk -v1 -c <community> <ip> | grep 41112` desde el EdgeRouter y buscar los OIDs con valores de señal/CCQ reconocibles.

---

## 6. Actualizar el script en el EdgeRouter

Si se cambia `buildEdgeosHeartbeatScript` en el backend, el EdgeRouter debe descargar la nueva versión:

```bash
# 1. Descargar nueva versión del script
curl -sf https://app.fibranexus.cl/hs/<TOKEN> | sudo tee /config/scripts/fibranexus/heartbeat.sh

# 2. Matar el daemon anterior y reiniciar
sudo kill $(cat /tmp/fibranexus.pid 2>/dev/null) 2>/dev/null
sudo bash /config/scripts/fibranexus/heartbeat.sh &

# 3. Verificar que está corriendo
sudo kill -0 $(cat /tmp/fibranexus.pid 2>/dev/null) && echo "daemon activo"
```

El token está en **FibraNexus → Routers → panel del router → "Token agente"**.

---

## 7. Troubleshooting rápido

| Síntoma | Causa probable | Solución |
|---------|---------------|----------|
| `— dBm` en el dashboard | SNMP no habilitado en airOS | Activar en Services → SNMP |
| `— dBm` aunque airOS tiene SNMP | Community incorrecta | Verificar que coincide en ambos lados |
| `Timeout` con v2c | Modelo solo acepta v1 | Normal — el script hace fallback automático |
| Métricas `0` o vacías | OID incorrecto o índice `.0` en vez de `.1` | Correr snmpwalk para confirmar OIDs |
| Dashboard muestra datos viejos | Heartbeat caído | `ps aux | grep heartbeat` y reiniciar daemon |
| `sig === 0` en logs del servidor | `snmpget` devolvió `0` (falla silenciosa) | Ver output manual del heartbeat en EdgeRouter |
