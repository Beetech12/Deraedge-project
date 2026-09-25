(() => {
  const root = new URL('../', document.currentScript.src);
  async function loadComponent(id, file) {
    const element = document.getElementById(id);
    if (!element) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(new URL(file, root), { signal: controller.signal });
      if (!response.ok) throw new Error(`Component returned ${response.status}`);
      element.innerHTML = await response.text();
      element.querySelectorAll('[href^="/"], [src^="/"]').forEach((node) => {
        for (const attribute of ['href', 'src']) {
          const value = node.getAttribute(attribute);
          if (value?.startsWith('/')) node.setAttribute(attribute, new URL(value.slice(1), root).href);
        }
      });
      document.dispatchEvent(new CustomEvent('componentLoaded', { detail: { id } }));
    } catch (error) {
      console.warn(`Could not load ${file}`, error);
      // Leave the static navigation and contact fallback available.
    } finally {
      clearTimeout(timeout);
    }
  }
  Promise.allSettled([
    loadComponent('header-placeholder', 'components/header.html'),
    loadComponent('footer-placeholder', 'components/footer.html'),
  ]).then(() => document.dispatchEvent(new Event('componentsLoaded')));
})();
