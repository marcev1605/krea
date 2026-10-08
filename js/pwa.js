/* Krea · integración PWA
 * 1. Registra el service worker.
 * 2. Avisa cuando hay una versión nueva y la aplica al tocar "Actualizar".
 * 3. En Safari de iPhone (sin instalar) muestra una ayuda para "Agregar a pantalla de inicio".
 * 4. Pide al navegador que no borre los datos guardados (si lo permite).
 * No modifica la lógica ni los datos de la app.
 */
(function () {
  "use strict";

  var isStandalone = window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  var ua = navigator.userAgent || "";
  var isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);

  function css() {
    if (document.getElementById("pwa-css")) return;
    var st = document.createElement("style");
    st.id = "pwa-css";
    st.textContent =
      ".pwa-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(96px + env(safe-area-inset-bottom,0px));" +
      "z-index:50;width:min(520px,calc(100% - 32px));display:flex;align-items:center;gap:10px;padding:12px 12px 12px 16px;" +
      "border-radius:16px;color:#eef6f3;font:500 14px/1.35 Figtree,system-ui,sans-serif;" +
      "background:linear-gradient(150deg,#0c1b30 0%,#0b2a3a 55%,#0d3a35 100%);border:1px solid rgba(80,200,170,.25);" +
      "box-shadow:0 10px 28px rgba(6,20,30,.35)}" +
      ".pwa-toast p{margin:0;flex:1;min-width:0}" +
      ".pwa-toast b{font-weight:600}" +
      ".pwa-toast button{flex:none;border:0;border-radius:99px;padding:8px 14px;font:600 13px Figtree,system-ui,sans-serif;cursor:pointer}" +
      ".pwa-toast .pwa-go{background:#2ee6a0;color:#06231a}" +
      ".pwa-toast .pwa-x{background:rgba(255,255,255,.1);color:#eef6f3;padding:8px 11px}" +
      ".pwa-share{display:inline-block;width:14px;height:16px;vertical-align:-3px;margin:0 2px}";
    document.head.appendChild(st);
  }

  function toast(html, actions) {
    css();
    var old = document.querySelector(".pwa-toast");
    if (old) old.remove();
    var el = document.createElement("div");
    el.className = "pwa-toast";
    el.setAttribute("role", "status");
    var p = document.createElement("p");
    p.innerHTML = html;
    el.appendChild(p);
    actions.forEach(function (a) {
      var b = document.createElement("button");
      b.className = a.cls;
      b.textContent = a.label;
      b.setAttribute("aria-label", a.aria || a.label);
      b.addEventListener("click", function () { a.onClick(el); });
      el.appendChild(b);
    });
    document.body.appendChild(el);
    return el;
  }

  // ---------- Service worker ----------
  var canSW = "serviceWorker" in navigator && /^https?:$/.test(location.protocol) && window.top === window.self;
  if (canSW) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("service-worker.js", { scope: "./", updateViaCache: "none" })
        .then(function (reg) {
          if (!reg) return;
          if (reg.waiting && navigator.serviceWorker.controller) avisarActualizacion(reg.waiting);
          reg.addEventListener("updatefound", function () {
            var nuevo = reg.installing;
            if (!nuevo) return;
            nuevo.addEventListener("statechange", function () {
              if (nuevo.state === "installed" && navigator.serviceWorker.controller) avisarActualizacion(nuevo);
            });
          });
          // Buscar versión nueva al volver a la app (iOS no recarga las apps instaladas por sí solo)
          document.addEventListener("visibilitychange", function () {
            if (document.visibilityState === "visible") reg.update().catch(function () {});
          });
        })
        .catch(function (err) { console.warn("[Krea] No se pudo registrar el service worker:", err); });

      // Recargar solo cuando el usuario tocó "Actualizar".
      // (En la primera instalación también cambia el controlador y no hay que recargar: interrumpiría la carga.)
      var recargando = false;
      navigator.serviceWorker.addEventListener("controllerchange", function () {
        if (recargando || !window.__kreaActualizando) return;
        recargando = true;
        window.location.reload();
      });
    });
  }

  function avisarActualizacion(worker) {
    toast("<b>Hay una versión nueva de Krea.</b> Tus datos no se tocan.", [
      { cls: "pwa-go", label: "Actualizar", onClick: function (el) { el.remove(); window.__kreaActualizando = true; worker.postMessage({ type: "SKIP_WAITING" }); } },
      { cls: "pwa-x", label: "✕", aria: "Más tarde", onClick: function (el) { el.remove(); } }
    ]);
  }

  // ---------- Ayuda de instalación en iPhone ----------
  function yaMostrado() { try { return localStorage.getItem("krea-ayuda-instalar") === "1"; } catch (e) { return true; } }
  function marcarMostrado() { try { localStorage.setItem("krea-ayuda-instalar", "1"); } catch (e) {} }

  if (isIOS && isSafari && !isStandalone && window.top === window.self && !yaMostrado()) {
    window.addEventListener("load", function () {
      setTimeout(function () {
        var share = '<svg class="pwa-share" viewBox="0 0 14 18" aria-hidden="true"><path d="M7 1v10M3.5 4.5 7 1l3.5 3.5M2 8H1v9h12V8h-1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        toast("Instalá Krea en tu iPhone: tocá " + share + " <b>Compartir</b> y después <b>Agregar a inicio</b>.", [
          { cls: "pwa-x", label: "Entendido", onClick: function (el) { el.remove(); marcarMostrado(); } }
        ]);
      }, 1500);
    });
  }

  // ---------- Conservar datos ----------
  // Pide almacenamiento persistente para que el sistema no borre los datos guardados (si el navegador lo permite).
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  } catch (e) {}
})();
