// Glisser-déposer compatible souris ET doigt (iPhone), via une poignée [data-handle].
// Les éléments triables portent [data-sort-item] et sont enfants directs du conteneur.

export function makeSortable(container, onReorder) {
  container.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-handle]');
    if (!handle || !container.contains(handle)) return;
    const item = handle.closest('[data-sort-item]');
    if (!item || item.parentElement !== container) return;
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const sortItems = () => [...container.children].filter((c) => c.hasAttribute('data-sort-item'));
    const startIdx = sortItems().indexOf(item);
    const rect = item.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;

    const ph = document.createElement('div');
    ph.className = 'sort-placeholder';
    ph.style.height = rect.height + 'px';
    item.parentElement.insertBefore(ph, item);

    Object.assign(item.style, {
      position: 'fixed', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', zIndex: 1000, pointerEvents: 'none',
    });
    item.classList.add('dragging');
    let lastY = e.clientY;
    let scrollTimer = null;

    const place = (y) => {
      item.style.top = y - offsetY + 'px';
      const others = sortItems().filter((c) => c !== item);
      let before = null;
      for (const o of others) {
        const r = o.getBoundingClientRect();
        if (y < r.top + r.height / 2) { before = o; break; }
      }
      if (before) container.insertBefore(ph, before);
      else if (others.length) others[others.length - 1].after(ph);
    };

    const autoScroll = () => {
      const edge = 70;
      let dy = 0;
      if (lastY < edge) dy = -12;
      else if (lastY > window.innerHeight - edge) dy = 12;
      if (dy) { window.scrollBy(0, dy); place(lastY); }
      scrollTimer = requestAnimationFrame(autoScroll);
    };
    scrollTimer = requestAnimationFrame(autoScroll);

    const move = (ev) => { lastY = ev.clientY; place(ev.clientY); };
    const up = () => {
      cancelAnimationFrame(scrollTimer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      ph.replaceWith(item);
      item.removeAttribute('style');
      item.classList.remove('dragging');
      const newIdx = sortItems().indexOf(item);
      if (newIdx !== startIdx && newIdx >= 0) onReorder(startIdx, newIdx);
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

export function moveInArray(arr, from, to) {
  const [x] = arr.splice(from, 1);
  arr.splice(to, 0, x);
  return arr;
}
