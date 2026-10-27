/* Keep a readable recovery screen available even when another script fails. */
(function () {
  'use strict';
  if (!Element.prototype.replaceChildren) {
    Element.prototype.replaceChildren = function () {
      while (this.firstChild) this.removeChild(this.firstChild);
      for (var i = 0; i < arguments.length; i++) { var child = arguments[i]; this.appendChild(child && typeof child.nodeType === 'number' ? child : document.createTextNode(String(child))); }
    };
  }
  function scrollTopNow() {
    var root = document.documentElement, previous = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    try { window.scrollTo(0, 0); } catch (error) { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; } finally { root.style.scrollBehavior = previous; }
  }
  function resetLayout() {
    if (window.SPUI && window.SPUI.resetLayout) { try { window.SPUI.resetLayout(); return; } catch (error) {} }
    var main = document.querySelector('.app-main'), drawer = document.getElementById('sidebar'), overlay = document.getElementById('navOverlay');
    if (main) main.inert = false;
    if (drawer) { drawer.classList.remove('mobile-open'); drawer.removeAttribute('aria-modal'); drawer.removeAttribute('role'); }
    if (overlay) { overlay.hidden = true; overlay.inert = true; }
    if (document.body.classList.contains('menu-open')) {
      document.body.classList.remove('menu-open');
      document.body.style.position = ''; document.body.style.top = ''; document.body.style.width = ''; document.body.style.overflow = '';
    }
  }
  function recover(message) {
    var panel = document.getElementById('fatalRecovery');
    if (!panel) return;
    resetLayout();
    document.getElementById('fatalRecoveryText').textContent = message || 'โหลดส่วนประกอบของหน้าเว็บไม่สำเร็จ กรุณาลองโหลดหน้านี้อีกครั้ง';
    panel.hidden = false; scrollTopNow();
  }
  window.SPRecovery = { show: recover, scrollTop: scrollTopNow, resetLayout: resetLayout };
  window.addEventListener('error', function (event) {
    var source = event.filename || event.target && event.target.src || '';
    if (/\/(app|ui|boot)\.js(?:\?|$)/.test(source)) recover();
  }, true);
  document.addEventListener('DOMContentLoaded', function () {
    var button = document.getElementById('recoveryReload');
    if (button) button.addEventListener('click', function () { window.location.replace(window.location.pathname + '?reload=' + Date.now() + window.location.hash); });
    if (!window.SPUI || (document.getElementById('appShell') && !window.SP_APP_READY) || (document.querySelector('.admin-shell') && !window.SP_DASH_READY)) recover();
  });
  window.addEventListener('pageshow', function (event) { if (event.persisted) resetLayout(); });
}());
