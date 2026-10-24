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
export const RENDER_PRODUCTION_URL = 'https://guardian-eye-ai-backend.onrender.com';

// 3. Local desktop browser development check (Only true on desktop browser localhost, never in native APK)
export const isLocalDesktop = typeof window !== 'undefined' && !isNativePlatform && (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
);
export const isLocal = isLocalDesktop;

const envApiUrl = import.meta.env.VITE_API_URL;

// 4. Global Cloud URL Resolution:
// When launched from a native Android APK or mobile device, dynamically resolve to the live Render endpoint.
// In desktop dev browser without VITE_API_URL, connect to local port 8000.
export const API_BASE_URL = (() => {
  if (isNativePlatform) {
    return envApiUrl && !envApiUrl.includes('localhost')
      ? envApiUrl.replace(/\/+$/, '')
      : RENDER_PRODUCTION_URL;
  }
  if (envApiUrl) {
    return envApiUrl.replace(/\/+$/, '');
  }
  return isLocalDesktop
    ? `http://${window.location.hostname}:8000`
    : RENDER_PRODUCTION_URL;
})();

export const FALLBACK_API_URLS = [
  API_BASE_URL,
  RENDER_PRODUCTION_URL,
  'https://guardian-eye-ai.onrender.com',
  `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:8000`,
  'http://localhost:8000',
  'http://10.102.167.95:8000',
  'http://127.0.0.1:8000'
].filter((url, idx, arr) => url && arr.indexOf(url) === idx);

export const WS_BASE_URL = import.meta.env.VITE_WS_URL
  ? import.meta.env.VITE_WS_URL.replace(/\/+$/, '')
  : (isNativePlatform
      ? RENDER_PRODUCTION_URL.replace(/^http/, 'ws')
      : (envApiUrl
          ? envApiUrl.replace(/^http/, 'ws').replace(/\/+$/, '')
          : (isLocalDesktop ? `ws://${window.location.hostname}:9000` : RENDER_PRODUCTION_URL.replace(/^http/, 'ws'))));

// ── 1. Stable Public Google STUN + Auxiliary Firewall Traversal Array ─────────
export const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.services.mozilla.com' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.sipgate.net:3478' }
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
const defaultPeerHost = import.meta.env.VITE_PEER_HOST || (isLocal ? window.location.hostname : undefined);
const defaultPeerPort = import.meta.env.VITE_PEER_PORT ? Number(import.meta.env.VITE_PEER_PORT) : (isLocal ? 9000 : undefined);
const defaultPeerPath = import.meta.env.VITE_PEER_PATH || '/peerjs';

export const PEER_OPTIONS = {
  config: ADVANCED_RTC_CONFIG,
  debug: 1,
  ...(defaultPeerHost ? {
    host: defaultPeerHost,
    port: defaultPeerPort,
    path: defaultPeerPath,
    secure: window.location.protocol === 'https:'
  } : {})
};

// ── 4. Bandwidth & Codec Constraints (SDP Transformation) ──────────────────────
/**
 * Modifies local and remote SDP strings to:
 * - Prioritize H.264 (hardware-accelerated low latency) and VP8 codecs over CPU-heavy AV1/VP9.
 * - Enforce dynamic bitrate capping (Max 500kbps per video stream) via b=AS and b=TIAS.
 */
export function optimizeSdp(sdp, maxBitrateKbps = 500) {
  if (!sdp || typeof sdp !== 'string') return sdp;

  const lines = sdp.split(/\r\n|\r|\n/);
  const modifiedLines = [];
  let inVideoSection = false;
  let mVideoLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('m=video')) {
      inVideoSection = true;
      mVideoLineIndex = modifiedLines.length;
      modifiedLines.push(line);
      continue;
    } else if (line.startsWith('m=')) {
      inVideoSection = false;
    }

    // Strip out pre-existing video bandwidth caps to ensure clean injection
    if (inVideoSection && (line.startsWith('b=AS:') || line.startsWith('b=TIAS:'))) {
      continue;
    }

    modifiedLines.push(line);
  }

  // Inject Bitrate Capping in video section
  if (mVideoLineIndex !== -1) {
    let insertIdx = mVideoLineIndex + 1;
    // If followed by connection line c=IN IP4 ..., place right after it
    if (insertIdx < modifiedLines.length && modifiedLines[insertIdx].startsWith('c=')) {
      insertIdx++;
    }
    modifiedLines.splice(
      insertIdx,
      0,
      `b=AS:${maxBitrateKbps}`,
      `b=TIAS:${maxBitrateKbps * 1000}`
    );
  }

  // Reorder payload types in m=video line to prioritize H264 (1st) and VP8 (2nd)
  const videoIdx = modifiedLines.findIndex(l => l.startsWith('m=video'));
  if (videoIdx !== -1) {
    const parts = modifiedLines[videoIdx].split(' ');
    const header = parts.slice(0, 3); // ['m=video', port, proto]
    const payloads = parts.slice(3);

    const h264List = [];
    const vp8List = [];
    const otherList = [];

    payloads.forEach(pt => {
      const rtpmap = modifiedLines.find(l => l.startsWith(`a=rtpmap:${pt} `));
      if (rtpmap) {
        const upper = rtpmap.toUpperCase();
        if (upper.includes('H264/')) {
          h264List.push(pt);
        } else if (upper.includes('VP8/')) {
          vp8List.push(pt);
        } else {
          otherList.push(pt);
        }
      } else {
        otherList.push(pt);
      }
    });

    const reordered = [...h264List, ...vp8List, ...otherList];
    if (reordered.length === payloads.length && reordered.length > 0) {
      modifiedLines[videoIdx] = [...header, ...reordered].join(' ');
    }
  }

  return modifiedLines.join('\r\n');
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
