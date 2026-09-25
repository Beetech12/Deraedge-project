(() => {
  const api = window.DeraPayments;
  const message = document.getElementById('payment-message');
  const title = document.getElementById('payment-title');
  const refresh = document.getElementById('refresh-payment');
  const resume = document.getElementById('resume-payment');
  const receipt = document.getElementById('payment-receipt');
  const reference = new URLSearchParams(location.search).get('reference') || api.saved()?.reference;
  const saved = api.saved(reference);
  let busy = false;
  let attempts = 0;
  let timer;
  const descriptions = {
    paid: ['Payment confirmed', 'Thank you. Your payment and enrollment have been recorded. Contact admissions with your reference to arrange your cohort and course access.'],
    pending: ['Payment not yet confirmed', 'We are waiting for payment confirmation. If your account was debited, do not pay again. Check again shortly or contact admissions with your reference.'],
    failed: ['Payment not completed', 'Paystack has not confirmed a successful payment. You can return to the same checkout to review or retry. If you were debited, contact support before paying again.'],
    refunded: ['Payment refunded', 'A full refund has been processed. Contact admissions for questions about your enrollment.'],
    partially_refunded: ['Payment partially refunded', 'A partial refund has been processed. The receipt shows the refunded amount. Contact admissions for your enrollment status.'],
    disputed: ['Payment under review', 'This payment has a dispute that needs review. Contact admissions with your reference.'],
  };
  if (!reference || !/^dera-[a-f0-9]{36}$/.test(reference) || saved?.reference !== reference || !saved?.token) {
    title.textContent = 'Payment lookup unavailable';
    message.textContent = 'Open this page in the same browser tab that started checkout, or contact info@deraedge.com with the payment reference from Paystack. A return link alone does not confirm payment.';
    refresh.hidden = true;
    return;
  }
  document.getElementById('payment-reference').textContent = reference;
  document.getElementById('payment-support').href = `mailto:info@deraedge.com?subject=${encodeURIComponent(`Enrollment payment ${reference}`)}`;
  async function check() {
    if (busy) return;
    clearTimeout(timer);
    busy = true;
    refresh.disabled = true;
    try {
      const order = await api.request(`api/orders/${reference}`, { headers: { Authorization: `Bearer ${saved.token}` } });
      const description = descriptions[order.status] || descriptions.pending;
      title.textContent = description[0];
      message.textContent = order.verificationUnavailable ? 'Payment verification is temporarily unavailable. Do not pay again if your account was debited. Check again shortly.' : description[1];
      document.getElementById('payment-test-note').hidden = !order.testMode;
      document.getElementById('receipt-program').textContent = order.program;
      document.getElementById('receipt-total').textContent = `${api.money(order.amount, order.currency)} ${order.currency}`;
      document.getElementById('receipt-refunded').textContent = api.money(order.refundedAmount, order.currency);
      document.getElementById('receipt-date').textContent = order.paidAt ? new Date(order.paidAt).toLocaleString() : 'Not confirmed';
      document.getElementById('receipt-status').textContent = order.status.replaceAll('_', ' ');
      receipt.hidden = false;
      document.getElementById('print-receipt').hidden = !order.paidAt;
      document.getElementById('another-enrollment').hidden = !['paid', 'refunded'].includes(order.status);
      resume.hidden = !['pending', 'failed'].includes(order.status) || !api.safeCheckout(order.checkoutUrl);
      if (!resume.hidden) resume.href = order.checkoutUrl;
      if (order.status === 'pending' && ++attempts < 5) timer = setTimeout(check, 15000);
    } catch (error) {
      message.textContent = error.message || 'Unable to check payment. Please try again.';
    } finally { busy = false; refresh.disabled = false; }
  }
  refresh.addEventListener('click', check);
  document.getElementById('print-receipt').addEventListener('click', () => window.print());
  document.getElementById('another-enrollment').addEventListener('click', () => sessionStorage.removeItem('dera-checkout'));
  window.addEventListener('pagehide', () => clearTimeout(timer));
  check();
})();
