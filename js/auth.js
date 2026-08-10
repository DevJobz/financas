const Auth = (() => {
  function getUser() {
    const raw = localStorage.getItem('fc_user');
    return raw ? JSON.parse(raw) : null;
  }

  function isLoggedIn() {
    return !!localStorage.getItem('fc_token');
  }

  function saveSession(token, user) {
    localStorage.setItem('fc_token', token);
    localStorage.setItem('fc_user', JSON.stringify(user));
  }

  function logout() {
    localStorage.removeItem('fc_token');
    localStorage.removeItem('fc_user');
    window.location.reload();
  }

  return { getUser, isLoggedIn, saveSession, logout };
})();
