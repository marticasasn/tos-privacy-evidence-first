# ToS/Privacy — Evidence-First

Extensión de navegador (Chrome / Manifest V3) que muestra un resumen de los **Términos de Servicio y la Política de Privacidad** del sitio que estás visitando, usando las evaluaciones públicas de [ToS;DR](https://tosdr.org).

La extensión es *evidence-first*: cada punto que muestra enlaza a su fuente y **solo hace peticiones cuando el usuario pulsa "Analizar"**. No hay análisis en segundo plano ni seguimiento de la navegación.

## Funcionalidades

- Detecta el dominio de la pestaña activa y lo reduce a su dominio registrable (`www.bbc.co.uk` → `bbc.co.uk`).
- Busca el servicio correspondiente en ToS;DR y muestra:
  - nombre del servicio y nota (grade A–E),
  - recuento de puntos por tipo: **Blocker**, **Bad**, **Good**, **Neutral**,
  - tarjetas con cada punto, su descripción y un enlace a la fuente original.
- Filtros: **Riesgos** (blocker + bad, por defecto), **Solo blockers** y **Todo**.
- Intenta obtener los puntos en español y, si no hay, en inglés.
- Caché local de 24 h por dominio (`chrome.storage.local`) para no repetir peticiones.
- Pista de subservicio para algunas rutas de `google.com` (Maps, Flights, Search, Travel).

## Instalación (modo desarrollador)

1. Clona o descarga este repositorio.
2. Abre `chrome://extensions` en Chrome (o cualquier navegador basado en Chromium).
3. Activa el **Modo de desarrollador**.
4. Pulsa **Cargar descomprimida** y selecciona la carpeta del proyecto.
5. Fija la extensión en la barra, abre cualquier web y pulsa **Analizar**.

No requiere compilación ni dependencias: es JavaScript plano.

## Estructura

```
manifest.json                 Manifest V3: permisos, popup, service worker y CSP
background/service-worker.js  Recibe la petición del popup, lee el hostname de la pestaña y llama a ToS;DR
lib/tosdr.js                  Normalización de dominio, selección del servicio, llamadas a la API y caché
popup/popup.html              Interfaz del popup
popup/popup.js                Renderizado: cabecera, filtros, contadores y tarjetas
popup/popup.css               Estilos
icons/icon-128.png            Icono
```

## Cómo funciona

1. El usuario pulsa **Analizar** en el popup → `popup.js` envía `ANALYZE_CURRENT_DOMAIN` con el `tabId` activo.
2. El service worker inyecta (vía `activeTab` + `scripting`) una función que devuelve `location.hostname` y `location.pathname`.
3. `normalizeDomain()` obtiene el dominio registrable.
4. `fetchTosdrSummary()`:
   - consulta la caché (`tosdr:<dominio>`); si es válida, la devuelve;
   - si no, llama a `GET https://api.tosdr.org/search/v5?query=<dominio>` y elige el mejor servicio con `pickBestService()`;
   - descarga los puntos con `GET https://api.tosdr.org/service/v3?id=<id>&lang=es` (y `lang=en` como alternativa);
   - guarda el resultado en caché 24 h (sin host ni ruta, por privacidad).
5. El popup muestra el resultado o un estado: `ok`, `no_coverage`, `rate_limited` o `api_error`.

## Permisos y privacidad

| Permiso | Para qué |
|---|---|
| `activeTab` | Acceder a la pestaña actual solo tras la acción del usuario |
| `scripting` | Leer el hostname/ruta de esa pestaña |
| `storage` | Caché local de resultados |
| `https://api.tosdr.org/*` | Consultar la API de ToS;DR |

- Lo único que se envía a ToS;DR es el **dominio registrable** (nunca la URL completa ni la ruta).
- `localhost`, IPs, hosts de intranet y TLDs privados (`.local`, `.lan`, `.internal`…) **no se envían nunca**: se marcan directamente como sin cobertura.
- Solo se muestra un servicio si alguna de sus URLs en ToS;DR coincide exactamente con el dominio; si no, se indica que no hay cobertura en vez de mostrar un servicio parecido.
- La caché se guarda solo en local y caduca a las 24 h.
- La CSP restringe los scripts a la propia extensión y las conexiones a `api.tosdr.org`.

## Limitaciones

- No funciona en páginas internas del navegador (`chrome://`, Chrome Web Store, nueva pestaña, visor de PDF).
- La cobertura depende de ToS;DR: muchos sitios no tienen evaluación.
- La normalización de dominios usa una lista reducida de ccTLD/ccSLD, no la Public Suffix List completa.

## Créditos

Los datos provienen de [ToS;DR — Terms of Service; Didn't Read](https://tosdr.org), un proyecto comunitario. Esta extensión no está afiliada a ToS;DR.
