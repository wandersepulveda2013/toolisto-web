# CONTINUOUS-EVOLUTION-MISSION.md — Toolisto

> Mision permanente del sistema autonomo de OpenCode sobre Toolisto: **evolucion continua**.
> Fuente de verdad del objetivo cuando el sistema esta en modo CONTINUOUS_EVOLUTION.
> Cualquier sesion nueva de OpenCode debe leerlo y saber que hacer.
> Updated: 2026-08-11
> Branch: feature/workspace-star-flow

## Que es este modo

Production Readiness fue una **etapa**, cerrada cuando se crea `workspace/PRODUCTION_READINESS_DONE`.
Al aparecer esa senal el runner **no se detiene**: transiciona automaticamente a
CONTINUOUS_EVOLUTION y sigue trabajando. El sistema solo se detiene por orden humana
(`AUTONOMOUS_STOP`), por limite de ciclos explicito o por fallo grave de la propia
infraestructura del runner. **Un backlog vacio nunca detiene el sistema.**

## Objetivo

Toolisto es un sitio estatico local-first, gratuito y sin cuentas, con 167 herramientas y un
Workspace, y debe **mejorar cada ciclo** sin regresiones:

- Cada herramienta produce un resultado real, editable, calculable, visual o profesional.
- Promesa del producto: "Convertir cualquier fotografia, archivo o documento desorganizado en
  un resultado editable, calculable, visual y profesional sin salir del proyecto".
- Flujo estrella, mantenido y evolucionado:
  `archivo -> escaneo -> OCR -> documento -> tabla -> grafico -> informe -> PDF`.
- Cero egress del contenido del usuario (local-first hermetico), sin claves, sin pagos.

## Orientacion del esfuerzo por ciclo (meta de distribucion)

| Ambito | % |
|--------|---|
| Implementacion / mejora funcional de producto | 45% |
| Bugs, fiabilidad, seguridad | 25% |
| Rendimiento | 15% |
| UX / movil / accesibilidad | 10% |
| Auditoria, documentacion, evidencia | 5% |

## Pilares de producto

1. **Evolucionar las 167 herramientas**: menos pasos, mejor calidad de salida,
   auto-parametros inteligentes, mejores formatos y vistas previas.
2. **Workspace como centro de poder**: agrega y orquesta las herramientas; los flujos de varios
   pasos se encadenan dentro del proyecto (PDF -> OCR -> texto -> tabla -> Excel;
   imagenes -> mejorar -> comprimir -> convertir -> ZIP).
3. **Defaults inteligentes**: valores iniciales razonables, progreso visible, feedback claro.
4. **Fiabilidad y privacidad primero**: nunca romper el cero-egress; nunca introducir claves.

## Nuevas herramientas: autorizadas pero exigentes

La restriccion de Phase 3C ("no anadir herramientas") **ha terminado**. Anadir una herramienta o
modulo nuevo esta permitido SOLO si responde las cuatro preguntas con SI:

1. Resuelve una necesidad real de un usuario real de Toolisto?
2. Es factible integramente en el navegador y local (sin API key, sin backend)?
3. Es diferenciada respecto a las 167 existentes y a otras candidatas?
4. La implementacion seria real y verificable (no decorativa, no un mock)?

Y cumple los cinco criterios: utilidad, calidad, simplicidad, testabilidad y coherencia con el
producto. Si una candidata falla alguna pregunta, se registra como DEFERRED con causa, no se hace.

## Reglas de ciclo

1. **Resultado minimo por ciclo**: al menos uno de FEATURE, BUG_FIX,
   PERFORMANCE_IMPROVEMENT, UX_IMPROVEMENT, ARCHITECTURE_IMPROVEMENT, SECURITY_FIX,
   MEANINGFUL_TEST_COVERAGE o DOCUMENTED_BLOCKER.
2. **Anti-ciclo-vacio**: un ciclo cuya unica salida es regenerar evidencia o auditoria sin cambio
   es invalido. No regenerar evidencias solo por regenerar.
3. **Politica de evidencia (anti-churn)**:
   - Solo tocar los archivos de evidencia afectados por el cambio del ciclo.
   - Salidas deterministas: sin timestamps absolutos, sin orden no determinista, sin campos de
     tiempo que cambien en cada ejecucion.
   - Si regenerar una evidencia produce contenido identico, NO se commitea.
   - Separar artefactos temporales (logs, ficheros intermedios) de la evidencia permanente.
   - Nunca commitear un diff de +50k/-50k de JSON de evidencia regenerado sin cambio funcional.
4. **Tests con flake**: si una suite falla de forma no determinista, reproducirla enfocada y
   diagnosticar la causa. Intentos razonables (maximo ~3 enfocados). Si sigue sin causa clara:
   marcar la tarea BLOCKED_FLAKY con diagnostico, registrar la suite en el STATUS y seguir con
   otra tarea. No repetir la misma suite durante horas.
5. **Cadencia de regresion completa**: regresion integral tras cambios transversales de
   infraestructura, cada N ciclos, al tocar codigo compartido critico y en hitos. No ejecutar
   `run-all` completo tras cambios aislados de copy.
6. **Discovery**: si la cola queda sin tareas TODO, el ciclo se dedica a discovery: generar
   oportunidades nuevas (P1/P2/P3) y anadirlas como DISCOVERED a la cola. Nunca "no hay nada que
   hacer".
7. **Salud de productividad**: si mas del 50% de los ultimos 10 ciclos fueron AUDIT_ONLY, el
   siguiente ciclo (salvo P0/P1 urgente) DEBE ser una mejora de producto (FEATURE o BUG_FIX).
8. **Anti-bucle de tareas ACTIVE**: si una tarea lleva >= 2 ciclos ACTIVE sin cambio de HEAD y
   conserva exactamente el mismo fallo reproducible, el siguiente ciclo entra en modo RECOVERY de
   esa tarea: cambia de estrategia de diagnostico (prohibido repetir la misma tecnica o el mismo
   analisis que ya fallo), demuestra la causa raiz con evidencia en navegador real cuando
   corresponda, y cierrala o degradala con un plan concreto. Un ciclo NO se considera progreso si
   HEAD no cambio y la tarea ACTIVE mantiene el mismo fallo.
9. **Cambio de tecnica obligatorio**: si una tecnica falla o rechaza permisos en un ciclo, el
   siguiente ciclo usa otra estrategia; no reintentar la misma ruta exacta esperando otro resultado.
10. **Scripts diagnosticos temporales**: crearlos EXCLUSIVAMENTE en `_toolisto_autopilot/tmp/`
    dentro del repositorio. PROHIBIDO usar `%TEMP%`, `AppData\Local\Temp`, directorios externos o
    solicitar `external_directory` para debugging.
11. **PowerShell en Windows**: usar solo comandos disponibles (Get-Content, Select-String,
    Select-Object, Get-ChildItem, Where-Object, Measure-Object). PROHIBIDO `rg`/`head`/`tail`/
    `grep`/`sed`/`awk` y pipes Unix que no existen en PowerShell.

## Estados de cola y prioridades

Estados: `TODO` / `ACTIVE` / `BLOCKED` / `DONE` / `DISCOVERED` / `DEFERRED`.
Prioridades: `P0` > `P1` > `P2` > `P3`.

- P0: seguridad, corrupcion de datos, perdida de trabajo, romper el sitio en produccion.
- P1: bugs importantes y funcionalidades clave de producto.
- P2: funcional, rendimiento y UX.
- P3: refinamiento.
- Si no hay P0/P1 ejecutables, elegir una mejora de producto P2 (no una auditoria mas).
- `BLOCKED_FLAKY` para tareas bloqueadas por tests inestables con diagnostico registrado.

## Cierre de ciclo y metricas

- Terminar la respuesta final del ciclo con una linea `RESULTADO_CICLO: <TIPO>` donde TIPO es uno
  de: FEATURE, BUG_FIX, PERFORMANCE_IMPROVEMENT, UX_IMPROVEMENT, ARCHITECTURE_IMPROVEMENT,
  SECURITY_FIX, MEANINGFUL_TEST_COVERAGE, DOCUMENTED_BLOCKER, AUDIT_ONLY (desaconsejado).
- Actualizar STATUS y QUEUE antes de terminar (registro completo del ciclo).
- Commits pequenos y reales. Revisar `git diff` antes de commitear.
- Evidencia solo cuando aporta a una tarea, guardada en `artifacts/`.

## Limites tecnicos documentados (no reabrir sin informacion nueva)

- OCR del fixture dificil: 76% chars / 43% words crudo con OEM 3; la mejora de preprocesado
  queda como TODO del pipeline OCR (texto efectivo ~8px con ruido determinista).
- `js/ocr/pdf-ocr-engine.js` (PDF searchable publico) conserva su propio adaptador clasico;
  el Workspace usa su modulo ES. Frontera documentada por `tests/pdf-ocr-architecture.mjs`.
- Flake preexistente de visibilidad en `playwright-render.mjs` y `visual-audit-click-nav.mjs`
  (`element is not visible`), verificado ajeno a cambios; gestionado por la regla 4.

## Permisos (inalterables)

Prohibido siempre: `git push`, `git merge`, `git rebase`, `git reset`, `git clean`,
`git branch -D`, `git checkout --`, `rm -rf`, borrados recursivos/forzados, clonar el repo,
modificar el remoto. Permitido: `git status/diff/log/show/add/commit` y ramas de respaldo.
Local-first hermetico: ningun contenido de usuario sale del proyecto.
