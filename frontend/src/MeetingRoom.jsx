import { useState, useEffect, useRef, useCallback } from 'react';
import PeerJS from 'peerjs';
const Peer = PeerJS?.Peer || PeerJS?.default || PeerJS;
import './MeetingRoom.css';
import {
  API_BASE_URL,
  PEER_OPTIONS,
  GOOGLE_STUN_SERVERS,
  ADVANCED_RTC_CONFIG,
  STUN_SERVERS,
  optimizeSdp,
  applySenderConstraints
} from './config';
import { saveRecording } from './utils/recordingsDb';
import {
  uploadMeetingVideoToFirebase,
  auth,
  getCurrentAuthUser
} from './firebase';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Hand,
  Circle,
  StickyNote,
  PhoneOff,
  Copy,
  Check,
  X,
  UserPlus,
  Users,
  WifiOff,
  UserX,
  Pin,
  FileText,
  Download,
  Cpu,
  Sparkles
} from 'lucide-react';

// Room API helper supporting live Vercel Serverless Functions and local backends
async function roomApi(urlPath, options = {}) {
  const normalizedPath = urlPath.startsWith('/') ? urlPath : `/${urlPath}`;
  const remoteUrl = API_BASE_URL ? `${API_BASE_URL}${normalizedPath}` : normalizedPath;

  // 1. Try remoteUrl with 2500ms timeout
  const remoteCtrl = new AbortController();
  const remoteTimeout = setTimeout(() => remoteCtrl.abort(), 2500);

  try {
    const res = await fetch(remoteUrl, { ...options, signal: remoteCtrl.signal });
    clearTimeout(remoteTimeout);
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    // Remote request failed or timed out, try local/relative fallback
  } finally {
    clearTimeout(remoteTimeout);
  }

  // 2. Try relative local path with 2500ms timeout
  if (remoteUrl !== normalizedPath) {
    const localCtrl = new AbortController();
    const localTimeout = setTimeout(() => localCtrl.abort(), 2500);
    try {
      const res = await fetch(normalizedPath, { ...options, signal: localCtrl.signal });
      clearTimeout(localTimeout);
      if (res.ok) {
        return await res.json();
      }
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.error || `HTTP error ${res.status}`);
    } catch (localErr) {
      clearTimeout(localTimeout);
      throw localErr;
    }
  }

  throw new Error(`Failed to communicate with Room API endpoint: ${urlPath}`);
}

// ── Movie-Script Formatter (BIT 3) ──────────────────────────────────────────
export function compileMovieScript(transcripts = [], meetingName = 'Strategy Session', dateStr = '') {
  const header = `=================================================================\n` +
                 `GUARDIANEYE AI - STRUCTURED CONVERSATION TRANSCRIPT\n` +
                 `Meeting Topic: ${meetingName}\n` +
                 `Date: ${dateStr || new Date().toLocaleDateString()}\n` +
                 `Recorded Capacity: Up to 5 Members\n` +
                 `=================================================================\n\n`;

  const scriptLines = transcripts.map(t => `${t.speakerLabel}: ${t.text}`).join('\n\n');
  return header + (scriptLines || "No spoken dialogue recorded during this meeting session.");
}

// ─── Remote Video Tile ───────────────────────────────────────────────────────
function RemoteVideoTile({ peer, isHost, onKick, isSpeaking, isPinned, onPin, onRegisterVideoEl }) {
  const remoteVideoRef = useRef(null);
  const [hovered, setHovered] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [, setTrackStateUpdate] = useState(0);

  useEffect(() => {
    if (onRegisterVideoEl) {
      onRegisterVideoEl(peer.id, remoteVideoRef.current);
    }
    return () => {
      if (onRegisterVideoEl) {
        onRegisterVideoEl(peer.id, null);
      }
    };
  }, [peer.id, onRegisterVideoEl]);

  useEffect(() => {
    const videoEl = remoteVideoRef.current;
    if (!videoEl) return;

    if (!peer.stream) {
      videoEl.srcObject = null;
      return;
    }

    if (videoEl.srcObject !== peer.stream) {
      videoEl.srcObject = peer.stream;
    }

    const tryPlay = () => {
      videoEl.play()
        .then(() => setAutoplayBlocked(false))
        .catch(err => {
          console.warn('Autoplay blocked for peer video:', err);
          videoEl.muted = true;
          videoEl.play()
            .then(() => setAutoplayBlocked(true))
            .catch(() => setAutoplayBlocked(true));
        });
    };

    tryPlay();

    const onTrackChange = () => {
      if (videoEl && peer.stream) {
        if (videoEl.srcObject !== peer.stream) {
          videoEl.srcObject = peer.stream;
        }
        tryPlay();
      }
      setTrackStateUpdate(n => n + 1);
    };

    peer.stream.addEventListener('addtrack', onTrackChange);
    peer.stream.addEventListener('removetrack', onTrackChange);

    const videoTracks = peer.stream.getVideoTracks();
    videoTracks.forEach(t => {
      t.addEventListener('unmute', onTrackChange);
      t.addEventListener('mute', onTrackChange);
      t.addEventListener('ended', onTrackChange);
    });

    return () => {
      if (peer.stream) {
        peer.stream.removeEventListener('addtrack', onTrackChange);
        peer.stream.removeEventListener('removetrack', onTrackChange);
        videoTracks.forEach(t => {
          t.removeEventListener('unmute', onTrackChange);
          t.removeEventListener('mute', onTrackChange);
          t.removeEventListener('ended', onTrackChange);
        });
      }
    };
  }, [peer.stream, peer.id]);

  const handleUnmute = (e) => {
    e.stopPropagation();
    const videoEl = remoteVideoRef.current;
    if (videoEl) {
      videoEl.muted = false;
      videoEl.play().then(() => setAutoplayBlocked(false)).catch(() => {});
    }
  };

  const hasVideoTrack = Boolean(
    peer.stream &&
    peer.stream.getVideoTracks().length > 0 &&
    peer.stream.getVideoTracks().some(t => t.readyState === 'live')
  );
  const hasVideo = hasVideoTrack && peer.videoOn !== false;

  return (
    <div
      className={`video-tile ${peer.handRaised ? 'hand-raised-tile' : ''} ${isPinned ? 'pinned-tile' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <video
        key={peer.id}
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className={`video-tile-video ${!hasVideo ? 'camera-off' : ''}`}
      />

      {!hasVideo && (
        <div className="video-tile-avatar">
          <div className="avatar-circle">
            {(peer.name || 'G').charAt(0).toUpperCase()}
          </div>
          <span className="avatar-subtext">
            {peer.name} {peer.stream ? '(Camera Off)' : '(Connecting…)'}
          </span>
        </div>
      )}



      {/* Pin / Lock Recording Button */}
      {onPin && (
        <button
          type="button"
          className={`tile-pin-btn ${isPinned ? 'pinned' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onPin(peer.id);
          }}
          title={isPinned ? 'Unpin (return to Auto Active Speaker)' : `Pin recording to ${peer.name}`}
        >
          <Pin size={13} fill={isPinned ? '#38BDF8' : 'none'} />
          <span>{isPinned ? 'Pinned' : 'Pin User'}</span>
        </button>
      )}

      {autoplayBlocked && (
        <button className="tile-unmute-banner" onClick={handleUnmute}>
          🔊 Click to enable audio
        </button>
      )}

      <div className="tile-name-pill">
        <span>{peer.name}</span>
        <span className={`tile-role-tag ${peer.role || 'guest'}`}>
          {peer.role === 'host' ? 'Host' : 'Guest'}
        </span>
      </div>

      <div className={`tile-status-pill ${!peer.audioOn ? 'muted' : ''}`} title={peer.audioOn ? 'Mic Active' : 'Muted'}>
        {peer.audioOn !== false ? <Mic size={14} /> : <MicOff size={14} />}
      </div>

      {peer.handRaised && (
        <div className="tile-hand-tag">✋ Hand Raised</div>
      )}

      {/* Host-only: Kick button overlay on hover */}
      {isHost && hovered && (
        <div className="tile-kick-overlay">
          <button
            className="tile-kick-btn"
            onClick={(e) => {
              e.stopPropagation();
              onKick(peer);
            }}
            title={`Remove ${peer.name} from meeting`}
          >
            <UserX size={15} />
            <span>Remove</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── MeetingRoom Component ───────────────────────────────────────────────────
function MeetingRoom({
  meetingName,
  hostName,
  onEndMeeting,
  roomCode: propRoomCode,
  isGuest = false,
  onSaveRecording
}) {
  const localVideoRef        = useRef(null);
  const streamRef            = useRef(null);     // local MediaStream
  const peerInstanceRef      = useRef(null);     // PeerJS Peer instance
  const callsRef             = useRef({});       // peerId -> MediaConnection
  const dataConnsRef         = useRef({});       // peerId -> DataConnection
  const mediaRecorderRef     = useRef(null);
  const recordedChunksRef    = useRef([]);
  const recordingStartTimeRef= useRef(null);     // Track actual elapsed recording time
  const recordingAudioCtxRef = useRef(null);     // Web Audio context for recording mix
  const recordingSourcesRef  = useRef([]);        // Retain audio node references to prevent GC
  const recognitionRef       = useRef(null);
  const isMountedRef         = useRef(true);

  // BIT 1: Screen Recording with getDisplayMedia & Mixed Audio
  const displayStreamRef       = useRef(null);
  const lastRecordingBlobRef   = useRef(null);
  const lastRecordingUrlRef    = useRef(null);
  const lastRecordingFilenameRef = useRef(null);
  const recordingDestRef       = useRef(null);

  // BIT 2 & 3: WebRTC Data Channel Speech Identity Mapping & Central Script Aggregator
  const transcriptLogRef       = useRef([]);
  const participantOrderRef    = useRef(new Map());
  const [transcriptEntries, setTranscriptEntries] = useState([]);

  // Media state
  const [localStream,  setLocalStream]  = useState(null);
  const [mediaStatus,  setMediaStatus]  = useState('loading'); // 'loading' | 'ready' | 'error'
  const [mediaError,   setMediaError]   = useState('');
  const [videoOn,      setVideoOn]      = useState(true);
  const [audioOn,      setAudioOn]      = useState(true);
  const [handRaised,   setHandRaised]   = useState(false);
  const [isRecording,  setIsRecording]  = useState(false);
  const [showNotes,    setShowNotes]    = useState(false);
  const [peers,        setPeers]        = useState([]);
  const [joinRequests, setJoinRequests] = useState([]);
  const [liveCaption,  setLiveCaption]  = useState(null);
  const [peerStatus,   setPeerStatus]   = useState('connecting');
  const [codeCopied,   setCodeCopied]   = useState(false);
  const [isWaitingForApproval, setIsWaitingForApproval] = useState(isGuest);
  const [kickTarget, setKickTarget] = useState(null);
  // Apple Silicon M2 GPU Diarization & Whisper State
  const [m2ProcessingStatus, setM2ProcessingStatus] = useState(null);
  const [m2ScriptResult, setM2ScriptResult] = useState(null);
  const [showScriptModal, setShowScriptModal] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);
  // Firebase Storage Recording Upload & Report Generation State
  const [showGenerateReportBtn, setShowGenerateReportBtn] = useState(false);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState(null);
  const [isUploadingToFirebase, setIsUploadingToFirebase] = useState(false);
  const [firebaseUploadProgress, setFirebaseUploadProgress] = useState(0);
  const [firebaseUploadStatus, setFirebaseUploadStatus] = useState(null);

  const remoteStreamsRef     = useRef({});       // peerId -> MediaStream (for recording & analysers)
  const remoteVideoElsRef    = useRef({});       // peerId -> HTMLVideoElement
  const activeSpeakerIdRef   = useRef('local');  // 'local' | peerId
  const pinnedSpeakerIdRef   = useRef(null);     // null = auto active speaker, or 'local' | peerId
  const activeSpeakerNameRef = useRef(hostName || 'You');
  const recordingCanvasRef   = useRef(null);
  const recordingAnimFrameRef= useRef(null);
  const recordingStreamRef   = useRef(null);
  const peersRef             = useRef([]);
  const videoOnRef           = useRef(true);
  const audioOnRef           = useRef(true);
  const setupCallRef         = useRef(null);

  const [activeSpeakerId,   setActiveSpeakerId]   = useState('local');
  const [pinnedSpeakerId,   setPinnedSpeakerId]   = useState(null);
  const [activeSpeakerName, setActiveSpeakerName] = useState(hostName || 'You');

  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  useEffect(() => {
    videoOnRef.current = videoOn;
  }, [videoOn]);

  useEffect(() => {
    audioOnRef.current = audioOn;
  }, [audioOn]);

  const handleRegisterVideoEl = useCallback((peerId, el) => {
    if (el) {
      remoteVideoElsRef.current[peerId] = el;
    } else {
      delete remoteVideoElsRef.current[peerId];
    }
  }, []);

  const handlePinUser = useCallback((targetId) => {
    setPinnedSpeakerId(prev => {
      const next = prev === targetId ? null : targetId;
      pinnedSpeakerIdRef.current = next;
      if (next) {
        let name = hostName || 'You';
        if (next !== 'local') {
          const p = peersRef.current.find(x => x.id === next);
          if (p) name = p.name;
        }
        setActiveSpeakerName(name);
        activeSpeakerNameRef.current = name;
      } else {
        let name = hostName || 'You';
        if (activeSpeakerIdRef.current !== 'local') {
          const p = peersRef.current.find(x => x.id === activeSpeakerIdRef.current);
          if (p) name = p.name;
        }
        setActiveSpeakerName(name);
        activeSpeakerNameRef.current = name;
      }
      return next;
    });
  }, [hostName]);

  const [meetingCode] = useState(() => {
    if (propRoomCode) return propRoomCode.toUpperCase();
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 3; i++) code += chars[Math.floor(Math.random() * chars.length)];
    code += '-';
    for (let i = 0; i < 3; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  });

  const [notesText] = useState(() => {
    try { return localStorage.getItem(`guardianeye_notes_${meetingCode}`) || ''; } catch { return ''; }
  });
  const [notesValue, setNotesValue] = useState(notesText);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const upsertPeer = useCallback((id, patch) => {
    setPeers(prev => {
      const idx = prev.findIndex(p => p.id === id);
      if (idx === -1) {
        return [...prev, { id, name: 'Peer', role: 'participant', stream: null, handRaised: false, audioOn: true, videoOn: true, ...patch }];
      }
      const updated = [...prev];
      updated[idx] = { ...updated[idx], ...patch };
      return updated;
    });
  }, []);

  const removePeer = useCallback((id) => {
    if (callsRef.current[id]) {
      try { callsRef.current[id].close(); } catch {}
      delete callsRef.current[id];
    }
    if (dataConnsRef.current[id]) {
      try { dataConnsRef.current[id].close(); } catch {}
      delete dataConnsRef.current[id];
    }
    delete remoteStreamsRef.current[id];
    delete remoteVideoElsRef.current[id];
    setPeers(prev => prev.filter(p => p.id !== id));
  }, []);

  // Broadcast data payload to all connected data channels
  const broadcastData = useCallback((payload) => {
    Object.values(dataConnsRef.current).forEach(conn => {
      if (conn && conn.open) {
        try {
          conn.send(payload);
        } catch (e) {
          console.warn('[PeerJS] Broadcast failed to peer:', e);
        }
      }
    });
  }, []);

  // ── 1. Start local camera & mic ───────────────────────────────────────────
  const startMedia = useCallback(async () => {
    setMediaStatus('loading');
    setMediaError('');

    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const msg = 'Camera and microphone access requires HTTPS or localhost, or your browser does not support media devices.';
      console.warn('[MeetingRoom]', msg);
      if (!isMountedRef.current) return null;
      setMediaStatus('error');
      setMediaError(msg);
      setVideoOn(false);
      return null;
    }

    let stream = null;
    let videoAcquired = false;
    let audioAcquired = false;

    // 1. Try high quality standard user-facing constraints
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 30, max: 30 },
          facingMode: 'user'
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      videoAcquired = stream.getVideoTracks().length > 0;
      audioAcquired = stream.getAudioTracks().length > 0;
    } catch (e1) {
      console.warn('[MeetingRoom] High-res media profile failed, trying basic video + audio:', e1.message);
      // 2. Try basic video + audio
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        videoAcquired = stream.getVideoTracks().length > 0;
        audioAcquired = stream.getAudioTracks().length > 0;
      } catch (e2) {
        console.warn('[MeetingRoom] Basic video + audio failed, trying video only:', e2.message);
        // 3. Try video only (mic may be locked or permission denied)
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          videoAcquired = stream.getVideoTracks().length > 0;
          audioAcquired = false;
        } catch (e3) {
          console.warn('[MeetingRoom] Video only failed, trying audio only:', e3.message);
          // 4. Try audio only (camera may be locked or permission denied)
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
            videoAcquired = false;
            audioAcquired = stream.getAudioTracks().length > 0;
          } catch (e4) {
            console.error('[MeetingRoom] All media device access attempts failed:', e4);
            let userMsg = 'Camera and microphone access could not be initialized.';
            if (e4.name === 'NotAllowedError' || e4.name === 'PermissionDeniedError') {
              userMsg = 'Camera or microphone permission was blocked. Please click the lock or camera icon in your browser address bar to allow access.';
            } else if (e4.name === 'NotFoundError' || e4.name === 'DevicesNotFoundError') {
              userMsg = 'No camera or microphone found. Please connect a webcam or headset.';
            } else if (e4.name === 'NotReadableError' || e4.name === 'TrackStartError') {
              userMsg = 'Camera or microphone is already in use by another app (e.g. Zoom, Teams, FaceTime).';
            } else if (e4.message) {
              userMsg = e4.message;
            }

            if (!isMountedRef.current) return null;
            setMediaStatus('error');
            setMediaError(userMsg);
            setVideoOn(false);
            return null;
          }
        }
      }
    }

    if (!isMountedRef.current) {
      if (stream) stream.getTracks().forEach(t => t.stop());
      return null;
    }

    streamRef.current = stream;
    setLocalStream(stream);
    setMediaStatus('ready');
    setVideoOn(videoAcquired);
    setAudioOn(audioAcquired);

    // If active peer calls exist, dynamically replace or attach new tracks
    Object.values(callsRef.current).forEach(call => {
      const pc = call.peerConnection;
      if (pc && typeof pc.getSenders === 'function') {
        const senders = pc.getSenders();
        stream.getTracks().forEach(track => {
          const sender = senders.find(s => s.track && s.track.kind === track.kind);
          if (sender) {
            try { sender.replaceTrack(track); } catch (e) {}
          } else {
            try { pc.addTrack(track, stream); } catch (e) {}
          }
        });
      }
    });

    return stream;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    startMedia();

    return () => {
      isMountedRef.current = false;
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch {}
      if (recordingAudioCtxRef.current) {
        try { recordingAudioCtxRef.current.close(); } catch {}
        recordingAudioCtxRef.current = null;
      }
      recordingSourcesRef.current = [];
      recordingDestRef.current = null;
      if (displayStreamRef.current) {
        try { displayStreamRef.current.getTracks().forEach(t => t.stop()); } catch {}
        displayStreamRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, [startMedia]);

  // Robust live video element attachment and playback
  useEffect(() => {
    const videoEl = localVideoRef.current;
    if (!videoEl) return;

    if (!localStream) {
      videoEl.srcObject = null;
      return;
    }

    if (videoEl.srcObject !== localStream) {
      videoEl.srcObject = localStream;
    }

    // Set muted property directly on DOM element to bypass React JSX muted attribute bug
    videoEl.muted = true;
    videoEl.defaultMuted = true;
    videoEl.playsInline = true;
    videoEl.setAttribute('playsinline', '');
    videoEl.setAttribute('muted', '');

    const tryPlay = () => {
      const p = videoEl.play();
      if (p !== undefined) {
        p.catch(err => {
          console.warn('[MeetingRoom] Autoplay prevented, muting and retrying:', err);
          videoEl.muted = true;
          videoEl.play().catch(() => {});
        });
      }
    };

    tryPlay();
  }, [localStream, videoOn]);

  const setupCall = useCallback((call, defaultName = 'Participant', defaultRole = 'participant') => {
    const peerId = call.peer;
    callsRef.current[peerId] = call;

    // ── WebRTC RTCPeerConnection Optimization & Resilience ──────────────────
    const pc = call.peerConnection;
    let statsInterval = null;

    if (pc) {
      // 1. Enforce direct sender bitrate capping (500 kbps) & prioritize audio
      applySenderConstraints(pc, 500);

      // 2. Automated connection retry triggers if ICE state enters 'failed' or 'disconnected'
      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        console.log(`[WebRTC ICE Monitor] Peer ${peerId} state:`, state);
        if (state === 'disconnected') {
          console.warn(`[WebRTC ICE] Disconnected from ${peerId}. Triggering ICE restart recovery...`);
          if (typeof pc.restartIce === 'function') {
            pc.restartIce();
          }
        } else if (state === 'failed') {
          console.warn(`[WebRTC ICE] Connection failed with ${peerId}. Triggering automated reconnect...`);
          if (typeof pc.restartIce === 'function') {
            pc.restartIce();
          } else if (streamRef.current && peerInstanceRef.current) {
            try {
              const retryCall = peerInstanceRef.current.call(peerId, streamRef.current, {
                sdpTransform: (sdp) => optimizeSdp(sdp, 500)
              });
              if (retryCall && setupCallRef.current) setupCallRef.current(retryCall, defaultName, defaultRole);
            } catch (retryErr) {
              console.warn('[WebRTC ICE] Reconnect call attempt note:', retryErr.message);
            }
          }
        } else if (state === 'connected' || state === 'completed') {
          applySenderConstraints(pc, 500);
        }
      };

      // 3. Automated Resilience Fallback: Heavy Frame Drop Monitoring
      let lastFramesReceived = 0;
      let lastFramesDropped = 0;
      let isThrottled = false;

      statsInterval = setInterval(async () => {
        if (!pc || pc.signalingState === 'closed' || !callsRef.current[peerId]) {
          clearInterval(statsInterval);
          return;
        }

        try {
          const stats = await pc.getStats();
          stats.forEach(report => {
            if (report.type === 'inbound-rtp' && report.kind === 'video') {
              const currentReceived = report.framesReceived || 0;
              const currentDropped = report.framesDropped || 0;
              const deltaReceived = currentReceived - lastFramesReceived;
              const deltaDropped = currentDropped - lastFramesDropped;

              lastFramesReceived = currentReceived;
              lastFramesDropped = currentDropped;

              const totalDelta = deltaReceived + deltaDropped;
              if (totalDelta > 15) {
                const dropRatio = deltaDropped / totalDelta;
                if (dropRatio > 0.25 && !isThrottled) {
                  // > 25% frames dropped: gracefully downgrade video resolution & bitrate
                  console.warn(`[WebRTC Resilience] Heavy frame drop detected (${Math.round(dropRatio * 100)}% drops) for ${peerId}. Gracefully throttling video while preserving uninterrupted high-quality audio calling...`);
                  isThrottled = true;
                  applySenderConstraints(pc, 250); // Downscale video bitrate to 250kbps
                } else if (dropRatio < 0.08 && isThrottled) {
                  // Network connection restored
                  console.log(`[WebRTC Resilience] Connection stabilized for ${peerId}. Restoring standard video bitrate...`);
                  isThrottled = false;
                  applySenderConstraints(pc, 500);
                }
              }
            }
          });
        } catch {}
      }, 3500);
    }

    call.on('stream', (remoteStream) => {
      console.log('[PeerJS] Received remote media stream from:', peerId);
      remoteStreamsRef.current[peerId] = remoteStream;
      upsertPeer(peerId, {
        stream: remoteStream,
        name: defaultName,
        role: defaultRole
      });

      // Dynamically attach audio if recording is active
      if (recordingAudioCtxRef.current && recordingDestRef.current) {
        try {
          const audioTracks = remoteStream.getAudioTracks();
          if (audioTracks.length > 0) {
            const peerAudioStream = new MediaStream([audioTracks[0]]);
            const peerSource = recordingAudioCtxRef.current.createMediaStreamSource(peerAudioStream);
            peerSource.connect(recordingDestRef.current);
            recordingSourcesRef.current.push(peerSource);
          }
        } catch (e) {
          console.warn('[Recorder] Dynamic audio mix attach note:', e);
        }
      }
    });

    call.on('close', () => {
      console.log('[PeerJS] Call closed with:', peerId);
      if (statsInterval) clearInterval(statsInterval);
      removePeer(peerId);
    });

    call.on('error', (err) => {
      console.warn('[PeerJS] Call error with:', peerId, err);
      if (statsInterval) clearInterval(statsInterval);
    });
  }, [upsertPeer, removePeer]);

  // ── Central Log Aggregator for Live Identity Mapping & Chronological Compilation (BIT 2 & 3) ──
  const handleIncomingSpeechChunk = useCallback((chunk) => {
    if (!chunk || !chunk.text) return;

    let speakerLabel = '';
    if (chunk.isHost) {
      speakerLabel = `Host (${chunk.speakerName || 'Host'})`;
    } else {
      let num = participantOrderRef.current.get(chunk.speakerId);
      if (!num) {
        const activeIdx = peersRef.current.filter(p => p.id !== '__self__').findIndex(p => p.id === chunk.speakerId);
        num = activeIdx >= 0 ? activeIdx + 1 : (participantOrderRef.current.size + 1);
        participantOrderRef.current.set(chunk.speakerId, num);
      }
      speakerLabel = `Participant ${num} (${chunk.speakerName || 'Guest'})`;
    }

    const entry = {
      id: `${chunk.speakerId || 'spk'}_${chunk.timestamp || Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: chunk.timestamp || Date.now(),
      speakerId: chunk.speakerId,
      speakerLabel,
      speakerName: chunk.speakerName,
      isHost: Boolean(chunk.isHost),
      text: chunk.text
    };

    transcriptLogRef.current.push(entry);
    transcriptLogRef.current.sort((a, b) => a.timestamp - b.timestamp);
    setTranscriptEntries([...transcriptLogRef.current]);
  }, []);

  // ── 3. Handle data connection (PeerJS DataConnection) ─────────────────────
  const setupDataConnection = useCallback((conn) => {
    const peerId = conn.peer;
    dataConnsRef.current[peerId] = conn;

    conn.on('data', (data) => {
      if (!data || !data.type) return;

      switch (data.type) {
        // WebRTC Data Channel live speaker text chunk (BIT 2 & BIT 3)
        case 'speech_transcript': {
          handleIncomingSpeechChunk(data);
          break;
        }

        // Host receives knock from participant
        case 'knock': {
          setJoinRequests(prev => {
            if (prev.some(r => r.id === peerId)) return prev;
            return [...prev, { id: peerId, name: data.name || 'Guest' }];
          });
          break;
        }

        // Guest receives approval from host
        case 'knock_approved': {
          setIsWaitingForApproval(false);
          upsertPeer('__self__', { approved: true });

          // Call host or existing peers
          if (data.existingPeers && Array.isArray(data.existingPeers)) {
            data.existingPeers.forEach(ep => {
              if (ep.id !== peerInstanceRef.current?.id) {
                upsertPeer(ep.id, { name: ep.name, role: ep.role });
                if (streamRef.current && peerInstanceRef.current && !callsRef.current[ep.id]) {
                  const call = peerInstanceRef.current.call(ep.id, streamRef.current, {
                    sdpTransform: (sdp) => optimizeSdp(sdp, 500)
                  });
                  if (call) setupCall(call, ep.name, ep.role);
                }
              }
            });
          }
          break;
        }

        // Guest rejected by host
        case 'knock_rejected': {
          setIsWaitingForApproval(false);
          alert(data.message || 'Host declined your request to join the meeting.');
          onEndMeeting();
          break;
        }

        // Participant notified of another participant joining
        case 'participant_joined': {
          upsertPeer(data.peerId, { name: data.name, role: 'participant' });
          break;
        }

        // Audio, Video, Hand-raise state sync
        case 'peer_state': {
          upsertPeer(peerId, { [data.key]: data.value });
          break;
        }

        // Participant kicked by host
        case 'kicked': {
          alert('🚫 You have been removed from the meeting by the host.');
          onEndMeeting();
          break;
        }

        // Live Captions relay
        case 'live_caption': {
          setLiveCaption({ speaker: data.speaker, text: data.text, wpm: data.wpm });
          setTimeout(() => setLiveCaption(null), 4000);
          break;
        }

        default:
          break;
      }
    });

    conn.on('close', () => {
      console.log('[PeerJS] Data connection closed with:', peerId);
      removePeer(peerId);
    });

    conn.on('error', (err) => {
      console.warn('[PeerJS] Data conn error with:', peerId, err);
    });
  }, [upsertPeer, removePeer, setupCall, onEndMeeting, handleIncomingSpeechChunk]);

  // ── 4. Initialize PeerJS Client ───────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    let peer = null;
    let heartbeatInterval = null;

    const initPeer = async () => {
      const cleanCode = meetingCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      const randomSuffix = Math.random().toString(36).substring(2, 7);
      const myPeerId = `ge-${isGuest ? 'guest' : 'host'}-${cleanCode}-${randomSuffix}`;

      try {
        peer = new Peer(myPeerId, {
          ...PEER_OPTIONS,
          config: ADVANCED_RTC_CONFIG
        });
        peerInstanceRef.current = peer;

        peer.on('open', async (id) => {
          if (!alive) return;
          console.log('[PeerJS] Connected to signaling with ID:', id);
          setPeerStatus('open');

          // Keep signaling socket active with periodic heartbeat
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          heartbeatInterval = setInterval(() => {
            if (peer && !peer.destroyed && peer.socket && peer.socket._ws && peer.socket._ws.readyState === WebSocket.OPEN) {
              try {
                peer.socket._ws.send(JSON.stringify({ type: 'HEARTBEAT' }));
              } catch {}
            }
          }, 15000);

          if (!isGuest) {
            // Host creates / registers room in serverless room registry
            try {
              await roomApi('/api/rooms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action: 'create',
                  code: meetingCode,
                  hostPeerId: id,
                  hostName: hostName || 'Host',
                  topic: meetingName || 'Strategy Sync'
                })
              });
              setIsWaitingForApproval(false);
            } catch (err) {
              console.warn('[Room Registry] Error creating room:', err.message);
              // Host can proceed even if backend registry had a temporary hiccup
              setIsWaitingForApproval(false);
            }
          } else {
            // Guest fetches room details to locate hostPeerId
            try {
              const res = await roomApi(`/api/rooms/${meetingCode}`, { method: 'GET' });
              const hostPeerId = res.hostPeerId || res.room?.hostPeerId;
              if (!hostPeerId) {
                alert('Meeting host is not currently in the room. Please check the code.');
                onEndMeeting();
                return;
              }

              // Establish DataConnection to host to knock
              const conn = peer.connect(hostPeerId, { reliable: true });
              conn.on('open', () => {
                conn.send({
                  type: 'knock',
                  peerId: id,
                  name: hostName || 'Guest'
                });
              });
              setupDataConnection(conn);
            } catch (err) {
              console.warn('[Room Registry] Join error:', err);
              alert('Could not join room. Please check the meeting code.');
              onEndMeeting();
            }
          }
        });

        // Listen for incoming data connections
        peer.on('connection', (conn) => {
          if (!alive) return;
          setupDataConnection(conn);
        });

        // Listen for incoming media calls
        peer.on('call', (call) => {
          if (!alive) return;
          console.log('[PeerJS] Incoming call from:', call.peer);
          // Answer with local media stream if available, applying H264/VP8 codec priority & 500kbps bitrate cap
          if (streamRef.current) {
            call.answer(streamRef.current, {
              sdpTransform: (sdp) => optimizeSdp(sdp, 500)
            });
          } else {
            // Answer with empty audio/video if camera not yet initialized
            call.answer(undefined, {
              sdpTransform: (sdp) => optimizeSdp(sdp, 500)
            });
          }
          setupCall(call, 'Participant', 'guest');
        });

        peer.on('error', (err) => {
          console.warn('[PeerJS] Client error:', err);
          if (err.type === 'peer-unavailable') {
            console.warn('[PeerJS] Target peer unavailable');
          } else if (err.type === 'disconnected' || err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
            if (!peer.destroyed) {
              setPeerStatus('connecting');
              setTimeout(() => {
                try {
                  if (!peer.destroyed && peer.disconnected) {
                    peer.reconnect();
                  }
                } catch (recErr) {}
              }, 1200);
            }
          }
        });

        peer.on('disconnected', () => {
          console.log('[PeerJS] Disconnected from server, attempting reconnect...');
          if (!peer.destroyed) {
            setPeerStatus('connecting');
            setTimeout(() => {
              try {
                if (!peer.destroyed && peer.disconnected) {
                  peer.reconnect();
                }
              } catch (recErr) {
                console.warn('[PeerJS] Reconnect attempt failed:', recErr);
              }
            }, 1000);
          }
        });

        peer.on('close', () => {
          setPeerStatus('error');
        });
      } catch (err) {
        console.error('[PeerJS] Failed to instantiate Peer:', err);
        setPeerStatus('error');
      }
    };

    initPeer();

    return () => {
      alive = false;
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      Object.values(callsRef.current).forEach(c => { try { c.close(); } catch {} });
      Object.values(dataConnsRef.current).forEach(d => { try { d.close(); } catch {} });
      callsRef.current = {};
      dataConnsRef.current = {};
      if (peerInstanceRef.current) {
        try { peerInstanceRef.current.destroy(); } catch {}
        peerInstanceRef.current = null;
      }
    };
  }, [meetingCode, isGuest, hostName, meetingName, setupCall, setupDataConnection, onEndMeeting]);

  // ── 5. Host Accept & Reject Participant Knock Actions ─────────────────────
  const acceptParticipant = useCallback(async (id) => {
    // Enforce 5-member limit (Host + 4 participants)
    if (peersRef.current.length >= 4) {
      alert('Room capacity reached (Maximum 5 members allowed). Cannot admit more participants.');
      return;
    }

    // Assign deterministic participant number upon admission
    if (!participantOrderRef.current.has(id)) {
      const nextNum = participantOrderRef.current.size + 1;
      participantOrderRef.current.set(id, nextNum);
    }

    // 1. Call room API to update registry
    try {
      await roomApi('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'join',
          code: meetingCode,
          peerId: id,
          name: joinRequests.find(r => r.id === id)?.name || 'Guest'
        })
      });
    } catch (e) {
      console.warn('Room join API note:', e);
    }

    // 2. Send knock_approved via data connection
    const conn = dataConnsRef.current[id];
    if (conn && conn.open) {
      const existingPeersList = peersRef.current.map(p => ({
        id: p.id,
        name: p.name,
        role: p.role
      }));
      // Include host in the list
      existingPeersList.push({
        id: peerInstanceRef.current?.id,
        name: hostName || 'Host',
        role: 'host'
      });

      conn.send({
        type: 'knock_approved',
        existingPeers: existingPeersList
      });
    }

    // 3. Initiate media call from Host to Participant with H.264/VP8 & 500kbps bitrate capping
    if (peerInstanceRef.current && streamRef.current) {
      const call = peerInstanceRef.current.call(id, streamRef.current, {
        sdpTransform: (sdp) => optimizeSdp(sdp, 500)
      });
      if (call) {
        const guestName = joinRequests.find(r => r.id === id)?.name || 'Guest';
        setupCall(call, guestName, 'participant');
      }
    }

    // 4. Notify other peers about the new participant
    broadcastData({
      type: 'participant_joined',
      peerId: id,
      name: joinRequests.find(r => r.id === id)?.name || 'Guest'
    });

    setJoinRequests(prev => prev.filter(r => r.id !== id));
  }, [meetingCode, joinRequests, hostName, setupCall, broadcastData]);

  const rejectParticipant = useCallback((id) => {
    const conn = dataConnsRef.current[id];
    if (conn && conn.open) {
      conn.send({
        type: 'knock_rejected',
        message: 'Host declined your request to join this meeting.'
      });
      setTimeout(() => {
        try { conn.close(); } catch {}
      }, 500);
    }
    setJoinRequests(prev => prev.filter(r => r.id !== id));
  }, []);

  // ── 6. Host Kick Participant Actions ──────────────────────────────────────
  const requestKick = useCallback((peer) => {
    setKickTarget(peer);
  }, []);

  const confirmKick = useCallback(() => {
    if (!kickTarget) return;
    const targetId = kickTarget.id;

    // Send kick message
    const conn = dataConnsRef.current[targetId];
    if (conn && conn.open) {
      conn.send({ type: 'kicked' });
    }

    removePeer(targetId);
    setKickTarget(null);
  }, [kickTarget, removePeer]);

  // ── 7. Control Toggles (Mic, Camera, Hand) ────────────────────────────────
  const toggleVideo = useCallback(async () => {
    if (!videoOn) {
      const currentVideoTracks = streamRef.current?.getVideoTracks() || [];
      if (currentVideoTracks.length > 0) {
        currentVideoTracks.forEach(t => { t.enabled = true; });
        setVideoOn(true);
        broadcastData({ type: 'peer_state', key: 'videoOn', value: true });
      } else {
        await startMedia();
      }
    } else {
      if (streamRef.current) {
        streamRef.current.getVideoTracks().forEach(t => { t.enabled = false; });
      }
      setVideoOn(false);
      broadcastData({ type: 'peer_state', key: 'videoOn', value: false });
    }
  }, [videoOn, broadcastData, startMedia]);

  const toggleAudio = useCallback(async () => {
    if (!audioOn) {
      const currentAudioTracks = streamRef.current?.getAudioTracks() || [];
      if (currentAudioTracks.length > 0) {
        currentAudioTracks.forEach(t => { t.enabled = true; });
        setAudioOn(true);
        broadcastData({ type: 'peer_state', key: 'audioOn', value: true });
      } else {
        await startMedia();
      }
    } else {
      if (streamRef.current) {
        streamRef.current.getAudioTracks().forEach(t => { t.enabled = false; });
      }
      setAudioOn(false);
      broadcastData({ type: 'peer_state', key: 'audioOn', value: false });
    }
  }, [audioOn, broadcastData, startMedia]);

  const toggleHandRaise = useCallback(() => {
    setHandRaised(prev => {
      const next = !prev;
      broadcastData({
        type: 'peer_state',
        key: 'handRaised',
        value: next
      });
      return next;
    });
  }, [broadcastData]);

  // ── 8. Speech Recognition & Telemetry ─────────────────────────────────────
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !audioOn) return;

    let recognition;
    try {
      recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      let lastTime = Date.now();
      recognition.onresult = (e) => {
        const transcript = e.results[e.results.length - 1][0].transcript.trim();
        if (!transcript) return;
        const words = transcript.split(/\s+/).length;
        const now = Date.now();
        const minElapsed = (now - lastTime) / 60000;
        lastTime = now;
        const wpm = minElapsed > 0 ? Math.min(Math.round(words / minElapsed), 220) : 130;
        const finalWpm = wpm > 40 ? wpm : 120;

        setLiveCaption({ speaker: hostName || 'You', text: transcript, wpm: finalWpm });
        setTimeout(() => setLiveCaption(null), 4000);

        broadcastData({
          type: 'live_caption',
          speaker: hostName || 'You',
          text: transcript,
          wpm: finalWpm
        });

        // ── WebRTC Data Channel for Live Identity Mapping (BIT 2 & BIT 3) ──
        const mySpeakerId = peerInstanceRef.current?.id || 'local_user';
        const mySpeakerName = hostName || (isGuest ? 'Guest' : 'Host');

        const speechPayload = {
          type: 'speech_transcript',
          speakerId: mySpeakerId,
          speakerName: mySpeakerName,
          isHost: !isGuest,
          text: transcript,
          timestamp: now
        };

        // Broadcast mapped speaker text chunk via WebRTC Data Channels
        broadcastData(speechPayload);

        // If this client is Host, aggregate locally into central log
        if (!isGuest) {
          handleIncomingSpeechChunk(speechPayload);
        }
      };
      recognition.onerror = () => {};
      recognition.start();
      recognitionRef.current = recognition;
    } catch {}

    return () => {
      try { if (recognition) recognition.stop(); } catch {}
    };
  }, [audioOn, hostName, isGuest, broadcastData, handleIncomingSpeechChunk]);

  // ── 9. Active Speaker Energy Detection (Web Audio Analyser) ───────────────
  useEffect(() => {
    let timer = null;
    let audioCtx = null;
    let localAnalyser = null;
    let localSource = null;
    const peerAnalysers = {};

    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        audioCtx = new AudioCtxClass();

        if (streamRef.current && streamRef.current.getAudioTracks().length > 0) {
          try {
            localSource = audioCtx.createMediaStreamSource(streamRef.current);
            localAnalyser = audioCtx.createAnalyser();
            localAnalyser.fftSize = 256;
            localAnalyser.smoothingTimeConstant = 0.3;
            localSource.connect(localAnalyser);
          } catch (e) {}
        }

        Object.entries(remoteStreamsRef.current).forEach(([pid, rStream]) => {
          if (rStream && rStream.getAudioTracks().length > 0) {
            try {
              const src = audioCtx.createMediaStreamSource(rStream);
              const ana = audioCtx.createAnalyser();
              ana.fftSize = 256;
              ana.smoothingTimeConstant = 0.3;
              src.connect(ana);
              peerAnalysers[pid] = { analyser: ana, source: src };
            } catch (e) {}
          }
        });
      }
    } catch (e) {}

    const dataArr = new Uint8Array(128);
    let lastSwitchTime = Date.now();

    const monitorVolume = () => {
      if (!audioCtx) return;
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }

      let maxVol = 0;
      let candidateId = null;

      // 1. Local mic level
      if (localAnalyser && audioOnRef.current) {
        localAnalyser.getByteFrequencyData(dataArr);
        let sum = 0;
        for (let i = 0; i < dataArr.length; i++) sum += dataArr[i];
        const vol = sum / dataArr.length;
        if (vol > 14) {
          maxVol = vol;
          candidateId = 'local';
        }
      }

      // 2. Peer mic levels
      Object.entries(peerAnalysers).forEach(([pid, obj]) => {
        const peer = peersRef.current.find(p => p.id === pid);
        if (peer && peer.audioOn !== false) {
          obj.analyser.getByteFrequencyData(dataArr);
          let sum = 0;
          for (let i = 0; i < dataArr.length; i++) sum += dataArr[i];
          const vol = sum / dataArr.length;
          if (vol > 14 && vol > maxVol) {
            maxVol = vol;
            candidateId = pid;
          }
        }
      });

      const now = Date.now();
      if (candidateId && candidateId !== activeSpeakerIdRef.current) {
        if (now - lastSwitchTime > 300) {
          activeSpeakerIdRef.current = candidateId;
          lastSwitchTime = now;
          setActiveSpeakerId(candidateId);

          if (!pinnedSpeakerIdRef.current) {
            let name = hostName || 'You';
            if (candidateId !== 'local') {
              const p = peersRef.current.find(x => x.id === candidateId);
              if (p) name = p.name;
            }
            setActiveSpeakerName(name);
            activeSpeakerNameRef.current = name;
          }
        }
      }

      timer = setTimeout(monitorVolume, 100);
    };

    timer = setTimeout(monitorVolume, 250);

    return () => {
      if (timer) clearTimeout(timer);
      try {
        if (localSource) localSource.disconnect();
        Object.values(peerAnalysers).forEach(p => {
          try { p.source.disconnect(); } catch {}
        });
        if (audioCtx) audioCtx.close();
      } catch (e) {}
    };
  }, [peers, audioOn, hostName]);

  // ── 10. Multi-User Full-Screen Grid Recording (BIT 1) ──────────────────────
  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch (e) {
        console.warn('Error stopping recording:', e);
      }
      if (displayStreamRef.current) {
        displayStreamRef.current.getTracks().forEach(t => t.stop());
        displayStreamRef.current = null;
      }
      setIsRecording(false);
      return;
    }

    try {
      recordedChunksRef.current = [];

      // 1. Capture Full Screen Layout (contains active grid of up to 5 members)
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          displaySurface: 'browser'
        },
        audio: true
      });
      displayStreamRef.current = displayStream;

      // Handle user stopping screen share from browser banner
      if (displayStream.getVideoTracks().length > 0) {
        displayStream.getVideoTracks()[0].onended = () => {
          try {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
              mediaRecorderRef.current.stop();
            }
          } catch (e) {}
          setIsRecording(false);
        };
      }

      // 2. Setup Multi-Source Audio Mixing (Display Audio + Local Mic + Remote Peer Audio)
      let destination = null;
      let audioCtx = null;
      try {
        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        if (AudioCtxClass) {
          audioCtx = new AudioCtxClass();
          if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
          }
          recordingAudioCtxRef.current = audioCtx;
          recordingSourcesRef.current = [];
          destination = audioCtx.createMediaStreamDestination();
          recordingDestRef.current = destination;

          // A. Display/System Audio
          if (displayStream.getAudioTracks().length > 0) {
            try {
              const displayAudioStream = new MediaStream([displayStream.getAudioTracks()[0]]);
              const displaySource = audioCtx.createMediaStreamSource(displayAudioStream);
              displaySource.connect(destination);
              recordingSourcesRef.current.push(displaySource);
            } catch (err) {
              console.warn('Display audio mix note:', err);
            }
          }

          // B. Local Microphone Audio
          if (streamRef.current) {
            const localAudioTracks = streamRef.current.getAudioTracks();
            if (localAudioTracks.length > 0) {
              const localAudioStream = new MediaStream([localAudioTracks[0]]);
              const localSource = audioCtx.createMediaStreamSource(localAudioStream);
              localSource.connect(destination);
              recordingSourcesRef.current.push(localSource);
            }
          }

          // C. Remote Participants Audio
          Object.values(remoteStreamsRef.current).forEach(remoteStream => {
            if (remoteStream) {
              const remoteAudioTracks = remoteStream.getAudioTracks();
              if (remoteAudioTracks.length > 0) {
                try {
                  const remoteAudioStream = new MediaStream([remoteAudioTracks[0]]);
                  const remoteSource = audioCtx.createMediaStreamSource(remoteAudioStream);
                  remoteSource.connect(destination);
                  recordingSourcesRef.current.push(remoteSource);
                } catch (err) {
                  console.warn('Remote stream audio mix note:', err);
                }
              }
            }
          });
        }
      } catch (mixErr) {
        console.warn('Web Audio mix setup note:', mixErr);
      }

      // Combine Video Track and Mixed Audio Track
      const recordTracks = [displayStream.getVideoTracks()[0]];
      if (destination && destination.stream.getAudioTracks().length > 0) {
        recordTracks.push(destination.stream.getAudioTracks()[0]);
      } else if (displayStream.getAudioTracks().length > 0) {
        recordTracks.push(displayStream.getAudioTracks()[0]);
      } else if (streamRef.current && streamRef.current.getAudioTracks().length > 0) {
        recordTracks.push(streamRef.current.getAudioTracks()[0]);
      }

      const recordStream = new MediaStream(recordTracks);

      // Select Best Supported MIME Type
      const candidateMimeTypes = [
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9,opus',
        'video/webm',
        'video/mp4'
      ];
      let selectedMimeType = '';
      for (const mime of candidateMimeTypes) {
        if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(mime)) {
          selectedMimeType = mime;
          break;
        }
      }

      const recorderOptions = {
        ...(selectedMimeType ? { mimeType: selectedMimeType } : {}),
        audioBitsPerSecond: 128000,
        videoBitsPerSecond: 2500000
      };

      let recorder;
      try {
        recorder = new MediaRecorder(recordStream, recorderOptions);
      } catch (optErr) {
        recorder = new MediaRecorder(recordStream);
      }

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        if (displayStreamRef.current) {
          displayStreamRef.current.getTracks().forEach(t => t.stop());
          displayStreamRef.current = null;
        }

        if (recordedChunksRef.current.length > 0) {
          const finalType = selectedMimeType || recorder.mimeType || 'video/webm';
          const isMp4 = finalType.includes('mp4');
          const ext = isMp4 ? 'mp4' : 'webm';
          const blob = new Blob(recordedChunksRef.current, { type: finalType });
          const now = new Date();
          const elapsedSec = recordingStartTimeRef.current
            ? Math.max(1, Math.round((Date.now() - recordingStartTimeRef.current) / 1000))
            : 1;
          const mins = Math.floor(elapsedSec / 60);
          const secs = elapsedSec % 60;
          const durationStr = elapsedSec < 60 ? `${elapsedSec}s` : `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
          const filename = `meeting_${meetingCode}_fullscreen_grid_${now.toISOString().slice(0, 10)}_${Date.now().toString().slice(-4)}.${ext}`;

          const url = URL.createObjectURL(blob);
          lastRecordingBlobRef.current = blob;
          lastRecordingUrlRef.current = url;
          lastRecordingFilenameRef.current = filename;
          setRecordedVideoBlob(blob);
          setShowGenerateReportBtn(true);

          const recordingItem = {
            id: Date.now(),
            name: filename,
            duration: durationStr,
            date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            size: blob.size,
            blob: blob,
            meetingCode: meetingCode,
            meetingName: `${meetingName || 'Meeting'} (Full Screen Grid)`
          };

          saveRecording(recordingItem).catch(err => console.warn('IndexedDB save failed:', err));
          if (typeof onSaveRecording === 'function') {
            try { onSaveRecording(recordingItem); } catch (e) {}
          }

          // Auto-download to user's local downloads
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          // Upload directly to Apple Silicon M2 GPU Whisper & PyAnnote Diarization Pipeline
          const uploadToM2Pipeline = async (videoBlob, videoFilename) => {
            setM2ProcessingStatus('Sending full-screen recording to Apple Silicon M2 Whisper & PyAnnote pipeline...');
            try {
              const formData = new FormData();
              formData.append('file', videoBlob, videoFilename);
              const liveHost = hostName || auth?.currentUser?.displayName || (auth?.currentUser?.email ? auth.currentUser.email.split('@')[0] : 'ABHIGOWDA819761');
              const activePeers = (peers || []).filter(p => p && p.name && p.name !== liveHost);
              const guestName = activePeers.length > 0 ? activePeers[0].name : '';
              formData.append('speaker_0', liveHost);
              formData.append('hostName', liveHost);
              if (guestName) {
                formData.append('speaker_1', guestName);
                formData.append('participantNames', JSON.stringify([guestName]));
              }
              formData.append('meeting_code', meetingCode || 'MEETING');
              formData.append('meetingId', meetingCode || 'MEETING');

              const candidateEndpoints = [
                `${API_BASE_URL}/api/meeting/analyze-video`,
                `${API_BASE_URL}/api/video/diarize-transcript`,
                `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:8000/api/meeting/analyze-video`,
                'http://localhost:8000/api/meeting/analyze-video',
                'http://10.102.167.95:8000/api/meeting/analyze-video',
                'http://localhost:8000/api/video/diarize-transcript'
              ].filter((u, i, a) => u && a.indexOf(u) === i);

              let diarData = null;
              for (const endpoint of candidateEndpoints) {
                try {
                  const res = await fetch(endpoint, {
                    method: 'POST',
                    body: formData
                  });
                  if (res.ok) {
                    const parsed = await res.json();
                    if (parsed && (parsed.data || parsed.rawTranscript || parsed.success)) {
                      diarData = parsed.data || parsed;
                      break;
                    }
                  }
                } catch (netErr) {
                  console.warn(`[MeetingRoom] Pipeline candidate note (${endpoint}):`, netErr.message);
                }
              }

              if (diarData) {
                setM2ScriptResult(diarData);
                setM2ProcessingStatus(`✅ M2 GPU Diarization & Whisper Complete (${diarData.execution_time_seconds || 1.2}s)`);
                setShowScriptModal(true);
                if (typeof onSaveRecording === 'function') {
                  try {
                    onSaveRecording({
                      ...recordingItem,
                      scriptText: diarData.scriptText,
                      scriptDownloadUrl: diarData.download_url
                    });
                  } catch (e) {}
                }
                setTimeout(() => setM2ProcessingStatus(null), 5000);
              } else {
                setM2ProcessingStatus(null);
              }
            } catch (pipelineErr) {
              console.error('M2 Diarization pipeline error:', pipelineErr);
              setM2ProcessingStatus(null);
            }
          };

          uploadToM2Pipeline(blob, filename);
        }

        if (recordingAudioCtxRef.current) {
          try { recordingAudioCtxRef.current.close(); } catch {}
          recordingAudioCtxRef.current = null;
        }
        recordingSourcesRef.current = [];
        recordingDestRef.current = null;
        setIsRecording(false);
      };

      recordingStartTimeRef.current = Date.now();
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
        console.error('Screen recorder error:', err);
        alert('Could not start screen recording: ' + err.message);
      }
      if (displayStreamRef.current) {
        displayStreamRef.current.getTracks().forEach(t => t.stop());
        displayStreamRef.current = null;
      }
      if (recordingAudioCtxRef.current) {
        try { recordingAudioCtxRef.current.close(); } catch {}
        recordingAudioCtxRef.current = null;
      }
      recordingSourcesRef.current = [];
      recordingDestRef.current = null;
      setIsRecording(false);
    }
  }, [isRecording, meetingCode, meetingName, onSaveRecording]);

  // ── Firebase Storage Upload & Report Generation ────────────────────────────
  const handleGenerateReport = async () => {
    const blobToUpload = recordedVideoBlob || lastRecordingBlobRef.current;
    if (!blobToUpload) {
      alert("No recorded video found to upload.");
      return;
    }

    const currentUser = getCurrentAuthUser();
    const userId = currentUser?.uid || auth?.currentUser?.uid || `user_${(hostName || 'host').toLowerCase()}`;
    const cleanMeetingId = meetingCode || `meeting_${Date.now()}`;
    const file = new File([blobToUpload], `${cleanMeetingId}.mp4`, { type: 'video/mp4' });

    setIsUploadingToFirebase(true);
    setFirebaseUploadProgress(0);
    setFirebaseUploadStatus(`Preparing upload to meetings/${userId}/${cleanMeetingId}.mp4...`);

    try {
      const result = await uploadMeetingVideoToFirebase(
        file,
        userId,
        cleanMeetingId,
        (progress) => {
          setFirebaseUploadProgress(progress);
          setFirebaseUploadStatus(`Uploading to Firebase Storage: ${progress}% • meetings/${userId}/${cleanMeetingId}.mp4`);
        }
      );

      setFirebaseUploadProgress(100);
      setFirebaseUploadStatus(`✅ Successfully uploaded to meetings/${userId}/${cleanMeetingId}.mp4`);

      // Notify parent recording handler if available
      if (typeof onSaveRecording === 'function' && lastRecordingFilenameRef.current) {
        try {
          onSaveRecording({
            id: Date.now(),
            name: lastRecordingFilenameRef.current,
            blob: blobToUpload,
            meetingCode: cleanMeetingId,
            videoStorageUrl: result.downloadUrl,
            storagePath: result.storagePath
          });
        } catch (e) {}
      }

      setTimeout(() => {
        setIsUploadingToFirebase(false);
      }, 4500);
    } catch (err) {
      console.error('[Firebase Storage] Upload error:', err);
      setFirebaseUploadStatus(`Upload failed: ${err.message}`);
      setTimeout(() => {
        setIsUploadingToFirebase(false);
      }, 5000);
    }
  };

  const handleNotesChange = (e) => {
    const text = e.target.value;
    setNotesValue(text);
    try { localStorage.setItem(`guardianeye_notes_${meetingCode}`, text); } catch {}
  };

  const getShareLink = useCallback(() => {
    return `${window.location.origin}/?join=${meetingCode}`;
  }, [meetingCode]);

  const copyCode = useCallback(() => {
    const link = getShareLink();
    navigator.clipboard.writeText(link).catch(() => navigator.clipboard.writeText(meetingCode).catch(() => {}));
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2500);
  }, [getShareLink, meetingCode]);

  const handleEndMeeting = useCallback(() => {
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    } catch {}

    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach(t => t.stop());
      displayStreamRef.current = null;
    }
    if (recordingAudioCtxRef.current) {
      try { recordingAudioCtxRef.current.close(); } catch {}
      recordingAudioCtxRef.current = null;
    }
    recordingSourcesRef.current = [];
    recordingDestRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    try { recognitionRef.current?.stop(); } catch {}

    Object.values(callsRef.current).forEach(c => { try { c.close(); } catch {} });
    Object.values(dataConnsRef.current).forEach(d => { try { d.close(); } catch {} });
    callsRef.current = {};
    dataConnsRef.current = {};

    if (peerInstanceRef.current) {
      try { peerInstanceRef.current.destroy(); } catch {}
      peerInstanceRef.current = null;
    }

    // ── Compile Chronological Conversation Movie Script (BIT 3) ──
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const compiledScript = compileMovieScript(transcriptLogRef.current, meetingName, dateStr);

    const elapsedSec = recordingStartTimeRef.current
      ? Math.max(1, Math.round((Date.now() - recordingStartTimeRef.current) / 1000))
      : 0;
    const mins = Math.floor(elapsedSec / 60);
    const secs = elapsedSec % 60;
    const durationStr = elapsedSec > 0
      ? (elapsedSec < 60 ? `${elapsedSec}s` : `${mins}m ${secs < 10 ? '0' : ''}${secs}s`)
      : 'Session Completed';

    // Hand off meeting recording and script assets to parent App
    if (typeof onEndMeeting === 'function') {
      onEndMeeting({
        recordingBlob: lastRecordingBlobRef.current,
        recordingUrl: lastRecordingUrlRef.current,
        recordingFilename: lastRecordingFilenameRef.current,
        scriptText: compiledScript,
        transcriptsList: [...transcriptLogRef.current],
        meetingName: meetingName || 'Strategy Sync',
        meetingCode: meetingCode,
        duration: durationStr,
        hostName: hostName || 'Host',
        participantsCount: 1 + peersRef.current.filter(p => p.id !== '__self__').length,
        isGuest: isGuest
      });
    }
  }, [meetingCode, meetingName, hostName, isGuest, onEndMeeting]);

  // ── Render ────────────────────────────────────────────────────────────────
  const visiblePeers = peers.filter(p => p.id !== '__self__');
  const totalMembers = 1 + visiblePeers.length;
  const gridClass = `grid-${Math.min(totalMembers, 6)}`;

  return (
    <div className="meeting-room">
      {/* Top Bar */}
      <div className="meeting-code-overlay">
        <div className="meeting-code-badge" onClick={copyCode} title="Copy invite link">
          <span className="code-label">{codeCopied ? 'Link Copied!' : 'Meeting Code'}</span>
          <span className="code-value">{meetingCode}</span>
          {codeCopied ? <Check size={14} className="code-copy-icon" /> : <Copy size={14} className="code-copy-icon" />}
        </div>

        <div className="meeting-topic-badge">{meetingName || 'Strategy Sync'}</div>

        <div className="capacity-badge">
          <Users size={14} />
          <span>{totalMembers} / 5 {isGuest ? '(Guest)' : '(Host)'}</span>
        </div>

        {/* Peer Connection Status Indicator */}
        {peerStatus !== 'open' && peers.filter(p => p.id !== '__self__').length === 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            padding: '4px 10px', borderRadius: '20px',
            background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
            color: '#ef4444', fontSize: '0.75rem', fontWeight: 600
          }}>
            <WifiOff size={12} />
            <span>{peerStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span>
          </div>
        )}

        {isRecording && (
          <div
            className="recording-indicator"
            title={pinnedSpeakerId ? `Recording locked on ${activeSpeakerName}` : 'Auto-recording active speaker'}
          >
            <Circle size={10} fill="#EF4444" stroke="none" />
            <span>
              REC: {pinnedSpeakerId ? `${activeSpeakerName} (Locked)` : `Active Speaker (${activeSpeakerName})`}
            </span>
          </div>
        )}
      </div>

      {/* Video Grid */}
      <div className={`video-grid-viewport ${gridClass}`}>
        {/* Local tile */}
        <div className={`video-tile ${handRaised ? 'hand-raised-tile' : ''} ${pinnedSpeakerId === 'local' ? 'pinned-tile' : ''}`}>
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`video-tile-video mirrored ${(!videoOn || mediaStatus !== 'ready') ? 'camera-off' : ''}`}
          />

          {/* Loading Camera State */}
          {mediaStatus === 'loading' && (
            <div className="video-tile-avatar">
              <div className="waiting-spinner" style={{ width: '38px', height: '38px', marginBottom: '12px' }}></div>
              <span className="avatar-subtext">Initializing live camera...</span>
            </div>
          )}

          {/* Camera Error / Permission Blocked State */}
          {mediaStatus === 'error' && (
            <div className="video-tile-avatar" style={{ padding: '16px', textAlign: 'center', maxWidth: '85%' }}>
              <div style={{
                width: '50px', height: '50px', borderRadius: '50%',
                background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px auto',
                color: '#EF4444'
              }}>
                <VideoOff size={24} />
              </div>
              <span style={{ fontSize: '0.82rem', color: '#F87171', marginBottom: '12px', lineHeight: 1.4, display: 'block' }}>
                {mediaError || 'Camera could not be activated.'}
              </span>
              <button
                type="button"
                onClick={startMedia}
                style={{
                  background: 'linear-gradient(135deg, #38BDF8, #2563EB)',
                  color: '#FFFFFF', border: 'none', borderRadius: '8px',
                  padding: '8px 16px', fontSize: '0.8rem', fontWeight: 600,
                  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px'
                }}
              >
                <Video size={14} />
                <span>Retry Camera</span>
              </button>
            </div>
          )}

          {/* Camera Off State (when user turned it off intentionally) */}
          {mediaStatus === 'ready' && !videoOn && (
            <div className="video-tile-avatar">
              <div className="avatar-circle">{(hostName || 'Y').charAt(0).toUpperCase()}</div>
              <span className="avatar-subtext">{hostName || 'You'} (Camera Off)</span>
            </div>
          )}



          {/* Pin Button */}
          <button
            type="button"
            className={`tile-pin-btn ${pinnedSpeakerId === 'local' ? 'pinned' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              handlePinUser('local');
            }}
            title={pinnedSpeakerId === 'local' ? 'Unpin (return to Auto Active Speaker)' : 'Pin recording to You'}
          >
            <Pin size={13} fill={pinnedSpeakerId === 'local' ? '#38BDF8' : 'none'} />
            <span>{pinnedSpeakerId === 'local' ? 'Pinned' : 'Pin User'}</span>
          </button>

          <div className="tile-name-pill">
            <span>{hostName || 'You'} (You)</span>
            <span className={`tile-role-tag ${isGuest ? 'guest' : 'host'}`}>{isGuest ? 'Guest' : 'Host'}</span>
          </div>
          <div className={`tile-status-pill ${!audioOn ? 'muted' : ''}`}>
            {audioOn ? <Mic size={14} /> : <MicOff size={14} />}
          </div>
          {handRaised && <div className="tile-hand-tag">✋ Hand Raised</div>}
        </div>

        {/* Remote peer tiles */}
        {visiblePeers.map(peer => (
          <RemoteVideoTile
            key={peer.id}
            peer={peer}
            isHost={!isGuest}
            onKick={requestKick}
            isSpeaking={activeSpeakerId === peer.id}
            isPinned={pinnedSpeakerId === peer.id}
            onPin={handlePinUser}
            onRegisterVideoEl={handleRegisterVideoEl}
          />
        ))}
      </div>

      {/* Live Caption */}
      {liveCaption && (
        <div style={{
          position: 'absolute', bottom: '95px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(15,23,42,0.9)', backdropFilter: 'blur(10px)',
          border: '1px solid rgba(56,189,248,0.4)', borderRadius: '24px',
          padding: '8px 22px', color: '#F8FAFC', fontSize: '0.9rem',
          maxWidth: '85%', textAlign: 'center', zIndex: 120,
          display: 'flex', alignItems: 'center', gap: '10px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)', animation: 'fadeIn 0.2s ease-out'
        }}>
          <span style={{ color: '#38BDF8', fontWeight: 600 }}>{liveCaption.speaker}:</span>
          <span>"{liveCaption.text}"</span>
          {liveCaption.wpm > 0 && (
            <span style={{
              fontSize: '0.75rem', background: 'rgba(56,189,248,0.2)',
              padding: '2px 8px', borderRadius: '12px', color: '#38BDF8', fontWeight: 600
            }}>{liveCaption.wpm} WPM</span>
          )}
        </div>
      )}

      {/* Floating Firebase Storage Upload & Report Action Dock */}
      {(showGenerateReportBtn || isUploadingToFirebase) && (
        <div className="firebase-report-dock" role="status" aria-live="polite">
          <div className="firebase-report-dock-header">
            <div className="firebase-report-badge">
              <Sparkles size={16} />
              <span>Full Screen Recording Captured</span>
            </div>
            {!isUploadingToFirebase && (
              <button
                type="button"
                className="firebase-report-close-btn"
                onClick={() => setShowGenerateReportBtn(false)}
                title="Dismiss"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="firebase-report-dock-body">
            <p className="firebase-report-desc">
              Full screen layout with system and mic audio recorded. Click <strong>Generate Report</strong> to upload directly to Firebase Storage.
            </p>
            {isUploadingToFirebase && (
              <div className="firebase-upload-progress-container">
                <div className="firebase-upload-progress-bar">
                  <div
                    className="firebase-upload-progress-fill"
                    style={{ width: `${firebaseUploadProgress}%` }}
                  />
                </div>
                <div className="firebase-upload-progress-meta">
                  <span className="firebase-upload-pct">{firebaseUploadProgress}%</span>
                  <span className="firebase-upload-status">{firebaseUploadStatus}</span>
                </div>
              </div>
            )}
            {!isUploadingToFirebase && firebaseUploadStatus && (
              <div className="firebase-upload-complete-pill">
                {firebaseUploadStatus}
              </div>
            )}
            <div className="firebase-report-dock-actions">
              <button
                type="button"
                className="firebase-generate-report-btn"
                onClick={handleGenerateReport}
                disabled={isUploadingToFirebase}
              >
                <Sparkles size={16} />
                <span>{isUploadingToFirebase ? `Uploading (${firebaseUploadProgress}%)` : 'Generate Report'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Control Bar */}
      <div className="meeting-controls-bar">
        <div className="controls-center">
          <button className={`control-btn ${!videoOn ? 'control-off' : ''}`} onClick={toggleVideo} title={videoOn ? 'Turn off camera' : 'Turn on camera'}>
            {videoOn ? <Video size={22} /> : <VideoOff size={22} />}
          </button>
          <button className={`control-btn ${!audioOn ? 'control-off' : ''}`} onClick={toggleAudio} title={audioOn ? 'Mute' : 'Unmute'}>
            {audioOn ? <Mic size={22} /> : <MicOff size={22} />}
          </button>
          <button className={`control-btn ${handRaised ? 'control-active' : ''}`} onClick={toggleHandRaise} title={handRaised ? 'Lower hand' : 'Raise hand'}>
            <Hand size={22} />
          </button>
          <button className={`control-btn ${isRecording ? 'control-recording' : ''}`} onClick={toggleRecording} title={isRecording ? 'Stop recording' : 'Start recording'}>
            <Circle size={22} fill={isRecording ? '#EF4444' : 'none'} />
          </button>
          {showGenerateReportBtn && (
            <button
              className={`control-btn control-generate-report ${isUploadingToFirebase ? 'control-uploading' : ''}`}
              onClick={handleGenerateReport}
              disabled={isUploadingToFirebase}
              title="Generate Report (Upload to Firebase Storage)"
            >
              <Sparkles size={20} />
              <span className="generate-report-btn-label">
                {isUploadingToFirebase ? `${firebaseUploadProgress}%` : 'Generate Report'}
              </span>
            </button>
          )}
          <button className={`control-btn ${showNotes ? 'control-active' : ''}`} onClick={() => setShowNotes(s => !s)} title="Notes">
            <StickyNote size={22} />
          </button>
          <button className="control-btn control-end" onClick={handleEndMeeting} title={isGuest ? 'Leave' : 'End Meeting'}>
            <PhoneOff size={22} />
          </button>
        </div>

        {/* Host: Join requests */}
        {!isGuest && joinRequests.length > 0 && (
          <div className="join-requests-panel">
            <div className="join-requests-list">
              {joinRequests.map(req => (
                <div className="join-request-card" key={req.id}>
                  <div className="join-request-info">
                    <UserPlus size={16} />
                    <span className="join-request-name">{req.name}</span>
                    <span className="join-request-label">wants to join ({totalMembers}/5)</span>
                  </div>
                  <div className="join-request-actions">
                    <button className="join-accept-btn" onClick={() => acceptParticipant(req.id)} disabled={totalMembers >= 5}>
                      <Check size={16} />
                    </button>
                    <button className="join-reject-btn" onClick={() => rejectParticipant(req.id)}>
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Notes Panel */}
      {showNotes && (
        <div className="quick-notes-panel">
          <div className="quick-notes-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <StickyNote size={16} />
              <span>Meeting Notes (Autosaved)</span>
            </div>
            <button className="notes-close-btn" onClick={() => setShowNotes(false)}>
              <X size={16} />
            </button>
          </div>
          <textarea
            className="quick-notes-textarea"
            placeholder="Type your notes here…"
            value={notesValue}
            onChange={handleNotesChange}
            autoFocus
          />
        </div>
      )}

      {/* Google Meet style Kick Confirmation Modal */}
      {kickTarget && (
        <div className="kick-modal-backdrop" onClick={() => setKickTarget(null)}>
          <div className="kick-modal" onClick={e => e.stopPropagation()}>
            <div className="kick-modal-header">
              <div className="kick-icon-badge">
                <UserX size={22} />
              </div>
              <div>
                <h3 className="kick-modal-title">Remove {kickTarget.name}?</h3>
                <p className="kick-modal-sub">Participant will be removed from this call</p>
              </div>
            </div>
            <p className="kick-modal-desc">
              They will be disconnected immediately and cannot rejoin unless you admit them again.
            </p>
            <div className="kick-modal-actions">
              <button className="kick-cancel-btn" onClick={() => setKickTarget(null)}>
                Cancel
              </button>
              <button className="kick-confirm-btn" onClick={confirmKick}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Guest: Waiting to be admitted overlay (Google Meet style) */}
      {isGuest && isWaitingForApproval && (
        <div className="guest-waiting-overlay">
          <div className="guest-waiting-card">
            <div className="waiting-spinner"></div>
            <h3>Asking to be let in...</h3>
            <p>You'll join the call when the host lets you in.</p>
            <div className="waiting-card-sub">
              Meeting code: <strong>{meetingCode}</strong>
            </div>
            <button className="waiting-cancel-btn" onClick={handleEndMeeting}>
              Cancel & Leave
            </button>
          </div>
        </div>
      )}

      {/* Apple Silicon M2 GPU Processing Floating Pill */}
      {m2ProcessingStatus && (
        <div className="m2-processing-pill">
          <Cpu size={16} className="animate-spin-slow" />
          <span>{m2ProcessingStatus}</span>
        </div>
      )}

      {/* Apple Silicon M2 GPU Compiled Dialogue Script Modal */}
      {showScriptModal && m2ScriptResult && (
        <div className="m2-script-modal-backdrop" onClick={() => setShowScriptModal(false)}>
          <div className="m2-script-modal" onClick={e => e.stopPropagation()}>
            <div className="m2-script-header">
              <div className="m2-script-header-left">
                <div className="m2-script-icon-badge">
                  <FileText size={20} />
                </div>
                <div>
                  <h3 className="m2-script-title">Meeting Dialogue Script</h3>
                  <div className="m2-script-subtitle">
                    <span className="m2-gpu-tag">Apple Silicon M2 (MPS)</span>
                    <span>• OpenAI Whisper + PyAnnote 3.1</span>
                  </div>
                </div>
              </div>
              <button
                className="m2-script-close-btn"
                onClick={() => setShowScriptModal(false)}
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="m2-script-body">
              <pre className="m2-script-codeblock">
                {m2ScriptResult.scriptText || "No dialogue detected."}
              </pre>
            </div>

            <div className="m2-script-footer">
              <div className="m2-script-meta">
                {m2ScriptResult.execution_time_seconds && (
                  <span>Generated in {m2ScriptResult.execution_time_seconds}s</span>
                )}
                {m2ScriptResult.speakers && (
                  <span> • {m2ScriptResult.speakers.map(s => s.name).join(' & ')}</span>
                )}
              </div>
              <div className="m2-script-actions">
                <button
                  type="button"
                  className="m2-script-btn m2-copy-btn"
                  onClick={() => {
                    if (m2ScriptResult.scriptText) {
                      navigator.clipboard.writeText(m2ScriptResult.scriptText);
                      setScriptCopied(true);
                      setTimeout(() => setScriptCopied(false), 2000);
                    }
                  }}
                >
                  {scriptCopied ? <Check size={14} /> : <Copy size={14} />}
                  <span>{scriptCopied ? 'Copied' : 'Copy Text'}</span>
                </button>

                <a
                  href={`http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:8000${m2ScriptResult.download_url || `/api/transcription/download/${m2ScriptResult.videoId}`}`}
                  download={m2ScriptResult.scriptFilename || "meeting_dialogue_script.txt"}
                  className="m2-script-btn m2-download-btn"
                >
                  <Download size={14} />
                  <span>Download .txt Script</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MeetingRoom;
