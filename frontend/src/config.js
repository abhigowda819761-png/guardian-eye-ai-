// Centralized API and WebSocket configuration for GuardianEye AI
// Automatically uses VITE_API_URL if provided, else falls back cleanly to local development

const envApiUrl = import.meta.env.VITE_API_URL;

export const API_BASE_URL = envApiUrl
  ? envApiUrl.replace(/\/+$/, '')
  : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:8000'
      : `${window.location.protocol}//${window.location.hostname}:8000`);

const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
export const WS_BASE_URL = import.meta.env.VITE_WS_URL
  ? import.meta.env.VITE_WS_URL.replace(/\/+$/, '')
  : (envApiUrl
      ? envApiUrl.replace(/^http/, 'ws').replace(/\/+$/, '')
      : `${wsProtocol}//${window.location.hostname}:8000`);
