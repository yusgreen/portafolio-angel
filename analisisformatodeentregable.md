# Análisis de ortografía, gramática y coherencia

**Documento analizado:** `CGEU-275 TRABAJO FINAL Angel Pereda v7.docx`
**Tema:** Fortalecimiento de la empleabilidad y marca profesional en TECNO SUR S.A.
**Estudiante:** Pereda Chavez, Angel David — ID 001637623 — SENATI, Semestre 5.º
**Curso:** Empleabilidad y Desarrollo Profesional (CGEU-275)

---

## 1. Metodología

1. Conversión del `.docx` a texto plano con **LibreOffice** (headless), para preservar párrafos y tablas.
2. Extracción complementaria de encabezados, pies de página y partes XML (header/footer) para no omitir texto.
3. Extracción de las **12 imágenes incrustadas** del `.docx` (`word/media/`).
4. Reconocimiento de texto en imágenes mediante **Tesseract OCR** (idioma español + inglés), instalado y configurado para este análisis.
5. Revisión manual de ortografía, gramática, concordancia, puntuación, espaciado y coherencia en español.

> **Limitación:** el OCR no es 100 % preciso. Los hallazgos marcados como "artefacto de OCR" deben verificarse en el original.

---

## 2. Veredicto general

**El documento NO está 100 % limpio**, pero está bien redactado y estructurado. Se encontraron:

- **3 errores reales de concordancia/gramática** en el texto principal.
- **9 acentos faltantes** en texto corrido de los diagramas.
- **1 inconsistencia** (AÑO 3 vs. AÑO 1/2).
- Varios detalles menores de espaciado, una abreviatura ambigua, una duplicación en el pie de página y tildes opcionales en mayúsculas/nombres propios.

Con las correcciones indicadas, el entregable quedaría impecable.

---

## 3. Errores en el texto principal

### 3.1 Errores reales (corregir obligatoriamente)

| # | Ubicación | Texto actual | Problema | Corrección sugerida |
|---|-----------|--------------|----------|---------------------|
| 1 | Cuadro de verificación — pregunta 2 | "¿Se **desarrolló** las condiciones de los requerimientos solicitados?" | "las condiciones" es plural → verbo en plural | "¿Se **desarrollaron** las condiciones de los requerimientos solicitados?" |
| 2 | Cuadro de verificación — pregunta 8 | "¿Se **consideran** las normativas técnicas, de seguridad y medio ambiente…?" | Inconsistencia de tiempo (las demás usan pasado) | "¿Se **consideraron** las normativas técnicas, de seguridad y medio ambiente…?" |
| 3 | Cuadro de verificación — pregunta 9 | "¿La propuesta es **pertinente con** los requerimientos solicitados?" | "Pertinente" se construye con "a" (o "para") | "¿La propuesta es **pertinente a** los requerimientos solicitados?" |

### 3.2 Detalles menores (espaciado/estilo)

| # | Ubicación | Detalle | Sugerencia |
|---|-----------|---------|------------|
| 4 | Línea ~225 | Doble espacio: "elaboró ​​un cronograma" | Eliminar espacio extra |
| 5 | Línea ~44 | "Curso/ Mód. Formativo" (espacio antes de /) | "Curso/Mód. Formativo" |
| 6 | Líneas ~77 y ~79 | Espacios finales después de ":" | Quitar espacios sobrantes |
| 7 | Línea ~188 | Abreviatura "SHI" (calidad, medio ambiente y SHI) | Aclarar significado (¿SST? ¿SHMA?) |
| 8 | Línea ~169 | "set-2027" | "sep-2027" (más estándar) |
| 9 | Pie de página (footer2) | "PLAN DE TRABAJO DEL ESTUDIANTE" duplicado en caja de texto | Corregir artefacto de diseño |

### 3.3 Sugerencias opcionales (nombres propios)

- "Angel David Pereda **Chavez**" → en español normativo: "**Ángel** … **Chávez**".
- Aparece en la portada y en el Anexo 1. En formularios oficiales a veces se omite, pero en un entregable académico formal conviene incluir la tilde.

---

## 4. Hallazgos en imágenes y diagramas (OCR)

Imágenes incrustadas: 12 en total (5 diagramas + 6 imágenes pequeñas + 1 miniatura `.wdp`).

### 4.1 Acentos faltantes en texto corrido (corregir)

| Diagrama | Texto actual | Corrección |
|----------|--------------|------------|
| d2 (FODA) | "Git, pull requests y **metodologia agil**" | "metodología ágil" |
| d2 (FODA) | "Sin certificaciones formales **todavia**" | "todavía" |
| d2 (FODA) | "red de contactos **minima**" | "mínima" |
| d2 (FODA) | "contrata **mas** técnicos" | "más" |
| d2 (FODA) | "Cambio tecnológico **rapido**" | "rápido" |
| d4 (Ruta) | "Ingreso a **Ingenieria** de Software…" | "Ingeniería" |
| d4 (Ruta) | "titulo de ingeniero" | "título" |
| d4 (Ruta) | "analitica industrial" (×2) | "analítica" |
| d1 (Mapa) | "titulación mantenimiento predictivo - ruta a bachiller en **técnica Ingeniería**" | Redacción confusa → "titulación técnica en Ingeniería" |

### 4.2 Títulos en MAYÚSCULAS sin tilde (estilo/opcional, pero recomendado)

| Diagrama | Actual | Con tilde |
|----------|--------|-----------|
| d1 | AUTODIAGNOSTICO / PROPOSITO / ANOS | AUTODIAGNÓSTICO / PROPÓSITO / AÑOS |
| d2 | Angel / Chavez | Ángel / Chávez |
| d4 | ANO 3 / INSERCION / PROFESIONALIZACION / ESPECIALIZACION / PROYECCION / VISION | AÑO 3 / INSERCIÓN / PROFESIONALIZACIÓN / ESPECIALIZACIÓN / PROYECCIÓN / VISIÓN |
| d5 | POLITICO | POLÍTICO |

> Omitir tildes en mayúsculas es habitual en diseño, pero en un entregable académico formal conviene incluirlas.

### 4.3 Inconsistencia

- d4: "AÑO 1" y "AÑO 2" llevan Ñ, pero "ANO 3" no → unificar a "AÑO 3".

### 4.4 Artefactos de OCR (verificar en el original)

| Diagrama | Lo que leyó el OCR | Nota |
|----------|-------------------|------|
| d1 | "Mer laboral nacional , - NO / ercado laboral nacional internacional" | El OCR partió "Mercado"; verificar que diga "Mercado laboral nacional/internacional (inglés B2)" |
| d1 | "-+" | Verificar símbolo (flecha) |
| d3 | "achine learning" | OCR omitió la "M" inicial; el diagrama dice "Machine learning" |
| d2 | "Ruta a bachiller en SENATI 0 en una universidad" | El OCR leyó "0" (cero); probablemente es "o" |
| d3 | "1.3 lm" | Posible artefacto; verificar valor |
| d3 | "Conocimiento del sector industrial y arquitectura" | OCR fusionó etiquetas; verificar layout |

### 4.5 Imágenes sin texto relevante

- `image1.png`, `image3.png`, `image5.jpeg`, `image6.jpeg` → logos de SENATI (sin texto que revisar).
- `image2.jpeg` → sin texto detectado (probablemente foto/ícono).
- `image4.png` → "RECURSO DIDÁCTICO PARA EL APRENDIZAJE / RDA." (sin errores).
- `hdphoto1.wdp` → formato no soportado por el OCR (miniatura/HD Photo); sin texto relevante.

---

## 5. Lo que está bien

- Ortografía general del texto principal muy cuidada.
- Concordancia de género/número en la mayor parte del documento.
- Uso consistente de "autodiagnóstico", "FODA", siglas y normas legales.
- Estructura, cronograma y tablas coherentes.
- Enlaces y datos de contacto consistentes.
- Los 6 componentes de la propuesta y las 5 preguntas guía están bien desarrollados.
- Diagramas claros y alineados con el texto.

---

## 6. Resumen de conteo

| Categoría | Cantidad |
|-----------|----------|
| Errores reales de concordancia/gramática (texto principal) | 3 |
| Acentos faltantes en texto corrido (diagramas) | 9 |
| Inconsistencia (AÑO 3) | 1 |
| Detalles menores (espaciado, abreviatura, pie de página) | 6 |
| Sugerencias opcionales (mayúsculas, nombres propios) | 2 grupos |

**Conclusión:** el documento es de buena calidad y está bien estructurado, pero **no está limpio**. Con las correcciones de las secciones 3.1 y 4.1 (especialmente los acentos faltantes en los diagramas, que son los más visibles) quedaría impecable.

---

## 7. Recomendaciones

1. Corregir los 3 errores de concordancia del cuadro de verificación (preguntas 2, 8 y 9).
2. Agregar las tildes faltantes en los diagramas d1, d2 y d4 (texto corrido).
3. Unificar "ANO 3" → "AÑO 3".
4. Revisar la redacción de "titulación mantenimiento predictivo - ruta a bachiller en técnica Ingeniería" (d1).
5. Corregir el artefacto de duplicación en el pie de página.
6. Aclarar la abreviatura "SHI".
7. (Opcional) Incluir tildes en títulos en mayúsculas y en nombres propios ("Ángel", "Chávez").

---

*Análisis realizado con extracción de texto (LibreOffice) y OCR (Tesseract, español) sobre el archivo original. Los artefactos de OCR deben verificarse en el documento fuente.*
