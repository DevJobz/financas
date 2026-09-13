const Auth = (() => {
  function getUser() {
    const raw = localStorage.getItem('fc_user');
    return raw ? JSON.parse(raw) : null;
  }

  function getToken() {
    return localStorage.getItem('fc_token');
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

  return { getUser, getToken, isLoggedIn, saveSession, logout };
})();