// Review first, then submit to the server. No email application is opened.
window.DeraForms = (() => {
  const recipient = 'okolochinedu10@gmail.com';
  const root = new URL('../', document.currentScript.src);
  async function request(path, options = {}) {
    const response = await fetch(new URL(path, root), { ...options, cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Website sending is unavailable. Your message has not been sent.');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to send. Please try again.');
    return result;
  }
  function showStatus(form, message) { form.querySelector('.form-status').textContent = message; }
  function bind(form, extraFields = () => ({}), validate = () => true) {
    if (!form) return;
    const type = form.id === 'contact-form' ? 'contact' : 'partnership';
    const storageKey = `dera-message-${type}`;
    const status = document.createElement('p');
    status.className = 'form-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    form.appendChild(status);
    const preview = document.createElement('section'); preview.className = 'email-preview'; preview.hidden = true;
    const label = document.createElement('label');
    const draft = document.createElement('textarea'); draft.id = `${form.id}-draft`; draft.readOnly = true;
    label.htmlFor = draft.id; label.textContent = 'Review your message';
    const actions = document.createElement('div'); actions.className = 'message-actions';
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'btn-outline-gold'; edit.textContent = 'Edit message';
    const send = document.createElement('button'); send.type = 'button'; send.className = 'btn btn-gold'; send.textContent = 'Send message'; send.disabled = true;
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'btn-outline-gold'; copy.textContent = 'Copy message';
    const check = document.createElement('button'); check.type = 'button'; check.className = 'btn-outline-gold'; check.textContent = 'Check delivery status'; check.hidden = true;
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn-outline-gold'; retry.textContent = 'Try sending again'; retry.hidden = true;
    let reviewed = null, attempt = null, busy = false, enabled = false, locked = false, timer, polls = 0;
    const originalControls = Array.from(form.querySelectorAll('input, textarea, select, button'));
    function lock(value) { locked = value; originalControls.forEach(control => { control.disabled = value; }); edit.disabled = value; }
    function save() { try { sessionStorage.setItem(storageKey, JSON.stringify(attempt)); } catch { /* Keep the in-memory token for this page. */ } }
    function message() {
      // Read controls directly, including disabled controls while a send is in progress.
      const fields = {};
      form.querySelectorAll('input[name],textarea[name],select[name]').forEach(control => {
        if (control.type !== 'checkbox' && control.type !== 'radio' || control.checked) fields[control.name] = control.value;
      });
      Object.assign(fields, extraFields());
      const lines = Object.entries(fields).map(([key,value]) => `${form.elements.namedItem(key)?.labels?.[0]?.textContent.trim() || key}: ${String(value).trim()}`);
      return { fields, subject: form.dataset.emailSubject, body: lines.join('\n\n') };
    }
    function invalidate() {
      if (locked || (!reviewed && !attempt)) return;
      reviewed = null; attempt = null; preview.hidden = true; check.hidden = true; retry.hidden = true;
      showStatus(form, 'Your message changed. Review it again before sending.');
    }
    form.addEventListener('input', event => { if (!preview.contains(event.target)) invalidate(); });
    form.addEventListener('change', event => { if (!preview.contains(event.target)) invalidate(); });
    form.addEventListener('click', event => { if (event.target.closest('.chip')) invalidate(); });
    edit.addEventListener('click', () => { invalidate(); originalControls.find(control => control.tagName === 'INPUT')?.focus(); });
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(draft.value); showStatus(form, 'Message copied. Copying does not send another message.'); }
      catch { draft.focus(); draft.select(); showStatus(form, 'Copy the selected message.'); }
    });
    function display(result) {
      attempt.status = result.status; attempt.reference = result.reference; save();
      const reference = ` Reference: ${result.reference}.`;
      send.disabled = true; retry.hidden = true; check.hidden = false;
      if (result.status === 'sent') {
        showStatus(form, `Your message was sent to ${recipient}.` + reference);
        lock(false); edit.textContent = 'Write another message';
      } else if (result.status === 'failed') {
        showStatus(form, 'The email server could not accept your message. Please try again later.' + reference);
        retry.hidden = false; lock(false);
      } else if (result.status === 'unknown') {
        showStatus(form, 'Delivery could not be confirmed. Please contact us with this reference before sending again.' + reference);
        lock(true);
      } else {
        showStatus(form, `Your message is queued for delivery to ${recipient}. We will retry temporary connection failures automatically.` + reference);
        lock(true);
        if (++polls < 10) timer = setTimeout(checkDelivery, 3000);
      }
    }
    async function checkDelivery() {
      clearTimeout(timer);
      if (!attempt?.reference || busy) return;
      check.disabled = true;
      try { display(await request(`api/messages/${attempt.reference}`, { headers: { Authorization: `Bearer ${attempt.token}` } })); }
      catch { showStatus(form, 'Unable to check delivery right now. Use Check delivery status again; please do not submit a duplicate message.'); }
      finally { check.disabled = false; }
    }
    check.addEventListener('click', () => { polls = 0; checkDelivery(); });
    retry.addEventListener('click', () => {
      if (attempt?.status !== 'failed') return;
      attempt = null; retry.hidden = true; send.disabled = !enabled; showStatus(form, 'Review your message, then choose Send message to retry.');
    });
    send.addEventListener('click', async () => {
      if (busy || !enabled || !reviewed) return;
      if (!locked && (!form.reportValidity() || !validate())) return;
      if (JSON.stringify(message()) !== JSON.stringify(reviewed)) { invalidate(); return; }
      if (!attempt) attempt = { token: Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2,'0')).join('') };
      save(); busy = true; lock(true); send.disabled = true;
      showStatus(form, 'Sending your reviewed message…');
      try {
        const result = await request('api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.token }, body: JSON.stringify({ type, reviewed: true, fields: reviewed.fields }) });
        display(result);
      } catch (error) {
        send.disabled = false;
        showStatus(form, `${error.message} Your message has been kept. Retry uses the same message reference to avoid duplicates.`);
      } finally { busy = false; }
    });
    actions.append(edit, send, copy, check, retry); preview.append(label, draft, actions); form.appendChild(preview);
    form.querySelector('[type="submit"]').disabled = false;
    form.querySelectorAll('input[required], textarea[required]').forEach(control => {
      const validateField = () => control.setCustomValidity(control.value.trim() ? '' : 'Please complete this field.');
      control.addEventListener('input', validateField); control.addEventListener('change', validateField);
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (locked || !form.reportValidity() || !validate()) return;
      reviewed = message();
      if (attempt?.status === 'sent' || attempt?.status === 'failed') attempt = null;
      draft.value = `To: ${recipient}\nSubject: ${reviewed.subject}\n\n${reviewed.body}`;
      preview.hidden = false; send.disabled = !enabled; edit.textContent = 'Edit message';
      showStatus(form, enabled ? 'Review your message below, then choose Send message. It has not been sent yet.' : 'You can review your message, but website sending is currently unavailable. Please try again later.');
      draft.focus(); preview.scrollIntoView({ block: 'nearest' });
    });
    request('api/messages/config').then(config => {
      enabled = config.enabled; send.disabled = !enabled;
      if (!enabled) showStatus(form, 'Website sending is currently unavailable. You can still write and review your message.');
      try { attempt = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { attempt = null; }
      if (attempt?.reference) {
        preview.hidden = false; check.hidden = false; send.disabled = true; lock(true); checkDelivery();
      }
    }).catch(() => showStatus(form, 'Website sending is currently unavailable. You can still write and review your message.'));
    window.addEventListener('pagehide', () => clearTimeout(timer));
  }
  return { bind, showStatus };
})();
