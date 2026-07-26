# Autoservicio WiFi y gestión de routers del abonado

Decisión de producto y arquitectura validada el 2026-07-25.

## Objetivo

Permitir que el operador y, de forma limitada, el abonado puedan:

- ver si el router WiFi administrado está conectado;
- cambiar el nombre de red (SSID) y la clave WiFi;
- reiniciar el router con una advertencia clara;
- ejecutar un diagnóstico simple y abrir un ticket con el resultado;
- mantener trazabilidad de quién cambió qué y cuándo.

La clave PPPoE no se expone ni se cambia desde el portal del abonado. Es una
credencial de provisión del servicio y un cambio aislado cortaría la conexión.

## Inventario de laboratorio

Organización `Nexus Sur QA`, abonado `Andrés Prueba`
(`antena.lab.20260724@fibranexus.test`, servicio 83 activo, Plan Rural 25Mbps):

- MikroTik L009 de borde: conectado.
- Sectorial Ubiquiti airOS: conectada.
- CPE Ubiquiti del abonado: conectado, gestión `172.16.11.251`.
- Router WiFi Mercusys MW330HP: inventariado en `172.16.11.252`, estado
  `Sin monitoreo`, con usuario web guardado y **sin** SSID/clave WiFi en bóveda.

La lista oficial de equipos TR-069 de Mercusys Chile no incluye el MW330HP.
Mercusys sí ofrece TR-069 en modelos más nuevos, como MR30G/MR50G/MR70X y otros,
pero no se debe asumir compatibilidad por marca: se valida modelo, versión de
hardware y firmware.

## Estado actual en código (2026-07-25)

Hoy FibraNexus solo tiene **bóveda de inventario** para WiFi doméstico:

- El operador puede guardar y revelar `wifiSsid` / `wifiPass` / web en la ficha
  del abonado (`PATCH /api/sites/equipment/:id`,
  `GET .../access-credentials`).
- Ese PATCH **no aplica** el cambio al router: solo actualiza la base de datos.
- El portal del abonado (`/api/portal`, `ClientPortal.tsx`) no tiene pestaña
  WiFi ni equipos.
- SNMP/airMAX monitorea el enlace radio; no configura el WiFi de la casa.
- No hay TR-069, GenieACS, CWMP ni API de fabricante.

## Referencias de producto

- Splynx integra un ACS basado en GenieACS y permite cambiar SSID/clave y
  reiniciar desde el panel del operador y el portal del abonado.
- UISP administra bien la red y equipos Ubiquiti, pero no ofrece de forma
  general autoservicio del router doméstico de terceros.
- Plataformas modernas separan el portal del ACS: el navegador nunca habla
  directamente con el servidor de equipos.
- TR-369/USP es el sucesor moderno, pero TR-069 sigue siendo necesario para el
  parque instalado. Ambos pueden compartir el modelo de datos TR-181.

## Arquitectura elegida

```text
Portal cliente / Panel operador
             |
        API FibraNexus
   autorización + auditoría
             |
      adaptador de gestión CPE
             |
    GenieACS NBI (red privada)
             |
     TR-069/HTTPS desde router
```

GenieACS se ejecutará como servicio separado con MongoDB. Su API NBI no tendrá
exposición pública: solo FibraNexus podrá llamarla mediante red privada,
allowlist y credencial de servicio. El endpoint CWMP sí será alcanzable por los
routers y usará TLS cuando el firmware lo soporte.

FibraNexus mantendrá un modelo canónico independiente de las rutas TR-069. Cada
familia/modelo tendrá un mapa de parámetros para SSID 2.4/5 GHz, clave,
reinicio, estado y clientes conectados. Esto evita acoplar el portal a
`InternetGatewayDevice.*` o `Device.*`, que varían por fabricante y firmware.

## Experiencia del operador

En el detalle del abonado:

1. Resumen en lenguaje simple: Internet, enlace exterior y router WiFi.
2. Acciones rápidas: `Probar conexión`, `Reiniciar router`, `Cambiar WiFi`.
3. Estado de la orden: pendiente, aplicada, fallida o equipo desconectado.
4. Última conexión, modelo, firmware y cantidad de dispositivos en la casa.
5. Un clic para crear ticket con diagnóstico adjunto.

No se debe mostrar “Offline” cuando el equipo simplemente carece de monitoreo.
Los estados distintos son: `En línea`, `Sin administración`, `Esperando al
router`, `Desconectado` y `Error`.

## Experiencia del abonado

La pestaña `Mi WiFi` solo aparece si tiene un router administrado y vinculado:

- nombre actual de la red;
- cambio de SSID y clave (8–63 caracteres);
- confirmación que avisa que los dispositivos se desconectarán;
- progreso visible durante 5–60 segundos y resultado final;
- reinicio con aviso de aproximadamente un minuto sin conexión;
- si falla, botón `Necesito ayuda` que abre un ticket con el diagnóstico.

La clave actual no se devuelve al navegador. El formulario permite definir una
nueva clave y confirmarla. Cada operación tiene rate limit, auditoría, control
multi-tenant y notificación al abonado.

## Adopción

1. Validar en laboratorio un router oficialmente compatible con TR-069.
2. Levantar GenieACS aislado y registrar un único router de prueba.
3. Implementar lectura de estado y reinicio para el operador.
4. Agregar cambio de SSID/clave para el operador.
5. Habilitar autoservicio del abonado después de validar recuperación, timeout,
   doble banda, desconexión durante el cambio y auditoría.
6. Definir una lista corta de routers recomendados por FibraNexus; no prometer
   gestión remota para equipos no homologados.

El MW330HP del laboratorio puede seguir inventariado como router no administrado.
No se expondrá su panel web a Internet ni se automatizará mediante scraping:
sería inseguro, dependiente del firmware y difícil de mantener.
