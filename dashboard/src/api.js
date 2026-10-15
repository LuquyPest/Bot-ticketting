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
    if (err.response?.status === 401 && path !== '/login' && !path.startsWith('/sa')) {
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
