# Investigación: Inyección edge `/.webmcp/bridge.js` (Cloudflare WebMCP)

> Ciclo: 126 (CONTINUOUS_EVOLUTION, investigación dirigida desde `ACTIVE-MISSION.md` ítem 2).
> Sitio analizado: `https://apluno.com` (live, build antiguo `0e2e14a`; HEAD certificado `2cb96d1` NO desplegado).
> Naturaleza: **solo lectura** (HTTP contra el sitio público del propietario + análisis estático + grep del repo). No se modifica Cloudflare ni el repo.

## Resumen

El `<head>` del sitio live incluye `<script src="/.webmcp/bridge.js">`. Se confirmó que es el puente **WebMCP de Cloudflare** (interfaz Model Context Protocol para que un asistente de IA en el navegador conduzca la página), inyectado en el **borde de Cloudflare**, y **no es un artefacto del build de Toolisto** (cero referencias en el repositorio).

El análisis de su contenido (47 616 bytes) concluye que **no intercepta el tráfico de red de la aplicación**, **no accede a IndexedDB** y **no contiene endpoints externos**: por tanto **no vulnera la garantía local-first / cero-egress de Toolisto** para el contenido del usuario.

## Evidencia recogida

| Comprobación | Resultado |
|--------------|-----------|
| `/.webmcp/bridge.js` | HTTP 200, 47 616 bytes |
| `/` (home) | `bridge.js` en `<head>`: SÍ (200) |
| `/toolisto` | `bridge.js` en `<head>`: SÍ (200) |
| `/privacidad/` | HTTP 404 (ruta live distinta/eliminada — gap de deploy aparte, ya conocido) |
| `/mcp` | HTTP 404 (no hay servidor MCP configurado) |
| Grep repo (`webmcp|bridge\.js|WebMCP|/mcp` en `*.js,*.mjs,*.html,*.json,*.md,*.yml,*.yaml`) | **0 coincidencias** |

## Análisis del script (atribución y riesgo)

- **Atribución:** tokens `webmcp` (×18), comentarios de fuente `// src/tool-pack.ts`, `// src/bridge/registry.ts`, y `DEFAULT_MCP_URL = "/mcp"`. Es el puente cliente WebMCP de Cloudflare.
- **Mensajería entre contextos:** 0 `postMessage` / `MessageChannel` / `BroadcastChannel`.
- **Intercepción de red de la app (riesgo egress):**
  - `XMLHttpRequest`: **0**
  - `WebSocket` / `EventSource` / `sendBeacon`: **0**
  - Literales de URL externas: **0**
  - `fetch(` : 3, todos a **mismo origen** (`/mcp` endpoint, `src` de `<img>` de la página, URL de pack dinámico). No envuelven el `fetch` de la aplicación.
  - El verbo "interce" (×13) se refiere a un *interceptor de herramientas MCP* (registrar/resolver tools), no a interceptación de red.
- **DOM:**
  - `document.write` / `createElement` (inyección de UI): **0**
  - `querySelector` (×3): lectura de la página para las tools MCP (p. ej. enumerar `<img>`, localizar elemento por selector). No inyecta.
  - Acceso a `IndexedDB` / `localStorage` para exfiltrar: **no**. Únicas menciones de `cookie` son comentarios sobre NO reenviar credenciales al endpoint mismo.
- **Requisito de activación:** `document.modelContext` (Chrome M146+ con `chrome://flags/#enable-experimental-web-platform-features`). Sin eso, el puente registra advertencia y queda inerte (línea 1345).
- **Estado actual:** `/mcp` devuelve 404 → el cliente **no registra ninguna site tool** (`tools/list failed … registering no site tools`); el puente es **inerte**.

## Clasificación de riesgo (producto)

| Dimensión | Veredicto |
|-----------|-----------|
| ¿Es build de Toolisto? | NO (borde Cloudflare; 0 refs en repo) |
| ¿Intercepta fetch/XHR/WS de la app? | NO |
| ¿Accede a IndexedDB / estado del usuario? | NO |
| ¿Endpoints externos? | NO (todo mismo-origen `/mcp`) |
| ¿Vulnera cero-egress local-first? | **NO_OBSERVADO** |
| Impacto en el despliegue certificado | NINGUNO (es externo al repo) |

**Clasificación:** `CONFIRMED_CLOUDFLARE_EDGE_INJECTION_BENIGN_TO_ZERO_EGRESS`.

## Acción requerida (dueño / host, NO repo)

1. **Decisión de divulgación:** el propietario debe saber que Cloudflare inyecta WebMCP en el borde de `apluno.com`.
2. **Opción:** si no se usa WebMCP, **eliminar la ruta `/.webmcp/*` / desactivar WebMCP en la configuración de Cloudflare** para no exponer el puente. Esto es configuración del host, no un cambio de código en el repositorio.
3. Si en el futuro se habilita un servidor MCP en `/mcp`, las "site tools" operan dentro de la página (mismo origen) y solo leen DOM/imágenes; no exfiltran contenido salvo que se cargue un pack malicioso. Sigue sin romper el cero-egress del contenido del usuario.

## Relación con el despliegue

Esta inyección **no bloquea** el despliegue del HEAD certificado `2cb96d1`. El bloqueo de despliegue sigue siendo el `HARD_RUNTIME_BLOCK_CONFIRMED` del harness (`git push*` denegado). El hallazgo se documenta para que el propietario decida sobre la ruta de Cloudflare; el repo no necesita cambios.
