# Star-Flow Fixtures

Archivos de prueba para el flujo end-to-end: imagen -> OCR -> texto -> tabla -> grafico -> diseno -> PDF.

## Archivos

| Archivo | Descripcion |
|---------|-------------|
| scan-clear.png | Imagen con tabla de texto legible (420x260px, fondo blanco, texto negro). Generada con Playwright para garantizar legibilidad OCR. |
| scan-difficult.png | El mismo texto esperado en 420x260px, con tipografía de 12px, bajo contraste, reducción al 70%, desenfoque y ruido determinista. |
| scan-table.png | Imagen con tabla simple de 3 columnas. Usada para probar conversion texto->tabla. |
| source-text.txt | Texto delimitado por punto y coma con encabezados y valores numericos incluyendo negativos. |
| source-semicolon.csv | CSV con separador punto y coma y precios con decimales (coma como separador de miles). |
| expected-ocr.txt | Resultado esperado normalizado del OCR sobre scan-clear.png. |
| expected-table.json | Encabezados y filas esperados despues de convertir el texto a tabla. |
| expected-chart.json | Valores esperados para el grafico, incluyendo valores negativos. |

## Tolerancias OCR

- El OCR puede fallar o producir resultados variables segun el motor y la plataforma.
- Se permite: diferencias en mayusculas/minusculas, espacios extra, caracteres acentuados approximados.
- El test E2E verifica la estructura (cantidad de filas, presencia de columnas) mas que la coincidencia exacta.
- La imagen scan-clear.png usa fuentes sans-serif grandes y alto contraste para maximizar la precision.
- La imagen scan-difficult.png comparte expected-ocr.txt y degrada la captura de forma reproducible; no define un umbral reducido para ocultar errores.

## Generacion

Las imagenes PNG se generan con Playwright (Chromium) renderizando HTML con texto.
Ejecutar `node tests/fixtures/star-flow/generate-fixtures.mjs` para regenerar.
