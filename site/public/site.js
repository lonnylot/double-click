'use strict';

(function () {
  var config = window.DCAI_CONFIG || {};
  if (config.chromeWebStoreUrl) {
    var links = document.querySelectorAll('[data-chrome-cta]');
    for (var i = 0; i < links.length; i += 1) {
      links[i].href = config.chromeWebStoreUrl;
    }
  }

  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (!toggle || !nav) return;

  function setOpen(open) {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.textContent = open ? 'Close' : 'Menu';
  }

  toggle.addEventListener('click', function () {
    setOpen(!nav.classList.contains('is-open'));
  });

  nav.addEventListener('click', function (event) {
    var target = event.target;
    if (target instanceof Element && target.closest('a')) setOpen(false);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') setOpen(false);
  });
})();
