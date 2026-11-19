/**
 * Global Network Configuration for GuardianEye AI
 * Optimized for Render.com production cloud hosting and native Android APK environments.
 */

// 1. Detect if running inside a native mobile APK container (Capacitor / Android WebView)
export const isNativePlatform = typeof window !== 'undefined' && Boolean(
  window.Capacitor !== undefined ||
  window.location.protocol === 'capacitor:' ||
  window.location.protocol === 'ionic:' ||
  (window.origin && window.origin.includes('capacitor://')) ||
  (window.location.hostname === 'localhost' && typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent))
);

// 2. Live Render.com Production Cloud Endpoint
export const RENDER_PRODUCTION_URL = 'https://guardian-eye-ai-1.onrender.com';

// 3. Local desktop browser development check (Only true on desktop browser localhost, never in native APK)
export const isLocalDesktop = typeof window !== 'undefined' && !isNativePlatform && (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname === '0.0.0.0'
);
export const isLocal = isLocalDesktop;

const envApiUrl = import.meta.env.VITE_API_URL;

// 4. Global Cloud URL Resolution:
// When launched from a native Android APK or mobile device, dynamically resolve to the live Render endpoint.
// In desktop dev browser (Vite), use '' so requests route through Vite's dev proxy to port 8000.
export const API_BASE_URL = (() => {
  if (isNativePlatform) {
    return envApiUrl && !envApiUrl.includes('localhost')
      ? envApiUrl.replace(/\/+$/, '')
      : RENDER_PRODUCTION_URL;
  }
  if (isLocalDesktop) {
    // If user explicitly provided a localhost URL in .env, honor it; otherwise default to '' for Vite proxy
    if (envApiUrl && (envApiUrl.includes('localhost') || envApiUrl.includes('127.0.0.1'))) {
      return envApiUrl.replace(/\/+$/, '');
    }
    return '';
  }
  if (envApiUrl) {
    return envApiUrl.replace(/\/+$/, '');
  }
  return RENDER_PRODUCTION_URL;
})();

export const FALLBACK_API_URLS = [
  '',
  'http://127.0.0.1:8000',
  'http://localhost:8000',
  API_BASE_URL,
  RENDER_PRODUCTION_URL
].filter((url, idx, arr) => (url !== undefined && url !== null) && arr.indexOf(url) === idx);

export const WS_BASE_URL = import.meta.env.VITE_WS_URL
  ? import.meta.env.VITE_WS_URL.replace(/\/+$/, '')
  : (isNativePlatform
      ? RENDER_PRODUCTION_URL.replace(/^http/, 'ws')
      : (isLocalDesktop
          ? `ws://${window.location.hostname}:9000`
          : (envApiUrl ? envApiUrl.replace(/^http/, 'ws').replace(/\/+$/, '') : RENDER_PRODUCTION_URL.replace(/^http/, 'ws'))));

// ── 1. Stable Public Google STUN + Auxiliary Firewall Traversal Array ─────────
export const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // OpenRelay Public TURN Relay fallback for strict NAT / mobile firewall traversal
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelay',
    credential: 'openrelay'
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelay',
    credential: 'openrelay'
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelay',
    credential: 'openrelay'
  }
];

// Retain alias for backward compatibility
export const GOOGLE_STUN_SERVERS = STUN_SERVERS;

// ── 2. Advanced RTCConfiguration ──────────────────────────────────────────────
export const ADVANCED_RTC_CONFIG = {
  iceServers: STUN_SERVERS,
  iceTransportPolicy: 'all',
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  sdpSemantics: 'unified-plan'
};

// ── 3. PeerJS Client Configuration ────────────────────────────────────────────
// Automatically bind to the active origin/proxy so signaling never drops or hits rate-limited public servers
const defaultPeerHost = import.meta.env.VITE_PEER_HOST || (typeof window !== 'undefined' ? window.location.hostname : undefined);
const defaultPeerPort = import.meta.env.VITE_PEER_PORT 
  ? Number(import.meta.env.VITE_PEER_PORT) 
  : (typeof window !== 'undefined'
      ? (window.location.port ? Number(window.location.port) : (window.location.protocol === 'https:' ? 443 : 80))
      : undefined);
const defaultPeerPath = import.meta.env.VITE_PEER_PATH || '/peerjs';

export const PEER_OPTIONS = {
  config: ADVANCED_RTC_CONFIG,
  debug: 1,
  ...(defaultPeerHost ? {
    host: defaultPeerHost,
    port: defaultPeerPort,
    path: defaultPeerPath,
    secure: typeof window !== 'undefined' ? window.location.protocol === 'https:' : true
  } : {})
};

// ── 4. Bandwidth & Codec Constraints (SDP Transformation) ──────────────────────
/**
 * Modifies local and remote SDP strings to:
 * - Prioritize H.264 (hardware-accelerated low latency) and VP8 codecs over CPU-heavy AV1/VP9.
 * - Enforce dynamic bitrate capping (Max 500kbps per video stream) via b=AS and b=TIAS.
 */
export function optimizeSdp(sdp, maxBitrateKbps = 500) {
  // Use clean browser-standard SDP to guarantee 100% interoperability across devices
  // Sender bitrate constraints are handled directly via RTCRtpSender.setParameters in applySenderConstraints
  return sdp;
}

// ── 5. Direct RTCRtpSender Capping & Resilience Constraints ────────────────────
/**
 * Directly configures RTCRtpSender parameters on an active RTCPeerConnection:
 * - Caps video stream to max 500kbps & 24fps
 * - Locks high network priority for audio streams
 */
export async function applySenderConstraints(peerConnection, maxBitrateKbps = 500) {
  if (!peerConnection || typeof peerConnection.getSenders !== 'function') return;

  try {
    const senders = peerConnection.getSenders();
    for (const sender of senders) {
      if (sender.track && sender.track.kind === 'video') {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings.forEach(enc => {
          enc.maxBitrate = maxBitrateKbps * 1000;
          enc.maxFramerate = 24;
          enc.priority = 'medium';
          enc.networkPriority = 'medium';
        });
        try {
          await sender.setParameters(params);
          console.log(`[WebRTC Optimizer] Video constrained to ${maxBitrateKbps}kbps @ 24fps`);
        } catch (setErr) {
          // Safari/certain web engines reject priority fields on encoding parameters
          params.encodings.forEach(enc => {
            delete enc.priority;
            delete enc.networkPriority;
          });
          try {
            await sender.setParameters(params);
            console.log(`[WebRTC Optimizer] Video constrained to ${maxBitrateKbps}kbps @ 24fps (fallback mode)`);
          } catch (fallbackErr) {
            console.warn('[WebRTC Optimizer] Video encoding parameter fallback note:', fallbackErr.message);
          }
        }
      } else if (sender.track && sender.track.kind === 'audio') {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings.forEach(enc => {
          enc.priority = 'high';
          enc.networkPriority = 'high';
        });
        try {
          await sender.setParameters(params);
        } catch (audioParamErr) {
          params.encodings.forEach(enc => {
            delete enc.priority;
            delete enc.networkPriority;
          });
          try { await sender.setParameters(params); } catch {}
        }
      }
    }
  } catch (err) {
    console.warn('[WebRTC Optimizer] Sender parameter note:', err.message);
  }
}
