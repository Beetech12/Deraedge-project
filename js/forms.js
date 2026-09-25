// Preparing an email is not delivery. Preserve inputs until the visitor chooses to clear them.
window.DeraForms = (() => {
  const recipient = 'info@deraedge.com';
  function showStatus(form, message) {
    const status = form.querySelector('.form-status');
    status.textContent = message;
  }
  function bind(form, extraFields = () => ({}), validate = () => true) {
    if (!form) return;
    const status = document.createElement('p');
    status.className = 'form-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    form.appendChild(status);
    const preview = document.createElement('div');
    preview.className = 'email-preview';
    preview.hidden = true;
    const label = document.createElement('label');
    const draft = document.createElement('textarea');
    draft.id = `${form.id}-draft`;
    draft.readOnly = true;
    label.htmlFor = draft.id;
    label.textContent = 'Email draft — copy this if your email app does not open';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn-outline-gold';
    copy.textContent = 'Copy email draft';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(draft.value);
        showStatus(form, 'Draft copied. Paste it into an email to info@deraedge.com and send it.');
      } catch {
        draft.focus();
        draft.select();
        showStatus(form, 'Select and copy the draft, then email it to info@deraedge.com.');
      }
    });
    preview.append(label, draft, copy);
    form.appendChild(preview);
    form.querySelector('[type="submit"]').disabled = false;
    form.querySelectorAll('input[required], textarea[required]').forEach(control => {
      const check = () => control.setCustomValidity(control.value.trim() ? '' : 'Please complete this field.');
      control.addEventListener('input', check);
      control.addEventListener('change', check);
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!form.reportValidity() || !validate()) return;
      const fields = Object.fromEntries(new FormData(form));
      const lines = Object.entries({ ...fields, ...extraFields() }).map(([key, value]) => {
        const control = form.elements.namedItem(key);
        const label = control?.labels?.[0]?.textContent.trim() || key;
        return `${label}: ${String(value).trim()}`;
      });
      const subject = form.dataset.emailSubject;
      const body = lines.join('\n\n');
      draft.value = `To: ${recipient}\nSubject: ${subject}\n\n${body}`;
      preview.hidden = false;
      const url = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      showStatus(form, 'Draft prepared, not sent. Review and send it in your email app, or copy it below.');
      // Long mailto links are unreliable; the copyable draft has no such limit.
      if (url.length <= 1800) window.location.href = url;
      else showStatus(form, 'Draft prepared, not sent. Copy the draft below into an email to info@deraedge.com.');
    });
  }
  return { bind, showStatus };
})();
