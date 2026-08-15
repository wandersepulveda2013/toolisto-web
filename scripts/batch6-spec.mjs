#!/usr/bin/env node
// batch6-spec.mjs — Catálogo de expansión Toolisto (Fase 3D: 56 herramientas)
//
// Uso:
//   node scripts/batch6-spec.mjs                 → validación (sin escribir)
//   node scripts/batch6-spec.mjs --write         → fusiona herramientas y categorías en tools.json / categories.json
//   node scripts/batch6-spec.mjs --write --category text
//                                                → fusiona solo las herramientas de una categoría (por fase)
//   node scripts/batch6-spec.mjs --report        → genera informe por fase (resumen de estado)
//
// Contiene la definición única de las 56 herramientas nuevas (53 del pedido
// original + 3 sustitutos). No implementa procesadores: estos viven en
// tool-processors.js y se cablean en app.js / js/file-limits.js.

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TOOLS_PATH = join(ROOT, 'src', 'data', 'tools.json');
const CATEGORIES_PATH = join(ROOT, 'src', 'data', 'categories.json');

const WRITE = process.argv.includes('--write');
const REPORT = process.argv.includes('--report');
const SYNC_CATEGORIES = process.argv.includes('--sync-categories');
const catArgIdx = process.argv.indexOf('--category');
const CATEGORY_FILTER = catArgIdx >= 0 && process.argv[catArgIdx + 1] ? process.argv[catArgIdx + 1] : null;

const LAST_MODIFIED = '2026-08-01';
const OG_IMAGE = '/assets/icon-512.png';

function faq(items) { return items.map(([q, a]) => ({ q, a })); }
function entry(p) {
  return {
    id: p.id,
    enabled: true,
    indexable: true,
    slug: p.slug,
    category: p.category,
    name: p.name,
    title: `${p.name} online gratis | Toolisto`,
    description: p.description,
    h1: p.h1 || p.name,
    summary: p.summary || p.description,
    inputFormats: p.inputFormats,
    outputFormats: p.outputFormats,
    accepts: p.accepts,
    toolId: p.toolId,
    icon: p.icon,
    relatedTools: p.relatedTools || [],
    relatedSlugs: p.relatedSlugs || [],
    enabledInSitemap: true,
    faq: p.faq,
    instructions: p.instructions,
    limitations: p.limitations,
    ogImage: OG_IMAGE,
    lastModified: p.lastModified || LAST_MODIFIED,
    keywords: p.keywords
  };
}

const SPECS = [
  // ─────────────────────────── TEXTO (10) ───────────────────────────
  entry({
    id: 'textStatistics', toolId: 'textStatistics', slug: 'estadisticas-texto', category: 'text',
    name: 'Estadísticas de texto', icon: '№', accepts: 'text',
    inputFormats: ['TXT', 'MD', 'LOG', 'CSV'], outputFormats: ['TXT'],
    description: 'Analiza cualquier archivo de texto y obtén palabras, caracteres, frases, párrafos y tiempo de lectura.',
    summary: 'Obtén métricas completas de tu texto: palabras, caracteres, frases y tiempo de lectura.',
    relatedTools: ['wordCount', 'textDiff', 'htmlToText'], relatedSlugs: ['contar-palabras', 'comparar-textos', 'html-a-texto'],
    faq: faq([
      ['¿Qué métricas incluye el análisis?', 'Incluye palabras, palabras únicas, caracteres con y sin espacios, frases, párrafos, líneas y tiempo estimado de lectura y habla.'],
      ['¿Funciona con textos largos?', 'Sí. Puedes analizar archivos de texto de hasta 200 MB sin salir del navegador.'],
      ['¿Cómo se calcula el tiempo de lectura?', 'Se usa el promedio de 200 palabras por minuto para lectura y 130 para habla, ambos ajustables en la documentación.'],
      ['¿Mis archivos se suben a algún servidor?', 'No. Todo el análisis ocurre localmente en tu navegador.'],
    ]),
    instructions: ['Selecciona un archivo de texto.', 'La herramienta analiza el contenido automáticamente.', 'Revisa las métricas en pantalla.', 'Descarga el informe en formato TXT si lo necesitas.'],
    limitations: ['El conteo de frases depende de signos de puntuación como . ! ?.', 'Los emojis pueden contar como palabras en algunos casos.', 'La codificación debe ser UTF-8 para resultados exactos.'],
    keywords: ['estadísticas', 'texto', 'palabras', 'caracteres', 'analizar', 'métricas', 'frases'],
  }),
  entry({
    id: 'wordCount', toolId: 'wordCount', slug: 'contar-palabras', category: 'text',
    name: 'Contar palabras', icon: '≡', accepts: 'text',
    inputFormats: ['TXT', 'MD', 'LOG', 'CSV'], outputFormats: ['TXT'],
    description: 'Cuenta palabras, caracteres y palabras únicas de cualquier archivo de texto al instante.',
    summary: 'Conoce el número exacto de palabras, caracteres y palabras únicas de tu texto.',
    relatedTools: ['textStatistics', 'textDiff', 'sortLines'], relatedSlugs: ['estadisticas-texto', 'comparar-textos', 'ordenar-lineas-texto'],
    faq: faq([
      ['¿Qué cuenta como una palabra?', 'Se considera palabra a cualquier secuencia de letras y números, incluyendo apóstrofes y guiones internos.'],
      ['¿Puedo contar palabras en varios archivos?', 'La herramienta procesa un archivo a la vez. Para varios archivos usa mergeTxt primero.'],
      ['¿Cuenta caracteres con o sin espacios?', 'Se muestran ambos valores en los resultados.'],
    ]),
    instructions: ['Selecciona el archivo de texto.', 'La herramienta cuenta las palabras automáticamente.', 'Consulta el total de palabras, únicas y caracteres.', 'Descarga el informe si lo necesitas.'],
    limitations: ['Los separadores muy inusuales pueden alterar el conteo.', 'Requiere texto en codificación UTF-8.'],
    keywords: ['contar', 'palabras', 'conteo', 'caracteres', 'texto', 'wpm'],
  }),
  entry({
    id: 'textDiff', toolId: 'textDiff', slug: 'comparar-textos', category: 'text',
    name: 'Comparar textos', icon: '⇄', accepts: 'texts',
    inputFormats: ['TXT', 'MD', 'LOG'], outputFormats: ['TXT'],
    description: 'Compara dos archivos de texto línea por línea y visualiza las diferencias entre ellos.',
    summary: 'Encuentra diferencias entre dos textos línea a línea con un informe claro.',
    relatedTools: ['compareWord', 'textStatistics', 'comparePdfs'], relatedSlugs: ['comparar-documentos-word', 'estadisticas-texto', 'comparar-dos-pdf'],
    faq: faq([
      ['¿Cómo se muestran las diferencias?', 'Con el prefijo "-" para las líneas solo en el primer archivo, "+" para las del segundo y sin prefijo para las comunes.'],
      ['¿Qué algoritmo usa?', 'Usa una comparación línea a línea con programación dinámica (secuencia común más larga) para detectar inserciones y eliminaciones.'],
      ['¿Puedo comparar archivos grandes?', 'Sí, pero archivos de más de 50 MB pueden tardar unos segundos en procesarse.'],
    ]),
    instructions: ['Selecciona el primer archivo de texto.', 'Selecciona el segundo archivo de texto.', 'La herramienta compara y muestra el resumen.', 'Descarga el informe de diferencias.'],
    limitations: ['La comparación es a nivel de línea, no de palabra.', 'Archivos muy grandes pueden requerir más memoria.'],
    keywords: ['comparar', 'texto', 'diferencias', 'diff', 'líneas', 'archivo'],
  }),
  entry({
    id: 'htmlToMarkdown', toolId: 'htmlToMarkdown', slug: 'html-a-markdown', category: 'text',
    name: 'HTML a Markdown', icon: '↓', accepts: 'html',
    inputFormats: ['HTML', 'HTM', 'XHTML'], outputFormats: ['MD'],
    description: 'Convierte archivos HTML a Markdown conservando encabezados, tablas, listas y enlaces.',
    summary: 'Transforma HTML a Markdown limpio y editable para documentación o blogs.',
    relatedTools: ['htmlToText', 'markdownToHtml', 'markdownToWord'], relatedSlugs: ['html-a-texto', 'markdown-a-html', 'markdown-a-word'],
    faq: faq([
      ['¿Se conservan las tablas?', 'Sí. Las tablas HTML se convierten a tablas Markdown con alineación de separadores.'],
      ['¿Qué pasa con las imágenes?', 'Las imágenes se convierten a sintaxis ![](url) preservando el texto alternativo.'],
      ['¿Se elimina el JavaScript y CSS?', 'Sí, los bloques <script> y <style> se eliminan del resultado.'],
    ]),
    instructions: ['Selecciona un archivo HTML.', 'La herramienta convierte el contenido a Markdown.', 'Descarga el archivo .md resultante.'],
    limitations: ['Atributos de estilo inline se ignoran.', 'Formularios HTML no se convierten.'],
    keywords: ['html', 'markdown', 'convertir', 'md', 'documentación'],
  }),
  entry({
    id: 'htmlToText', toolId: 'htmlToText', slug: 'html-a-texto', category: 'text',
    name: 'HTML a texto plano', icon: '¶', accepts: 'html',
    inputFormats: ['HTML', 'HTM', 'XHTML'], outputFormats: ['TXT'],
    description: 'Extrae el texto visible de una página HTML eliminando etiquetas, scripts y estilos.',
    summary: 'Obtén solo el texto legible de cualquier archivo HTML.',
    relatedTools: ['htmlToMarkdown', 'textStatistics', 'wordCount'], relatedSlugs: ['html-a-markdown', 'estadisticas-texto', 'contar-palabras'],
    faq: faq([
      ['¿Qué se elimina del HTML?', 'Se eliminan etiquetas, scripts, estilos y comentarios. Solo queda el texto visible.'],
      ['¿Se conservan los saltos de línea?', 'Sí. Los párrafos y divisiones generan saltos de línea para mantener la legibilidad.'],
      ['¿Funciona con páginas completas?', 'Sí, puedes procesar documentos HTML completos con su estructura.'],
    ]),
    instructions: ['Selecciona el archivo HTML.', 'La herramienta extrae el texto visible.', 'Revisa y descarga el archivo de texto.'],
    limitations: ['El texto generado por JavaScript no se captura.', 'Las entidades HTML se decodifican a caracteres simples.'],
    keywords: ['html', 'texto', 'extraer', 'plano', 'quitar etiquetas'],
  }),
  entry({
    id: 'cssMinifier', toolId: 'cssMinifier', slug: 'minificar-css', category: 'text',
    name: 'Minificar CSS', icon: '{}', accepts: 'css',
    inputFormats: ['CSS'], outputFormats: ['CSS'],
    description: 'Reduce el tamaño de archivos CSS eliminando espacios, comentarios y caracteres innecesarios.',
    summary: 'Optimiza tu CSS eliminando espacios y comentarios para cargar páginas más rápido.',
    relatedTools: ['htmlToText', 'htmlToMarkdown', 'wordCount'], relatedSlugs: ['html-a-texto', 'html-a-markdown', 'contar-palabras'],
    faq: faq([
      ['¿Qué elimina el minificador?', 'Elimina comentarios, espacios innecesarios, saltos de línea y el punto y coma final de cada bloque.'],
      ['¿Cambia el funcionamiento del CSS?', 'No. La minificación es semánticamente idéntica al CSS original.'],
      ['¿Cuánto se reduce el tamaño?', 'Normalmente entre 20% y 50% dependiendo de la cantidad de comentarios y espacios.'],
    ]),
    instructions: ['Selecciona el archivo CSS.', 'La herramienta lo minifica automáticamente.', 'Compara el tamaño original con el minificado.', 'Descarga el archivo .min.css.'],
    limitations: ['Los valores CSS con espacios significativos (como en calc()) se conservan.', 'El código preprocesado (SASS) debe compilarse antes.'],
    keywords: ['css', 'minificar', 'optimizar', 'reducir', 'estilos'],
  }),
  entry({
    id: 'base64Encode', toolId: 'base64Encode', slug: 'codificar-base64', category: 'text',
    name: 'Codificar en Base64', icon: 'ⓑ', accepts: 'text',
    inputFormats: ['TXT', 'MD', 'LOG', 'JSON', 'XML'], outputFormats: ['TXT'],
    description: 'Codifica el contenido de un archivo a formato Base64 para incrustarlo o transmitirlo.',
    summary: 'Convierte cualquier texto a Base64 con un clic.',
    relatedTools: ['base64Decode', 'urlEncode', 'checksumFile'], relatedSlugs: ['decodificar-base64', 'codificar-url', 'calcular-hash'],
    faq: faq([
      ['¿Para qué sirve el Base64?', 'Se usa para incrustar datos en JSON, HTML o URLs sin caracteres conflictivos.'],
      ['¿Aumenta el tamaño?', 'Sí, el Base64 aumenta el tamaño del contenido alrededor de un 33%.'],
      ['¿Maneja texto acentuado?', 'Sí, el texto se codifica en UTF-8 antes de aplicar Base64.'],
    ]),
    instructions: ['Selecciona el archivo a codificar.', 'La herramienta genera el Base64 automáticamente.', 'Copia o descarga el resultado.'],
    limitations: ['Archivos binarios muy grandes pueden generar salidas extensas.', 'La codificación se realiza sobre el contenido de texto.'],
    keywords: ['base64', 'codificar', 'encode', 'texto', 'transmisión'],
  }),
  entry({
    id: 'base64Decode', toolId: 'base64Decode', slug: 'decodificar-base64', category: 'text',
    name: 'Decodificar Base64', icon: 'ⓓ', accepts: 'text',
    inputFormats: ['TXT'], outputFormats: ['TXT', 'BIN'],
    description: 'Convierte contenido Base64 de vuelta a texto legible o datos binarios originales.',
    summary: 'Decodifica texto Base64 a su contenido original.',
    relatedTools: ['base64Encode', 'urlDecode', 'checksumFile'], relatedSlugs: ['codificar-base64', 'decodificar-url', 'calcular-hash'],
    faq: faq([
      ['¿Qué pasa si el resultado no es texto?', 'Si los bytes decodificados no forman texto UTF-8 válido, se descargan como datos binarios (.bin).'],
      ['¿Acepta salidas con saltos de línea?', 'Sí, se ignoran los espacios y saltos de línea al decodificar.'],
      ['¿Cómo valido que sea Base64?', 'La herramienta verifica el alfabeto y la longitud antes de decodificar.'],
    ]),
    instructions: ['Selecciona el archivo con contenido Base64.', 'La herramienta lo decodifica automáticamente.', 'Descarga el contenido original.'],
    limitations: ['Base64 mal formado se rechaza con un mensaje claro.', 'No se admiten fragmentos parciales sin relleno correcto.'],
    keywords: ['base64', 'decodificar', 'decode', 'texto', 'binario'],
  }),
  entry({
    id: 'urlEncode', toolId: 'urlEncode', slug: 'codificar-url', category: 'text',
    name: 'Codificar URL', icon: '⇈', accepts: 'text',
    inputFormats: ['TXT', 'MD', 'JSON', 'XML'], outputFormats: ['TXT'],
    description: 'Codifica el contenido de un archivo para utilizarlo de forma segura dentro de una URL.',
    summary: 'Convierte texto a formato URL-encoded compatible con navegadores y APIs.',
    relatedTools: ['urlDecode', 'base64Encode', 'htmlToText'], relatedSlugs: ['decodificar-url', 'codificar-base64', 'html-a-texto'],
    faq: faq([
      ['¿Qué caracteres se codifican?', 'Se codifican todos los caracteres reservados y no ASCII usando la codificación de componente de URL.'],
      ['¿Es seguro para query strings?', 'Sí, el resultado es seguro para valores de parámetros en URLs.'],
      ['¿Se conservan las letras y números?', 'Sí, los caracteres alfanuméricos se mantienen sin codificar.'],
    ]),
    instructions: ['Selecciona el archivo a codificar.', 'La herramienta genera la URL codificada.', 'Copia o descarga el resultado.'],
    limitations: ['La codificación usa encodeURIComponent, por lo que no codifica / o ? dentro del contenido.'],
    keywords: ['url', 'codificar', 'encode', 'uri', 'query', 'texto'],
  }),
  entry({
    id: 'urlDecode', toolId: 'urlDecode', slug: 'decodificar-url', category: 'text',
    name: 'Decodificar URL', icon: '⇊', accepts: 'text',
    inputFormats: ['TXT'], outputFormats: ['TXT'],
    description: 'Convierte contenido codificado en URL de vuelta a texto legible.',
    summary: 'Decodifica secuencias %XX a caracteres normales.',
    relatedTools: ['urlEncode', 'base64Decode', 'htmlToText'], relatedSlugs: ['codificar-url', 'decodificar-base64', 'html-a-texto'],
    faq: faq([
      ['¿Qué secuencias decodifica?', 'Decodifica secuencias %XX y + a espacios según el estándar de URLs.'],
      ['¿Qué pasa con contenido mal codificado?', 'Si el formato es inválido se muestra un mensaje de error claro.'],
    ]),
    instructions: ['Selecciona el archivo codificado.', 'La herramienta decodifica el contenido.', 'Descarga el texto original.'],
    limitations: ['Solo decodifica componentes de URL, no la barra "/" ni el signo "?" literal.'],
    keywords: ['url', 'decodificar', 'decode', 'uri', 'porcentaje'],
  }),

  // ─────────────────────────── HOJAS DE CÁLCULO Y DATOS (13) ───────────────────────────
  entry({
    id: 'csvToMarkdown', toolId: 'csvToMarkdown', slug: 'csv-a-markdown', category: 'spreadsheets',
    name: 'CSV a Markdown', icon: '▦', accepts: 'csvs',
    inputFormats: ['CSV', 'TSV'], outputFormats: ['MD'],
    description: 'Convierte archivos CSV a tablas Markdown listas para GitHub, Notion o documentación.',
    summary: 'Transforma tus datos CSV en tablas Markdown alineadas.',
    relatedTools: ['csvToHtml', 'csvToExcel', 'excelToMarkdown'], relatedSlugs: ['csv-a-html', 'csv-a-excel', 'excel-a-markdown'],
    faq: faq([
      ['¿Cómo maneja los delimitadores?', 'Detecta automáticamente comas, punto y coma y tabulaciones.'],
      ['¿Se conserva el encabezado?', 'Sí, la primera fila se usa como fila de encabezado de la tabla.'],
    ]),
    instructions: ['Selecciona el archivo CSV.', 'Configura el delimitador si es necesario.', 'Descarga la tabla en Markdown.'],
    limitations: ['Celdas muy largas pueden romper la alineación en editores simples.', 'No se soportan tablas anidadas.'],
    keywords: ['csv', 'markdown', 'tabla', 'convertir', 'github', 'notion'],
  }),
  entry({
    id: 'csvToHtml', toolId: 'csvToHtml', slug: 'csv-a-html', category: 'spreadsheets',
    name: 'CSV a HTML', icon: '☰', accepts: 'csvs',
    inputFormats: ['CSV', 'TSV'], outputFormats: ['HTML'],
    description: 'Convierte archivos CSV a una tabla HTML estilizada y lista para incrustar.',
    summary: 'Genera una tabla HTML con estilos básicos a partir de tu CSV.',
    relatedTools: ['csvToMarkdown', 'excelToHtml', 'csvToExcel'], relatedSlugs: ['csv-a-markdown', 'excel-a-html', 'csv-a-excel'],
    faq: faq([
      ['¿El HTML es autocontenido?', 'Sí, incluye estilos básicos para que la tabla se vea bien al incrustarla.'],
      ['¿Puedo usarlo en correos?', 'El HTML generado es compatible con la mayoría de clientes de correo.'],
    ]),
    instructions: ['Selecciona el CSV.', 'La herramienta genera la tabla HTML.', 'Descarga o copia el HTML.'],
    limitations: ['Celdas con contenido HTML se escapan por seguridad.', 'Fórmulas de CSV no se interpretan.'],
    keywords: ['csv', 'html', 'tabla', 'convertir', 'incrustar'],
  }),
  entry({
    id: 'csvToYaml', toolId: 'csvToYaml', slug: 'csv-a-yaml', category: 'spreadsheets',
    name: 'CSV a YAML', icon: '⬛', accepts: 'csvs',
    inputFormats: ['CSV', 'TSV'], outputFormats: ['YAML'],
    description: 'Convierte filas de un CSV en una lista de objetos YAML con sus columnas como claves.',
    summary: 'Transforma tus datos tabulares a YAML para configuración o pipelines.',
    relatedTools: ['csvToMarkdown', 'csvToJson', 'csvToExcel'], relatedSlugs: ['csv-a-markdown', 'csv-a-json', 'csv-a-excel'],
    faq: faq([
      ['¿Cómo se estructura el YAML?', 'Cada fila se convierte en un objeto con las columnas como claves dentro de una lista.'],
      ['¿Qué pasa con valores vacíos?', 'Los valores vacíos se convierten en null o se omiten según la configuración.'],
    ]),
    instructions: ['Selecciona el archivo CSV.', 'Revisa la estructura YAML generada.', 'Descarga el archivo .yaml.'],
    limitations: ['Claves duplicadas en el encabezado se renombran automáticamente.', 'Valores con comillas complejas pueden requerir ajustes manuales.'],
    keywords: ['csv', 'yaml', 'convertir', 'datos', 'configuración'],
  }),
  entry({
    id: 'excelToHtml', toolId: 'excelToHtml', slug: 'excel-a-html', category: 'spreadsheets',
    name: 'Excel a HTML', icon: '⌘', accepts: 'excels',
    inputFormats: ['XLS', 'XLSX'], outputFormats: ['HTML'],
    description: 'Convierte hojas de Excel a tablas HTML estilizadas, conservando el contenido de cada celda.',
    summary: 'Convierte tus hojas de cálculo a HTML para web o informes.',
    relatedTools: ['excelToMarkdown', 'csvToHtml', 'excelToCsv'], relatedSlugs: ['excel-a-markdown', 'csv-a-html', 'excel-a-csv'],
    faq: faq([
      ['¿Se convierten todas las hojas?', 'Se genera un archivo por hoja o una sola hoja seleccionada, según la configuración.'],
      ['¿Se conservan las fórmulas?', 'Se exporta el valor calculado de cada celda, no la fórmula.'],
    ]),
    instructions: ['Selecciona el archivo Excel.', 'Elige la hoja o convierte todas.', 'Descarga el HTML generado.'],
    limitations: ['No se conservan formatos complejos ni imágenes embebidas.', 'Las hojas con más de 10.000 celdas pueden tardar.'],
    keywords: ['excel', 'html', 'tabla', 'hoja', 'convertir'],
  }),
  entry({
    id: 'excelToMarkdown', toolId: 'excelToMarkdown', slug: 'excel-a-markdown', category: 'spreadsheets',
    name: 'Excel a Markdown', icon: '▤', accepts: 'excels',
    inputFormats: ['XLS', 'XLSX'], outputFormats: ['MD'],
    description: 'Convierte hojas de Excel a tablas Markdown para documentación y repositorios.',
    summary: 'Exporta tus hojas de cálculo como tablas Markdown.',
    relatedTools: ['csvToMarkdown', 'excelToHtml', 'excelToCsv'], relatedSlugs: ['csv-a-markdown', 'excel-a-html', 'excel-a-csv'],
    faq: faq([
      ['¿La primera fila es el encabezado?', 'Sí, por defecto la primera fila se trata como encabezado.'],
      ['¿Puedo elegir la hoja?', 'Sí, puedes seleccionar una hoja concreta del libro.'],
    ]),
    instructions: ['Selecciona el archivo Excel.', 'Elige la hoja a convertir.', 'Descarga la tabla Markdown.'],
    limitations: ['Valores con saltos de línea se simplifican.', 'No se exportan comentarios ni formatos.'],
    keywords: ['excel', 'markdown', 'tabla', 'hoja', 'exportar'],
  }),
  entry({
    id: 'xmlToExcel', toolId: 'xmlToExcel', slug: 'xml-a-excel', category: 'spreadsheets',
    name: 'XML a Excel', icon: '≣', accepts: 'xmls',
    inputFormats: ['XML'], outputFormats: ['XLSX'],
    description: 'Extrae datos de archivos XML y los convierte en una tabla Excel editable.',
    summary: 'Convierte la información contenida en XML a una hoja de cálculo.',
    relatedTools: ['xmlToJson', 'jsonToExcel', 'csvToExcel'], relatedSlugs: ['xml-a-json', 'json-a-excel', 'csv-a-excel'],
    faq: faq([
      ['¿Qué estructura XML soporta?', 'Soporta XML con elementos repetidos donde cada elemento se convierte en una fila.'],
      ['¿Qué pasa si el XML es anidado?', 'Las jerarquías simples se aplanan usando el nombre de los atributos como columnas.'],
    ]),
    instructions: ['Selecciona el archivo XML.', 'La herramienta detecta la estructura.', 'Revisa las columnas generadas.', 'Descarga el XLSX.'],
    limitations: ['XML muy anidado puede requerir configuración manual.', 'Los atributos de XML se prefijan con @ en el nombre de la columna.'],
    keywords: ['xml', 'excel', 'convertir', 'datos', 'hoja'],
  }),
  entry({
    id: 'csvStatistics', toolId: 'csvStatistics', slug: 'estadisticas-csv', category: 'spreadsheets',
    name: 'Estadísticas CSV', icon: '∑', accepts: 'csvs',
    inputFormats: ['CSV', 'TSV'], outputFormats: ['TXT'],
    description: 'Analiza un CSV y obtiene filas, columnas, valores vacíos y estadísticas numéricas por columna.',
    summary: 'Obtén métricas y análisis de tus archivos CSV al instante.',
    relatedTools: ['csvFilter', 'csvSort', 'csvToExcel'], relatedSlugs: ['filtrar-csv', 'ordenar-csv', 'csv-a-excel'],
    faq: faq([
      ['¿Qué estadísticas calcula?', 'Cuenta filas y columnas, valores vacíos, y para columnas numéricas: mínimo, máximo, media y suma.'],
      ['¿Detecta el delimitador?', 'Sí, detecta comas, punto y coma y tabulaciones automáticamente.'],
    ]),
    instructions: ['Selecciona el archivo CSV.', 'La herramienta calcula las estadísticas.', 'Revisa el informe por columna.', 'Descarga el informe.'],
    limitations: ['Columnas mixtas (texto y números) se tratan como texto.', 'Archivos con más de 100.000 filas pueden requerir más memoria.'],
    keywords: ['csv', 'estadísticas', 'análisis', 'datos', 'métricas'],
  }),
  entry({
    id: 'csvFilter', toolId: 'csvFilter', slug: 'filtrar-csv', category: 'spreadsheets',
    name: 'Filtrar CSV', icon: '⌖', accepts: 'csvs',
    inputFormats: ['CSV', 'TSV'], outputFormats: ['CSV'],
    description: 'Filtra filas de un CSV por una condición de columna con operadores de comparación.',
    summary: 'Conserva solo las filas que cumplen la condición que elijas.',
    relatedTools: ['csvSort', 'csvStatistics', 'csvToExcel'], relatedSlugs: ['ordenar-csv', 'estadisticas-csv', 'csv-a-excel'],
    faq: faq([
      ['¿Qué operadores soporta?', 'Igual, distinto, mayor, mayor o igual, menor, menor o igual, contiene y no contiene.'],
      ['¿Funciona con texto?', 'Sí, los operadores contiene e igual funcionan con texto sensible a mayúsculas o no.'],
    ]),
    instructions: ['Selecciona el archivo CSV.', 'Elige la columna a filtrar.', 'Selecciona el operador y escribe el valor.', 'Descarga el CSV filtrado.'],
    limitations: ['Los valores numéricos se comparan como números si ambos son numéricos.', 'Las filas sin valor en la columna se excluyen del resultado.'],
    keywords: ['csv', 'filtrar', 'filtro', 'datos', 'condición'],
  }),
  entry({
    id: 'csvSort', toolId: 'csvSort', slug: 'ordenar-csv', category: 'spreadsheets',
    name: 'Ordenar CSV', icon: '⇅', accepts: 'csvs',
    inputFormats: ['CSV', 'TSV'], outputFormats: ['CSV'],
    description: 'Ordena las filas de un CSV por una columna en orden ascendente o descendente.',
    summary: 'Ordena tus datos CSV por cualquier columna.',
    relatedTools: ['csvFilter', 'csvStatistics', 'csvToExcel'], relatedSlugs: ['filtrar-csv', 'estadisticas-csv', 'csv-a-excel'],
    faq: faq([
      ['¿Cómo ordena números y texto?', 'Detecta automáticamente si la columna es numérica y ordena en consecuencia.'],
      ['¿Mantiene el encabezado?', 'Sí, la fila de encabezado siempre permanece en la primera posición.'],
    ]),
    instructions: ['Selecciona el archivo CSV.', 'Elige la columna de ordenación.', 'Selecciona ascendente o descendente.', 'Descarga el CSV ordenado.'],
    limitations: ['La ordenación es estable, conservando el orden relativo de filas con valores iguales.'],
    keywords: ['csv', 'ordenar', 'sort', 'datos', 'columna'],
  }),
  entry({
    id: 'csvToSql', toolId: 'csvToSql', slug: 'csv-a-sql', category: 'spreadsheets',
    name: 'CSV a SQL', icon: '🗄', accepts: 'csvs',
    inputFormats: ['CSV', 'TSV'], outputFormats: ['SQL'],
    description: 'Genera sentencias CREATE TABLE e INSERT a partir de un CSV para importar a una base de datos.',
    summary: 'Convierte tu CSV en sentencias SQL listas para ejecutar.',
    relatedTools: ['csvToExcel', 'csvToJson', 'csvToMarkdown'], relatedSlugs: ['csv-a-excel', 'csv-a-json', 'csv-a-markdown'],
    faq: faq([
      ['¿Qué sentencias genera?', 'Genera un CREATE TABLE con tipos inferidos y un INSERT por fila, o un INSERT múltiple.'],
      ['¿Escapa los valores?', 'Sí, los valores se escapan para evitar inyecciones y errores de sintaxis.'],
    ]),
    instructions: ['Selecciona el archivo CSV.', 'Configura el nombre de la tabla.', 'Elige el formato de INSERT.', 'Descarga el archivo .sql.'],
    limitations: ['Los tipos se infieren de los valores, no de metadatos externos.', 'No se generan claves foráneas automáticamente.'],
    keywords: ['csv', 'sql', 'base de datos', 'insert', 'create table'],
  }),
  entry({
    id: 'jsonFormatter', toolId: 'jsonFormatter', slug: 'formatear-json', category: 'spreadsheets',
    name: 'Formatear JSON', icon: '⛁', accepts: 'jsons',
    inputFormats: ['JSON'], outputFormats: ['JSON'],
    description: 'Formatea, valida y ordena archivos JSON para que sean legibles o compactos.',
    summary: 'Embellece o compacta tu JSON con indentación configurable.',
    relatedTools: ['jsonValidator', 'jsonToExcel', 'jsonToCsv'], relatedSlugs: ['validar-json', 'json-a-excel', 'json-a-csv'],
    faq: faq([
      ['¿Qué hace si el JSON es inválido?', 'Muestra el error de parseo con la posición para que puedas corregirlo.'],
      ['¿Puedo ordenar las claves?', 'Sí, con la opción de ordenar claves alfabéticamente.'],
    ]),
    instructions: ['Selecciona el archivo JSON.', 'Configura la indentación y opciones.', 'Descarga el JSON formateado.'],
    limitations: ['Los valores grandes (más de 100 MB) pueden ser lentos de procesar.', 'Los números muy grandes pueden perder precisión al volver a serializar.'],
    keywords: ['json', 'formatear', 'validar', 'pretty', 'compactar'],
  }),
  entry({
    id: 'excelToXml', toolId: 'excelToXml', slug: 'excel-a-xml', category: 'spreadsheets',
    name: 'Excel a XML', icon: '⛃', accepts: 'excels',
    inputFormats: ['XLS', 'XLSX'], outputFormats: ['XML'],
    description: 'Convierte las hojas de un Excel a un documento XML estructurado con filas y celdas.',
    summary: 'Exporta tus hojas de cálculo a XML para intercambio de datos.',
    relatedTools: ['xmlToExcel', 'excelToJson', 'excelToCsv'], relatedSlugs: ['xml-a-excel', 'excel-a-json', 'excel-a-csv'],
    faq: faq([
      ['¿Cómo se estructura el XML?', 'Cada hoja se convierte en un elemento <hoja> con filas <fila> y celdas <celda>.'],
      ['¿Se incluyen todas las hojas?', 'Sí, todas las hojas del libro se incluyen en el documento.'],
    ]),
    instructions: ['Selecciona el archivo Excel.', 'La herramienta genera el XML.', 'Descarga el documento .xml.'],
    limitations: ['No se exportan estilos, comentarios ni fórmulas.', 'Los nombres de hoja se normalizan como identificadores XML.'],
    keywords: ['excel', 'xml', 'convertir', 'hoja', 'datos'],
  }),
  entry({
    id: 'jsonValidator', toolId: 'jsonValidator', slug: 'validar-json', category: 'spreadsheets',
    name: 'Validar JSON', icon: '✓', accepts: 'jsons',
    inputFormats: ['JSON'], outputFormats: ['TXT'],
    description: 'Valida la estructura de un archivo JSON y reporta errores de sintaxis con ubicación exacta.',
    summary: 'Comprueba si tu JSON es válido y dónde está el error si no lo es.',
    relatedTools: ['jsonFormatter', 'jsonToExcel', 'jsonToCsv'], relatedSlugs: ['formatear-json', 'json-a-excel', 'json-a-csv'],
    faq: faq([
      ['¿Qué errores detecta?', 'Detecta errores de sintaxis, comas mal colocadas, llaves sin cerrar y tipos inválidos.'],
      ['¿Genera un informe?', 'Sí, puedes descargar un informe TXT con el resultado y la posición del error.'],
    ]),
    instructions: ['Selecciona el archivo JSON.', 'La herramienta lo valida al instante.', 'Revisa el informe de validación.'],
    limitations: ['No valida esquemas JSON Schema, solo sintaxis.', 'El texto debe estar en codificación UTF-8.'],
    keywords: ['json', 'validar', 'validación', 'sintaxis', 'error'],
  }),

  // ─────────────────────────── DOCUMENTOS WORD (7) ───────────────────────────
  entry({
    id: 'wordStatistics', toolId: 'wordStatistics', slug: 'estadisticas-word', category: 'documents',
    name: 'Estadísticas Word', icon: '№', accepts: 'docs',
    inputFormats: ['DOC', 'DOCX'], outputFormats: ['TXT'],
    description: 'Obtén estadísticas de un documento Word: palabras, caracteres, párrafos y tiempo de lectura.',
    summary: 'Analiza documentos Word y obtén métricas de contenido al instante.',
    relatedTools: ['extractWord', 'compareWord', 'wordToTxt'], relatedSlugs: ['extraer-contenido-word', 'comparar-documentos-word', 'word-a-txt'],
    faq: faq([
      ['¿Qué métricas incluye?', 'Palabras, caracteres, párrafos, líneas y tiempo estimado de lectura.'],
      ['¿Funciona con DOC antiguos?', 'Sí, se admiten archivos .doc y .docx convirtiéndolos internamente.'],
    ]),
    instructions: ['Selecciona el documento Word.', 'La herramienta extrae el texto y calcula métricas.', 'Revisa las estadísticas.', 'Descarga el informe.'],
    limitations: ['Las notas al pie se incluyen según el extractor.', 'Documentos protegidos no se pueden analizar.'],
    keywords: ['word', 'estadísticas', 'palabras', 'caracteres', 'documento'],
  }),
  entry({
    id: 'markdownToWord', toolId: 'markdownToWord', slug: 'markdown-a-word', category: 'documents',
    name: 'Markdown a Word', icon: '⬇', accepts: 'text',
    inputFormats: ['MD', 'MARKDOWN'], outputFormats: ['DOCX'],
    description: 'Convierte archivos Markdown a documentos Word (.docx) con encabezados, listas y tablas.',
    summary: 'Transforma tu Markdown en un documento Word editable y profesional.',
    relatedTools: ['markdownToHtml', 'htmlToWord', 'wordToMarkdown'], relatedSlugs: ['markdown-a-html', 'html-a-word', 'word-a-markdown'],
    faq: faq([
      ['¿Se conservan los encabezados?', 'Sí, los encabezados Markdown se convierten en estilos de título de Word.'],
      ['¿Las tablas se convierten?', 'Sí, las tablas Markdown se transforman en tablas nativas de Word.'],
      ['¿Qué pasa con el código?', 'Los bloques de código se convierten en párrafos con fuente monoespaciada.'],
    ]),
    instructions: ['Selecciona el archivo Markdown.', 'La herramienta genera el documento.', 'Descarga el .docx resultante.'],
    limitations: ['Imágenes locales no se incrustan, solo las que usan URL.', 'Sintaxis avanzada como diagramas Mermaid no se convierte.'],
    keywords: ['markdown', 'word', 'docx', 'convertir', 'documento'],
  }),
  entry({
    id: 'markdownToHtml', toolId: 'markdownToHtml', slug: 'markdown-a-html', category: 'documents',
    name: 'Markdown a HTML', icon: '⬆', accepts: 'text',
    inputFormats: ['MD', 'MARKDOWN'], outputFormats: ['HTML'],
    description: 'Convierte Markdown a HTML semántico con encabezados, listas, tablas y código resaltable.',
    summary: 'Genera HTML limpio a partir de tu Markdown.',
    relatedTools: ['htmlToMarkdown', 'markdownToWord', 'htmlToText'], relatedSlugs: ['html-a-markdown', 'markdown-a-word', 'html-a-texto'],
    faq: faq([
      ['¿El HTML es accesible?', 'Sí, se generan encabezados semánticos y atributos alt en las imágenes.'],
      ['¿Incluye estilos?', 'Incluye un bloque de estilos básico opcional para una visualización rápida.'],
    ]),
    instructions: ['Selecciona el archivo Markdown.', 'La herramienta genera el HTML.', 'Descarga el archivo .html.'],
    limitations: ['El HTML generado no incluye CSS avanzado por defecto.', 'Los enlaces se conservan tal cual están en el Markdown.'],
    keywords: ['markdown', 'html', 'convertir', 'documento', 'web'],
  }),
  entry({
    id: 'htmlToWord', toolId: 'htmlToWord', slug: 'html-a-word', category: 'documents',
    name: 'HTML a Word', icon: '⭳', accepts: 'html',
    inputFormats: ['HTML', 'HTM'], outputFormats: ['DOCX'],
    description: 'Convierte contenido HTML a un documento Word (.docx) conservando encabezados, listas y tablas.',
    summary: 'Crea un documento Word a partir de tu HTML.',
    relatedTools: ['markdownToWord', 'htmlToMarkdown', 'wordToHtml'], relatedSlugs: ['markdown-a-word', 'html-a-markdown', 'word-a-html'],
    faq: faq([
      ['¿Se conserva el formato?', 'Sí, encabezados, párrafos, listas y tablas se mantienen como elementos de Word.'],
      ['¿Las imágenes se incrustan?', 'Las imágenes con URL se descargan e incrustan si es posible.'],
    ]),
    instructions: ['Selecciona el archivo HTML.', 'La herramienta lo convierte a Word.', 'Descarga el .docx.'],
    limitations: ['CSS avanzado no se traduce, solo la estructura semántica.', 'Los scripts del HTML se ignoran.'],
    keywords: ['html', 'word', 'docx', 'convertir', 'documento'],
  }),
  entry({
    id: 'csvToWord', toolId: 'csvToWord', slug: 'csv-a-word', category: 'documents',
    name: 'CSV a Word', icon: '▦', accepts: 'csvs',
    inputFormats: ['CSV', 'TSV'], outputFormats: ['DOCX'],
    description: 'Convierte un archivo CSV en un documento Word con una tabla de contenido.',
    summary: 'Crea una tabla profesional en Word a partir de tu CSV.',
    relatedTools: ['excelToWord', 'csvToExcel', 'csvToMarkdown'], relatedSlugs: ['excel-a-word', 'csv-a-excel', 'csv-a-markdown'],
    faq: faq([
      ['¿Cómo se genera la tabla?', 'La primera fila se usa como encabezado con estilo y el resto como cuerpo.'],
      ['¿Puedo elegir la orientación?', 'Sí, puedes elegir horizontal para tablas anchas.'],
    ]),
    instructions: ['Selecciona el archivo CSV.', 'Configura la orientación de la página.', 'Descarga el documento Word.'],
    limitations: ['Las celdas muy largas se ajustan automáticamente.', 'El delimitador debe ser detectable automáticamente.'],
    keywords: ['csv', 'word', 'tabla', 'documento', 'convertir'],
  }),
  entry({
    id: 'excelToWord', toolId: 'excelToWord', slug: 'excel-a-word', category: 'documents',
    name: 'Excel a Word', icon: '⌘', accepts: 'excels',
    inputFormats: ['XLS', 'XLSX'], outputFormats: ['DOCX'],
    description: 'Convierte una hoja de Excel en un documento Word con tabla y opciones de orientación.',
    summary: 'Exporta tu hoja de cálculo como documento Word editable.',
    relatedTools: ['csvToWord', 'excelToMarkdown', 'excelToHtml'], relatedSlugs: ['csv-a-word', 'excel-a-markdown', 'excel-a-html'],
    faq: faq([
      ['¿Qué hoja se convierte?', 'Puedes elegir la hoja activa o la primera disponible.'],
      ['¿Se conserva el formato numérico?', 'Los valores se convierten a texto preservando el formato mostrado.'],
    ]),
    instructions: ['Selecciona el archivo Excel.', 'Elige la hoja a convertir.', 'Configura la orientación.', 'Descarga el documento Word.'],
    limitations: ['Las fórmulas se exportan como su valor calculado.', 'Imágenes y gráficos de la hoja no se incluyen.'],
    keywords: ['excel', 'word', 'tabla', 'documento', 'convertir'],
  }),
  entry({
    id: 'compareWord', toolId: 'compareWord', slug: 'comparar-documentos-word', category: 'documents',
    name: 'Comparar documentos Word', icon: '⇄', accepts: 'docs',
    inputFormats: ['DOC', 'DOCX'], outputFormats: ['TXT'],
    description: 'Compara dos documentos Word línea por línea y obtén un informe de diferencias.',
    summary: 'Encuentra las diferencias entre dos versiones de un documento Word.',
    relatedTools: ['textDiff', 'extractWord', 'wordStatistics'], relatedSlugs: ['comparar-textos', 'extraer-contenido-word', 'estadisticas-word'],
    faq: faq([
      ['¿Cómo se comparan?', 'Se extrae el texto de ambos documentos y se comparan las líneas.'],
      ['¿Qué reporta el informe?', 'Líneas añadidas, eliminadas y modificadas entre ambos documentos.'],
    ]),
    instructions: ['Selecciona el primer documento Word.', 'Selecciona el segundo documento Word.', 'La herramienta compara y muestra el resumen.', 'Descarga el informe.'],
    limitations: ['La comparación es a nivel de texto, no de formato.', 'Documentos protegidos o con contraseña no se procesan.'],
    keywords: ['word', 'comparar', 'diferencias', 'documento', 'diff'],
  }),

  // ─────────────────────────── IMÁGENES (20) ───────────────────────────
  entry({
    id: 'resizeImage', toolId: 'resizeImage', slug: 'redimensionar-imagen-v2', category: 'images',
    name: 'Redimensionar imagen', icon: '⤢', accepts: 'image',
    inputFormats: ['JPG', 'PNG', 'WEBP', 'GIF', 'AVIF', 'BMP'], outputFormats: ['JPG', 'PNG', 'WEBP'],
    description: 'Redimensiona imágenes a un ancho y alto exactos conservando la proporción si lo deseas.',
    summary: 'Cambia el tamaño de tus imágenes a las dimensiones que necesites.',
    relatedTools: ['crop', 'rotateImage', 'convert'], relatedSlugs: ['recortar-y-redimensionar', 'girar-imagen', 'convertir-imagen'],
    faq: faq([
      ['¿Se conserva la calidad?', 'Puedes elegir la calidad de compresión en el formato de salida.'],
      ['¿Mantengo la proporción?', 'Sí, con la opción de mantener proporción el alto se ajusta automáticamente.'],
    ]),
    instructions: ['Selecciona la imagen.', 'Indica ancho y alto.', 'Elige el formato de salida.', 'Descarga la imagen redimensionada.'],
    limitations: ['Los GIF animados se reducen a su primer fotograma.', 'Redimensionar a tamaños enormes puede consumir mucha memoria.'],
    keywords: ['redimensionar', 'tamaño', 'imagen', 'píxeles', 'reescalar'],
  }),
  entry({
    id: 'rotateImage', toolId: 'rotateImage', slug: 'girar-imagen', category: 'images',
    name: 'Girar imagen', icon: '↻', accepts: 'image',
    inputFormats: ['JPG', 'PNG', 'WEBP', 'GIF', 'AVIF', 'BMP'], outputFormats: ['JPG', 'PNG', 'WEBP'],
    description: 'Rota imágenes 90°, 180° o 270° y voltea horizontal o verticalmente.',
    summary: 'Gira o voltea tus imágenes en la orientación correcta.',
    relatedTools: ['resizeImage', 'crop', 'convert'], relatedSlugs: ['redimensionar-imagen-v2', 'recortar-y-redimensionar', 'convertir-imagen'],
    faq: faq([
      ['¿Qué rotaciones soporta?', '90°, 180° y 270° en sentido horario, además de volteo horizontal y vertical.'],
      ['¿Corrige la orientación EXIF?', 'Sí, la orientación EXIF se aplica automáticamente antes de rotar.'],
    ]),
    instructions: ['Selecciona la imagen.', 'Elige la rotación o volteo.', 'Descarga la imagen corregida.'],
    limitations: ['Los GIF animados se procesan como imagen estática.'],
    keywords: ['girar', 'rotar', 'imagen', 'voltear', 'orientación'],
  }),
  entry({
    id: 'watermarkImage', toolId: 'watermarkImage', slug: 'marca-de-agua-imagen', category: 'images',
    name: 'Marca de agua', icon: '❖', accepts: 'image',
    inputFormats: ['JPG', 'PNG', 'WEBP'], outputFormats: ['JPG', 'PNG', 'WEBP'],
    description: 'Añade texto o una segunda imagen como marca de agua con opacidad y posición configurables.',
    summary: 'Protege tus imágenes con una marca de agua de texto o logo.',
    relatedTools: ['borderImage', 'annotateImage', 'crop'], relatedSlugs: ['agregar-borde-imagen', 'anotar-imagen', 'recortar-y-redimensionar'],
    faq: faq([
      ['¿Puedo usar un logo?', 'Sí, puedes cargar una segunda imagen como marca de agua además de texto.'],
      ['¿Controlo la opacidad?', 'Sí, puedes ajustar la opacidad entre 0 y 100%.'],
    ]),
    instructions: ['Selecciona la imagen base.', 'Escribe el texto o selecciona el logo.', 'Configura opacidad y posición.', 'Descarga la imagen con marca de agua.'],
    limitations: ['El texto usa fuentes disponibles del navegador.', 'Para logos se recomienda PNG con fondo transparente.'],
    keywords: ['marca de agua', 'watermark', 'imagen', 'logo', 'proteger'],
  }),
  entry({
    id: 'borderImage', toolId: 'borderImage', slug: 'agregar-borde-imagen', category: 'images',
    name: 'Agregar borde', icon: '▭', accepts: 'image',
    inputFormats: ['JPG', 'PNG', 'WEBP'], outputFormats: ['JPG', 'PNG', 'WEBP'],
    description: 'Añade un borde de color y grosor configurables alrededor de una imagen.',
    summary: 'Da un toque profesional a tus imágenes con un borde de color.',
    relatedTools: ['watermarkImage', 'resizeImage', 'crop'], relatedSlugs: ['marca-de-agua-imagen', 'redimensionar-imagen-v2', 'recortar-y-redimensionar'],
    faq: faq([
      ['¿Puedo elegir el color?', 'Sí, con el selector de color puedes elegir cualquier tono.'],
      ['¿Cuánto borde añade?', 'Puedes indicar el grosor en píxeles, normalmente entre 1 y 100.'],
    ]),
    instructions: ['Selecciona la imagen.', 'Elige el grosor y color del borde.', 'Descarga la imagen con borde.'],
    limitations: ['El borde se añade al lienzo, por lo que el archivo puede crecer ligeramente.'],
    keywords: ['borde', 'imagen', 'marco', 'color', 'grosor'],
  }),
  entry({
    id: 'brightnessContrastImage', toolId: 'brightnessContrastImage', slug: 'brillo-contraste-imagen', category: 'images',
    name: 'Brillo y contraste', icon: '◐', accepts: 'image',
    inputFormats: ['JPG', 'PNG', 'WEBP', 'GIF', 'AVIF', 'BMP'], outputFormats: ['JPG', 'PNG', 'WEBP'],
    description: 'Ajusta el brillo y el contraste de una imagen con controles deslizantes precisos.',
    summary: 'Corrige la iluminación de tus fotos ajustando brillo y contraste.',
    relatedTools: ['saturationImage', 'grayscaleImage', 'enhanceScannedDocument'], relatedSlugs: ['saturacion-tono-imagen', 'escala-de-grises', 'mejorar-documento-escaneado'],
    faq: faq([
      ['¿Qué rango tiene el brillo?', 'El brillo se ajusta entre -100 y +100.'],
      ['¿Se puede previsualizar?', 'Sí, la vista previa se actualiza en tiempo real al mover los controles.'],
    ]),
    instructions: ['Selecciona la imagen.', 'Ajusta brillo y contraste.', 'Descarga la imagen corregida.'],
    limitations: ['Ajustes extremos pueden provocar pérdida de detalle en las zonas claras u oscuras.'],
    keywords: ['brillo', 'contraste', 'imagen', 'foto', 'iluminación'],
  }),
  entry({
    id: 'saturationImage', toolId: 'saturationImage', slug: 'saturacion-tono-imagen', category: 'images',
    name: 'Saturación y tono', icon: '◎', accepts: 'image',
    inputFormats: ['JPG', 'PNG', 'WEBP', 'GIF', 'AVIF', 'BMP'], outputFormats: ['JPG', 'PNG', 'WEBP'],
    description: 'Ajusta la saturación y el tono de color de una imagen para obtener colores vivos o suaves.',
    summary: 'Controla la intensidad de color de tus fotos.',
    relatedTools: ['brightnessContrastImage', 'duotoneImage', 'sepiaImage'], relatedSlugs: ['brillo-contraste-imagen', 'efecto-duotono', 'filtro-sepia'],
    faq: faq([
      ['¿Qué hace la saturación negativa?', 'Reduce los colores hacia escala de grises. -100 produce una imagen en grises.'],
      ['¿Qué hace el tono?', 'Desplaza los colores alrededor de la rueda cromática.'],
    ]),
    instructions: ['Selecciona la imagen.', 'Ajusta saturación y tono.', 'Descarga el resultado.'],
    limitations: ['Ajustes extremos de tono pueden producir colores no deseados en pieles.'],
    keywords: ['saturación', 'tono', 'color', 'imagen', 'foto'],
  }),
  entry({
    id: 'grayscaleImage', toolId: 'grayscaleImage', slug: 'escala-de-grises', category: 'images',
    name: 'Escala de grises', icon: '◑', accepts: 'image',
    inputFormats: ['JPG', 'PNG', 'WEBP', 'GIF', 'AVIF', 'BMP'], outputFormats: ['JPG', 'PNG', 'WEBP'],
    description: 'Convierte cualquier imagen a escala de grises (blanco y negro) con un clic.',
    summary: 'Transforma tus fotos a blanco y negro clásico.',
    relatedTools: ['sepiaImage', 'thresholdImage', 'invertColorsImage'], relatedSlugs: ['filtro-sepia', 'umbral-binario', 'invertir-colores'],
    faq: faq([
      ['¿El resultado es en blanco y negro puro?', 'Sí, usa la luminancia estándar para convertir cada píxel a gris.'],
      ['¿Conserva la calidad?', 'Sí, la conversión no degrada la imagen salvo por la compresión del formato de salida.'],
    ]),
    instructions: ['Selecciona la imagen.', 'La herramienta la convierte a grises.', 'Descarga el resultado.'],
    limitations: ['No se recupera el color una vez convertido el archivo.'],
    keywords: ['escala de grises', 'blanco y negro', 'imagen', 'gris', 'monocromo'],
  }),
  entry({
    id: 'sepiaImage', toolId: 'sepiaImage', slug: 'filtro-sepia', category: 'images',
    name: 'Filtro sepia', icon: '◗', accepts: 'image',
    inputFormats: ['JPG', 'PNG', 'WEBP', 'GIF', 'AVIF', 'BMP'], outputFormats: ['JPG', 'PNG', 'WEBP'],
    description: 'Aplica un filtro sepia vintage a cualquier imagen.',
    summary: 'Dale a tus fotos el clásico tono sepia antiguo.',
    relatedTools: ['grayscaleImage', 'duotoneImage', 'saturationImage'], relatedSlugs: ['escala-de-grises', 'efecto-duotono', 'saturacion-tono-imagen'],
    faq: faq([
      ['¿Qué es el efecto sepia?', 'Es un tono marrón cálido que simula fotografías antiguas.'],
      ['¿Puedo ajustar la intensidad?', 'Sí, puedes controlar la intensidad del efecto entre 0 y 100%.'],
    ]),
    instructions: ['Selecciona la imagen.', 'Ajusta la intensidad del sepia.', 'Descarga el resultado.'],
    limitations: ['El efecto es irreversible una vez descargado.'],
    keywords: ['sepia', 'filtro', 'vintage', 'imagen', 'foto'],
  }),
  entry({
    id: 'invertColorsImage', toolId: 'invertColorsImage', slug: 'invertir-colores', category: 'images',
    name: 'Invertir colores', icon: '⬒', accepts: 'image',
    inputFormats: ['JPG', 'PNG', 'WEBP', 'GIF', 'AVIF', 'BMP'], outputFormats: ['JPG', 'PNG', 'WEBP'],
    description: 'Invierte todos los colores de una imagen para crear un efecto de negativo fotográfico.',
    summary: 'Convierte tu imagen a su negativo invirtiendo los colores.',
    relatedTools: ['grayscaleImage', 'thresholdImage', 'sepiaImage'], relatedSlugs: ['escala-de-grises', 'umbral-binario', 'filtro-sepia'],
    faq: faq([
      ['¿Qué produce la inversión?', 'Cada color se reemplaza por su complemento (blanco a negro, rojo a cian...).'],
      ['¿Funciona con imágenes PNG con transparencia?', 'Sí, el canal alfa se conserva y solo se invierten los colores visibles.'],
    ]),
    instructions: ['Selecciona la imagen.', 'La herramienta invierte los colores.', 'Descarga el negativo.'],
    limitations: ['Las imágenes con alfa se procesan conservando la transparencia.'],
    keywords: ['invertir', 'colores', 'negativo', 'imagen', 'efecto'],
  }),
  entry({
    id: 'blurImage', toolId: 'blurImage', slug: 'desenfocar-imagen', category: 'images',
    name: 'Desenfocar imagen', icon: '◌', accepts: 'image',
    inputFormats: ['JPG', 'PNG', 'WEBP', 'GIF', 'AVIF', 'BMP'], outputFormats: ['JPG', 'PNG', 'WEBP'],
    description: 'Aplica un desenfoque gaussiano con radio configurable para suavizar o difuminar.',
    summary: 'Suaviza imágenes con un desenfoque gaussiano ajustable.',
    relatedTools: ['sharpenImage', 'pixelateImage', 'enhanceScannedDocument'], relatedSlugs: ['enfocar-imagen', 'pixelar-imagen', 'mejorar-documento-escaneado'],
    faq: faq([
      ['¿Qué radio usar?', 'Entre 1 y 20. Valores altos producen un desenfoque muy marcado.'],
      ['¿Es un desenfoque gaussiano?', 'Sí, se aplica una convolución gaussiana sobre la imagen.'],
    ]),
    instructions: ['Selecciona la imagen.', 'Ajusta el radio del desenfoque.', 'Descarga el resultado.'],
    limitations: ['Radios muy altos aumentan el tiempo de procesamiento en imágenes grandes.'],
    keywords: ['desenfocar', 'blur', 'imagen', 'suavizar', 'difuminar'],
  }),
  entry({
    id: 'sharpenImage', toolId: 'sharpenImage', slug: 'enfocar-imagen', category: 'images',
    name: 'Enfocar imagen', icon: '⊕', accepts: 'image',
    inputFormats: ['JPG', 'PNG', 'WEBP', 'GIF', 'AVIF', 'BMP'], outputFormats: ['JPG', 'PNG', 'WEBP'],
    description: 'Aumenta la nitidez de una imagen realzando los bordes y detalles.',
    summary: 'Mejora la definición de tus fotos con un filtro de enfoque.',
    relatedTools: ['blurImage', 'detectEdgesImage', 'enhanceScannedDocument'], relatedSlugs: ['desenfocar-imagen', 'detectar-bordes-imagen', 'mejorar-documento-escaneado'],
    faq: faq([
      ['¿Cómo funciona el enfoque?', 'Realza el contraste entre píxeles adyacentes para resaltar los bordes.'],
      ['¿Qué intensidad usar?', 'Entre 0 y 2. Valores muy altos pueden crear halos alrededor de los bordes.'],
    ]),
    instructions: ['Selecciona la imagen.', 'Ajusta la intensidad de enfoque.', 'Descarga la imagen enfocada.'],
    limitations: ['Enfocar en exceso puede introducir ruido visible.'],
    keywords: ['enfocar', 'nitidez', 'imagen', 'sharpen', 'detalle'],
  }),
  entry({
    id: 'detectEdgesImage', toolId: 'detectEdgesImage', slug: 'detectar-bordes-imagen', category: 'images',
    name: 'Detectar bordes', icon: '⛉', accepts: 'image',
    inputFormats: ['JPG', 'PNG', 'WEBP', 'GIF', 'AVIF', 'BMP'], outputFormats: ['PNG', 'JPG', 'WEBP'],
    description: 'Aplica un filtro de detección de bordes para resaltar los contornos de la imagen.',
    summary: 'Convierte tu imagen en un mapa de bordes artístico o técnico.',
    relatedTools: ['sharpenImage', 'thresholdImage', 'grayscaleImage'], relatedSlugs: ['enfocar-imagen', 'umbral-binario', 'escala-de-grises'],
    faq: faq([
      ['¿Qué filtro usa?', 'Usa el operador de Sobel para calcular los gradientes de intensidad.'],
      ['¿El resultado es en blanco y negro?', 'Sí, por defecto los bordes se muestran en negro sobre fondo blanco.'],
    ]),
    instructions: ['Selecciona la imagen.', 'Configura el umbral de sensibilidad.', 'Descarga el mapa de bordes.'],
    limitations: ['Imágenes con mucho ruido pueden producir bordes falsos.'],
    keywords: ['bordes', 'detección', 'sobel', 'imagen', 'contorno'],
  }),
  entry({
    id: 'thresholdImage', toolId: 'thresholdImage', slug: 'umbral-binario', category: 'images',
    name: 'Umbral binario', icon: '▮▯', accepts: 'image',
    inputFormats: ['JPG', 'PNG', 'WEBP', 'GIF', 'AVIF', 'BMP'], outputFormats: ['PNG', 'JPG', 'WEBP'],
    description: 'Convierte una imagen a blanco y negro puro aplicando un umbral de luminosidad.',
    summary: 'Binariza tu imagen según un umbral ajustable.',
    relatedTools: ['grayscaleImage', 'detectEdgesImage', 'invertColorsImage'], relatedSlugs: ['escala-de-grises', 'detectar-bordes-imagen', 'invertir-colores'],
    faq: faq([
      ['¿Qué es el umbral?', 'El valor de luminosidad (0-255) a partir del cual un píxel se vuelve blanco.'],
      ['¿Es útil para documentos?', 'Sí, ideal para escaneos y OCR mejorando el contraste.'],
    ]),
    instructions: ['Selecciona la imagen.', 'Ajusta el umbral.', 'Descarga la imagen binarizada.'],
    limitations: ['Imágenes con degradados pierden información tonal.'],
    keywords: ['umbral', 'binario', 'blanco y negro', 'imagen', 'binarizar'],
  }),
  entry({
    id: 'combineImagesImage', toolId: 'combineImagesImage', slug: 'combinar-imagenes', category: 'images',
    name: 'Combinar imágenes', icon: '▰', accepts: 'images',
    inputFormats: ['JPG', 'PNG', 'WEBP'], outputFormats: ['PNG', 'JPG', 'WEBP'],
    description: 'Une varias imágenes en una sola cuadrícula horizontal o vertical con espaciado configurable.',
    summary: 'Crea una composición uniendo varias imágenes en fila o columna.',
    relatedTools: ['imagesPdf', 'mergePdf', 'resizeImage'], relatedSlugs: ['imagenes-a-pdf', 'unir-pdf', 'redimensionar-imagen-v2'],
    faq: faq([
      ['¿Cómo se unen las imágenes?', 'Se colocan en una sola fila (horizontal) o columna (vertical) alineadas al centro.'],
      ['¿Qué formato de salida usar?', 'Se recomienda PNG para composiciones con transparencia.'],
    ]),
    instructions: ['Selecciona dos o más imágenes.', 'Elige la dirección de unión.', 'Configura el espaciado.', 'Descarga la imagen combinada.'],
    limitations: ['Las imágenes se redimensionan a la misma altura/ancho para la composición.', 'Máximo 10 imágenes por composición.'],
    keywords: ['combinar', 'imágenes', 'unir', 'composición', 'collage'],
  }),
  entry({
    id: 'annotateImage', toolId: 'annotateImage', slug: 'anotar-imagen', category: 'images',
    name: 'Anotar imagen', icon: '✎', accepts: 'image',
    inputFormats: ['JPG', 'PNG', 'WEBP'], outputFormats: ['PNG', 'JPG', 'WEBP'],
    description: 'Añade texto y flechas a una imagen para anotarla con fines educativos o de trabajo.',
    summary: 'Marca tus imágenes con textos y flechas señaladoras.',
    relatedTools: ['watermarkImage', 'borderImage', 'crop'], relatedSlugs: ['marca-de-agua-imagen', 'agregar-borde-imagen', 'recortar-y-redimensionar'],
    faq: faq([
      ['¿Qué elementos puedo añadir?', 'Textos con tamaño y color configurables, además de flechas de señalización.'],
      ['¿Puedo mover las anotaciones?', 'Sí, puedes arrastrar cada anotación a la posición deseada.'],
    ]),
    instructions: ['Selecciona la imagen.', 'Añade textos o flechas.', 'Ajusta posición y estilo.', 'Descarga la imagen anotada.'],
    limitations: ['Las anotaciones se rasterizan, no se conservan como capas editables.'],
    keywords: ['anotar', 'texto', 'imagen', 'flechas', 'marcar'],
  }),
  entry({
    id: 'trimImage', toolId: 'trimImage', slug: 'recortar-bordes-vacios', category: 'images',
    name: 'Recortar bordes vacíos', icon: '▢', accepts: 'image',
    inputFormats: ['JPG', 'PNG', 'WEBP', 'GIF', 'AVIF', 'BMP'], outputFormats: ['PNG', 'JPG', 'WEBP'],
    description: 'Elimina automáticamente los bordes de un color uniforme que rodean tu imagen.',
    summary: 'Recorta automáticamente el espacio vacío de los bordes.',
    relatedTools: ['crop', 'resizeImage', 'circleCropImage'], relatedSlugs: ['recortar-y-redimensionar', 'redimensionar-imagen-v2', 'recorte-circular'],
    faq: faq([
      ['¿Qué color se considera vacío?', 'El color de las esquinas se usa como referencia para el borde.'],
      ['¿Puedo ajustar la tolerancia?', 'Sí, la tolerancia permite eliminar bordes ligeramente degradados.'],
    ]),
    instructions: ['Selecciona la imagen.', 'Ajusta la tolerancia si es necesario.', 'Descarga la imagen recortada.'],
    limitations: ['Imágenes con textura en los bordes pueden requerir mayor tolerancia.'],
    keywords: ['recortar', 'bordes', 'vacíos', 'imagen', 'automático'],
  }),
  entry({
    id: 'circleCropImage', toolId: 'circleCropImage', slug: 'recorte-circular', category: 'images',
    name: 'Recorte circular', icon: '◉', accepts: 'image',
    inputFormats: ['JPG', 'PNG', 'WEBP', 'GIF', 'AVIF', 'BMP'], outputFormats: ['PNG', 'WEBP'],
    description: 'Recorta una imagen en forma circular con fondo transparente, ideal para avatares.',
    summary: 'Crea avatares circulares con fondo transparente.',
    relatedTools: ['crop', 'trimImage', 'socialCrop'], relatedSlugs: ['recortar-y-redimensionar', 'recortar-bordes-vacios', 'recortar-para-redes'],
    faq: faq([
      ['¿Qué formato debo elegir?', 'PNG o WebP para conservar el fondo transparente fuera del círculo.'],
      ['¿Qué tamaño tiene el círculo?', 'El diámetro es el lado menor de la imagen, centrado automáticamente.'],
    ]),
    instructions: ['Selecciona la imagen.', 'La herramienta genera el recorte circular.', 'Descarga como PNG o WebP.'],
    limitations: ['Si eliges JPG, el fondo exterior se volverá blanco.'],
    keywords: ['circular', 'recorte', 'avatar', 'imagen', 'círculo'],
  }),
  entry({
    id: 'pixelateImage', toolId: 'pixelateImage', slug: 'pixelar-imagen', category: 'images',
    name: 'Pixelar imagen', icon: '▦', accepts: 'image',
    inputFormats: ['JPG', 'PNG', 'WEBP', 'GIF', 'AVIF', 'BMP'], outputFormats: ['PNG', 'JPG', 'WEBP'],
    description: 'Aplica un efecto de pixelación a toda la imagen con un nivel de bloque ajustable.',
    summary: 'Pixeliza tus imágenes para efectos retro o para ocultar zonas.',
    relatedTools: ['blurImage', 'sharpenImage', 'thresholdImage'], relatedSlugs: ['desenfocar-imagen', 'enfocar-imagen', 'umbral-binario'],
    faq: faq([
      ['¿Qué tamaño de bloque usar?', 'Entre 2 y 64 píxeles. Valores altos producen más pixelación.'],
      ['¿Es reversible?', 'No, la pixelación pierde información de forma irreversible.'],
    ]),
    instructions: ['Selecciona la imagen.', 'Ajusta el tamaño del bloque.', 'Descarga la imagen pixelada.'],
    limitations: ['Pixelar zonas específicas requiere la herramienta completa en futuras versiones.'],
    keywords: ['pixelar', 'píxeles', 'imagen', 'retro', 'mosaico'],
  }),
  entry({
    id: 'duotoneImage', toolId: 'duotoneImage', slug: 'efecto-duotono', category: 'images',
    name: 'Efecto duotono', icon: '◪', accepts: 'image',
    inputFormats: ['JPG', 'PNG', 'WEBP', 'GIF', 'AVIF', 'BMP'], outputFormats: ['PNG', 'JPG', 'WEBP'],
    description: 'Aplica un efecto duotono combinando dos colores personalizables a la imagen.',
    summary: 'Crea imágenes con dos colores para un look artístico y moderno.',
    relatedTools: ['sepiaImage', 'grayscaleImage', 'saturationImage'], relatedSlugs: ['filtro-sepia', 'escala-de-grises', 'saturacion-tono-imagen'],
    faq: faq([
      ['¿Cómo funciona el duotono?', 'La imagen se convierte a grises y luego cada tono se mapea entre los dos colores elegidos.'],
      ['¿Qué colores elegir?', 'Puedes usar el selector para elegir las sombras y las luces.'],
    ]),
    instructions: ['Selecciona la imagen.', 'Elige los dos colores del duotono.', 'Descarga el resultado.'],
    limitations: ['Las imágenes con muchos colores pierden su paleta original.'],
    keywords: ['duotono', 'dos colores', 'imagen', 'efecto', 'artístico'],
  }),
  entry({
    id: 'histogramImage', toolId: 'histogramImage', slug: 'histograma-imagen', category: 'images',
    name: 'Histograma de imagen', icon: '▂▄▆', accepts: 'image',
    inputFormats: ['JPG', 'PNG', 'WEBP', 'GIF', 'AVIF', 'BMP'], outputFormats: ['PNG', 'TXT'],
    description: 'Genera el histograma RGB de luminancia de una imagen y descarga el análisis.',
    summary: 'Analiza la distribución tonal de tu imagen con un histograma.',
    relatedTools: ['brightnessContrastImage', 'thresholdImage', 'enhanceScannedDocument'], relatedSlugs: ['brillo-contraste-imagen', 'umbral-binario', 'mejorar-documento-escaneado'],
    faq: faq([
      ['¿Qué muestra el histograma?', 'La distribución de luminosidad de la imagen, útil para detectar exposición.'],
      ['¿Puedo descargar el gráfico?', 'Sí, puedes descargar el histograma como PNG.'],
    ]),
    instructions: ['Selecciona la imagen.', 'La herramienta calcula el histograma.', 'Revisa el gráfico en pantalla.', 'Descarga el PNG o el informe.'],
    limitations: ['El análisis se hace sobre la imagen completa, no por zonas.'],
    keywords: ['histograma', 'imagen', 'luminancia', 'exposición', 'análisis'],
  }),

  // ─────────────────────────── PDF (6) ───────────────────────────
  entry({
    id: 'flattenPdf', toolId: 'flattenPdf', slug: 'aplanar-pdf', category: 'pdf',
    name: 'Aplanar PDF', icon: '▭', accepts: 'pdfs',
    inputFormats: ['PDF'], outputFormats: ['PDF'],
    description: 'Combina las capas de un PDF en una sola para que los campos y anotaciones queden fijados.',
    summary: 'Convierte formularios y anotaciones en contenido fijo del documento.',
    relatedTools: ['fillFormPdf', 'annotatePdf', 'redactPdf'], relatedSlugs: ['rellenar-formulario-pdf', 'anotar-pdf', 'redactar-pdf'],
    faq: faq([
      ['¿Qué hace exactamente?', 'Rasteriza o fija los elementos interactivos para que no puedan editarse ni eliminarse.'],
      ['¿Por qué aplanar un PDF?', 'Para evitar que se modifiquen campos de formulario o anotaciones al enviar el documento.'],
    ]),
    instructions: ['Selecciona el PDF.', 'La herramienta aplanará las capas.', 'Descarga el PDF aplanado.'],
    limitations: ['Los archivos escaneados ya vienen aplanados de fábrica.', 'El texto seleccionable se conserva según el método de aplanado.'],
    keywords: ['aplanar', 'pdf', 'capas', 'formulario', 'fijar'],
  }),
  entry({
    id: 'extractTextPdf', toolId: 'extractTextPdf', slug: 'extraer-texto-pdf', category: 'pdf',
    name: 'Extraer texto PDF', icon: '¶', accepts: 'pdfs',
    inputFormats: ['PDF'], outputFormats: ['TXT'],
    description: 'Extrae todo el texto seleccionable de un PDF y lo descarga como archivo de texto.',
    summary: 'Obtén el texto de un PDF en un archivo TXT editable.',
    relatedTools: ['extractWord', 'pdfToImages', 'scannedPdfToSearchablePdf'], relatedSlugs: ['extraer-contenido-word', 'pdf-a-imagenes', 'pdf-escaneado-a-pdf-buscable'],
    faq: faq([
      ['¿Funciona con PDF escaneados?', 'No directamente. Para PDF escaneados usa primero la herramienta de OCR a PDF buscable.'],
      ['¿Se conservan los saltos de página?', 'Sí, se añade una separación al final de cada página.'],
    ]),
    instructions: ['Selecciona el PDF.', 'La herramienta extrae el texto.', 'Descarga el archivo TXT.'],
    limitations: ['El texto depende de la calidad de la capa de texto del PDF.', 'No se extraen imágenes ni tablas estructuradas.'],
    keywords: ['extraer', 'texto', 'pdf', 'txt', 'contenido'],
  }),
  entry({
    id: 'fillFormPdf', toolId: 'fillFormPdf', slug: 'rellenar-formulario-pdf', category: 'pdf',
    name: 'Rellenar formulario PDF', icon: '✎', accepts: 'pdfs',
    inputFormats: ['PDF'], outputFormats: ['PDF'],
    description: 'Rellena los campos de texto de un formulario PDF y descarga el documento completado.',
    summary: 'Completa formularios PDF directamente en el navegador.',
    relatedTools: ['flattenPdf', 'annotatePdf', 'signPdf'], relatedSlugs: ['aplanar-pdf', 'anotar-pdf', 'firmar-pdf'],
    faq: faq([
      ['¿Qué campos soporta?', 'Campos de texto y áreas de texto de formularios AcroForm.'],
      ['¿El PDF rellenado se puede guardar?', 'Sí, se descarga un PDF con los campos completados.'],
    ]),
    instructions: ['Selecciona el formulario PDF.', 'Rellena los campos detectados.', 'Descarga el formulario completado.'],
    limitations: ['Los campos de selección y casillas requieren PDFLib y se procesan por separado.', 'Formularios mal construidos pueden no detectar todos los campos.'],
    keywords: ['rellenar', 'formulario', 'pdf', 'campos', 'completar'],
  }),
  entry({
    id: 'annotatePdf', toolId: 'annotatePdf', slug: 'anotar-pdf', category: 'pdf',
    name: 'Anotar PDF', icon: '🗒', accepts: 'pdfs',
    inputFormats: ['PDF'], outputFormats: ['PDF'],
    description: 'Añade notas, resaltados y subrayados a tu PDF y descarga el documento anotado.',
    summary: 'Marca y anota tus PDFs para revisión y estudio.',
    relatedTools: ['redactPdf', 'signPdf', 'flattenPdf'], relatedSlugs: ['redactar-pdf', 'firmar-pdf', 'aplanar-pdf'],
    faq: faq([
      ['¿Qué anotaciones puedo añadir?', 'Notas de texto, resaltados de color y subrayados.'],
      ['¿Se guardan en el PDF?', 'Sí, se incrustan como anotaciones nativas del documento.'],
    ]),
    instructions: ['Selecciona el PDF.', 'Elige el tipo de anotación y la página.', 'Añade la nota o marca.', 'Descarga el PDF anotado.'],
    limitations: ['Las anotaciones se añaden en posiciones aproximadas según el número de página.', 'Revisa el resultado en tu visor de PDF.'],
    keywords: ['anotar', 'pdf', 'notas', 'resaltar', 'comentar'],
  }),
  entry({
    id: 'redactPdf', toolId: 'redactPdf', slug: 'redactar-pdf', category: 'pdf',
    name: 'Redactar PDF', icon: '▨', accepts: 'pdfs',
    inputFormats: ['PDF'], outputFormats: ['PDF'],
    description: 'Oculta de forma permanente texto o zonas sensibles de un PDF pintando sobre ellas.',
    summary: 'Protege información confidencial redactando zonas del PDF.',
    relatedTools: ['annotatePdf', 'flattenPdf', 'censor'], relatedSlugs: ['anotar-pdf', 'aplanar-pdf', 'censurar'],
    faq: faq([
      ['¿La redacción es irreversible?', 'Sí, una vez redactada la zona queda cubierta de forma permanente.'],
      ['¿Puedo redactar por palabra clave?', 'En esta versión se redacta pintando la zona manualmente.'],
    ]),
    instructions: ['Selecciona el PDF.', 'Pinta sobre las zonas a ocultar.', 'Descarga el PDF redactado.'],
    limitations: ['Asegúrate de revisar todas las páginas antes de compartir el documento.'],
    keywords: ['redactar', 'pdf', 'ocultar', 'confidencial', 'tachar'],
  }),
  entry({
    id: 'extractImagesPdf', toolId: 'extractImagesPdf', slug: 'extraer-imagenes-pdf', category: 'pdf',
    name: 'Extraer imágenes PDF', icon: '🖼', accepts: 'pdfs',
    inputFormats: ['PDF'], outputFormats: ['PNG', 'JPG', 'WEBP', 'ZIP'],
    description: 'Extrae las imágenes embebidas de un PDF y las descarga individualmente o en un ZIP.',
    summary: 'Recupera todas las imágenes contenidas en un PDF.',
    relatedTools: ['pdfToImages', 'extractTextPdf', 'imagesPdf'], relatedSlugs: ['pdf-a-imagenes', 'extraer-texto-pdf', 'imagenes-a-pdf'],
    faq: faq([
      ['¿Cómo se extraen las imágenes?', 'Se renderizan los objetos de imagen de cada página con su resolución original.'],
      ['¿Qué formato se usa?', 'Se conserva el formato original cuando es posible o se convierte a PNG.'],
    ]),
    instructions: ['Selecciona el PDF.', 'Elige el formato de salida.', 'Descarga las imágenes individuales o en ZIP.'],
    limitations: ['Las imágenes enmascaradas o muy comprimidas pueden requerir conversión.', 'Los PDF escaneados contienen una única imagen por página.'],
    keywords: ['extraer', 'imágenes', 'pdf', 'imagenes', 'recuperar'],
  }),
];

function validate() {
  const tools = JSON.parse(readFileSync(TOOLS_PATH, 'utf8'));
  const existingById = new Set(tools.map((t) => t.id));
  const existingBySlug = new Set(tools.map((t) => t.slug));
  const existingByToolId = new Set(tools.map((t) => t.toolId));
  const problems = [];
  const collisions = [];
  const seen = new Set();

  for (const s of SPECS) {
    if (seen.has(s.id)) problems.push(`ID duplicado dentro del spec: ${s.id}`);
    seen.add(s.id);
    if (existingById.has(s.id)) collisions.push(`ID ya escrito en tools.json: ${s.id}`);
    if (existingByToolId.has(s.toolId)) collisions.push(`toolId ya escrito en tools.json: ${s.toolId}`);
    if (existingBySlug.has(s.slug)) collisions.push(`slug ya escrito en tools.json: ${s.slug}`);
    for (const f of ['id', 'toolId', 'slug', 'category', 'name', 'description', 'summary', 'accepts', 'icon']) {
      if (!s[f]) problems.push(`${s.id}: falta campo "${f}"`);
    }
    if (!Array.isArray(s.faq) || s.faq.length < 2) problems.push(`${s.id}: faq debe tener al menos 2 entradas`);
    if (!Array.isArray(s.instructions) || s.instructions.length < 3) problems.push(`${s.id}: instructions debe tener al menos 3 entradas`);
    if (!Array.isArray(s.keywords) || s.keywords.length < 3) problems.push(`${s.id}: keywords debe tener al menos 3 entradas`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.slug)) problems.push(`${s.id}: slug no es URL-safe`);
  }

  const counts = {};
  for (const s of SPECS) counts[s.category] = (counts[s.category] || 0) + 1;

  console.log('=== batch6-spec.mjs — Validación del catálogo de expansión ===');
  console.log(`Herramientas definidas: ${SPECS.length}`);
  console.log('Por categoría:', JSON.stringify(counts));
  console.log(`Herramientas existentes: ${tools.length} → total objetivo: ${tools.length + SPECS.length}`);
  if (collisions.length) {
    console.log(`\n${collisions.length} entradas ya escritas en fases previas (se omiten en --write):`);
    collisions.forEach((p) => console.log('  · ' + p));
  }
  if (problems.length) {
    console.error(`\n${problems.length} problema(s) real(es):`);
    problems.forEach((p) => console.error('  ✗ ' + p));
    process.exit(1);
  }
  console.log('\n✓ Sin colisiones pendientes: todos los id, toolId y slug sin escribir son nuevos y únicos.');
  return true;
}

function write() {
  const tools = JSON.parse(readFileSync(TOOLS_PATH, 'utf8'));
  const categories = JSON.parse(readFileSync(CATEGORIES_PATH, 'utf8'));

  const byId = new Set(tools.map((t) => t.id));
  const bySlug = new Set(tools.map((t) => t.slug));
  const selected = CATEGORY_FILTER
    ? SPECS.filter((s) => s.category === CATEGORY_FILTER)
    : SPECS;
  const newTools = selected.filter((s) => !byId.has(s.id) && !bySlug.has(s.slug));

  const merged = tools.concat(newTools.map((s) => ({ ...s })));
  writeFileSync(TOOLS_PATH, JSON.stringify(merged, null, 2) + '\n');

  const catById = {};
  for (const c of categories) {
    catById[c.id] = c;
    c.toolIds = c.toolIds || [];
    c.slugs = c.slugs || [];
  }
  for (const s of newTools) {
    const cat = catById[s.category];
    if (cat) {
      if (!cat.toolIds.includes(s.toolId)) cat.toolIds.push(s.toolId);
      if (!cat.slugs.includes(s.slug)) cat.slugs.push(s.slug);
    }
  }
  writeFileSync(CATEGORIES_PATH, JSON.stringify(categories, null, 2) + '\n');

  const label = CATEGORY_FILTER ? ` (categoría ${CATEGORY_FILTER})` : '';
  console.log(`Escrito: ${newTools.length} herramientas nuevas${label} en tools.json (total ${merged.length}).`);
  console.log('Categorías actualizadas con toolIds y slugs.');
}

function report() {
  const counts = {};
  for (const s of SPECS) {
    counts[s.category] = (counts[s.category] || 0) + 1;
  }
  console.log('=== Informe batch6 (Fase 3D: 56 herramientas) ===');
  console.log(`Total: ${SPECS.length} herramientas nuevas (53 solicitadas + 3 sustitutos).`);
  console.log('Sustitutos: extractImagesPdf (por pdfToImages), excelToXml (por jsonToCsv), jsonValidator (por jsonToExcel).');
  console.log('Por categoría:', JSON.stringify(counts));
  console.log(`Catálogo resultante: ${JSON.parse(readFileSync(TOOLS_PATH, 'utf8')).length + SPECS.length} herramientas.`);
}

function syncCategories() {
  const tools = JSON.parse(readFileSync(TOOLS_PATH, 'utf8'));
  const categories = JSON.parse(readFileSync(CATEGORIES_PATH, 'utf8'));

  const catById = {};
  for (const c of categories) {
    catById[c.id] = c;
    c.toolIds = c.toolIds || [];
    c.slugs = c.slugs || [];
  }

  let addedIds = 0;
  let addedSlugs = 0;
  for (const tool of tools) {
    if (!tool.enabled) continue;
    const cat = catById[tool.category];
    if (!cat) continue;
    if (!cat.toolIds.includes(tool.toolId)) {
      cat.toolIds.push(tool.toolId);
      addedIds++;
      console.log(`  + toolId ${tool.toolId} → categoría ${cat.id}`);
    }
    if (!cat.slugs.includes(tool.slug)) {
      cat.slugs.push(tool.slug);
      addedSlugs++;
      console.log(`  + slug ${tool.slug} → categoría ${cat.id}`);
    }
  }

  writeFileSync(CATEGORIES_PATH, JSON.stringify(categories, null, 2) + '\n');
  console.log(`\nSync completado: ${addedIds} toolId y ${addedSlugs} slug añadidos a categories.json.`);
}

if (WRITE) {
  validate();
  write();
} else if (REPORT) {
  report();
} else if (SYNC_CATEGORIES) {
  syncCategories();
} else {
  validate();
}
