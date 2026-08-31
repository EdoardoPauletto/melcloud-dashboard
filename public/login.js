const form = document.getElementById('loginForm');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const submitButton = document.getElementById('loginButton');
const feedback = document.getElementById('loginFeedback');
const togglePassword = document.getElementById('togglePassword');

function setLoading(loading) {
  submitButton.disabled = loading;
  emailInput.disabled = loading;
  passwordInput.disabled = loading;
  submitButton.classList.toggle('loading', loading);
  submitButton.querySelector('.login-button-label').textContent = loading ? 'Accesso in corso' : 'Accedi';
  submitButton.querySelector('.login-button-icon').textContent = loading ? 'progress_activity' : 'arrow_forward';
}

togglePassword.addEventListener('click', () => {
  const showPassword = passwordInput.type === 'password';
  passwordInput.type = showPassword ? 'text' : 'password';
  togglePassword.setAttribute('aria-label', showPassword ? 'Nascondi password' : 'Mostra password');
  togglePassword.setAttribute('title', showPassword ? 'Nascondi password' : 'Mostra password');
  togglePassword.querySelector('.material-symbols-rounded').textContent = showPassword ? 'visibility_off' : 'visibility';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  feedback.textContent = '';
  setLoading(true);

  try {
    // Le credenziali vengono inviate una sola volta al backend tramite HTTPS
    // in produzione. Non vengono salvate in localStorage o cookie dal browser.
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: emailInput.value.trim(),
        password: passwordInput.value
      })
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      // Un 401 MELCloud mantiene l'utente sul form e mostra il messaggio server.
      throw new Error(body.error ?? 'Accesso non riuscito');
    }

    // Apri esplicitamente la dashboard: la root potrebbe essere in cache nel proxy.
    window.location.replace('index.html');
  } catch (error) {
    feedback.textContent = error.message ?? 'Accesso non riuscito';
    passwordInput.select();
  } finally {
    setLoading(false);
  }
});
