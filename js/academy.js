(() => {
  const programs = {
    foundation: {
      ...window.DeraPrograms.foundation,
      cta: "Enroll Now — $100",
      curriculum: [
        "Introduction to Financial Markets",
        "Forex, Commodities & Indices",
        "Market Participants & Market Structure",
        "Trading Platforms & Tools",
        "Candlestick Fundamentals",
        "Support & Resistance",
        "Trend Identification",
        "Basic Technical Analysis",
        "Risk Management Fundamentals",
        "Trading Psychology",
        "Developing Your First Trading Plan",
      ],
    },
    professional: {
      ...window.DeraPrograms.professional,
      cta: "Enroll Now — $200",
      curriculum: [
        "Advanced Market Structure",
        "Liquidity Concepts",
        "Supply & Demand",
        "Smart Money Concepts (SMC)",
        "Institutional Order Flow",
        "Multi-Timeframe Analysis",
        "Trade Planning",
        "Position Sizing",
        "Advanced Risk Management",
        "Trading Journaling",
        "Performance Review Framework",
        "Building a Repeatable Trading System",
      ],
    },
    mastery: {
      ...window.DeraPrograms.mastery,
      cta: "Apply for Mastery — $500",
      curriculum: [
        "Proprietary Market Frameworks",
        "Institutional Trading Models",
        "Advanced Liquidity Mapping",
        "Order Flow Analysis",
        "Market Manipulation & Liquidity Dynamics",
        "Macro Market Analysis",
        "Gold (XAU/USD) Trading Strategies",
        "High-Probability Trade Execution",
        "Portfolio & Risk Management",
        "Trading Psychology for Professionals",
        "Building a Personal Trading Business",
        "Performance Analytics & Optimization",
        "Developing Proprietary Trading Strategies",
      ],
    },
  };
  let active = "professional";
  const api = window.DeraPayments;
  const currencyPicker = document.getElementById('academy-currency');
  let catalog;
  let currency = 'USD';
  const price = id => catalog?.programs[id]?.prices[currency] ?? (currency === 'USD' && !catalog ? programs[id].price * 100 : null);
  function paymentLinks() {
    for (const id of Object.keys(programs)) {
      const card = document.getElementById(id);
      const amount = price(id);
      card.querySelector('.price').textContent = amount ? api.money(amount, currency) : 'Unavailable';
      card.querySelector('.price-meta').textContent = `${currency} · ${programs[id].duration}`;
      const link = card.querySelector('a[href*="deraedge-enroll"]');
      link.textContent = amount ? `Enroll — ${api.money(amount, currency)}` : 'Contact admissions';
      link.href = amount ? `../deraedge-enroll/index.html?program=${id}&currency=${currency}` : 'mailto:info@deraedge.com?subject=Academy%20enrollment';
    }
  }
  const list = document.getElementById("curriculum-list");
  function renderCurriculum() {
    list.innerHTML = "";
    programs[active].curriculum.forEach((item, i) => {
      const li = document.createElement("li");
      li.style.animationDelay = i * 40 + "ms";
      li.innerHTML =
        '<span class="num">' +
        String(i + 1).padStart(2, "0") +
        '</span><span class="item">' +
        item +
        "</span>";
      list.appendChild(li);
    });
    document.getElementById("final-name").textContent =
      programs[active].name;
    const amount = price(active);
    document.getElementById('final-meta').textContent = `${programs[active].duration} · ${amount ? api.money(amount, currency) + ' ' + currency : 'Unavailable in this currency'} · Certificate on completion.`;
    document.getElementById('final-cta').textContent = amount ? `Enroll — ${api.money(amount, currency)}` : 'Contact admissions';
    document.getElementById('final-cta').href = amount ? `../deraedge-enroll/index.html?program=${active}&currency=${currency}` : 'mailto:info@deraedge.com?subject=Academy%20enrollment';

  }
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.classList.contains("active")));
    btn.addEventListener("click", () => {
      active = btn.dataset.id;
      document
        .querySelectorAll(".tab-btn")
        .forEach((b) => { b.classList.toggle("active", b === btn); b.setAttribute("aria-pressed", String(b === btn)); });
      renderCurriculum();
    });
  });
  renderCurriculum();
  paymentLinks();
  currencyPicker.addEventListener('change', () => { currency = currencyPicker.value; paymentLinks(); renderCurriculum(); });
  api.request('api/catalog').then(data => {
    catalog = data;
    const currencies = [...new Set(Object.values(data.programs).flatMap(p => Object.keys(p.prices)))];
    currencyPicker.replaceChildren();
    for (const code of ['USD', 'NGN']) {
      const option = new Option(`${code}${currencies.includes(code) ? '' : ' — unavailable'}`, code);
      option.disabled = !currencies.includes(code);
      currencyPicker.add(option);
    }
    currency = currencies[0] || 'USD';
    currencyPicker.value = currency;
    currencyPicker.disabled = currencies.length < 2;
    document.getElementById('academy-payment-note').textContent = data.enabled ? (data.testMode ? 'Test checkout is enabled. No real payment will be collected.' : 'Secure payment through Paystack. Review your details at enrollment.') : 'Online payment is not available yet. Contact admissions for enrollment.';
    paymentLinks(); renderCurriculum();
  }).catch(() => { document.getElementById('academy-payment-note').textContent = 'Online payment is unavailable. Contact admissions for enrollment.'; });
})();
