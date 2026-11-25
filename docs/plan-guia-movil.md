# Plan · Guía interactiva móvil y correcciones del mapa en móvil

Estado: **propuesta, sin implementar.** Fecha: 25 de noviembre de 2026.

Dos entregas independientes:

- **A. Guía interactiva** (`#guia`): recorrido por todo el proyecto (problemática, metodología, investigación realizada y software) sobre un mapa 3D estilizado de Bolivia, con un robot animado y pasos de driver.js. El último paso entra al mapa 3D real del Centro.
- **B. Corrección del sistema:** en móvil, la interfaz tapa demasiado el mapa 3D.

Conviene hacer **B primero**, porque el último paso de la guía termina en el mapa real.

---

## A. Guía interactiva móvil

### A0. Estado (25-nov-2026): fases 1 a 5 hechas

- `src/guide/steps.ts` (contenido), `GuideView.tsx` (driver.js, lista, cabecera), `GuideScene.tsx` (Bolivia, paradas, Wayra, cámara), `guide.css`.
- driver.js fijado en **1.10.2**, publicado hace más de un mes (las versiones 1.11 a 1.14 salieron en los 17 días previos).
- Decisiones simplificadas: no se usa relieve con teselas (se usan alturas simbólicas por departamento) ni sombras (rendimiento en móvil). Las paradas primera y última se anclan en el robot. La transición final usa el modo móvil ya corregido en la parte B, sin un parámetro `?limpio`.
- Probado en Brave sin interfaz a 390×844 y a 1280×800: saludo, avance por las paradas, último paso «Entrar al mapa 3D» y vista de lista.
- **Pendiente:** fase 6, prueba en teléfonos reales.

### A1. Para quién y para qué

Para el investigador o jurado que escanea el QR del póster o del tríptico y quiere entender el proyecto en 3 a 5 minutos desde el teléfono. El orden es el de la exposición, y el peso va en **metodología e investigación**; el software aparece al final como el objeto evaluado.

### A2. Concepto: un “mundito” de Bolivia

- Escena 3D **low-poly** de Bolivia: los departamentos son losas extruidas con un relieve suave y una paleta guinda/gris coherente con el póster. Puede girarse como una maqueta sobre una mesa.
- Cada sección de la investigación es una **estación** sobre el mapa: un hito con una etiqueta.
- Un **robot** (la mascota) viaja de estación en estación. Al llegar, apunta al hito y driver.js abre la tarjeta del paso.
- **Paso final:** la cámara vuela a La Paz, se acerca al Centro y hace la transición a la vista 3D real (`#zona/centro`) en el modo de mapa limpio de la parte B.

### A3. Estaciones (contenido tomado del informe; la ubicación es ajustable)

| # | Estación | Lugar en el mapa | Contenido de la tarjeta |
|---|---|---|---|
| 1 | Bienvenida | Bolivia completa | El robot se presenta: qué es LA PAZ 2050 y qué se va a recorrer. Botón «Saltar guía». |
| 2 | Problemática | La Paz – El Alto | 30.269 minibuses y 363 rutas de minibús (GAMLP, 2026). Una visualización 3D no demuestra que un modelo sea consistente. |
| 3 | Pregunta y objetivos | Lago Titicaca (el punto de partida) | Pregunta de investigación, objetivo general y los 5 objetivos específicos, plegables. |
| 4 | Metodología | Salar de Uyuni (terreno plano y controlado = experimento controlado) | Enfoque cuantitativo, Ciencia del Diseño, viabilidad técnica; unidades (2.343 segmentos, 62 sentidos, ejecución); condiciones base/refuerzo/control; fórmula de C; verificación por hash. |
| 5 | Investigación realizada | Cochabamba (sede central de UNIVALLE) | Resultados: −22,20 %, 900/900, 179 pasos idénticos antes del control, ablaciones (36,6 %), 124 bloqueos sin violaciones, 28/28 alertas. Figuras del informe. |
| 6 | Viabilidad y límites | Sucre (la capital: “lo que se puede afirmar”) | Qué se demostró y qué no; principal limitación (sin calibración de campo); próximos pasos. |
| 7 | El software | Santa Cruz | Arquitectura en tres capas (React/Three.js, Node/Fastify, PostgreSQL/PostGIS), modelo de Krauss, Dijkstra, alertas SQL. Nota: el software es el objeto evaluado, no el resultado. |
| 8 | Mapa 3D real | Vuelo a La Paz → Centro | Transición a la vista Centro. Último popover: «Prueba la hora punta en El Prado». |

Todo el texto va en un solo archivo (`src/guide/steps.ts`), con un arreglo `{ id, lugar: [lon, lat], titulo, cuerpo, figura?, accion? }`. Así se edita el contenido sin tocar la escena.

### A4. Técnica

| Pieza | Decisión | Motivo |
|---|---|---|
| Vista | `#guia` en `view.ts`, cargada con `lazy()` como `MetroView` | No pesa en las demás vistas. El QR puede apuntar directo a `/#guia`. |
| Pasos y resaltado | **driver.js** (`^1.3`, MIT, ~5 KB gz): `steps`, `showProgress` («3 de 8»), `popoverClass` propia y `onHighlightStarted` para mover cámara y robot | Es la única dependencia nueva. Resalta elementos DOM, así que cada estación expone su etiqueta HTML (`<Html>` de drei) como ancla. |
| Mapa de Bolivia | Límites de departamentos de **Natural Earth admin-1** (dominio público), simplificados y precalculados en un JSON pequeño con un script en `scripts/guia/`. `ExtrudeGeometry` por departamento | Sin teselas ni red en tiempo de ejecución. Objetivo: < 50 000 triángulos. |
| Relieve | Opcional: desplazamiento suave de la losa con Terrain Tiles a zoom bajo (fuente que ya se usa) | Que se vea “mundito”, no un mapa plano. |
| Robot | Modelo hecho con primitivas en R3F (cabeza, cuerpo, antena con luz, ruedas u orugas), con animación procedimental: flotar, girar hacia la estación y “saludar” | Ya están instalados three y R3F: no hace falta Lottie ni un GLB. Pesa unos KB. |
| Cámara | Vuelo con interpolación entre estaciones (`CameraControls` de drei o lerp propio) | Mismo patrón que el zoom a estaciones de Mi Teleférico. |
| Transición final | `setView('centro')` con un parámetro de modo limpio (`#zona/centro?limpio`) | Reutiliza la vista existente. |

### A5. Reglas de uso

- **Siempre saltable:** botón «Saltar guía» en cada paso, y «Volver a la guía» en la cabecera.
- **`prefers-reduced-motion`:** sin vuelos; cambios de estación con un fundido. El robot queda quieto.
- **Sin WebGL o en equipos lentos:** la misma guía como lista de tarjetas (mismo `steps.ts`), sin escena.
- Textos de 14 px o más en la tarjeta, objetivos táctiles de 44 px y popover anclado abajo en vertical.
- La guía no reemplaza la etiqueta «DEMO · SIMULACIÓN»: el paso 8 la muestra.
- DPR limitado a 1,5 en móvil; la escena se pausa cuando la pestaña no está visible.

### A6. Fases

1. `steps.ts` con el contenido y la lista de tarjetas sin 3D (ya sirve como guía y como respaldo).
2. Mapa de Bolivia low-poly con las estaciones y el vuelo de cámara.
3. driver.js sobre las estaciones.
4. Robot y sus animaciones.
5. Transición final al Centro (depende de B).
6. Prueba en teléfonos reales: 360×740, 390×844 y 412×915, en vertical y horizontal.

---

## B. Corrección: el mapa 3D queda tapado en móvil

### B1. Situación actual (según `src/styles.css`)

En `≤ 720px`, `.hud-centro` apila en una sola columna: la cabecera (`top`), la barra de congestión (`banner`), el hueco del mapa, los controles de escenarios en una rejilla de 2 columnas (`ctrl`) y la atribución (`attr`), además de la hoja de paneles. Solo en horizontal (`max-height: 520px`) se ocultan KPIs y paneles. El resultado es que en vertical la franja libre del mapa queda reducida. El botón «ocultar paneles» (`hud-min`) existe en escritorio, pero en móvil no se muestra.

### B2. Primero medir

Tomar capturas en las tres vistas (Ciudad, Centro/zonas y Mi Teleférico) a 360×740, 390×844 y 412×915, y anotar el **porcentaje de alto libre del mapa** en el estado inicial y con una alerta activa.

**Criterio de aceptación:** al menos **70 % del alto** con mapa visible en el estado inicial, sin solapes, con objetivos de 44 px y la atribución de OSM legible.

### B3. Cambios propuestos

1. **Una sola hoja inferior** con tres posiciones (asomada de unos 56 px, media y completa), que reúna escenarios, KPIs y paneles. Hoy son tres bloques separados. Asomada solo muestra la acción principal («Hora punta») y un asa.
2. **Cabecera de una fila** de 44–48 px: nombre corto, zona y un menú «⋯» para calidad, tema, XR y guía.
3. **Barra de congestión como aviso flotante:** una píldora breve que se expande al tocarla y se recoge sola. Al tocarla, sigue volando al lugar de la alerta.
4. **Modo mapa limpio:** activar `hud-min` también en móvil con un botón visible, y ocultar la interfaz mientras se arrastra o se hace zoom, mostrándola de nuevo al soltar.
5. **Alto real del viewport:** usar `100dvh` y `env(safe-area-inset-*)` en todos los bordes, para que la barra del navegador y la muesca no recorten la escena.
6. **Atribución compacta:** una línea corta «© OpenStreetMap · SRTM» siempre visible; los detalles van en la hoja.
7. Aplicar lo mismo en Mi Teleférico, donde el panel ya es plegable: unificarlo con la misma hoja.

### B3.1 Hecho (25-nov-2026)

Se aplicó una versión más simple que la hoja unificada, con CSS y un menú «⋯», y ya cumple el criterio de aceptación. Las mediciones se hicieron a 390×844, contando los puntos de una rejilla de 10 px donde lo primero que se toca es el canvas:

| Vista | Antes | Después |
|---|---|---|
| Ciudad | 57 % | 77 % |
| Centro / zonas | 70 % | 83 % (81 % con alerta de congestión) |
| Mi Teleférico | 78 % | 84 % |

- **Centro:** la cabecera quedó en una fila (volver, selector de zona, punto de estado de la API, «⋯» y paneles). Mi Teleférico, la calidad, XR y el tema pasaron al menú «⋯». Los escenarios van en una fila deslizable. La barra de congestión ocupa una línea y deja solo el icono «ver en el mapa». La atribución ocupa una línea. Se agregaron márgenes de área segura.
- **Ciudad:** la navegación usa iconos, se ocultó el reloj simulado en móvil y los KPIs quedan en una fila de cuatro.
- **Mi Teleférico:** cabecera de una fila con el título «Mi Teleférico 2050».
- **Pendiente:** la hoja inferior unificada (B3.1) y ocultar la interfaz mientras se mueve el mapa (B3.4). Solo hacen falta si una prueba en un teléfono real muestra que no alcanza.

### B4. Riesgos

- La hoja inferior no debe capturar los gestos del mapa: el arrastre solo funciona desde el asa.
- La atribución de OpenStreetMap debe seguir visible (licencia ODbL).
- Comprobar que el vuelo a una alerta no queda debajo de la hoja: hay que desplazar el objetivo de la cámara según el alto de la hoja.
