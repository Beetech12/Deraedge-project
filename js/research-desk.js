(() => {
  const host = document.getElementById('research-market');
  const status = document.getElementById('research-status');
  if (!host || !status) return;

  // Keep the third-party chart off the critical rendering path.
  function initializeChart() {
  const container = document.createElement('div');
  container.className = 'tradingview-widget-container';
  const widget = document.createElement('div');
  widget.className = 'tradingview-widget-container__widget';
  container.appendChild(widget);
  host.appendChild(container);
  host.hidden = false;

  const script = document.createElement('script');
  script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js';
  script.async = true;
  script.textContent = JSON.stringify({
    colorTheme: 'dark',
    dateRange: '1D',
    locale: 'en',
    width: '100%',
    height: 390,
    isTransparent: true,
    showChart: true,
    showSymbolLogo: false,
    showFloatingTooltip: true,
    plotLineColorGrowing: 'rgba(200, 135, 69, 1)',
    plotLineColorFalling: 'rgba(200, 135, 69, 1)',
    belowLineFillColorGrowing: 'rgba(200, 135, 69, 0.12)',
    belowLineFillColorFalling: 'rgba(200, 135, 69, 0.12)',
    belowLineFillColorGrowingBottom: 'rgba(200, 135, 69, 0)',
    belowLineFillColorFallingBottom: 'rgba(200, 135, 69, 0)',
    gridLineColor: 'rgba(255, 255, 255, 0.04)',
    scaleFontColor: 'rgba(190, 198, 214, 1)',
    symbolActiveColor: 'rgba(200, 135, 69, 0.12)',
    tabs: [{ title: 'Markets', symbols: [
      { s: 'FOREXCOM:XAUUSD', d: 'Gold · XAU/USD' },
      { s: 'FOREXCOM:NSXUSD', d: 'NAS100 · Cash CFD' },
      { s: 'FOREXCOM:EURUSD', d: 'EUR/USD' },
    ] }],
  });

  status.textContent = 'Loading market widget…';
  const timer = setTimeout(() => {
    status.textContent = 'Quotes taking longer to load? Open TradingView using the link below.';
    if (!container.querySelector('iframe')) host.hidden = true;
  }, 15000);
  const observer = new MutationObserver(() => {
    const frame = container.querySelector('iframe');
    if (!frame || frame.dataset.observed) return;
    frame.dataset.observed = 'true';
    frame.title = 'Research Desk market chart and prices from TradingView';
    frame.addEventListener('load', () => {
      clearTimeout(timer);
      host.hidden = false;
      // Frame loading cannot establish quote freshness across origins.
      status.textContent = 'Chart and quotes supplied by TradingView.';
    }, { once: true });
    observer.disconnect();
  });
  observer.observe(container, { childList: true, subtree: true });
  script.addEventListener('error', () => {
    clearTimeout(timer);
    observer.disconnect();
    host.hidden = true;
    status.textContent = 'Market data could not load. Open TradingView using the link below.';
  });
  container.appendChild(script);
  }
  if ('IntersectionObserver' in window) {
    status.textContent = 'Market charts load when this section comes into view.';
    const visibility = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      visibility.disconnect();
      initializeChart();
    }, { rootMargin: '250px' });
    visibility.observe(host.closest('.desk') || host);
  } else initializeChart();
})();
