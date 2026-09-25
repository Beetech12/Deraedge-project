(() => {
  function initializeHeader() {
    const header = document.getElementById('header');
    if (!header || header.dataset.ready) return;
    header.dataset.ready = 'true';
    const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    const toggle = header.querySelector('.menu-toggle');
    const nav = header.querySelector('nav');
    if (!toggle || !nav) return;
    header.classList.add('menu-ready');
    const setOpen = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? 'Close menu' : 'Menu';
      nav.classList.toggle('open', open);
    };
    toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
    header.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        toggle.focus();
      }
    });
    nav.addEventListener('click', (event) => {
      if (event.target.closest('a')) setOpen(false);
    });
    matchMedia('(min-width: 761px)').addEventListener('change', () => setOpen(false));
    nav.querySelectorAll('a').forEach((link) => {
      if (new URL(link.href).pathname.replace(/index\.html$/, '') === location.pathname.replace(/index\.html$/, '')) {
        link.setAttribute('aria-current', 'page');
      }
    });
  }
  document.addEventListener('componentLoaded', initializeHeader);
  initializeHeader();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  if ('IntersectionObserver' in window && !reducedMotion.matches) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    document.querySelectorAll('.reveal').forEach((element) => {
      element.style.transitionDelay = `${element.dataset.delay || 0}ms`;
      observer.observe(element);
      element.classList.add('reveal-pending');
    });
  }
  const video = document.querySelector('video[data-background-video]');
  if (video) {
    const updateVideo = () => {
      if (reducedMotion.matches || navigator.connection?.saveData) video.pause();
      else {
        const source = video.querySelector('source');
        if (!source.hasAttribute('src')) {
          source.src = source.dataset.src;
          video.load();
        }
        video.play().catch(() => {});
      }
    };
    updateVideo();
    reducedMotion.addEventListener('change', updateVideo);
  }
})();
