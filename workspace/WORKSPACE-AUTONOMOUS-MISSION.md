# WORKSPACE-AUTONOMOUS-MISSION.md — Mision autonoma: APLUNO Workspace

Mision permanente de mejora continua del producto `/workspace/` (la app
`workspace/` de este repositorio), reutilizando la infraestructura autonoma de
Toolisto. Un ciclo = una tarea atomica; sesion nueva por ciclo; memoria solo en
el repo (MISSION/STATUS/QUEUE/git/evidencias).

## Objetivo central

"Convertir cualquier fotografia, archivo o documento desorganizado en un
resultado editable, calculable, visual y profesional sin salir del proyecto":
mejorar fiabilidad, rendimiento, accesibilidad, cobertura de pruebas y UX del
Workspace sin romper Toolisto, APLUNO ni las 144 rutas existentes.

## Reglas

- No modificar las piezas compartidas del sitio publico salvo que el cambio
  beneficie tambien a APLUNO/Toolisto y pase los gates.
- No simular funcionalidades. No bots decorativos. No cambiar textos esperados
  de OCR para forzar PASS.
- Mantener la interfaz en espanol. Sin emojis como iconos. Sin Times New Roman.
- Git local: commits pequenos y descriptivos. Prohibido push/merge/rebase/
  reset/clean/force.
- No publicar nada en redes sociales ni hacer deploy automatico: el despliegue
  a produccion queda en `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`.
- Prioridades en el backlog: P0 > P1 > P2 > P3. Alternar categorias y evitar
  bucles de pulido.
- Un ciclo sin cambio real de HEAD no cuenta como progreso. Si una tecnica
  falla dos veces, cambiar de estrategia (anti-bucle).
- Sin reintentos para ocultar inestabilidad; sin aumentar timeouts globales.
- Definicion de terminado: implementacion, uso real en la UI, persistencia,
  pruebas relevantes verdes, validacion en navegador cuando corresponda, sin
  errores de consola, evidencia guardada, limitaciones documentadas, commit
  descriptivo, roadmap actualizado.

## Formato del reporte de ciclo (seccion en STATUS)

Audit / Finding / Evidence / Root cause / Implementation / Files / Validation /
Regression check / Next step.

## Criterio de parada

Solo `AUTONOMOUS_STOP` (orden humana), limite de ciclos explicito o fallo grave
de la infraestructura del runner. El backlog vacio nunca detiene la mision.

Reporte final cuando el stack trabaje: `WORKSPACE-AUTONOMOUS-FINAL-REPORT.md`.