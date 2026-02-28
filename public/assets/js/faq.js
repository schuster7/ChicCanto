// /public/assets/js/faq.js
// ChicCanto FAQ accordion with animated icon. Minimal JS, no dependencies.
(() => {
  const root = document.querySelector('[data-page="faq"]');
  if (!root) return;

  const items = Array.from(root.querySelectorAll('.faq-item'));
  if (!items.length) return;

  const closeItem = (item) => {
    item.classList.remove('is-open');
    const btn = item.querySelector('.faq-q');
    const panel = item.querySelector('.faq-a');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (panel) panel.setAttribute('aria-hidden', 'true');
  };

  const openItem = (item) => {
    item.classList.add('is-open');
    const btn = item.querySelector('.faq-q');
    const panel = item.querySelector('.faq-a');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    if (panel) panel.setAttribute('aria-hidden', 'false');
  };

  // Open first? (no, keep closed)
  items.forEach((item) => closeItem(item));

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.faq-q');
    if (!btn) return;

    const item = btn.closest('.faq-item');
    if (!item) return;

    const isOpen = item.classList.contains('is-open');

    // close others (accordion behavior)
    items.forEach((it) => {
      if (it !== item) closeItem(it);
    });

    if (isOpen) closeItem(item);
    else openItem(item);
  });

  // Keyboard: Enter/Space on button already works, but keep focus visible.
})();
