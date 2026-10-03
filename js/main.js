(() => {
  function initializeHeader() {
    const header = document.getElementById('header');
    if (!header || header.dataset.ready) return;
    header.dataset.ready = 'true';
    const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 24);
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true });
    const toggle = header.querySelector('.menu-toggle');
    const nav = header.querySelector('nav');
    if (!toggle || !nav) return;
    header.classList.add('menu-ready');
    const setOpen = open => { toggle.setAttribute('aria-expanded', String(open)); toggle.textContent = open ? 'Close menu' : 'Menu'; nav.classList.toggle('open', open); };
    toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
    header.addEventListener('keydown', event => { if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') { setOpen(false); toggle.focus(); } });
    nav.addEventListener('click', event => { if (event.target.closest('a')) setOpen(false); });
    matchMedia('(min-width: 961px)').addEventListener('change', () => setOpen(false));
    nav.querySelectorAll('a').forEach(link => { if (new URL(link.href).pathname.replace(/index\.html$/, '') === location.pathname.replace(/index\.html$/, '')) link.setAttribute('aria-current', 'page'); });
  }
  document.addEventListener('componentLoaded', initializeHeader);
  initializeHeader();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  // Retain touch feedback briefly after a tap without intercepting navigation.
  const touchCards = '.card, .card-lux, .purpose-card, .market-card, .home-program, .pillar, .cap, .pick, .values li, .firm-disciplines > *';
  let touchedCard, touchTimer, touchStart;
  const clearTouchCard = () => { clearTimeout(touchTimer); touchedCard?.classList.remove('is-touch-raised'); touchedCard = null; touchStart = null; };
  document.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    clearTouchCard();
    if (event.target.closest('input, textarea, select')) return;
    touchedCard = event.target.closest(touchCards);
    if (!touchedCard) return;
    touchStart = { x: event.clientX, y: event.clientY }; touchedCard.classList.add('is-touch-raised');
  }, { passive: true });
  document.addEventListener('pointerup', () => { if (touchedCard) touchTimer = setTimeout(clearTouchCard, 700); }, { passive: true });
  document.addEventListener('pointermove', event => { if (touchStart && Math.hypot(event.clientX - touchStart.x, event.clientY - touchStart.y) > 12) clearTouchCard(); }, { passive: true });
  document.addEventListener('pointercancel', clearTouchCard, { passive: true });
  window.addEventListener('pagehide', clearTouchCard);
  if ('IntersectionObserver' in window && !reducedMotion.matches) {
    const observer = new IntersectionObserver(entries => { entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); } }); }, { threshold: 0.15 });
    document.querySelectorAll('.reveal').forEach(element => { element.style.transitionDelay = `${element.dataset.delay || 0}ms`; observer.observe(element); element.classList.add('reveal-pending'); });
  }
  const video = document.querySelector('video[data-background-video]');
  if (video) {
    const hero = video.closest('.hero-content');
    const toggle = hero.querySelector('.hero-motion-toggle');
    // Keep the control off-screen while automatic background playback continues.
    toggle.hidden = true;
    let userPaused = false;
    video.muted = true; video.defaultMuted = true; video.playsInline = true;
    const updateVideo = () => {
      if (userPaused || document.hidden) { video.pause(); return; }
      video.play().catch(() => hero.classList.remove('video-ready'));
    };
    video.addEventListener('playing', () => hero.classList.add('video-ready'));
    video.addEventListener('error', () => hero.classList.remove('video-ready'));
    video.addEventListener('canplay', updateVideo);
    toggle.addEventListener('click', () => {
      userPaused = !video.paused;
      toggle.textContent = userPaused ? 'Play motion' : 'Pause motion';
      toggle.setAttribute('aria-label', userPaused ? 'Play background video' : 'Pause background video');
      updateVideo();
    });
    document.addEventListener('pointerdown', event => { if (!toggle.contains(event.target) && video.paused && !userPaused) updateVideo(); }, { passive: true });
    document.addEventListener('visibilitychange', updateVideo);
    window.addEventListener('pageshow', updateVideo);
    updateVideo();
  }
})();
