(() => {
  const api = window.DeraPayments;
  const form = document.getElementById('enroll-form');
  const status = document.getElementById('checkout-status');
  const submit = document.getElementById('submit-btn');
  const currency = document.getElementById('currency');
  const params = new URLSearchParams(location.search);
  let selected = Object.hasOwn(window.DeraPrograms, params.get('program')) ? params.get('program') : 'professional';
  let catalog;
  let busy = false;
  let attempt = api.saved();
  const radios = document.querySelectorAll('input[name="program"]');
  function previous() {
    if (attempt?.reference) {
      document.getElementById('previous-checkout').hidden = false;
      document.getElementById('previous-checkout-link').href = api.statusUrl(attempt.reference);
    }
  }
  function update() {
    const program = catalog?.programs[selected] || window.DeraPrograms[selected];
    document.getElementById('sum-name').textContent = program.name;
    document.getElementById('sum-dur').textContent = program.duration;
    document.getElementById('sum-cert').textContent = program.cert;
    const amount = catalog?.programs[selected]?.prices[currency.value];
    document.getElementById('sum-price').textContent = amount ? `${api.money(amount, currency.value)} ${currency.value}` : catalog ? 'Unavailable in this currency' : `$${program.price} USD`;
    submit.disabled = busy || !catalog?.enabled || !amount;
    submit.textContent = busy ? 'Preparing secure checkout…' : !catalog?.enabled || !amount ? 'Checkout unavailable' : `Continue to Paystack — ${api.money(amount, currency.value)}`;
    radios.forEach(radio => {
      radio.checked = radio.value === selected;
      const data = catalog?.programs[radio.value];
      if (data) {
        const price = data.prices[currency.value];
        radio.closest('label').querySelector('.p-price').textContent = price ? api.money(price, currency.value) : 'Unavailable';
        radio.closest('label').querySelector('.p-dur').textContent = `${currency.value} · ${data.duration}`;
      }
    });
  }
  radios.forEach(radio => radio.addEventListener('change', () => { selected = radio.value; update(); }));
  currency.addEventListener('change', update);
  form.querySelectorAll('input[required]:not([type="checkbox"])').forEach(input => input.addEventListener('input', () => input.setCustomValidity(input.value.trim() ? '' : 'Please complete this field.')));
  previous();
  update();
  api.request('api/catalog').then(data => {
    catalog = data;
    const currencies = [...new Set(Object.values(data.programs).flatMap(p => Object.keys(p.prices)))];
    currency.replaceChildren();
    for (const code of ['USD', 'NGN']) {
      const option = new Option(`${code} — ${code === 'USD' ? 'US Dollar' : 'Nigerian Naira'}${currencies.includes(code) ? '' : ' (unavailable)'}`, code);
      option.disabled = !currencies.includes(code);
      currency.add(option);
    }
    currency.value = currencies.includes(params.get('currency')) ? params.get('currency') : currencies[0] || 'USD';
    currency.disabled = currencies.length < 2;
    const policyReady = Object.values(data.policies).every(Boolean);
    document.getElementById('payment-policies').hidden = !policyReady;
    for (const type of ['terms','privacy','refund']) if (data.policies[type]) document.getElementById(`${type}-link`).href = data.policies[type];
    document.getElementById('test-payment-note').hidden = !data.enabled || !data.testMode;
    status.textContent = data.enabled ? 'Review your details and total before continuing to Paystack.' : 'Online payment is not available yet. Please contact admissions to enroll.';
    update();
  }).catch(() => { status.textContent = 'Online payment is currently unavailable. Please contact admissions to enroll.'; });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !catalog?.enabled || !form.reportValidity()) return;
    const details = Object.fromEntries(new FormData(form));
    details.program = selected;
    details.currency = currency.value;
    details.consent = document.getElementById('consent').checked;
    details.policyVersion = catalog.policyVersion;
    try {
      if (!attempt) { attempt = { token: api.newToken() }; api.save(attempt); }
    } catch {
      status.textContent = 'Allow session storage in this browser before checkout so you can securely retrieve your payment status.';
      return;
    }
    busy = true; update();
    status.textContent = 'Creating your enrollment and opening secure checkout…';
    try {
      const result = await api.request('api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.token }, body: JSON.stringify(details) });
      attempt.reference = result.reference;
      api.save(attempt);
      previous();
      if (result.checkoutUnavailable || ['paid','refunded','partially_refunded','disputed'].includes(result.status)) location.assign(api.statusUrl(result.reference));
      else if (api.safeCheckout(result.checkoutUrl)) location.assign(result.checkoutUrl);
      else throw new Error('Unable to open secure checkout. Check the saved payment status before trying again.');
    } catch (error) {
      status.textContent = `${error.message || 'Unable to reach checkout.'} Your details have been kept. Retrying will reuse this checkout.`;
    } finally { busy = false; update(); }
  });
})();
