# AUTONOMOUS-CONTEXT.md — Dispatcher de modo del sistema autonomo

Cargado en cada sesion via `opencode.json`. Determina que archivos leer segun el modo:

- Si existe `workspace/PRODUCTION_READINESS_DONE`, el modo es **CONTINUOUS_EVOLUTION**:
  - `workspace/CONTINUOUS-EVOLUTION-MISSION.md`
  - `workspace/CONTINUOUS-EVOLUTION-STATUS.md`
  - `workspace/CONTINUOUS-EVOLUTION-QUEUE.md`
- Si no, el modo es **PRODUCTION_READINESS** (etapa en curso):
  - `workspace/PRODUCTION-READINESS-MISSION.md`
  - `workspace/PRODUCTION-READINESS-STATUS.md`
  - `workspace/PRODUCTION-READINESS-QUEUE.md`

Regla de parada del sistema: solo por `AUTONOMOUS_STOP` (orden humana), limite de ciclos explicito
o fallo grave de la infraestructura del runner. El DONE de Production Readiness es una senal de
TRANSICION a CONTINUOUS_EVOLUTION, no de parada. Un backlog vacio nunca detiene el sistema.
