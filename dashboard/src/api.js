import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'X-Requested-With': 'XMLHttpRequest' }
});

api.interceptors.response.use(
  r => r,
  err => {
    const path = window.location.pathname;
    if (err.response?.status === 401 && path !== '/login' && !path.startsWith('/sa') && !path.startsWith('/espace') && !path.startsWith('/invite') && path !== '/status') {
      window.location.href = '/login';
    }
    // The server requires 2FA for this account: only the profile (to turn it on) is reachable
    if (err.response?.status === 403 && err.response.data?.code === '2fa_required' && path !== '/profile') {
      window.location.href = '/profile?2fa=required';
    }
    return Promise.reject(err);
  }
);

export default api;
