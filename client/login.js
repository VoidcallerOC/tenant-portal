const form = document.querySelector('#login-form');
const error = document.querySelector('#error');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.hidden = true;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const response = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Unable to sign in.');
    window.location.assign(body.redirect || '/');
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    button.disabled = false;
  }
});
