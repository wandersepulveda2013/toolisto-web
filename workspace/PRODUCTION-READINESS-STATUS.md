# PRODUCTION-READINESS-STATUS.md — Memoria persistente del sistema autónomo

> Cada ciclo de OpenCode LEE este archivo antes de actuar y lo ACTUALIZA antes de terminar.
> Registro histórico de ciclos de la misión Production Readiness.
> Updated: 2026-08-11

---

## Cycle 27 — Cierre certificado de Production Readiness

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | de1b0ddd8c550c45cceb0aa28e1d2a5fb0aaa19b |
| **HEAD final** | Ver commit de Cycle 27. |
| **Task** | PR-018 — validación final y creación de `PRODUCTION_READINESS_DONE`. |
| **Hypothesis** | Tras eliminar el churn de evidencia de CE-012, una validación integral verde sobre el HEAD actual y un commit final limpio permiten cerrar la etapa sin ocultar trabajo. |
| **Change** | Se certificó build, audit y regresión completa; se creó `workspace/PRODUCTION_READINESS_DONE`. Durante la reproducción se corrigió el último campo no determinista: el check de Word Family validaba el tamaño comprimido, pero almacenaba en la evidencia el mensaje completo con el tamaño variable del DOCX temporal. Ahora conserva la aserción semántica y una etiqueta estable. |
| **Hallazgos** | El primer `run-all` dejó Responsive Matrix sin salida porque el límite por suite de 300 s de su runner se agotó en secuencia. Dos ejecuciones enfocadas posteriores pasaron (una medida en 167,51 s) y el segundo `run-all` aprobó 43/43; no se modificaron timeouts ni se añadieron reintentos al runner. |
| **Bugs encontrados** | La evidencia de Word Family cambiaba entre ejecuciones por un byte variable del DOCX generado y su mensaje completo se serializaba como nombre de check, pese a que la forma JSON ya era canónica. |
| **Bugs corregidos** | La evidencia de Word Family es estable en dos ejecuciones consecutivas y conserva la comprobación real de que el resultado informa el tamaño comprimido. |
| **Tests ejecutados** | `npm run build`; `npm test`; `node tests/run-all.mjs` (primer intento 42/43: Responsive Matrix sin diagnóstico por límite de suite); `node tests/responsive-matrix.mjs` ×2; `node tests/gate-e2e-word-tools.mjs` ×2; `node tests/evidence-determinism.mjs`; `node tests/run-all.mjs` final. |
| **Tests PASS** | Build 179 páginas; Audit Count PASS; Responsive Matrix 4.198/4.198 ×2; Word Family 67/67 ×2; Evidence Determinism 69/69; regresión final 43/43 suites, 0 fallos. |
| **Tests FAIL** | Primer `run-all`: 42/43, Responsive Matrix agotó los 300 s sin salida; reproducido enfocadamente y regresión final verde. |
| **Commits** | Ver commit de Cycle 27. |
| **Bloqueos** | Ninguno. Production Readiness está cerrada; el marcador transiciona el siguiente ciclo a Continuous Evolution. |
| **Limitaciones** | Responsive Matrix sigue dependiendo de Chromium y de un límite de 300 s por suite; no se amplió el timeout global. La variación temporal interna del DOCX no afecta el output funcional y ya no contamina la evidencia. |
| **Próxima prioridad** | Seguir `CONTINUOUS-EVOLUTION-MISSION.md` y su cola canónica. |

---

## Cycle 26 — Evidencia determinista: regenerar = diff cero

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 8b1ee17 |
| **HEAD final** | Ver commit de Cycle 26. |
| **Task** | CE-012 — normalizar los escritores de evidencia para eliminar el churn que mantenía bloqueado PR-018. |
| **Hypothesis** | Las 23 evidencias que cada regresión regeneraba cambiaban porque los gates incrustaban timestamps absolutos y puertos efímeros del servidor local; si la escritura es determinista y solo escribe si cambió, regenerar no produce diff y el árbol deja de auto-contaminarse. |
| **Change** | Creado `tests/evidence-helper.mjs` (canonicaliza: elimina `generatedAt`/`updatedAt`/`fecha`, normaliza `http://127.0.0.1:PUERTO` → `<port>`, ordena claves de forma estable) y `tests/evidence-determinism.mjs` (ratchet integrado en `run-all`). Migrados 29 escritores de evidencia a `writeEvidence`. Canonizadas 30 evidencias `TLT-*.json`. Versionado `workspace/AUTONOMOUS_MODE` e ignorado el flag transitorio `AUTONOMOUS_STOP`. Además, la prueba negativa de red pasó de registrar el log completo de requests (2,4 MB) a un resumen agregado determinista: canario fijo, conteos (external/probes), `unexpected` y `secretLeak`. |
| **Hallazgos** | El diff de las evidencias modificadas era únicamente `generatedAt` (11:58→13:08) y puertos efímeros en nombres de checks (`Server started on http://127.0.0.1:62612`). La tarea CE-012 ya había sido descubierta y encolada por el sistema de Evolución Continua. El gate de red negativa era el único escritor con payload intrínsecamente no determinista: canario aleatorio (`Date.now`+`Math.random`) y el log íntegro de requests en la evidencia. |
| **Bugs encontrados** | Ninguna regresión funcional. El impedimento de PR-018 era íntegramente churn de evidencia más estado de runtime sin versionar (`AUTONOMOUS_MODE` untracked, `AUTONOMOUS_STOP` untracked). En el gate de red negativa, la evidencia guardaba el secreto aleatorio y miles de requests locales con headers/postData (2,4 MB), lo que garantizaba diff en cada ejecución. |
| **Bugs corregidos** | Regenerar cualquier evidencia con su gate ya no cambia sus bytes: la regresión completa (`run-all` 43/43) regeneró toda la evidencia y el ratchet siguió 69/69 con diff cero. La evidencia de red negativa quedó determinista y ligera (36 KB): canario fijo, agregados y `secretLeak`; dos ejecuciones seguidas producen SHA-256 idéntico (343/343 PASS en ambas). |
| **Tests ejecutados** | `node --check` (31 archivos); `node tests/evidence-determinism.mjs`; `node tests/production-tool-coverage.mjs`; `node tests/deployment-guide-audit.mjs`; `node tests/public-site-network-negative.mjs` (dos veces, SHA idéntico); `node tests/run-all.mjs` (regresión completa). |
| **Tests PASS** | Evidence Determinism 69/69; Coverage 26/26 (167/167); Deployment 7/7; Red negativa 343/343 ×2 con evidencia byte-idéntica; `run-all` 43/43 suites, 0 fallos. |
| **Tests FAIL** | 0. |
| **Commits** | Ver commit de Cycle 26. |
| **Bloqueos** | PR-018 sigue BLOCKED hasta una validación final sobre el HEAD certificado; con el churn eliminado y el runtime versionado/ignorado, un ciclo de cierre puede dejar el árbol limpio y cerrar Production Readiness. |
| **Limitaciones** | Las evidencias estáticas de ciclos (`TLT-production-readiness-cycle-*`) y las no generadas por gates (`TLT-dead-code-audit`, `TLT-security-honesty`, `TLT-root-structure-audit`, `TLT-pdf-ocr-architecture`) conservan su formato propio; el ratchet solo exige forma canónica a los archivos escritos por gates. |
| **Próxima prioridad** | PR-018 — validación final de cierre sobre el HEAD actual con árbol limpio (build + `npm test` + `run-all`). |

---

## Cycle 25 — Recuperación clara para rutas PWA no visitadas

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 28c9d2a4bcc754be67122972ad01cda659d921bb |
| **HEAD final** | Ver commit de Cycle 25. |
| **Task** | PR-020 — mostrar una recuperación explícita al abrir offline una herramienta no visitada. |
| **Hypothesis** | Devolver la portada en una URL de herramienta sin conexión es ambiguo: parece que la herramienta solicitada se abrió, aunque su contenido no esté en caché. |
| **Change** | Añadida `offline.html`, ligera y accesible; el build la publica, el service worker la precachea y la utiliza sólo como fallback de navegación no almacenada. La página conserva un enlace claro al inicio. |
| **Hallazgos** | La estrategia red primero de Cycle 24 mantenía correctamente las rutas ya visitadas, pero el fallback de `index.html` para cualquier navegación fallida perdía el contexto y podía inducir a error. |
| **Bugs encontrados** | Una herramienta no visitada sin red devolvía la portada con HTTP 200 bajo la URL original. |
| **Bugs corregidos** | Las herramientas cacheadas se siguen abriendo offline; las no cacheadas muestran una explicación honesta y una recuperación navegable, sin scripts ni solicitudes externas. |
| **Tests ejecutados** | `npm run build`; `node tests/pwa-offline.mjs`; `node tests/deployment-guide-audit.mjs`; `npm test`. |
| **Tests PASS** | Build 179 páginas; PWA Offline 20/20 (184 páginas indexables), incluido navegador offline para ruta visitada y no visitada; Deployment Guide 7/7; Audit Count PASS. |
| **Tests FAIL** | 0. |
| **Commits** | Ver commit de Cycle 25. |
| **Bloqueos** | PR-020 cerrado. PR-018 continúa BLOCKED: `git status` contiene cambios concurrentes ajenos, incluida la cola CE y evidencias, por lo que no se puede certificar ni cerrar Production Readiness. |
| **Limitaciones** | Una ruta no visitada requiere una conexión inicial para quedar disponible offline; esto evita entregar contenido equivocado. La página de recuperación no procesa ni persiste archivos del usuario. |
| **Próxima prioridad** | PR-018 sólo cuando el árbol quede limpio y pueda ejecutarse la validación final sobre el HEAD certificado. |

---

## Cycle 24 — Actualización fiable de PWA publicada

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | e92610842f10a0dbbe6662b30064219547befd69 |
| **HEAD final** | Ver commit de Cycle 24. |
| **Task** | PR-019 — revalidar recursos publicados y preservar URLs versionadas en la caché offline. |
| **Hypothesis** | La estrategia cache-first fija podía dejar HTML, JS y CSS obsoletos después de publicar una versión nueva; red primero con fallback conserva la disponibilidad offline sin sacrificar actualizaciones. |
| **Change** | El service worker migra a caché `toolisto-static-v2`, revalida los GET locales contra red y sólo utiliza la copia local ante fallo. Ya no ignora la query string. El gate PWA añade una sonda de navegador con URL versionada y cabecera de servidor para verificar que el recurso llega desde la publicación actual. |
| **Hallazgos** | La caché v1 devolvía una coincidencia antes de intentar red y `ignoreSearch: true` podía entregar una variante equivocada. La activación elimina automáticamente la caché v1. |
| **Bugs encontrados** | Usuarios con una PWA ya controlada podían permanecer en una versión obsoleta mientras hubiese conectividad. |
| **Bugs corregidos** | Las publicaciones se revalidan online; ante desconexión se conserva la herramienta visitada y el shell local. Las URLs con parámetros de versión mantienen entradas separadas. |
| **Tests ejecutados** | `npm run build`; `node tests/pwa-offline.mjs`; `npm test`; `node tests/deployment-guide-audit.mjs`. |
| **Tests PASS** | Build 179 páginas; PWA Offline 16/16 y 184 páginas, incluyendo sonda online/versionada, offline y consola limpia; Audit Count PASS; Deployment Guide 7/7. |
| **Tests FAIL** | 0. |
| **Commits** | Ver commit de Cycle 24. |
| **Bloqueos** | PR-019 cerrado. PR-018 continúa BLOCKED: siguen existiendo cambios concurrentes no atribuibles a este ciclo y el árbol no puede certificarse limpio. |
| **Limitaciones** | Red primero prioriza contenido publicado actual y puede ser menos instantáneo con conectividad muy lenta; el fallback mantiene la experiencia offline y no intercepta solicitudes que no sean GET del mismo origen. |
| **Próxima prioridad** | PR-018, únicamente cuando el autor de los cambios concurrentes deje un árbol limpio para la validación final completa. |

---

## Cycle 23 — Cierre de Production Readiness bloqueado por trabajo concurrente

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | a98d999c15c35ea63777fe9165d9c51838d4d79a |
| **HEAD final** | Ver commit documental de cierre de Cycle 23. |
| **Task** | PR-018 — validación final y creación de `PRODUCTION_READINESS_DONE`. |
| **Hypothesis** | La transición sólo es válida si se puede certificar un árbol limpio y la regresión final corresponde al HEAD actual. |
| **Change** | Se actualizó el bloqueo con el estado real del árbol, sin apropiarse de evidencias ni de la cola CE modificadas por otro trabajo. |
| **Hallazgos** | Desde la certificación integral de Cycle 20, HEAD avanzó a `a98d999` con una mejora CE. Persisten 23 evidencias modificadas, `workspace/CONTINUOUS-EVOLUTION-QUEUE.md` modificado y `workspace/AUTONOMOUS_MODE` no versionado. Por tanto, la regresión 42/42 de Cycle 20 ya no certifica el HEAD actual y el árbol no puede declararse limpio. |
| **Bugs encontrados** | Ninguna regresión funcional reproducida. El bloqueo es de integridad de la certificación: no es seguro incluir, descartar ni alterar cambios concurrentes. |
| **Bugs corregidos** | Se mantuvo la barrera de cierre: no se crea el marcador DONE con un árbol sucio ni con regresión anterior al HEAD actual. |
| **Tests ejecutados** | `node tests/deployment-guide-audit.mjs`. |
| **Tests PASS** | Deployment Guide 8/8 PASS. |
| **Tests FAIL** | 0. |
| **Commits** | Ver commit documental de cierre de Cycle 23. |
| **Bloqueos** | PR-018 sigue BLOCKED hasta que el autor resuelva o confirme los cambios concurrentes, el árbol quede limpio y se ejecuten build, `npm test` y `node tests/run-all.mjs` sobre el HEAD entonces certificado. |
| **Limitaciones** | No se ejecutó la regresión completa ni se regeneró evidencia: no puede cerrar PR-018 mientras el requisito explícito de árbol limpio ya falla y una ejecución volvería a producir churn sobre evidencia ajena. |
| **Próxima prioridad** | Resolver el árbol concurrente y repetir la validación de cierre en un árbol limpio; sólo entonces crear `workspace/PRODUCTION_READINESS_DONE`. |

---

## Cycle 21 — Bloqueo de cierre confirmado sin apropiación de cambios

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 3f89f5fa98187fac4211f264cef3634998c88f01 |
| **HEAD final** | Commit documental de cierre de Cycle 21. |
| **Task** | PR-018 — validación final y creación de `PRODUCTION_READINESS_DONE`. |
| **Hypothesis** | Si el árbol de trabajo ya fuese limpio tras la última validación verde, el marcador de transición podría crearse sin ocultar trabajo ajeno. |
| **Change** | Se volvió a inspeccionar el árbol y se registró de forma precisa el impedimento persistente; no se alteraron las evidencias ni la cola de Evolución Continua que pertenecen a otro trabajo. |
| **Hallazgos** | Siguen presentes 24 ficheros modificados de evidencia (incluido un diff voluminoso en la prueba negativa de red), una entrada nueva en `workspace/CONTINUOUS-EVOLUTION-QUEUE.md` y `workspace/AUTONOMOUS_MODE` no versionado. El gate relacionado de despliegue pasa 7/7. |
| **Bugs encontrados** | Ninguna regresión funcional reproducida. El requisito de `git status` limpio sigue sin cumplirse, por lo que crear el marcador DONE sería una certificación incorrecta. |
| **Bugs corregidos** | Se consolidó la causa exacta de bloqueo de PR-018, preservando los cambios preexistentes y evitando churn de evidencia. |
| **Tests ejecutados** | `node tests/deployment-guide-audit.mjs`. |
| **Tests PASS** | Deployment Guide 7/7 PASS. |
| **Tests FAIL** | 0. |
| **Commits** | Commit documental de cierre de Cycle 21. |
| **Bloqueos** | PR-018 continúa BLOCKED hasta que su autor confirme o resuelva los cambios preexistentes y el árbol quede limpio. No se crea `PRODUCTION_READINESS_DONE`. |
| **Limitaciones** | No se repitió la regresión completa: ya fue verde (42/42) en Cycle 20 y ningún archivo de producto cambió; el impedimento es exclusivamente la limpieza del árbol. |
| **Próxima prioridad** | Resolver el árbol de trabajo ajeno; con estado limpio, repetir la comprobación final de PR-018 y crear el marcador únicamente si todos los criterios siguen satisfechos. |

---

## Cycle 20 — Validación final bloqueada por árbol ajeno

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 7948dc6f8b09fbb2abe14411a9623698c4c18cfb |
| **HEAD final** | Ver commit documental de cierre de Cycle 20. |
| **Task** | PR-018 — validación final y creación de `PRODUCTION_READINESS_DONE`. |
| **Hypothesis** | Con todas las tareas de la cola cerradas, una pasada completa verde y un árbol limpio permitirían cerrar Production Readiness sin degradar criterios. |
| **Change** | Se añadió PR-018 como bloqueo explícito de cierre: el requisito de árbol limpio no se puede certificar sin apropiarse de cambios preexistentes de otro trabajo. |
| **Hallazgos** | `npm run build`, `npm test` y `node tests/run-all.mjs` finalizaron verdes; la regresión integral completó 42/42 suites. Antes de la validación ya había modificaciones sin confirmar en `RUN-OPENCODE-AUTONOMOUS.ps1`, la cola CE, 24 evidencias y el archivo no versionado `workspace/AUTONOMOUS_MODE`. |
| **Bugs encontrados** | Ninguna regresión funcional reproducible. El impedimento es de integridad del cierre: el criterio exige `git status` limpio y no es seguro sobrescribir, descartar o commitear cambios ajenos. |
| **Bugs corregidos** | Se documentó el bloqueo de forma rastreable en vez de declarar DONE con un árbol sucio. |
| **Tests ejecutados** | `npm run build`; `npm test`; `node tests/run-all.mjs`. |
| **Tests PASS** | Build 179 páginas; `npm test` PASS; `run-all` 42/42 suites, 0 fallos. |
| **Tests FAIL** | 0. |
| **Commits** | Ver commit documental de cierre de Cycle 20. |
| **Bloqueos** | PR-018 BLOCKED hasta que los cambios ajenos preexistentes se confirmen o se resuelvan por su autor y `git status` esté limpio. No se crea `PRODUCTION_READINESS_DONE` en este ciclo. |
| **Limitaciones** | No se modificaron ni se incluyeron los archivos ajenos; las evidencias regeneradas por la regresión quedan fuera de este commit para evitar churn. |
| **Próxima prioridad** | Resolver el árbol de trabajo ajeno y repetir sólo la comprobación de estado limpia antes de crear el marcador DONE. |

---

## Cycle 19 — Guía de despliegue estático reproducible

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 7629db8289763067eed99ca4c55e463d721863fd |
| **HEAD final** | Ver commit de cierre de Cycle 19. |
| **Task** | PR-017 — documentar despliegue estático/GitHub Pages reproducible, sin CI automático. |
| **Hypothesis** | Una guía versionada y un gate pequeño evitan publicar el árbol fuente o un build no validado y hacen reproducible la salida estática de Toolisto. |
| **Change** | Añadidos `DEPLOYMENT.md`, un enlace desde el README y `tests/deployment-guide-audit.mjs`, integrado en `run-all`. La guía exige `npm ci`, build, auditoría y regresión; delimita `dist/` como único contenido publicable, explica GitHub Pages manual y sus límites de cabeceras. La evidencia determinista queda en `TLT-deployment-guide-evidence.json`. |
| **Hallazgos** | Antes del build, `verify-workspace-sync` detectó cuatro documentos de control de evolución recién presentes en `workspace/` que aún no estaban en `dist/`; `npm run build` los sincronizó y el verificador pasó. El build sigue generando 179 páginas. |
| **Bugs encontrados** | La pasada integral falló únicamente `Responsive Matrix` dentro de `run-all` (41/42) sin detalle de fallo en el runner; su ejecución enfocada inmediata fue 4.198/4.198 PASS. Es la señal de visibilidad preexistente, no causada por documentación. |
| **Bugs corregidos** | Se cierra la ausencia de una guía de despliegue verificable y se protege su contenido operativo mediante regresión. |
| **Tests ejecutados** | `node scripts/verify-workspace-sync.mjs` (reproducción inicial); `node tests/deployment-guide-audit.mjs`; `npm run build`; `node scripts/verify-workspace-sync.mjs`; `npm test`; `node tests/run-all.mjs`; `node tests/responsive-matrix.mjs`. |
| **Tests PASS** | Deployment Guide 7/7; build 179 páginas; sync OK; `npm test` PASS; Responsive Matrix enfocada 4.198/4.198. |
| **Tests FAIL** | `run-all`: 41/42; Responsive Matrix falló en secuencia, mientras el gate enfocada posterior pasó. |
| **Commits** | Ver commit de cierre de Cycle 19. |
| **Bloqueos** | PR-017 cerrado. No se crea `PRODUCTION_READINESS_DONE`: la regresión integral de este ciclo no fue verde y el árbol contiene cambios ajenos/no confirmados. |
| **Limitaciones** | GitHub Pages no aplica `/_headers`; para cabeceras de endurecimiento se requiere un host compatible o configuración externa. La publicación manual de Pages exige preparar una rama cuyo contenido sea `dist/`, operación que esta guía no automatiza. |
| **Próxima prioridad** | Reproducir y diagnosticar la señal flake de Responsive Matrix antes de cualquier cierre final de Production Readiness. |

---

## Cycle 18 — Cierre verificable de privacidad pública

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 4574a3ed64fd0f6303c9c10ea19a857f25627d78 |
| **HEAD final** | Ver commit de cierre de Cycle 18. |
| **Task** | PR-009 — cierre de prueba negativa de red del sitio público. |
| **Hypothesis** | Con la regresión integral verde de Cycle 17, una nueva certificación sobre `dist/` recién construido debía confirmar que el sitio público mantiene el contenido del usuario en local y permitir el cierre de la tarea. |
| **Change** | Se renovó la evidencia de cierre `TLT-production-readiness-cycle-18-evidence.json` y se cerró PR-009 en la cola; no fue necesario cambiar código de producto porque el gate existente ya cubre las rutas, el flujo privado real y los controles positivos de red. |
| **Hallazgos** | Las 167 herramientas cargaron sin egress externo; Base64 procesó localmente el marcador secreto, que no apareció en URL, body ni headers. Los controles `fetch`, `sendBeacon`, imagen y WebSocket fueron detectados/bloqueados, por lo que la aserción negativa no es vacía. |
| **Bugs encontrados** | Ninguno en el HEAD certificado. |
| **Bugs corregidos** | No aplica: la implementación y el gate de privacidad permanecen correctos; este ciclo cierra la tarea antes bloqueada tras regresión integral verde. |
| **Tests ejecutados** | `npm run build`; `node tests/public-site-network-negative.mjs`; `npm test`; `node tests/run-all.mjs`. |
| **Tests PASS** | Build 179 páginas; privacidad 343/343; `npm test` PASS; `run-all` 41/41 suites, 0 fallos. |
| **Tests FAIL** | 0. |
| **Commits** | Ver commit de cierre de Cycle 18. |
| **Bloqueos** | PR-009 cerrado. No quedan P2 pendientes; PR-017 (P3) es la siguiente tarea ejecutable. |
| **Limitaciones** | El gate cubre el shell de 167 rutas y un flujo Base64 representativo con secreto; la cobertura de procesamiento especializado permanece en los gates de familia. |
| **Próxima prioridad** | PR-017 — documentar despliegue estático/GitHub Pages reproducible, sin CI automático. |

---

## Cycle 17 — Higiene de estructura de raíz

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 285d609e7ab08f1e679ac6248e991615bfaaa44a |
| **HEAD final** | Ver commit de cierre de Cycle 17. |
| **Task** | PR-016 — auditar `work/` vacío y residuos de raíz. |
| **Hypothesis** | El residuo `work/` no es parte de la arquitectura publicada ni del flujo de desarrollo; una auditoría versionada puede eliminarlo y evitar su reintroducción sin restringir `dist/` o `node_modules` generados localmente. |
| **Change** | Se eliminó el directorio vacío `work/`, se añadió `tests/root-structure-audit.mjs` y se integró al runner. El gate certifica la ausencia física/versionada de `work/`, el inventario de directorios versionados permitido y que dependencias/build/fixtures temporales no entren al repositorio. |
| **Hallazgos** | `work/` existía vacío y no tenía archivos versionados. Los únicos directorios versionados de raíz son los diez aprobados; `node_modules` y `dist` se generan e ignoran correctamente. La regresión completa posterior fue verde, eliminando el bloqueo de PR-009. |
| **Bugs encontrados** | El primer gate reprodujo el residuo: 8/9 por la presencia de `work/` vacío. |
| **Bugs corregidos** | Se eliminó el directorio vacío y el gate pasó 9/9; el control queda integrado para que un residuo equivalente falle antes de ser certificado. |
| **Tests ejecutados** | `node tests/root-structure-audit.mjs` (antes y después de la corrección); `node tests/dead-code-audit.mjs`; `npm run build`; `npm test`; `node tests/run-all.mjs`. |
| **Tests PASS** | Root Structure 9/9; Dead Code 15/15; build 179 páginas; `npm test` PASS; `run-all` 41/41 suites, 0 fallos. |
| **Tests FAIL** | Primera reproducción Root Structure 8/9 por `work/` vacío; corregida. Validación final: 0. |
| **Commits** | Ver commit de cierre de Cycle 17. |
| **Bloqueos** | PR-016 cerrado. PR-009 pasa de BLOCKED a TODO: la condición de regresión integral verde ya se cumplió y debe cerrarse en su propio ciclo con el gate de privacidad. |
| **Limitaciones** | El auditor no impide directorios ignorados necesarios en ejecución local (`node_modules`, `dist`); protege el árbol versionado y la ausencia de residuos transitorios conocidos. |
| **Próxima prioridad** | PR-009 — cerrar la prueba negativa de red del sitio público con su gate enfocado sobre el HEAD actual. |

---

## Cycle 16 — Cierre de privacidad pública bloqueado por regresión

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 729c59f7673385028213013b742857c37f06c47c |
| **HEAD final** | Ver commit de cierre de Cycle 16. |
| **Task** | PR-009 — cierre de prueba negativa de red del sitio público. |
| **Hypothesis** | Tras PR-015, la regresión integral completa debía confirmar el gate de privacidad ya verde y permitir cerrar PR-009. |
| **Change** | Se ejecutó de nuevo la certificación sobre `dist/` recién construido y se añadió la evidencia reproducible del intento de cierre. No se modificó código de producto: no se reprodujo una causa determinista que justificara un cambio. |
| **Hallazgos** | El gate de privacidad mantiene 343/343: las 167 rutas no emitieron egress externo, el flujo Base64 procesó el secreto localmente y los cuatro controles positivos fueron interceptados. La pasada integral alcanzó 39/40 suites; la única roja fue Responsive Matrix. Su ejecución enfocada posterior fue 4.198/4.198. `Docs Extras` también falló una vez dentro de la primera pasada larga por un selector ausente y pasó 41/41 al reproducirse aislada. |
| **Bugs encontrados** | Persistió inestabilidad no determinista bajo la secuencia integral: Responsive Matrix falló pese a que su reproducción inmediata pasó. No se observó fallo funcional reproducible ni regresión de privacidad. |
| **Bugs corregidos** | No aplica: modificar código sin causa reproducible ocultaría la inestabilidad y contravendría los criterios de producción. |
| **Tests ejecutados** | `npm run build`; `node tests/public-site-network-negative.mjs`; `npm test`; `node tests/run-all.mjs`; `node tests/responsive-matrix.mjs`; `node tests/gate-e2e-docs-extras.mjs`. |
| **Tests PASS** | Build 179 páginas; privacidad 343/343; `npm test` PASS; Responsive 4.198/4.198 enfocado; Docs Extras 41/41 enfocado. |
| **Tests FAIL** | `run-all`: 39/40; Responsive Matrix falló. La pasada no se acepta como regresión integral verde. |
| **Commits** | Ver commit documental de cierre de Cycle 16. |
| **Bloqueos** | PR-009 queda BLOCKED hasta obtener `node tests/run-all.mjs` verde completo sin reducir criterios ni añadir reintentos. |
| **Limitaciones** | La evidencia de privacidad es válida, pero no sustituye la regresión integral requerida para declarar la tarea DONE. El fallo aislado de Docs Extras quedó verde al repetirlo, pero se registra para investigar si reaparece. |
| **Próxima prioridad** | PR-016 — auditar `work/` vacío y residuos de raíz; PR-009 debe volver a TODO al disponer de una regresión integral verde reproducible. |

---

## Cycle 15 — Estabilización de inicializadores PDF

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 320ab1c65e6f290b8c75959698e6dd0e2ba471e2 |
| **HEAD final** | Ver commit de cierre de Cycle 15. |
| **Task** | PR-015 — resolver el flake de navegación/carga PDF. |
| **Hypothesis** | Los errores efímeros no eran una condición de red: los inicializadores de controles PDF se ejecutaban sin archivo ni motor diferido y lanzaban `ensurePdfLib` durante la navegación acelerada. |
| **Change** | Los 18 inicializadores que inspeccionan PDFs ahora se ejecutan sólo tras seleccionar un archivo. `chooseTool` resuelve de forma local PDFLib/pdf.js/JSZip antes de reentrar en esos inicializadores. Se amplió el gate lazy a seis páginas PDF, se enriqueció el diagnóstico responsive y el harness PDF carga explícitamente sus bibliotecas de inspección. |
| **Hallazgos** | La matriz reprodujo 4.194/4.198 con stack a `initInsertBlankPagesPdf`/`initCompressPdf`: el panel estaba oculto, pero `renderAdvancedControls` aún iniciaba su lógica. El harness PDF histórico conservaba una dependencia implícita de globals pese al lazy-load; se corrigió sólo en el entorno de prueba. |
| **Bugs encontrados** | Inicializadores PDF sin archivo lanzaban `No se pudo cargar el componente PDF` al abrir páginas; el gate PDF Family no cargaba de forma explícita PDFLib/pdf.js para inspeccionar resultados. Durante la corrección se detectó y reparó un primer error de scope de `hasFiles` antes de la validación final. |
| **Bugs corregidos** | Navegación de 167 herramientas sin errores PDF y carga pesada diferida hasta seleccionar archivo; los procesadores PDF y su inspección funcional siguen operativos. |
| **Tests ejecutados** | `npm run build`; `lazy-dependencies`; `gate-e2e-pdf-misc-tools`; `verify-pdf-family`; `production-tool-coverage`; `responsive-matrix`; `npm test`; `run-all`; accesibilidad, red negativa y seguridad públicas. |
| **Tests PASS** | Build 179 páginas; Lazy 10/10; PDF Misc 62/62; PDF Family 95/95; Coverage 26/26 (167/167); Responsive 4.198/4.198; `npm test` PASS; accesibilidad 1.348/1.348; red 343/343; seguridad 7/7. |
| **Tests FAIL** | Primera ejecución de PDF Family falló por globals de inspección implícitos, corregido. Un `run-all` posterior superó su ventana externa de 20 min tras mostrar Responsive PASS; no se declara regresión integral verde en este ciclo. |
| **Commits** | Ver commit de cierre de Cycle 15. |
| **Bloqueos** | PR-009 queda ejecutable y requiere el cierre de regresión integral verde. |
| **Limitaciones** | El gate responsive conserva diagnóstico de origen/stack para futuros errores. La carga de motores en PDF Family es exclusiva del inspector E2E; la aplicación sigue sin cargar motores pesados al abrir una página. |
| **Próxima prioridad** | PR-009 — cierre de privacidad pública con regresión integral verde. |

---

## Cycle 14 — Frontera OCR-PDF pública y Workspace

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 69861e62e7c53e529f47d6809c21ebd5fcf3e8bb |
| **HEAD final** | Ver commit de cierre de Cycle 14. |
| **Task** | PR-014 — unificar o documentar `js/ocr/pdf-ocr-engine.js`. |
| **Hypothesis** | El Workspace ES y las 167 rutas públicas clásicas pueden mantener una frontera explícita sin duplicar workers dentro del flujo OCR-PDF público. |
| **Change** | Se documentó la frontera: `workspace/core/ocr-engine.js` sigue aislado como módulo ES y `js/ocr/pdf-ocr-engine.js` es el adaptador clásico público. `extractTextFromScannedPdf` dejó de cargar/reconocer con un worker propio y ahora delega en `PdfOcrEngine.ocrCanvas`. Se añadió `tests/pdf-ocr-architecture.mjs` (6/6) al runner. |
| **Hallazgos** | Importar el módulo del Workspace desde las páginas públicas exigiría cargar su bundle en 167 rutas, por lo que no es una unificación segura. La duplicación corregible estaba dentro del sitio público: `extractTextFromScannedPdf` evitaba el adaptador y creaba un worker paralelo. |
| **Bugs encontrados** | La extracción OCR de PDF cargaba directamente `EngineLoader` y llamaba `worker.recognize`, divergente del contrato de normalización y errores de `PdfOcrEngine.ocrCanvas`. |
| **Bugs corregidos** | El flujo usa un único punto OCR-PDF público con idioma, progreso, normalización y manejo de error consistentes; el E2E verificó TXT OCR real y cero errores de consola. |
| **Tests ejecutados** | `npm run build`; `node tests/pdf-ocr-architecture.mjs`; `node tests/gate-e2e-ocr-pdf-tools.mjs`; `npm test`; `node tests/run-all.mjs`. |
| **Tests PASS** | Build 179 páginas; arquitectura 6/6; OCR-PDF 34/34; `npm test` PASS; en `run-all`, 39/40 suites, incluidos arquitectura y OCR-PDF. |
| **Tests FAIL** | `run-all`: Responsive Matrix 4.195/4.198 por tres cargas locales PDF efímeras (`intercalar-pdf` y `agregar-marca-de-agua-pdf` a 1024, `insertar-paginas-en-blanco-pdf` a 1440), preexistente y asignado a PR-015. |
| **Commits** | Ver commit de cierre de Cycle 14. |
| **Bloqueos** | Ninguno para PR-014. PR-015 continúa como requisito para regresión integral verde y para desbloquear PR-009. |
| **Limitaciones** | No se fusionan los dos módulos porque sus formatos de carga son deliberadamente distintos; el gate impide que el flujo PDF público vuelva a crear un worker paralelo. |
| **Próxima prioridad** | PR-015 — resolver definitivamente el flake de navegación/carga PDF. |

---

## Cycle 13 — PWA offline local

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | cd082c8c587d8de443c2a1be647f6f5e00354e4a |
| **HEAD final** | Ver commit de cierre de Cycle 13. |
| **Task** | PR-013 — manifest + service worker local para experiencia offline. |
| **Hypothesis** | Un manifest relativo y un service worker limitado al mismo origen permiten instalar Toolisto y abrir sin red una herramienta visitada, sin almacenar ni transmitir contenido de usuario. |
| **Change** | Se completó el manifest con `start_url` y `scope` relativos; se añadieron `service-worker.js` y `js/pwa-register.js`, el generador los publica y todas las páginas los declaran. El worker precachea el shell local y guarda sólo respuestas GET exitosas del mismo origen. Se añadió `tests/pwa-offline.mjs` al runner principal. |
| **Hallazgos** | El manifest e iconos ya existían en portada, pero faltaban scope/start URL, registro y worker; las 183 páginas indexables más 404 se generan desde cinco plantillas, por lo que el registro debía inyectarse también en cada plantilla. |
| **Bugs encontrados** | La primera validación de build detectó que el worker de raíz no se copiaba a `dist/`; se corrigió explícitamente en el generador. |
| **Bugs corregidos** | La distribución ahora contiene el worker en su scope de raíz, el registro compartido y manifest consistente. Una herramienta cargada con red vuelve a abrir offline bajo control del worker, sin errores de consola. |
| **Tests ejecutados** | `npm run build` (primera ejecución reprodujo el fichero omitido, segunda final); `node tests/pwa-offline.mjs`; `npm test`; `node tests/seo-production-audit.mjs`; `node tests/run-all.mjs`. |
| **Tests PASS** | Build final 179 páginas; PWA Offline 14/14 (184 HTML); `npm test` PASS; SEO Production 2.753/2.753; en `run-all`, 38/39 suites PASS, incluido PWA. |
| **Tests FAIL** | `run-all`: Responsive Matrix 4.191/4.198 por 7 errores efímeros de carga local del componente PDF en navegación acelerada. Es la regresión preexistente asignada a PR-015; los gates PDF funcionales y el PWA nuevo pasaron. |
| **Commits** | Ver commit de cierre de Cycle 13. |
| **Bloqueos** | Ninguno para PR-013. La regresión integral queda bloqueada por PR-015; PR-009 continúa BLOCKED hasta que quede verde. |
| **Limitaciones** | El worker no precachea motores pesados ni todas las herramientas: mantiene carga inicial ligera y cachea una herramienta tras visitarla. Sólo trata GET del mismo origen; no procesa, persiste ni egresa archivos del usuario. |
| **Próxima prioridad** | PR-014 — unificar o documentar `js/ocr/pdf-ocr-engine.js`; PR-015 permanece necesaria para cerrar la regresión. |

---

## Cycle 12 — Auditoría SEO de producción

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | c235af9d54c7e882600dc39a434e073ea27b395e |
| **HEAD final** | Ver commit de cierre de Cycle 12. |
| **Task** | PR-012 — verificar y cerrar SEO en 167 páginas. |
| **Hypothesis** | Un gate de producción que derive el inventario indexable desde el catálogo y valide cada URL publicada evita divergencias entre sitemap, canonical, robots y metadatos sociales que los tests de presencia no detectan. |
| **Change** | Añadido `tests/seo-production-audit.mjs` al runner principal. Certifica las 183 URLs indexables (inicio, 167 herramientas, 12 categorías y 3 legales), sitemap/robots, canonicals, rangos de title/description, OpenGraph y Twitter. Corregidos el canonical y `og:url` de la portada para usar la URL raíz del sitemap, y las descripciones legales ahora tienen longitud útil y coinciden con OpenGraph/Twitter. |
| **Hallazgos** | El auditor previo (1.940 checks) validaba herramientas y categorías, pero no contrastaba la portada ni las páginas legales contra el sitemap ni exigía coherencia completa de redes sociales. La portada declaraba `index.html` mientras el sitemap publicaba `/`, creando dos URLs canónicas para el mismo recurso. |
| **Bugs encontrados** | Canonical y `og:url` de inicio desalineados con la URL raíz indexable; descripciones de Privacidad y Condiciones demasiado breves para el umbral editorial de producción. |
| **Bugs corregidos** | La portada canonicaliza a `/`; metadatos sociales usan la misma URL. Las dos páginas legales generan descripciones específicas de 50–160 caracteres y sus equivalentes OG/Twitter. |
| **Tests ejecutados** | `npm run build`; `node tests/seo-production-audit.mjs`; `node tests/seo-functional-test.js`; `node scripts/seo-audit.mjs`; `npm test`; `node tests/run-all.mjs`. |
| **Tests PASS** | Build 179 páginas; SEO Production 2.753/2.753 (183 URLs, 167 herramientas); SEO funcional PASS; SEO histórico 1.940/1.940; `npm test` PASS; regresión completa 38/38 suites, 0 fallos. |
| **Tests FAIL** | Primera ejecución del gate nuevo: 2 fallos que reprodujeron la divergencia canonical/`og:url` de la portada; corregidos. Validación final: 0. |
| **Commits** | Ver commit de cierre de Cycle 12. |
| **Bloqueos** | Ninguno para PR-012. PR-009 sigue BLOCKED hasta cerrar PR-015 según la cola, aunque esta regresión no reprodujo el flake PDF. |
| **Limitaciones** | El gate valida HTML estático generado y la configuración de indexación; no sustituye la inspección de indexación remota de motores de búsqueda tras un despliegue. |
| **Próxima prioridad** | PR-013 — manifest + service worker local para experiencia offline. |

---

## Cycle 11 — Auditoría y limpieza de código muerto

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | e92829ecd5a8d5c508af1756a310ce190e8b6652 |
| **HEAD final** | Ver commit de cierre de Cycle 11. |
| **Task** | PR-011 — auditoría de código muerto. |
| **Hypothesis** | Eliminar módulos globales y helpers sin consumidores reduce carga y superficie de mantenimiento sin alterar los procesadores registrados ni los flujos de exportación alcanzables. |
| **Change** | Eliminados los módulos huérfanos `local-encryption` y `apa7-formatter` de fuente y del shell de 167 páginas; ambos duplicaban procesadores reales. Eliminados 11 helpers privados sin referencias en procesadores, modos y scripts. Añadido `tests/dead-code-audit.mjs` al runner (15/15) y actualizada la regresión histórica Batch 5 para el catálogo actual. |
| **Hallazgos** | Los 157 `toolId` únicos tienen procesador registrado o handler builtin; los helpers globales `PDFEncryptor`, `PdfOcrEngine`, `PdfCensorEngine`, `PhotoLocation`, `BrailleES` y `ExpressionParser` sí tienen consumidores. No se hallaron ramas de descarga/exportación inalcanzables. `apa7-formatter` además conservaba Times New Roman, prohibida por las reglas, aunque el flujo real APA usa el procesador propio. |
| **Bugs encontrados** | Dos módulos de 167 cargas públicas no tenían consumidor y duplicaban implementación. La suite histórica Batch 5 aún esperaba cinco herramientas en revisión y dos calculadoras exclusivas de categoría, contradiciendo el catálogo certificado de 167 habilitadas. |
| **Bugs corregidos** | Se suprimió la carga/código huérfano y se reparó Batch 5 para afirmar el estado actual verificable (148/148), sin rebajar criterios funcionales. |
| **Tests ejecutados** | `npm run build`; `node tests/dead-code-audit.mjs`; `node tests/batch5-functional-test.js`; `node scripts/seo-audit.mjs`; gates QR, Calc, File Family Extra y Docs Extras; `npm test`; `node tests/run-all.mjs`. |
| **Tests PASS** | Build 179 páginas; dead-code 15/15; Batch 5 148/148; SEO 1.940/1.940; QR 43/43; Calc 22/22; File Family Extra 76/76; Docs Extras 41/41; `npm test` PASS; `run-all` 36/37 suites PASS. |
| **Tests FAIL** | `run-all`: Responsive Matrix volvió a fallar por el flake PDF local preexistente de PR-015; no fue causado por la limpieza y todos los gates relacionados pasaron. |
| **Commits** | Ver commit de cierre de Cycle 11. |
| **Bloqueos** | Ninguno para PR-011. La regresión completa sigue bloqueada por PR-015; PR-009 permanece BLOCKED hasta su resolución. |
| **Limitaciones** | El auditor ratchetea los hallazgos eliminados; las APIs cargadas de forma dinámica o usadas globalmente se validan por sus consumidores y gates existentes para no introducir falsos positivos. |
| **Próxima prioridad** | PR-012 — auditoría SEO de las 167 páginas; PR-015 continúa como requisito para cerrar la regresión y PR-009. |

---

## Cycle 10 — Sanitización y export/import del sitio público

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 8da2e40ee8c423a7629d83525e071c10e86e0ecd |
| **HEAD final** | Ver commit de cierre de Cycle 10. |
| **Task** | PR-010 — auditoría de sanitización y export/import del sitio público. |
| **Hypothesis** | Un único sanitizador estricto en el sink de resúmenes, acompañado de un gate de navegador con payload hostil, impide que resultados o nombres de archivo no confiables se conviertan en HTML ejecutable sin degradar las salidas locales. |
| **Change** | Añadidos `sanitizeSummaryHtml` y `window.ToolistoSecurity` para el gate; `presentSummaryResult` sólo admite estructura mínima y PNG data-URI local, eliminando handlers, URLs peligrosas y nodos activos. Se escaparon interpolaciones de búsqueda, progreso y detección de formato. Añadido `tests/public-site-security-audit.mjs` al runner: valida nombre hostil real, resumen hostil, dependencias, ausencia de claves y consola. |
| **Hallazgos** | El resumen genérico aceptaba `result.html` directamente aunque hoy sólo lo producen dos flujos propios; era una frontera insegura ante futuras extensiones. Las exportaciones Blob locales (incluida metadata JSON) y la importación/round-trip de archivos ya están cubiertas funcionalmente por File Family Extra. `package.json` no declara dependencias de producción y sus cinco dependencias de desarrollo están justificadas para motores locales/E2E; no se hallaron claves de proveedor en código propio. |
| **Bugs encontrados** | Sink de vista previa de resumen sin sanitización; interpolaciones de metadatos de formato y superficies de búsqueda/progreso no tenían escape defensivo homogéneo. |
| **Bugs corregidos** | El HTML hostil ya no llega al DOM activo; nombres hostiles se siguen presentando como texto. Se conservan las miniaturas PNG data-URI generadas localmente y se rechaza cualquier otro `src` de resumen. |
| **Tests ejecutados** | `npm run build`; `node tests/public-site-security-audit.mjs`; `node tests/public-site-network-negative.mjs`; `node tests/gate-e2e-file-family-tools.mjs`; `node tests/gate-e2e-image-tools.mjs`; `npm test`; `node tests/run-all.mjs`. |
| **Tests PASS** | Build 179 páginas; seguridad pública 7/7; privacidad pública 343/343; File Family Extra 76/76 (import/export y round-trip real); Image Interactive 21/21; `npm test` PASS; `run-all` 35/36 suites PASS, incluyendo el gate nuevo. |
| **Tests FAIL** | `run-all`: Responsive Matrix 4.196/4.198 por dos cargas PDF locales efímeras (`encabezado-pie-pdf` 1024 y `editar-metadatos-pdf` 1440). Es el flake repetido de PR-015, ajeno al cambio de seguridad. |
| **Commits** | Ver commit de cierre de Cycle 10. |
| **Bloqueos** | Ninguno para PR-010. La regresión completa no queda verde hasta resolver PR-015; PR-009 continúa BLOCKED por la misma causa. |
| **Limitaciones** | El sanitizador de resúmenes conserva sólo la estructura necesaria para las dos vistas existentes y PNG data-URI local; no es un sanitizador HTML enriquecido ni habilita contenido HTML de usuario. |
| **Próxima prioridad** | PR-011 — auditoría de código muerto; PR-015 sigue siendo requisito para cerrar la regresión y PR-009. |

---

## Cycle 9 — Prueba negativa de red del sitio público

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 2b9643569cc49b296c2a030dbbaab1506ada6faf |
| **HEAD final** | Ver commit documental de Cycle 9. |
| **Task** | PR-009 — prueba negativa de red para el sitio público. |
| **Hypothesis** | Un gate de navegador que recorra el catálogo real, procese un archivo con un marcador secreto y bloquee todos los canales externos protege la promesa local-first contra regresiones que los gates de familia no alcancen. |
| **Change** | Añadido `tests/public-site-network-negative.mjs` e integrado en `tests/run-all.mjs`. Sirve `dist/` real, recorre 167 herramientas, bloquea todo egress ajeno al origen local, procesa un TXT con marcador secreto mediante Base64 y comprueba URL/body/headers. Incluye control positivo de `fetch`, `sendBeacon`, imagen y WebSocket; además audita las primitivas de red del runtime público propio. |
| **Hallazgos** | El sitio público no emitió egress inesperado y el marcador no salió por ningún request real; los cuatro controles positivos fueron detectados/bloqueados. La primera versión contó correctamente los errores `ERR_BLOCKED_BY_CLIENT` del control positivo como consola de aplicación: se aisló esa fase deliberada para no producir falso negativo. |
| **Bugs encontrados** | La regresión completa y dos ejecuciones enfocadas de la matriz responsive reprodujeron una carga PDF local efímera en rutas distintas (`editar-metadatos-pdf` móvil 390 y `agregar-marca-de-agua-pdf` 1024), 4.197/4.198. Es el flake preexistente ya asignado a PR-015, no causado por el gate de privacidad. |
| **Bugs corregidos** | Corregido el falso positivo del propio gate: los errores esperados al abortar los probes externos no se mezclan con los errores de consola de la aplicación. |
| **Tests ejecutados** | `npm run build`; `node tests/public-site-network-negative.mjs` (primera pasada 342/343 por falso positivo, corregida); `node tests/public-site-network-negative.mjs` final; `npm test`; `node tests/accessibility-audit.mjs`; `node tests/run-all.mjs`; `node tests/responsive-matrix.mjs`. |
| **Tests PASS** | Build 179 páginas; privacidad pública 343/343 y 167 herramientas; `npm test` PASS; accesibilidad 1.348/1.348; en `run-all`, 34/35 suites PASS. |
| **Tests FAIL** | `run-all`: Responsive Matrix 4.197/4.198 por carga PDF efímera; ejecución enfocada posterior también 4.197/4.198 en otra ruta PDF. No se declara PR-009 DONE. |
| **Commits** | Ver commit documental de Cycle 9. |
| **Bloqueos** | PR-009 queda BLOCKED para cierre por la regresión roja de PR-015; el gate de privacidad y su evidencia son válidos y verdes. |
| **Limitaciones** | El gate cubre el shell y navegación de las 167 rutas más un flujo real representativo con contenido secreto; los gates de familia conservan la cobertura de procesamiento especializada. No confunde los URLs textuales de canonical/JSON-LD ni el enlace voluntario de apoyo con egress automático. |
| **Próxima prioridad** | PR-010 — auditoría de sanitización y export/import del sitio público; PR-015 debe resolver el flake PDF antes del cierre de PR-009. |

---

## Cycle 8 — Accesibilidad del sitio público

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 9eb13e68045018559d97dbab76dd4959a5e5880c |
| **HEAD final** | Ver commit de cierre de Cycle 8. |
| **Task** | PR-008 — auditoría de accesibilidad. |
| **Hypothesis** | La semántica compartida del shell público puede certificarse sobre las 167 herramientas y evitar que páginas generadas omitan un mecanismo de salto, nombres de controles o contraste suficiente. |
| **Change** | Añadido `tests/accessibility-audit.mjs` al runner principal. Recorre las 167 herramientas reales en Chromium, valida idioma, un H1, `alt`, nombres de controles, ARIA del menú, skip-link enfocable, foco por teclado, menú móvil, consola y contraste AA de los tokens claros y oscuros. La portada y el generador ahora incorporan el enlace «Saltar al contenido principal», objetivos `main` enfocables y un nombre accesible para el menú móvil. |
| **Hallazgos** | El Workspace ya tenía skip-link, pero el shell de portada y las 167 páginas generadas no. El menú móvil se anunciaba únicamente mediante SVG y carecía de nombre accesible. La paleta de tokens compartidos supera AA (≥4.5:1) en ambos temas. |
| **Bugs encontrados** | Navegar con teclado no ofrecía salto al contenido en el sitio público y el botón de menú móvil no tenía nombre programático. |
| **Bugs corregidos** | Se añadió skip-link con destino `tabindex="-1"` para transferir foco de forma fiable y `aria-label="Abrir menú de navegación"` al control móvil en portada y páginas generadas. |
| **Tests ejecutados** | `npm run build`; `node tests/accessibility-audit.mjs`; `npm test`; `node tests/responsive-matrix.mjs`; `node tests/run-all.mjs`. |
| **Tests PASS** | Build 179 páginas; accesibilidad 1.348/1.348; `npm test` PASS; matriz responsive 4.198/4.198; regresión completa 34/34 suites, 0 fallos. |
| **Tests FAIL** | 0. |
| **Commits** | Ver commit de cierre de Cycle 8. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El gate verifica el shell público compartido y sus tokens; los componentes especializados del Workspace mantienen sus gates de accesibilidad propios. No se introdujo una dependencia de auditoría externa. |
| **Próxima prioridad** | PR-009 — prueba negativa de red para el sitio público. |

---

## Cycle 7 — Estados de error recuperables del sitio público

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 4b30361aaf5198dcad1f1a57d11420173c0673b0 |
| **HEAD final** | Ver commit de cierre de Cycle 7. |
| **Task** | PR-007 — auditoría de estados de error y feedback. |
| **Hypothesis** | Un error de procesamiento debe permanecer visible junto a la acción y permitir recuperación, en vez de depender de un toast efímero. |
| **Change** | El shell generado de las 167 herramientas incorpora feedback persistente con rol `alert`, mensaje seguro, reintento y copia de detalles técnicos. El motor genérico lo muestra para validaciones, resultados vacíos y excepciones; se limpia al volver a procesar o añadir archivos aceptados. Los botones de detalles ya no dependen de un `onclick` global inexistente y los rechazos gestionados no producen `console.error`. |
| **Hallazgos** | `copyTechnicalDetails` estaba encapsulada en `app.js`, por lo que el `onclick` generado no hacía nada. El ZIP vacío solo dejaba toast temporal aunque los archivos y el botón se recuperaban. |
| **Bugs encontrados** | La copia de detalles técnicos era un no-op silencioso en páginas generadas; los errores gestionados se escribían como error de consola; no había superficie persistente ni acción de recuperación. |
| **Bugs corregidos** | Listener real para cada botón de detalles; bloque recuperable con reintento y restauración de foco; detalles copiados al portapapeles; eliminada la contaminación de consola del catch controlado. |
| **Tests ejecutados** | `npm run build`; `node tests/gate-e2e-file-family-tools.mjs`; data, QR, calculadoras y hojas de cálculo; `node tests/run-all.mjs`. |
| **Tests PASS** | Build 179 páginas; File Family Extra 76/76; Data 58/58; QR 43/43; Calc 22/22; Spreadsheet 197/197; regresión completa 33/33 suites, 0 fallos. |
| **Tests FAIL** | Primera ejecución del gate nuevo: el reintento no devolvía foco tras completar el procesamiento; corregido esperando la promesa antes de enfocar. Validación final: 0. |
| **Commits** | Ver commit de cierre de Cycle 7. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | Los modos especializados mantienen sus propios flujos y toasts; este ciclo refuerza el motor genérico que usan las páginas públicas. Los avisos no bloqueantes permanecen como toast. |
| **Próxima prioridad** | PR-008 — auditoría de accesibilidad. |

---

## Cycle 6 — Matriz responsive pública y Workspace

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | d7398ca554500163c127ed2e440a2f521f69162b |
| **HEAD final** | Ver commit de cierre de Cycle 6. |
| **Task** | PR-006 — auditoría responsive de las 167 páginas y Workspace en cinco viewports. |
| **Hypothesis** | Una certificación de navegador que recorra el catálogo completo evita que una regresión CSS específica de una herramienta pase inadvertida tras cambios compartidos. |
| **Change** | Añadido `tests/responsive-matrix.mjs` e integrado a `tests/run-all.mjs`. Sirve el `dist/` real sin mocks y verifica las 167 herramientas en 320, 390, 768, 1024 y 1440px, más el preview interno de Workspace: HTTP, ausencia de overflow horizontal, encabezado, tamaño mínimo del botón de ejecución, menú móvil y errores de consola. |
| **Hallazgos** | La matriz completa certifica 4.198 comprobaciones: 4.175 de herramientas (5 por URL y viewport) y 23 de Workspace. El CSS existente acomoda correctamente los cinco tamaños; no se detectó corrección de producto necesaria. |
| **Bugs encontrados** | El primer diseño del gate midió la caja de un botón intencionalmente oculto hasta elegir archivo y dio 835 falsos fallos. Se corrigió el gate para validar su `min-height` CSS real. Una primera pasada de regresión completa registró cuatro errores efímeros de carga PDF durante navegación acelerada; dos ejecuciones enfocadas y la regresión completa posterior no los reprodujeron. |
| **Bugs corregidos** | El gate ahora no confunde un control oculto con un objetivo táctil inválido; mantiene el criterio de al menos 40px configurados. |
| **Tests ejecutados** | `npm run build`; `node tests/mobile-responsive-test.js`; `node tests/responsive-matrix.mjs` (dos veces enfocadas); `npm test`; `node tests/run-all.mjs` (dos pasadas). |
| **Tests PASS** | Build 179 páginas; responsive legado 100/100; matriz 4.198/4.198; `npm test` PASS; regresión final `run-all` 33/33 suites, 0 fallos. |
| **Tests FAIL** | Primera ejecución de matriz: 835 falsos fallos del botón oculto (corregidos en el gate). Primera regresión: 32/33 por 4 errores PDF efímeros; regresión final 33/33. |
| **Commits** | Ver commit de cierre de Cycle 6. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La matriz verifica el shell inicial y controles disponibles, no cada modo tras cargar archivos; los gates funcionales existentes mantienen esa cobertura. La señal PDF efímera queda documentada para PR-015 si reaparece. |
| **Próxima prioridad** | PR-007 — auditoría de estados de error y feedback. |

---

## Cycle 5 — Carga diferida de dependencias pesadas

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | f00954869af7b04b7e2d745048e7e74d5a6bfff0 |
| **HEAD final** | Ver commit de cierre de Cycle 5. |
| **Task** | PR-005 — lazy-load de dependencias pesadas. |
| **Change** | Eliminadas las etiquetas estáticas de PDFLib, pdf.js, JSZip, SheetJS y EngineLoader; se cargan por herramienta y los modos especializados comparten el resolvedor. Añadido gate `lazy-dependencies` al runner. Los fixtures E2E cargan explícitamente sus bibliotecas locales de inspección. |
| **Hallazgos** | La carga estática ocultaba dependencias de fixtures y modos. Excel necesita SheetJS al primer archivo; `zipRepair` necesita JSZip para su vista previa; `pdfToImages` necesita sus motores al crear miniaturas tras elegir el PDF. |
| **Bugs encontrados** | El primer `run-all` falló en 6/32 suites: fixtures asumían globales, `splitTxt` omitía JSZip, `zipRepair` no resolvía JSZip antes de su vista previa y `pdfToImages` abortaba su inicializador antes de habilitar el botón. `pdfPageCounter` omitía pdf.js. |
| **Bugs corregidos** | Migrados fixtures a carga explícita local; completados los conjuntos de dependencias y los resolvedores de modos. `pdfToImages` resuelve PDFLib/pdf.js/JSZip tras seleccionar el PDF, antes de pintar miniaturas, manteniendo la carga inicial ligera. |
| **Tests ejecutados** | `npm run build`; gates enfocados lazy, PDF Encrypt, Text, File, Image Converters y Docs Extras; `node tests/run-all.mjs`; `npm test`. |
| **Tests PASS** | Build 179 páginas; lazy 4/4; PDF Encrypt 35/35; Text 56/56; File 35/35; Image Converters 87/87; Docs Extras 41/41; regresión `run-all` 32/32 suites, 0 fallos; `npm test` PASS. |
| **Tests FAIL** | 0 en la validación final. |
| **Commits** | Ver commit de cierre de Cycle 5. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | Los motores se descargan al procesar, salvo `pdfToImages`, que los descarga al elegir el PDF porque sus miniaturas son feedback inmediato. La carga sigue siendo local y no hay descarga pesada inicial en las páginas. |
| **Próxima prioridad** | PR-006 — auditoría responsive de las 167 páginas y workspace en la matriz de 5 viewports. |

---

## Cycle 3 — Cobertura explícita de mejora de documento escaneado

| Field | Value |
|-------|-------|
| **Date** | 2026-08-10 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | ee849a8b59dde95da716b0353d7acc5fe2d1fa99 |
| **HEAD final** | 92fd5aa (implementación y evidencia; el commit documental de cierre sigue) |
| **Task** | PR-004 — Cerrar cobertura explícita de `enhanceScannedDocument`. |
| **Hypothesis** | La herramienta estaba cubierta solo de forma incidental por el harness de familia; una suite nominal integrada al runner debe verificar sus controles, salida, recorte y ausencia de errores de consola. |
| **Change** | Añadido `tests/gate-e2e-enhance-scanned-document.mjs`, integrado en `tests/run-all.mjs`; certifica la salida JPEG real, normalización de calidad porcentual, recorte automático y su desactivación. Corregido el procesador para consumir `enhQuality` de la UI y normalizarlo de forma acotada para `canvas.toBlob`. |
| **Hallazgos** | El harness histórico sí comprobaba un caso básico, pero no era gate propio ni se ejecutaba desde `run-all`. El control UI `enhQuality` (25–100) no coincidía con el campo `quality` que consumía el procesador, por lo que la preferencia de calidad se ignoraba. |
| **Bugs encontrados** | `enhanceScannedDocument` ignoraba `enhQuality` y siempre usaba 0.92 salvo llamadas programáticas con `quality`. |
| **Bugs corregidos** | El procesador acepta `enhQuality`, convierte porcentajes a la escala 0–1 y limita el valor al intervalo que permite la UI. |
| **Tests ejecutados** | `npm run build`; `node tests/gate-e2e-enhance-scanned-document.mjs`; `node tests/production-tool-coverage.mjs`; `node tests/verify-image-family.mjs`; `node tests/run-all.mjs`. |
| **Tests PASS** | Build: 179 páginas; gate nominal: 7/7; cobertura producción: 26/26 y 167/167; familia visual: PASS; `run-all`: 31/31 suites, 0 fallos. |
| **Tests FAIL** | 0 |
| **Commits** | `92fd5aa test(site): certifica mejora de documento escaneado`; commit documental de cierre de Cycle 3 pendiente. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El gate prueba recorte determinista, calidad JPEG, salida y consola; no sustituye las variantes manuales de nitidez, reducción de ruido u orientación. La brecha de cobertura explícita queda cerrada. |
| **Próxima prioridad** | PR-005 — lazy-load de dependencias pesadas en las 167 páginas. |

---

## Cycle 2 — Regresión integral de producción

| Field | Value |
|-------|-------|
| **Date** | 2026-08-10 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 7737a5805a2d7fa836669c202272c55a8e41ecbf |
| **HEAD final** | Ver commit de cierre de Cycle 2 |
| **Task** | PR-003 — Regresión final de la misión |
| **Hypothesis** | La certificación funcional consolidada, el build estático y el auditor de catálogo deben seguir siendo reproducibles desde el HEAD certificado de Cycle 1. |
| **Change** | Ejecutada validación integral; se renovaron las evidencias E2E durante la regresión y se añadió el resumen reproducible del ciclo en `artifacts/deep-audit/toolisto/TLT-production-readiness-cycle-2-evidence.json`. |
| **Hallazgos** | Las 30 suites de `run-all` completaron sin fallos; el gate de cobertura mantiene 167/167 herramientas habilitadas y certificadas; el build de producción generó y validó 179 páginas. |
| **Bugs encontrados** | Ninguno. |
| **Bugs corregidos** | No aplica: la validación no reveló regresiones. |
| **Tests ejecutados** | `npm test`; `node tests/production-tool-coverage.mjs`; `node tests/run-all.mjs`; `npm run build`. |
| **Tests PASS** | `npm test` PASS; cobertura 25/25; `run-all` 30/30 suites, 0 fallos; build PASS (179 páginas). |
| **Tests FAIL** | 0 |
| **Commits** | Ver commit de cierre de Cycle 2 |
| **Bloqueos** | Ninguno para PR-003. |
| **Limitaciones** | PR-003 queda cerrada, pero la misión no está terminada: permanecen tareas P1/P2 ejecutables. La verificación de árbol limpio corresponde al cierre del commit documental de este ciclo. |
| **Próxima prioridad** | PR-004 — cerrar cobertura explícita de `enhanceScannedDocument`. |

---

## Cycle 1 — Cierre verificable de la auditoría funcional pública

| Field | Value |
|-------|-------|
| **Date** | 2026-08-10 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 1394e6e513475fcd6d5095b2e88c7857999c1075 |
| **HEAD final** | Ver commit de cierre de Cycle 1 |
| **Task** | PR-002 — Auditoría funcional real de las 167 herramientas |
| **Hypothesis** | La evidencia de certificación ya cubría el catálogo, pero los esquemas heterogéneos (`tool`/`tools`, `totals`/campos de raíz) impedían verificarlo continuamente y la regresión no lo exigía. |
| **Change** | Añadido `tests/production-tool-coverage.mjs` al runner principal: valida 167/167 habilitadas, evidencia aprobada y cobertura por `toolId`; normalizados los campos de resultado de las evidencias de Docs Extras e Image Converters. |
| **Hallazgos** | Las 21 evidencias de familia cubren los 167 `toolId` del catálogo. La certificación de PDF Encrypt usaba legítimamente `tool` singular y dos suites recientes usaban `totals`; el nuevo auditor reconoce las variantes históricas y exige resultado explícitamente aprobado. |
| **Bugs encontrados** | La cobertura funcional global no estaba protegida por `tests/run-all.mjs`; una herramienta nueva o una evidencia fallida podía dejar la afirmación 167/167 desactualizada. Esquema de evidencia inconsistente en dos gates recientes. |
| **Bugs corregidos** | Se añadió gate de cobertura de producción al runner y se completaron `total`/`passed`/`failed` en Docs Extras e Image Converters, sin alterar los criterios E2E. |
| **Tests ejecutados** | `node tests/gate-e2e-image-tools.mjs` (21/21); `node tests/gate-e2e-docs-extras.mjs` (41/41); `node tests/gate-e2e-image-converters.mjs` (87/87); `node tests/production-tool-coverage.mjs` (25/25); `node tests/run-all.mjs`. |
| **Tests PASS** | Todas las pruebas anteriores PASS; regresión relacionada `run-all`: 30/30 suites, 0 fallos. |
| **Tests FAIL** | 0 |
| **Commits** | Ver commit de cierre de Cycle 1 |
| **Bloqueos** | None |
| **Limitaciones** | El gate de cobertura verifica la trazabilidad catálogo → evidencia E2E/funcional aprobada; no sustituye los gates de navegador que produce cada evidencia. Las evidencias históricas conservan su esquema compatible para no reescribir su procedencia. |
| **Próxima prioridad** | PR-004 — cerrar cobertura explícita de `enhanceScannedDocument`. |

---

## Cycle 0 — Implementación del sistema autónomo (orquestador)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-10 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | fdec01d |
| **HEAD final** | (ver commit de cierre del orquestador) |
| **Task** | Implementar el orquestador autónomo de OpenCode para Toolisto: MISSION/STATUS/QUEUE, runner con lock/STOP/RESUME/STATUS/logs, permisos endurecidos y guía |
| **Change** | Creados `workspace/PRODUCTION-READINESS-MISSION.md`, `workspace/PRODUCTION-READINESS-STATUS.md`, `workspace/PRODUCTION-READINESS-QUEUE.md`, `RUN-OPENCODE-AUTONOMOUS.ps1`, `STOP-OPENCODE-AUTONOMOUS.ps1`, `STATUS-OPENCODE-AUTONOMOUS.ps1`, `workspace/OPENCODE-AUTONOMOUS-GUIDE.md`. Reutilizada y corregida la infraestructura previa (`.opencode/agents/toolisto-autonomous.md`, `.opencode/commands/toolisto-cycle.md`, `opencode.json`) adaptándola de Phase 3C a Production Readiness y corrigiendo el orden de reglas de permisos (última coincidencia gana → deny al final). |
| **Hallazgos** | 1) La infraestructura autónoma previa (Phase 3C) existía y se reutilizó. 2) `opencode.json` tenía reglas de permisos en orden incorrecto: `"*": "allow"` al final anulaba los deny (última coincidencia gana). Corregido poniendo deny después de allow. 3) El sitio no tiene manifest ni service worker (PWA pendiente → PR-013). 4) `work/` raíz vacío. |
| **Bugs corregidos** | Orden de reglas de permisos en `opencode.json` y `.opencode/agents/toolisto-autonomous.md`. |
| **Tests ejecutados** | Sintaxis PowerShell de los 3 scripts; `STATUS-OPENCODE-AUTONOMOUS.ps1`; STOP/RESUME (creación y borrado de `AUTONOMOUS_STOP`); lock (segunda instancia rechazada); detección de DONE; generación de logs con prompt; dry run (prompt construido sin lanzar opencode); comando real `opencode run --agent toolisto-autonomous --title ...` verificado contra CLI 1.18.9. |
| **Tests PASS** | Sintaxis PS 3/3, STATUS OK, STOP OK, RESUME OK, lock OK, dry run OK. |
| **Tests FAIL** | 0 |
| **Commits** | (commit de cierre del orquestador) |
| **Bloqueos** | None |
| **Limitaciones** | El runner lanza una sesión NUEVA de `opencode run` por ciclo (sin `--continue`); la memoria entre ciclos vive en MISSION/STATUS/QUEUE/git/evidencias. El modo `-UseServer`/`opencode serve` queda opcional y sin implementar (no es dependencia). |
| **Próxima prioridad** | PR-002 — Auditoría funcional real de las 167 herramientas. |

---

## Snapshot de referencia (al cierre de Phase 3C / inicio de esta misión)

```
Phase 3B: COMPLETA
Phase 3C: COMPLETA
E2E Star-Flow: 83/83
OCR Source Selection: 34/34
Phase 3A: 45/45 | Phase 3B: 59/59 | Phase 11: 106/106
Workspace structure: 156/156 | Stability E2E: 9/9
Phase 3 integridad: 52/52 | Phase 4a migraciones: 34/34
Phase 4b integridad referencial: 43/43 | Phase 5 bundle trust: 49/49
Phase 6 red negativa: 51/51
Sitio público: 167 herramientas habilitadas, 101 certificadas con harness E2E
Total: 712 pass, 0 fail, 712 tests (workspace) + suites del sitio
```

## Plantilla para ciclos nuevos

```markdown
## Cycle N — Breve descripción

| Field | Value |
|-------|-------|
| **Date** | YYYY-MM-DD |
| **Branch** | |
| **HEAD inicial** | |
| **HEAD final** | |
| **Task** | PR-XXX |
| **Hypothesis** | |
| **Change** | |
| **Hallazgos** | |
| **Bugs encontrados** | |
| **Bugs corregidos** | |
| **Tests ejecutados** | |
| **Tests PASS** | |
| **Tests FAIL** | |
| **Commits** | |
| **Bloqueos** | |
| **Limitaciones** | |
| **Próxima prioridad** | |
```
