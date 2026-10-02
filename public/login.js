const form = document.getElementById('loginForm');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const submitButton = document.getElementById('loginButton');
const feedback = document.getElementById('loginFeedback');
const togglePassword = document.getElementById('togglePassword');
const t = I18n.t;

function setLoading(loading) {
  submitButton.disabled = loading;
  emailInput.disabled = loading;
  passwordInput.disabled = loading;
  submitButton.classList.toggle('loading', loading);
  submitButton.querySelector('.login-button-label').textContent = t(loading ? 'login.submitting' : 'login.submit');
  submitButton.querySelector('.login-button-icon').textContent = loading ? 'progress_activity' : 'arrow_forward';
}

togglePassword.addEventListener('click', () => {
  const showPassword = passwordInput.type === 'password';
  passwordInput.type = showPassword ? 'text' : 'password';
  const toggleLabel = t(showPassword ? 'login.hidePassword' : 'login.showPassword');
  togglePassword.setAttribute('aria-label', toggleLabel);
  togglePassword.setAttribute('title', toggleLabel);
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
      // La lingua esplicita garantisce messaggi di errore coerenti con la pagina.
      headers: { 'Content-Type': 'application/json', 'Accept-Language': I18n.lang },
      body: JSON.stringify({
        email: emailInput.value.trim(),
        password: passwordInput.value
      })
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      // Un 401 MELCloud mantiene l'utente sul form e mostra il messaggio server.
      throw new Error(body.error ?? t('login.failed'));
    }

    // Apri esplicitamente la dashboard: la root potrebbe essere in cache nel proxy.
    window.location.replace('index.html');
  } catch (error) {
    feedback.textContent = error.message ?? t('login.failed');
    passwordInput.select();
  } finally {
    setLoading(false);
  }
});
