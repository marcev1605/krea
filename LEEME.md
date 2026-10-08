# Krea · PWA para iPhone

Versión 1.1.0 (auditada) · Tu misma app Krea, separada en archivos y lista para instalarse desde Safari como una app.

---

## A. Estructura de carpetas

Subí **todo el contenido de la carpeta `krea-pwa/`** a la raíz de tu hosting. No cambies los nombres ni la ubicación de los archivos.

```
krea-pwa/
├── index.html               ← página principal (antes era cartera.html)
├── manifest.webmanifest     ← NUEVO: nombre, íconos, colores y modo app
├── service-worker.js        ← NUEVO: funcionamiento sin conexión y actualizaciones
├── _headers                 ← NUEVO: evita cachés viejas (Netlify / Cloudflare Pages)
├── LEEME.md                 ← este archivo
├── css/
│   └── styles.css           ← estilos de la app (los mismos de antes + base para iPhone)
├── js/
│   ├── app.js               ← la app (misma lógica; 3 cambios mínimos, ver abajo)
│   └── pwa.js               ← NUEVO: registra el service worker, aviso de versión nueva, ayuda de instalación
└── icons/
    ├── logo.jpg             ← logo del encabezado (antes estaba embebido en el código)
    ├── apple-touch-icon.png ← 180×180, ícono del iPhone
    ├── icon-192.png         ← 192×192
    ├── icon-512.png         ← 512×512
    ├── icon-maskable-512.png← 512×512 con margen de seguridad (Android)
    ├── favicon-32.png       ← 32×32, pestaña del navegador
    └── splash/              ← 12 pantallas de inicio, una por tamaño de iPhone
        ├── splash-1320x2868.png  (16 Pro Max, 17 Pro Max)
        ├── splash-1260x2736.png  (iPhone Air)
        ├── splash-1206x2622.png  (16 Pro, 17, 17 Pro)
        ├── splash-1290x2796.png  (14 Pro Max, 15 Plus/Pro Max, 16 Plus)
        ├── splash-1179x2556.png  (14 Pro, 15, 15 Pro, 16)
        ├── splash-1284x2778.png  (12/13 Pro Max, 14 Plus)
        ├── splash-1170x2532.png  (12, 13, 14, 12/13 Pro)
        ├── splash-1125x2436.png  (X, XS, 11 Pro, 12/13 mini)
        ├── splash-1242x2688.png  (XS Max, 11 Pro Max)
        ├── splash-828x1792.png   (XR, 11)
        ├── splash-1242x2208.png  (6/7/8 Plus)
        └── splash-750x1334.png   (SE 2/3, 6/7/8)
```

### Qué cambió respecto de la app original

| Archivo | Cambio |
|---|---|
| `index.html` | Nuevo. Contiene el `<head>` con todo lo de PWA/iOS y carga los mismos scripts y fuentes que antes. |
| `css/styles.css` | Mismo CSS. Se agregó al principio la base que antes ponía el entorno de Claude (márgenes, áreas seguras del iPhone). La barra inferior ahora también respeta las áreas seguras laterales. |
| `js/app.js` | Misma lógica. Tres cambios: 1) el logo se lee de `icons/logo.jpg`; 2) **Exportar a Excel** funciona fuera de Claude (en iPhone abre el menú Compartir → "Guardar en Archivos"); 3) el texto al pie avisa que los datos quedan en el dispositivo. |
| `js/pwa.js` | Nuevo. Registro del service worker, aviso "Hay una versión nueva", ayuda para instalar en iPhone y pedido de almacenamiento persistente. |
| `service-worker.js` | Nuevo. |
| `manifest.webmanifest` | Nuevo. |

El diseño, los cálculos y las pantallas son los mismos.

---

## B. Contenido de los archivos

Todos los archivos están completos en esta carpeta; no hay fragmentos ni pasos a completar.

---

## C. Cómo probarla en la computadora

Los service workers solo funcionan con `https://` o en `localhost`. No abras `index.html` con doble clic (`file://`).

1. Abrí una terminal en la carpeta `krea-pwa`.
2. Ejecutá **uno** de estos comandos:
   - Mac / Linux: `python3 -m http.server 8080`
   - Windows: `py -m http.server 8080`
   - Con Node: `npx serve -l 8080`
3. Abrí **Chrome** en `http://localhost:8080`.
4. Abrí las herramientas de desarrollador (F12) → pestaña **Application**:
   - **Manifest**: debe mostrar "Krea", los íconos y "Display: standalone", sin errores.
   - **Service workers**: debe figurar `service-worker.js` como *activated and is running*.
   - **Cache storage**: deben aparecer `krea-shell-1.1.0`, `krea-libs-v1` y `krea-fonts-v1`.
5. Probá sin conexión: en **Network** elegí *Offline* y recargá. La app tiene que abrir igual.
6. Para ver el iPhone: modo dispositivo (Ctrl+Shift+M / Cmd+Shift+M) → iPhone 14 Pro.

Para probarla **en el iPhone** hace falta publicarla con `https://` (paso D).

---

## D. Cómo instalarla en el iPhone

### 1) Publicarla con https (gratis)

**Opción fácil: Netlify Drop**
1. Entrá a <https://app.netlify.com/drop> y creá una cuenta gratis, para que el sitio no se borre.
2. Arrastrá la carpeta **`krea-pwa`** completa a la página.
3. Netlify te da una dirección del tipo `https://nombre-al-azar.netlify.app`. En *Site configuration → Change site name* podés cambiarla, por ejemplo a `https://krea-mio.netlify.app`.
4. Para publicar una versión nueva: *Deploys* → arrastrás otra vez la carpeta.

**Opción GitHub Pages**
1. Creá un repositorio en GitHub, por ejemplo `krea`.
2. Subí el **contenido** de `krea-pwa/` a la raíz del repositorio.
3. *Settings → Pages → Branch: main / (root) → Save*.
4. La dirección queda `https://TU-USUARIO.github.io/krea/`. La app usa rutas relativas, así que funciona en esa subcarpeta.

### 2) Instalarla
1. En el iPhone abrí **Safari**. Tiene que ser Safari; en iOS 16.4 o posterior también funciona desde Chrome con "Agregar a inicio".
2. Entrá a tu dirección `https://…`.
3. Tocá **Compartir** (el cuadrado con la flecha hacia arriba).
4. Bajá y tocá **Agregar a pantalla de inicio** (o "Agregar a inicio").
5. Dejá el nombre "Krea" y tocá **Agregar**.
6. Abrila desde el ícono de Krea: se abre a pantalla completa, sin la barra de Safari.

### 3) Pasar tus datos de Claude a la app instalada
Tus operaciones actuales están guardadas en Claude, no en el iPhone. Para pasarlas:
1. En la versión de Claude tocá **Excel → Descargar Excel** y guardá el archivo en *Archivos*.
2. Abrí **Krea desde el ícono** (no desde Safari; ver problema 1 más abajo).
3. Tocá **Excel → Importar → Elegir archivo…**, elegí el Excel y tocá **Agregar a mis datos**.
4. Volvé a cargar los **precios** y el **% de comisión**, porque no viajan en el Excel.

### 4) Publicar una versión nueva sin problemas de caché
Cada vez que cambies algo:
1. En `service-worker.js` subí `VERSION` (por ejemplo `"1.1.1"`) y el `?v=` de los tres archivos de la lista `SHELL_FILES`.
2. En `index.html` cambiá los tres `?v=1.1.0` al mismo número nuevo.
3. Publicá la carpeta.
4. La próxima vez que abras Krea aparece **"Hay una versión nueva de Krea" → Actualizar**. Tus datos no se tocan.

---

## E. Lista de comprobación

- [ ] La dirección empieza con `https://`.
- [ ] En Chrome de escritorio, *Application → Manifest* no muestra errores.
- [ ] El service worker figura como *activated*.
- [ ] En el iPhone, "Agregar a pantalla de inicio" muestra el ícono de Krea, no una captura de pantalla.
- [ ] Al abrir desde el ícono no aparece la barra de direcciones de Safari.
- [ ] Al abrir se ve la pantalla de inicio oscura con el logo (en los iPhone de la lista).
- [ ] El encabezado no queda tapado por el notch o la Dynamic Island, y la barra Compra / Venta / Dividendo no queda tapada por la barra de inicio.
- [ ] Cargar una compra, cerrar la app por completo (deslizar hacia arriba) y volver a abrir: la compra sigue ahí.
- [ ] Modo avión → abrir Krea: abre y muestra tus datos. Hay que haberla abierto antes al menos una vez con internet.
- [ ] **Excel → Descargar Excel** abre el menú Compartir y se puede guardar en Archivos.
- [ ] **Excel → Importar** deja elegir un `.xlsx` desde Archivos.
- [ ] Modo oscuro del iPhone: la app cambia a tema oscuro.
- [ ] Después de publicar una versión nueva, aparece el aviso "Hay una versión nueva" y al tocar **Actualizar** se ven los cambios.

---

## F. Problemas detectados y cómo quedaron resueltos

1. **En iPhone, Safari y la app instalada no comparten datos.** iOS guarda por separado lo que cargás en Safari y lo que cargás en la app del ícono.
   → Instalá primero y cargá o importá los datos **dentro de la app instalada**.

2. **Si borrás el ícono de Krea, se borran sus datos.** Es así en iOS, y no hay sincronización entre dispositivos porque todo queda en el iPhone (`localStorage`).
   → Exportá a Excel de vez en cuando como respaldo; el pie de la app lo recuerda. Además, `pwa.js` pide almacenamiento persistente cuando el sistema lo permite. Las apps agregadas a inicio cuentan sus propios días de uso, así que mientras la abras de vez en cuando iOS no borra sus datos, como sí puede pasar con un sitio en Safari que no visitás por 7 días.

3. **La app original dependía de Claude** para guardar datos y para descargar archivos.
   → Guardar: la app ya tenía guardado local (`localStorage`, claves `compras`, `krea-precios`, `krea-config` y `krea-cur`), y fuera de Claude lo usa automáticamente. No se borró ni se renombró nada.
   → Descargar: se agregó el guardado nativo. En iPhone (iOS 15 o posterior) abre el menú Compartir; en otros navegadores descarga el archivo.

4. **Librerías externas (React 18.3.1, ReactDOM, htm 3.1.1, SheetJS 0.18.5) y tipografías de Google.** Se cargan de CDNs públicos con versión fija.
   → El service worker las guarda la primera vez que abrís la app con internet; después funciona sin conexión. La **primera** apertura necesita internet.
   → Si querés independizarte de los CDNs: descargá esos 4 archivos `.js` en una carpeta `vendor/`, cambiá las 4 URLs en `index.html` y en `LIB_FILES` de `service-worker.js` por `vendor/…`, y agregá `vendor/` a `SHELL_FILES`.

5. **iOS no muestra un botón "Instalar"**, a diferencia de Android y Chrome.
   → `pwa.js` muestra una sola vez, en Safari de iPhone, la ayuda "Compartir → Agregar a inicio".

6. **La orientación vertical del manifest no siempre se respeta en iOS.** Si girás el teléfono, la app puede rotar.
   → El diseño ya se adapta al ancho y respeta las áreas seguras laterales en horizontal.

7. **Versión mínima de iOS.** La app usa funciones de JavaScript modernas (`||=`, `?.`, `Intl` con formato compacto).
   → Requiere **iOS 15 o posterior**; se recomienda iOS 16.4 o posterior. En versiones más viejas puede quedar en blanco.

8. **Pantallas de inicio.** iOS solo las muestra si el tamaño coincide exactamente con el del teléfono.
   → Se generaron 12 tamaños, de iPhone SE a iPhone 17 Pro Max y Air. En modelos que no estén en la lista se ve el color de fondo y después la app.

9. **Barra de estado.** Se usa `black-translucent` (pantalla completa) con una franja oscura de marca detrás de la hora y la batería, para que se lean en tema claro y oscuro.

10. **Logo embebido.** El logo estaba incrustado en el código (unos 110 KB de texto).
    → Se pasó a `icons/logo.jpg`, que el navegador puede guardar aparte.

11. **Integridad de datos (ya existía).** Si editás o borrás una compra vieja que tenía ventas posteriores, esa venta puede quedar "vendiendo más de lo que tenías". La app lo marca en rojo, pero no lo impide.
    → Pendiente para una próxima versión: avisar antes de guardar.

No se usan APIs que Safari de iOS no soporte: no hay notificaciones push, sincronización en segundo plano, `beforeinstallprompt`, `alert` ni `confirm`.

---

## G. Auditoría v1.1.0: qué se corrigió

| # | Área | Problema encontrado | Corrección |
|---|---|---|---|
| 1 | Registro del SW | En la **primera** instalación, el cambio de controlador recargaba la página sola a los pocos segundos y podía cortar lo que estabas cargando. | `pwa.js` recarga solo cuando tocás **Actualizar**. Verificado: la primera carga hace una sola navegación. |
| 2 | Offline / tipografías | Al abrir por primera vez desde el ícono, las tipografías no quedaban guardadas hasta la segunda apertura. En modo avión se veía la fuente del sistema. | El SW guarda la hoja de Google Fonts **y** sus archivos `.woff2` al instalarse. |
| 3 | Offline / caché | La hoja de fuentes se pedía sin CORS (respuesta "opaca"), que ocupa mucho espacio de caché y no se puede verificar. | `crossorigin="anonymous"` en el `<link>` de fuentes. |
| 4 | Señal débil | Con "lie-fi" (conexión que no responde), la app podía quedar en blanco esperando la red. | Si la red tarda más de 4 s, se muestra la copia guardada y se actualiza en segundo plano. |
| 5 | Safari iOS | `Array.prototype.at()` no existe en iOS 15.0–15.3: la app quedaba en blanco. | Reemplazado por acceso por índice. Ahora alcanza con **iOS 15**. |
| 6 | Almacenamiento | Si `localStorage` fallaba (lleno o navegación privada), la compra se mostraba pero **no se guardaba**, sin avisar. | Ahora el error llega al formulario y muestra "No se pudo guardar". |
| 7 | Importar Excel | El `<input type="file">` estaba con `display:none`; en algunas versiones de iOS el botón "Elegir archivo…" no abría el selector. | Se oculta de forma visual pero sigue activable (`.vh-input`). |
| 8 | Safe areas / barra de estado | Con el estilo `default`, en modo oscuro la barra de estado podía quedar blanca sobre la app oscura. | `black-translucent` + franja `.ios-statusbar` del alto de `safe-area-inset-top` con el degradado de marca. |
| 9 | Viewport | La hoja inferior usaba `92vh`, que en Safari (con barras visibles) puede quedar tapada abajo. | `92dvh` con `92vh` como respaldo. |
| 10 | Toques | Doble toque podía hacer zoom en botones. | `touch-action: manipulation` en botones. |
| 11 | Caché de iconos | El ícono maskable no estaba en la precarga. | Agregado a `SHELL_FILES`. |
| 12 | Versionado | Se subió la versión a **1.1.0** (SW + `?v=`) para que cualquier copia previa se reemplace limpia. | — |

### Revisado y correcto (sin cambios)
- **manifest.webmanifest:** JSON válido; `start_url` y `scope` relativos (`./`), así que funciona en la raíz o en una subcarpeta (GitHub Pages); `display: standalone`; 4 íconos con el tamaño real coincidiendo con el declarado.
- **Rutas:** todas relativas; se verificó que existan los 31 archivos referenciados en `index.html` y `service-worker.js`.
- **Apple touch icon:** 180×180, sin transparencias (iOS rellenaría de negro las zonas transparentes).
- **Meta tags de iOS:** `apple-mobile-web-app-capable`, título, `apple-touch-icon` y 12 `apple-touch-startup-image` con medidas exactas.
- **Viewport:** `width=device-width, initial-scale=1, viewport-fit=cover`. Todos los campos de texto tienen 16 px o más, así que iOS no hace zoom al tocarlos.
- **theme-color:** uno para tema claro y otro para oscuro.
- **HTTPS:** obligatorio para el service worker. Netlify y GitHub Pages lo dan gratis. En `http://` (salvo `localhost`) la app funciona, pero sin modo offline.
- **Datos:** el SW nunca toca `localStorage`. Las claves `compras`, `krea-precios`, `krea-config` y `krea-cur` se conservan al actualizar (verificado).

### Simulación del recorrido (probado en Chromium con el tamaño de un iPhone, con copias locales de las librerías)
| Paso | Resultado |
|---|---|
| 1–2. Abrir y primera carga | Carga completa, sin recarga inesperada. Se guardan 12 archivos propios, 4 librerías y las fuentes. |
| 3–4. Agregar a inicio y abrir desde el ícono | En iOS la app instalada tiene **su propio almacenamiento**: en su primera apertura vuelve a descargar y guardar todo, así que **necesita internet esa primera vez**. |
| 5–6. Cerrar y reabrir | Abre con los datos guardados. |
| 7–8. Modo avión | Funciona todo lo que es local: ver movimientos, cartera, torta, resultados, cargar compras y ventas, importar Excel. No hay nada que dependa de internet una vez instalada. |
| 9. Vuelve internet | Sin cambios visibles; los archivos se revalidan en segundo plano. |
| 10. Versión nueva | Aparece "Hay una versión nueva de Krea → Actualizar"; al tocarlo se recarga, se borra la caché vieja y los datos quedan intactos. |

### Lo que no se pudo verificar desde acá
- La prueba fue en Chromium, no en Safari de un iPhone real: la lista de la sección E es para confirmarlo en tu teléfono.
- Las librerías reales de los CDN (React, htm, SheetJS) no se pudieron descargar en el entorno de prueba; se usaron copias equivalentes. En tu iPhone se descargan de los servidores reales.
