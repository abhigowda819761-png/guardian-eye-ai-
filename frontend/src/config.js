// Centralized API and WebSocket configuration for GuardianEye AI
const envApiUrl = import.meta.env.VITE_API_URL;

export const API_BASE_URL = envApiUrl ? envApiUrl.replace(/\/+$/, '') : '';

const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
export const WS_BASE_URL = import.meta.env.VITE_WS_URL
  ? import.meta.env.VITE_WS_URL.replace(/\/+$/, '')
  : (envApiUrl
      ? envApiUrl.replace(/^http/, 'ws').replace(/\/+$/, '')
      : `${wsProtocol}//${window.location.host}`);
