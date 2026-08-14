# AUDITORIA COMPLETA — Toolisto Workspace

**Fecha:** 27 de julio de 2026
**Alcance:** Codigo fuente completo del workspace (workspace.js, workspace.css, index.html, core/*.js, tools-data.js)
**Metodo:** Revision estatica del codigo + testing automatizado en 5 viewports (390px, 768px, 1024px, 1366px, 1920px)

> Documento histórico de la primera auditoría. Para el estado actual y la validación posterior a las correcciones, consultar `AUDIT-2026-07-29-DELIVERY.md` y `PHASE-3C-REALITY-CHECK.md`.
>
> **Actualización (Paso 2, auditoría profunda):** `scripts/build-workspace-js.mjs` fue auditado y quedó obsoleto. `workspace/workspace.js` es el source canónico mantenido a mano (6834 líneas con fixes 3C/3D/3E) y el generador ahora es un guard que se niega a regenerar. La sincronización a `dist/` se hace con `npm run build` y se verifica con `npm run build:workspace` (`scripts/verify-workspace-sync.mjs`). La puerta de release es `npm run test:workspace:release`.

---

## 1. Arquitectura del Proyecto

| Archivo | Lineas | Funcion |
|---------|--------|---------|
| `workspace.js` | ~1608 | Logica principal (generado por `scripts/build-workspace-js.mjs` desde chunks inline) |
| `workspace.css` | ~1909 | Estilos completos del workspace |
| `index.html` | ~119 | Shell HTML con sidebar, topbar, y contenedor principal |
| `core/db.js` | ~102 | Wrapper de IndexedDB (openDB, dbGet, dbPut, dbDelete, dbGetAll, dbGetByIndex, dbClear, generateId) |
| `core/state.js` | ~73 | Store reactivo (createStore, appStore) |
| `core/events.js` | ~21 | Pub/sub (on, emit, once) |
| `core/storage.js` | ~240 | Operaciones CRUD sobre IndexedDB |
| `tools-data.js` | ~1586 | 96 definiciones de herramientas |

**Total aproximado:** ~6,866 lineas de codigo.

---

## 2. Inventario de Modulos — Estado Actual

### 2.1 Proyectos

| Funcion | Estado | Notas |
|---------|--------|-------|
| `createNewProject` | FUNCIONAL | Modal crea en IndexedDB |
| `createTemplateProject` | FUNCIONAL | Genera docs + datos de ejemplo |
| `deleteProjectConfirm` | FUNCIONAL | Usa `confirm()` nativo |
| `exportProjectData` | FUNCIONAL | Genera archivo .toolisto JSON |
| `importProjectFile` | FUNCIONAL | Parsea e importa |
| `renderProjectsView` | FUNCIONAL | Hero, bento cards, grid de proyectos recientes |
| `selectProjectAndNavigate` | FUNCIONAL | |

**Problemas:**
- No hay papelera ni recycle bin. Las eliminaciones son permanentes e irreversibles.
- `importProject` falla si `bundle.dataModel` es null (falta validacion).

### 2.2 Panel (Dashboard Principal)

| Funcion | Estado | Notas |
|---------|--------|-------|
| `renderDashboardView` | FUNCIONAL | Grid bento con estadisticas |

**Problemas:**
- Los contadores de capturas/docs/datos se leen del objeto project, no de conteos frescos de IndexedDB. Pueden mostrar datos desactualizados despues de operaciones CRUD.

### 2.3 Captura Universal (Intake)

| Funcion | Estado | Notas |
|---------|--------|-------|
| `renderIntakeView` | FUNCIONAL | Tarjetas de camara/pantalla/clipboard/archivo |
| `captureFromFile` | FUNCIONAL | Selector con validacion |
| `captureScreen` | FUNCIONAL | getDisplayMedia, canvas, guardado |
| `startCapture` | FUNCIONAL | Despacha a modos |

**Problemas:**
- La captura por camara no esta implementada (solo archivo, pantalla, clipboard).

### 2.4 Captura (Vista de Capturas)

| Funcion | Estado | Notas |
|---------|--------|-------|
| `renderCaptureView` | FUNCIONAL | Carga capturas, muestra grid |
| `saveImageCapture` | FUNCIONAL | Guarda en IndexedDB |

**Problemas:**
- Falta `.catch()` en la promesa de `loadCaptures`.

### 2.5 Documentos

| Funcion | Estado | Notas |
|---------|--------|-------|
| `renderDocumentsView` | FUNCIONAL | Lista docs, crear nuevo |
| `createNewDoc` | FUNCIONAL | |
| `importDocumentFile` | FUNCIONAL | .txt/.md/.html con parsing de bloques |

**Problemas:**
- Falta `.catch()` en la promesa de `loadDocs`.

### 2.6 Editor de Documentos

| Funcion | Estado | Notas |
|---------|--------|-------|
| `renderDocEditor` | FUNCIONAL | Editor de bloques completo |
| `renderBlock` | FUNCIONAL | Drag, edicion, formato inline |
| `showBlockMenu` | FUNCIONAL | Menu flotante de tipos |
| `autoSaveDoc` | FUNCIONAL | Debounced 1s |
| `renderDocumentToolbar` | FUNCIONAL | Bold, italic, underline, link, etc. |
| `exportDocument` | FUNCIONAL | Exporta Markdown |
| `exportDocumentHtml` | FUNCIONAL | Documento HTML completo |

**Problemas:**
- Usa `document.execCommand` (deprecated).
- No hay carga de imagenes/archivos dentro de bloques.
- No hay metadata a nivel de pagina/documento.

**Falta completamente:**
- Exportar PDF
- Exportar DOCX
- Backlinks entre documentos
- Generacion de tabla de contenido
- Paginas anidadas (nested pages)

### 2.7 Datos

| Funcion | Estado | Notas |
|---------|--------|-------|
| `renderDataView` | FUNCIONAL | Lista tablas, crear nueva, importar CSV |
| `createNewDataTable` | FUNCIONAL | |
| `importCSV` | FUNCIONAL | Parser completo con deteccion de separador |
| `detectCSVSeparator` | FUNCIONAL | Heuristica |

**Problemas:**
- Falta `.catch()` en la promesa de `loadData`.

### 2.8 Tabla de Datos (Hojas de Calculo)

| Funcion | Estado | Notas |
|---------|--------|-------|
| `renderDataTableView` | FUNCIONAL | Spreadsheet completo |
| Edicion de celdas | FUNCIONAL | |
| Multi-select + clipboard | FUNCIONAL | |
| Undo/Redo | FUNCIONAL | |
| Barra de formulas | FUNCIONAL | SUM, AVERAGE, MIN, MAX, COUNT, COUNTA |
| Multi-sheet (tabs) | FUNCIONAL | |
| Agregar columna/fila | FUNCIONAL | |
| Auto-save | FUNCIONAL | |
| Exportar CSV | FUNCIONAL | |

**Problemas:**
- Usa `prompt()` nativo para agregar columna (no modal).
- No hay virtualizacion para datasets grandes.

**Formulas faltantes:** IF, AND, OR, ROUND, CONCAT, LEFT, RIGHT, MID, LEN, DATE, TODAY.

**Funcionalidad faltante:**
- Formato de celdas (moneda, porcentaje, fechas)
- Formato condicional
- Validacion de datos / dropdowns
- Graficos a partir de datos
- Columnas congeladas
- Importar/Exportar XLSX
- Importar/Exportar JSON

### 2.9 Toolisto Query

| Funcion | Estado | Notas |
|---------|--------|-------|
| `renderQueryStudioView` | FUNCIONAL | Estudio de 3 paneles |
| 25+ operaciones de consulta | FUNCIONAL | filter, sort, group, pivot, join, union, etc. |
| Multi-sheet con tabs | FUNCIONAL | |
| Guardar resultado como tabla | FUNCIONAL | |
| Exportar CSV | FUNCIONAL | |

**Problemas:**
- El resultado de la consulta no se persiste automaticamente.

### 2.10 Dashboards

| Funcion | Estado | Notas |
|---------|--------|-------|
| `renderDashboardsView` | FUNCIONAL | Lista de dashboards |
| `renderDashboardBuilder` | FUNCIONAL | Configuracion de widgets |
| `renderDashboardWidget` | FUNCIONAL | KPI, barra, linea, tabla, insights |
| `DashboardChart` | FUNCIONAL | SVG bar/line charts |

**Problemas:**
- Los datos de los widgets se leenan al renderizar, sin actualizaciones en vivo.
- No hay drag-to-reorder de widgets.

### 2.11 Toolisto Flow

| Funcion | Estado | Notas |
|---------|--------|-------|
| `renderFlowView` | PARCIAL | Interfaz con nodos arrastrables |

**Problemas criticos:**
- Los event listeners se filtran en cada re-render (mousemove/mouseup nunca se eliminan).
- Los datos del flow NO se persisten en IndexedDB. Se pierden al recargar la pagina.
- El boton "Ejecutar prueba" solo muestra toast, no ejecuta nada.
- No hay motor de ejecucion de flujos.

### 2.12 Herramientas

| Funcion | Estado | Notas |
|---------|--------|-------|
| `renderToolsView` | FUNCIONAL | Grid por categoria, busqueda, favoritas, recientes |
| `createToolCard` | FUNCIONAL | Con toggle de favorita |
| `openTool` | FUNCIONAL | Abre herramienta en nueva pestana |

**Problemas:**
- Las herramientas se abren como paginas separadas, no integradas en el workspace.

### 2.13 Paleta (Ctrl+K)

| Funcion | Estado | Notas |
|---------|--------|-------|
| `renderPalette` | FUNCIONAL | Modal overlay con busqueda |
| `filterPalette` | FUNCIONAL | Busca herramientas + items de navegacion |

**Problemas:**
- Solo busca herramientas. No hay command palette (atajos, acciones del workspace).

### 2.14 Modales, Toasts, Menu Contextual, Tema/Densidad

| Funcion | Estado |
|---------|--------|
| `showModal` | FUNCIONAL |
| `closeModal` | FUNCIONAL |
| `toast` | FUNCIONAL |
| `showContextMenu` / `hideContextMenu` | FUNCIONAL |
| `toggleTheme` | FUNCIONAL (persiste en localStorage) |
| `toggleDensity` | FUNCIONAL (airada/equilibrada/compacta) |
| `toggleSidebar` | FUNCIONAL (persiste estado colapsado) |

**Problemas:**
- El toggle de tema solo alterna oscuro/claro. No hay modo automatico segun preferencias del SO.

---

## 3. Modulos Core — Estado y Problemas

### 3.1 db.js (IndexedDB Wrapper)

| Aspecto | Estado |
|---------|--------|
| Operaciones basicas | FUNCIONAL: openDB, dbGet, dbPut, dbDelete, dbGetAll, dbGetByIndex, dbClear |
| Generacion de IDs | FUNCIONAL |

**Problemas:**
- Sin manejo de errores de transaccion (`tx.onerror` nunca se configura).
- Sin connection pooling — cada operacion abre una conexion nueva.
- Sin logica de migracion — `onupgradeneeded` solo crea stores, nunca agrega indices.
- Sin manejo de `blocked`/`versionchange` para multi-pestana.

### 3.2 state.js (Store Reactivo)

| Aspecto | Estado |
|---------|--------|
| createStore | FUNCIONAL |
| appStore | FUNCIONAL |

**Problemas:**
- Todos los stores comparten el mismo Map de listeners. Si dos stores tienen claves con el mismo nombre, `subscribe` se dispara para ambos.
- No hay imposicion de inmutabilidad — los objetos anidados se comparten por referencia.

### 3.3 events.js (Pub/Sub)

| Aspecto | Estado |
|---------|--------|
| on, emit, once | FUNCIONAL |

**Problemas:**
- Ejecucion sincronica unicamente.
- No hay historial ni replay — los suscriptores tardios pierden eventos anteriores.

### 3.4 storage.js (CRUD Operations)

| Funcion | Estado |
|---------|--------|
| createProject | FUNCIONAL |
| updateProject | FUNCIONAL |
| deleteProject | FUNCIONAL |
| loadProjects | FUNCIONAL |
| selectProject | FUNCIONAL |
| saveDoc / loadDocs / deleteDoc | FUNCIONAL |
| saveData / loadData / deleteData | FUNCIONAL |
| saveCapture / loadCaptures / deleteCapture | FUNCIONAL |
| saveSetting / loadSetting | FUNCIONAL |
| exportProject | FUNCIONAL |
| importProject | FUNCIONAL |

**Problemas:**
- Sin batch de transacciones — `deleteProject` realiza ~7 operaciones DB separadas.
- Race conditions en `updateProject` (lectura-modificacion-escritura sin locking).
- `saveDoc` muta su argumento (agrega `.id` si falta).
- `exportProject` ensambla el bundle pero no dispara la descarga.

**Falta:**
- Papelera/recycle bin.
- Timer de auto-save.
- Undo/redo (existen `undoStack`/`redoStack` en appStore pero no se usan).

---

## 4. Codigo Muerto y Sistemas Duplicados

### 4.1 Sistema duplicado de favoritas/recientes

Dos sistemas compiten por el mismo proposito:

| Sistema | Ubicacion | Mecanismo |
|---------|-----------|-----------|
| Activo | appStore | Claves `toolisto-favorite-tools` / `toolisto-recent-tools` |
| Muerto | localStorage | Claves `ws-favorites` / `ws-recent`, funciones `toggleFavoriteTool` y `addToRecentTools` |

### 4.2 Aliases muertos (nunca llamados desde `initApp`)

- `cycleTheme`
- `cycleDensity`
- `setupCollapse`
- `showToast`
- `exportProjectFile`
- `scheduleAutoSave`
- `setupMobileMenu`
- `setupKeyboardShortcuts`
- `setupGlobalDragDrop`
- `handleFiles`
- `analyzeFile`
- `setupBlockEditor`
- `setupFlowCanvas`
- `getPaletteCommands`

**Total: 14 funciones muertas.**

### 4.3 Codigo obsoleto

- `renderQueryView` (linea ~3282) — reemplazada por `renderQueryStudioView`.

---

## 5. Bugs Criticos

| # | Bug | Severidad | Ubicacion |
|---|-----|-----------|-----------|
| 1 | **Fuga de memoria en Flow**: los listeners de mouse se agregan en cada re-render y nunca se eliminan | ALTA | `renderFlowView` |
| 2 | **Datos de Flow no persistidos**: se pierden al recargar la pagina | ALTA | `renderFlowView` |
| 3 | **Sistema duplicado de favoritas**: dos mecanismos de localStorage compiten | MEDIA | `workspace.js` |
| 4 | **Sin seguridad de transacciones**: eliminaciones en cascada pueden fallar parcialmente | MEDIA | `storage.js` |
| 5 | **Navegacion del sidebar rota en mobile**: vistas de proyecto inalcanzables | ALTA | Testing automatizado |
| 6 | **Vistas especificas de proyecto inalcanzables**: documentos, datos, query, dashboards, flow fallan en todos los viewports en testing automatizado | ALTA | Testing automatizado |

---

## 6. Testing por Viewport

| Viewport | Carga | Crear Proyecto | Intake | Capture | Tools | Documents | Data | Query | Dashboards | Flow | Theme | Density | Palette |
|----------|-------|----------------|--------|---------|-------|-----------|------|-------|------------|------|-------|---------|---------|
| 390px (Mobile) | OK | OK | -- | -- | -- | FALLO | FALLO | FALLO | FALLO | FALLO | -- | -- | OK |
| 768px (Tablet) | OK | OK | -- | -- | -- | FALLO | FALLO | FALLO | FALLO | FALLO | -- | -- | OK |
| 1024px (Desktop pequeno) | OK | OK | OK | OK | OK | FALLO | FALLO | FALLO | FALLO | FALLO | OK | OK | OK |
| 1366px (Laptop) | OK | OK | OK | OK | OK | FALLO | FALLO | FALLO | FALLO | FALLO | OK | OK | OK |
| 1920px (Desktop) | OK | OK | OK | OK | OK | FALLO | FALLO | FALLO | FALLO | FALLO | OK | OK | OK |

**Errores en consola detectados:** 0 durante todo el testing.

### Causa raiz del fallo de navegacion

La seccion `#ws-project-nav` del sidebar comienza con `display: none`. Despues de crear un proyecto, `updateTopbar()` deberia mostrarla. Los fallos en testing automatizado se deben a:

1. **En mobile:** el sidebar probablemente esta oculto detras del overlay movil.
2. **En desktop:** los items existen pero pueden estar fuera de vista en el scroll del sidebar.

---

## 7. Auditoria CSS/HTML

### 7.1 Custom Properties

Tema claro completo: `--ws-bg`, `--ws-bg-secondary`, `--ws-bg-tertiary`, `--ws-text`, `--ws-text-secondary`, `--ws-text-tertiary`, `--ws-border`, `--ws-blue`, `--ws-green`, `--ws-violet`, `--ws-orange`, `--ws-red`, `--ws-radius`, `--ws-radius-lg`, `--ws-shadow`, `--ws-transition`, `--ws-font`.

Tema oscuro: definido via `.theme-dark`.

Sistema de densidad: `--ws-density-scale` (1.2, 1.0, 0.8).

### 7.2 CSS Faltante

- Estilos para elementos de formulario (inputs, selects, textareas) — `.ws-input` se agrego pero no se usa consistentemente.
- Estilos de edicion de celdas para spreadsheet.
- Estilos de contenedor para graficos.
- Estados de carga / skeleton.
- Ilustraciones de estados vacios.

### 7.3 Accesibilidad HTML

| Elemento | Estado |
|----------|--------|
| Skip link | Presente |
| ARIA labels | Toggle tema, toggle densidad, toggle colapso, menu movil |
| Roles | `role="navigation"`, `role="main"`, `role="banner"`, `role="status"` en toast |
| aria-live | `"polite"` en toast |

**Falta:**
- ARIA en la mayoria de elementos interactivos dentro de las vistas.
- Gestion de foco despues de navegacion.

---

## 8. Auditoria del Star Flow

El flujo estrella de Toolisto es: **Capturar -> Corregir -> Reconocer -> Editar -> Estructurar -> Calcular -> Visualizar -> Disenar -> Exportar**

| Paso | Estado | Detalle |
|------|--------|---------|
| Importar imagen/PDF/camara/clipboard | PARCIAL | Camara falta, no hay extraccion de paginas PDF |
| Detectar bordes | NO EXISTE | |
| Correccion manual de esquinas | NO EXISTE | |
| Correccion de perspectiva | NO EXISTE | |
| Auto-rotacion | NO EXISTE | |
| Mejorar contraste/sombras/nitidez | NO EXISTE | |
| Documento multi-pagina | NO EXISTE | |
| Reordenar/duplicar/eliminar paginas | NO EXISTE | |
| OCR por pagina | NO EXISTE | |
| Nivel de confianza OCR | NO EXISTE | |
| Editar texto OCR | PARCIAL | Editor de docs existe pero no conectado a OCR |
| Deteccion de tablas | NO EXISTE | |
| Tabla -> TableDocument | NO EXISTE | |
| Editar tabla | FUNCIONAL | Vista data table |
| Crear graficos desde tabla | NO EXISTE | |
| Colocar grafico en disenador | NO EXISTE | No existe modulo de diseno |
| Exportar PDF profesional | NO EXISTE | Solo export Markdown y HTML |

**Resumen del star flow:** 13 de 17 pasos estan completamente ausentes. 2 estan parciales. Solo 1 esta funcional.

---

## 9. Resumen Ejecutivo

| Categoria | Cantidad |
|-----------|----------|
| Funciones FUNCIONALES | ~185 |
| Funciones PARCIAL | 6 |
| Funciones DEMO | 0 |
| Funciones ROTAS (bugs criticos) | 2 |
| Stub vacios / NO EXISTE | 3 |
| Codigo muerto | 15+ funciones |
| Pasos del star flow faltantes | 13 de 17 |

### Fortalezas

- Gestion de proyectos completa (crear, template, exportar, importar).
- Editor de bloques funcional con autoguardado.
- Spreadsheet con formulas, multi-sheet, undo/redo.
- Query studio con 25+ operaciones.
- Dashboard builder con multiples tipos de widget.
- Sistema de temas y densidad.
- Paleta de busqueda.
- 96 herramientas indexadas.

### Debilidades Criticas

1. **El star flow esta vacio.** La promesa central de Toolisto — convertir una foto en un resultado editable, estructurado y exportable — no esta implementada.
2. **Navegacion rota.** Las vistas especificas de proyecto (documentos, datos, query, dashboards, flow) son inalcanzables desde el sidebar en mobile y fallan en testing automatizado.
3. **Flow no persiste.** Se pierden todos los datos al recargar.
4. **Flow tiene fuga de memoria.** Los event listeners se acumulan.
5. **Sin seguridad de transacciones.** Las operaciones compuestas pueden fallar a medias.
6. **15+ funciones muertas.** Codigo que nunca se ejecuta.

### Prioridad de Correccion

| Prioridad | Item |
|-----------|------|
| P0 | Arreglar navegacion del sidebar en todos los viewports |
| P0 | Arreglar persistencia y fuga de memoria en Flow |
| P1 | Eliminar codigo muerto y sistema duplicado de favoritas |
| P1 | Agregar manejo de errores en db.js y storage.js |
| P1 | Agregar .catch() en todas las promesas de carga |
| P2 | Implementar extraccion de imagenes (bordes, perspectiva) |
| P2 | Implementar OCR y conexion con editor |
| P2 | Implementar exportar PDF |
| P3 | Agregar virtualizacion para datasets grandes |
| P3 | Completar formulas faltantes (IF, AND, OR, etc.) |
| P3 | Agregar ARIA y gestion de foco |

---

*Auditoria generada a partir de revision de codigo fuente y testing automatizado. No se detectaron errores en consola durante el testing.*

---

## ACTUALIZACION: Fase 3A — Captura y Escaneo (2026-07-27)

### Archivos creados
- `workspace/core/image-processor.js` (590 lineas) — Procesamiento de imagen puro con Canvas
- `workspace/core/scanner-ui.js` (313 lineas) — UI interactiva del escaner
- `tests/workspace/phase3a-test.mjs` (45 tests) — Tests del image processor
- `tests/workspace/phase3a-manual-verification.mjs` (41 tests) — Verificacion manual con 10 escenarios

### Archivos modificados
- `workspace/workspace.css` (+150 lineas) — CSS del scanner (toolbar, corners, canvas, compare, footer)
- `workspace/workspace.js` (+44 lineas) — import de scanner-ui, launchScanner(), renderScannerView(), routing de captura a scanner
- `workspace/core/image-processor.js` — Export de funcion `distance()` (requerida por scanner-ui)

### Capacidades implementadas
- Deteccion de bordes: Gaussian blur → grayscale → Sobel edges → componentes conectados → convex hull → Douglas-Peucker → deteccion de cuadrilatero
- Correccion de perspectiva: bilinear interpolation con esquinas ordenadas (TL, TR, BR, BL)
- Auto-rotacion basada en orientacion de bordes
- Thumbnails con preservacion de aspect ratio
- Object URL lifecycle management (create, revoke, revokeAll, getActive)
- Scanner UI: esquinas arrastrables con pointer events, preview en tiempo real, modo comparar, auto-detectar, restablecer
- Keyboard: Escape cancela, Ctrl+Enter confirma
- Flujo: Captura (camera/screen/clipboard) → Scanner → Confirmar → Guardar como asset en IndexedDB

### Limitaciones de deteccion自动ica
- Bajo contraste: fallback a esquinas manuales
- Sombras fuertes: fallback
- Imagenes borrosas: fallback
- Bordes curvos: no detectados
- Multiples hojas: solo detecta la mas grande
- Obetos rectangulares en fondo: pueden confundirse

### Resultados de pruebas
- 340/340 tests pasan (156 estructura + 106 auditoria + 45 phase3a + 33 playwright)
- 41/41 pruebas manuales verificadas con 10 escenarios sinteticos
- 0 errores en consola
- Tamano dist: 994 KB

### Pendiente
- Integrar output del scanner con el sistema de assets (models.js)
- Conectar scan documents al pipeline de procesamiento del star flow
- OCR (Fase 3C)
- Editor de texto editable (Fase 3D)
- Tabla editable desde documento escaneado (Fase 3E)
- Grafico (Fase 3F)
- Informe/PDF (Fase 3G)
