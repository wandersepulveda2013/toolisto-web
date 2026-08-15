---
description: Ejecuta UN ciclo autonomo de OpenCode para Toolisto (Evolucion Continua / Production Readiness segun el modo). Lee MISSION/STATUS/QUEUE del modo activo, selecciona la tarea de mayor prioridad, investiga, implementa una mejora real, prueba, corrige, actualiza estado y cola, y hace un commit descriptivo.
agent: toolisto-autonomous
---

# Toolisto Evolucion Continua — Cycle $ARGUMENTS

Ejecuta UN ciclo autonomo completo segun el modo activo (PRODUCTION_READINESS o CONTINUOUS_EVOLUTION).

## Paso 1 — Lee el estado

Determina el modo: si existe `workspace/PRODUCTION_READINESS_DONE` el modo es CONTINUOUS_EVOLUTION.
En modo PR lee `workspace/PRODUCTION-READINESS-{MISSION,STATUS,QUEUE}.md`; en modo CE lee
`workspace/CONTINUOUS-EVOLUTION-{MISSION,STATUS,QUEUE}.md`. Lee tambien `AGENTS.md`.

## Paso 2 — Revisa Git

```
git status
git rev-parse HEAD
git log --oneline -5
```

## Paso 3 — Selecciona la tarea

Elige la tarea `TODO` de mayor prioridad (P0 > P1 > P2 > P3) de la QUEUE del modo activo y
cambiala a `ACTIVE`. No preguntes al usuario que hacer. Si la de mayor prioridad esta `BLOCKED`
o `BLOCKED_FLAKY`, elige la siguiente ejecutable. Si descubres una tarea nueva, anadela como
DISCOVERED. Si no hay TODO, dedica el ciclo a DISCOVERY.

## Paso 4 — Investiga

Antes de editar codigo: lee las fuentes relevantes, busca patrones, entiende la implementacion,
revisa los tests existentes del area y formula una hipotesis verificable.

## Paso 5 — Implementa (mejora real)

Haz el cambio mas pequeno posible que produzca una mejora real: FEATURE, BUG_FIX,
PERFORMANCE_IMPROVEMENT, UX_IMPROVEMENT, ARCHITECTURE_IMPROVEMENT, SECURITY_FIX,
MEANINGFUL_TEST_COVERAGE o DOCUMENTED_BLOCKER. No mezcles cambios no relacionados. Un ciclo
solo-auditoria o solo-regeneracion-de-evidencia es INVALIDO.

## Paso 6 — Prueba

Ejecuta los tests enfocados del area y despues la regresion relacionada (regresion integral solo
si el cambio es transversal, codigo compartido critico o un hito). Si tu cambio rompe algo,
corrigelo antes de continuar.

## Paso 7 — Revisa y commitea

```
git diff --stat
git diff
git status
```

Verifica: solo archivos intencionados, sin secretos, sin codigo de depuracion. No commitees
evidencia regenerada sin cambio funcional (anti-churn). Crea un commit descriptivo y pequeno si
hay cambios validos (`feat:`, `fix:`, `perf:`, `test:`, `chore:`, `docs:`, `refactor:`).
No hagas commits vacios. Nunca hagas push.

## Paso 8 — Actualiza QUEUE y STATUS

- QUEUE: marca la tarea `DONE` (o `BLOCKED`/`BLOCKED_FLAKY` con causa) con su evidencia.
- STATUS: anade el registro del ciclo (fecha, HEAD inicial/final, tareas, hallazgos, bugs
  encontrados/corregidos, tests ejecutados/PASS/FAIL, commits, bloqueos, limitaciones, proxima prioridad).

## Paso 9 — Evidencia

Guarda evidencia SOLO si aporta a la tarea y es determinista (sin timestamps absolutos, sin orden
aleatorio). Si regenerar produce contenido identico, no la commitees.

## Paso 10 — Cierre

- En modo PR: solo si la etapa esta REALMENTE terminada, ejecuta la validacion final completa y
  crea `workspace/PRODUCTION_READINESS_DONE`. Nunca por agotamiento. El runner transiciona solo a CE.
- Cierra tu respuesta final con una linea exacta: `RESULTADO_CICLO: <TIPO>`.
- Resume: tarea, cambios, tests, commit, proxima tarea y bloqueos.
