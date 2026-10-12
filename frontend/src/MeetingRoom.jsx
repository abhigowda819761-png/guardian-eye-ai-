import { useState, useEffect, useRef, useCallback } from 'react';
import './MeetingRoom.css';
import { WS_BASE_URL } from './config';
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
  WifiOff
} from 'lucide-react';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' }
  ]
};

// ─── Remote Video Tile ───────────────────────────────────────────────────────
function RemoteVideoTile({ peer }) {
  const remoteVideoRef = useRef(null);

  // Always reassign srcObject whenever stream changes or element remounts
  useEffect(() => {
    const videoEl = remoteVideoRef.current;
    if (!videoEl) return;
    if (peer.stream) {
      if (videoEl.srcObject !== peer.stream) {
        videoEl.srcObject = peer.stream;
      }
      videoEl.play().catch(() => {});
    } else {
      videoEl.srcObject = null;
    }
  }, [peer.stream, peer.id]);

  const hasVideo = Boolean(peer.stream) && peer.videoOn !== false;

  return (
    <div className={`video-tile ${peer.handRaised ? 'hand-raised-tile' : ''}`}>
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
    </div>
  );
}

// ─── MeetingRoom Component ───────────────────────────────────────────────────
function MeetingRoom({
  meetingName,
  hostName,
  onEndMeeting,
  roomCode: propRoomCode,
  isGuest = false
}) {
  const localVideoRef    = useRef(null);
  const streamRef        = useRef(null);     // local MediaStream
  const wsRef            = useRef(null);
  const pcMapRef         = useRef({});       // peerId -> RTCPeerConnection
  const iceQueueRef      = useRef({});       // peerId -> RTCIceCandidate[] (queued before remote desc set)
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef= useRef([]);
  const recognitionRef   = useRef(null);
  const isMountedRef     = useRef(true);

  const [videoOn,      setVideoOn]      = useState(true);
  const [audioOn,      setAudioOn]      = useState(true);
  const [handRaised,   setHandRaised]   = useState(false);
  const [isRecording,  setIsRecording]  = useState(false);
  const [showNotes,    setShowNotes]    = useState(false);
  const [peers,        setPeers]        = useState([]);
  const [joinRequests, setJoinRequests] = useState([]);
  const [liveCaption,  setLiveCaption]  = useState(null);
  const [wsStatus,     setWsStatus]     = useState('connecting'); // 'connecting'|'open'|'error'
  const [codeCopied,   setCodeCopied]   = useState(false);

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
  const sendWs = useCallback((payload) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  // Add a peer to state (idempotent)
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

  // ── 1. Start local camera & mic ───────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;

    const startMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        if (!isMountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Add tracks to any peer connections that were created before media was ready
        Object.values(pcMapRef.current).forEach(pc => {
          stream.getTracks().forEach(track => {
            const senders = pc.getSenders();
            if (!senders.find(s => s.track === track)) {
              pc.addTrack(track, stream);
            }
          });
        });
      } catch (err) {
        console.warn('Camera/mic unavailable:', err.message);
      }
    };

    startMedia();

    return () => {
      isMountedRef.current = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // ── 2. Create RTCPeerConnection ────────────────────────────────────────────
  const createPc = useCallback((peerId, peerName, peerRole, isInitiator) => {
    // Return existing if already exists
    if (pcMapRef.current[peerId]) return pcMapRef.current[peerId];

    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcMapRef.current[peerId] = pc;

    // Add local tracks (if stream already available)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, streamRef.current);
      });
    }

    // Receive remote tracks → update peer's stream in state
    pc.ontrack = (event) => {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      upsertPeer(peerId, { stream: remoteStream, name: peerName, role: peerRole });
    };

    // ICE candidate exchange
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendWs({ type: 'ice_candidate', targetId: peerId, data: event.candidate });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        pc.restartIce();
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        // Clean up and remove failed peer
        pc.close();
        delete pcMapRef.current[peerId];
        setPeers(prev => prev.filter(p => p.id !== peerId));
      }
    };

    // Initiator sends SDP offer
    if (isInitiator) {
      // Small delay to allow local tracks to be added
      setTimeout(() => {
        if (!pcMapRef.current[peerId]) return;
        pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
          .then(offer => pc.setLocalDescription(offer))
          .then(() => {
            sendWs({ type: 'webrtc_offer', targetId: peerId, data: pc.localDescription });
          })
          .catch(err => console.warn('Offer error:', err));
      }, 300);
    }

    return pc;
  }, [sendWs, upsertPeer]);

  // Drain queued ICE candidates once remote description is set
  const drainIceQueue = useCallback(async (peerId) => {
    const pc = pcMapRef.current[peerId];
    const queue = iceQueueRef.current[peerId] || [];
    if (!pc || !queue.length) return;
    iceQueueRef.current[peerId] = [];
    for (const candidate of queue) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    }
  }, []);

  // ── 3. WebSocket Signaling ────────────────────────────────────────────────
  useEffect(() => {
    const wsUrl = `${WS_BASE_URL}/ws/meeting/${meetingCode}`;
    let socket;
    let reconnectTimer;
    let alive = true;

    const connect = () => {
      if (!alive) return;
      try {
        socket = new WebSocket(wsUrl);
        wsRef.current = socket;
        setWsStatus('connecting');

        socket.onopen = () => {
          if (!alive) return;
          setWsStatus('open');
          socket.send(JSON.stringify({
            role: isGuest ? 'participant' : 'host',
            name: hostName || (isGuest ? 'Guest' : 'Host')
          }));
        };

        socket.onclose = () => {
          setWsStatus('error');
          if (alive) reconnectTimer = setTimeout(connect, 3000);
        };

        socket.onerror = () => {
          setWsStatus('error');
        };

        socket.onmessage = async (event) => {
          if (!alive) return;
          let msg;
          try { msg = JSON.parse(event.data); } catch { return; }

          switch (msg.type) {

            // ── Host ready ──
            case 'host_ready':
              break;

            // ── Participant: host accepted the knock ──
            case 'request_approved':
              upsertPeer('__self__', { approved: true }); // self marker (unused in render)
              if (msg.existingPeers && Array.isArray(msg.existingPeers)) {
                msg.existingPeers.forEach(ep => {
                  upsertPeer(ep.id, { name: ep.name, role: ep.role });
                  createPc(ep.id, ep.name, ep.role, true /* this device initiates */);
                });
              }
              break;

            // ── Host: participant knocked ──
            case 'join_request':
              setJoinRequests(prev => {
                if (prev.some(r => r.id === msg.participantId)) return prev;
                return [...prev, { id: msg.participantId, name: msg.name }];
              });
              break;

            // ── All peers: a new participant joined ──
            case 'participant_joined':
              upsertPeer(msg.peerId, { name: msg.name, role: msg.role || 'participant' });
              // The joining peer is the initiator (they create offer), so we do NOT create offer here
              // We just create the pc shell ready to receive the offer
              if (!pcMapRef.current[msg.peerId]) {
                createPc(msg.peerId, msg.name, msg.role, false);
              }
              break;

            // ── WebRTC SDP Offer (we are answerer) ──
            case 'webrtc_offer': {
              const pc = createPc(msg.senderId, msg.senderName, msg.senderRole || 'participant', false);
              try {
                await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
                await drainIceQueue(msg.senderId);
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                sendWs({ type: 'webrtc_answer', targetId: msg.senderId, data: pc.localDescription });
              } catch (err) {
                console.warn('Answer error:', err);
              }
              break;
            }

            // ── WebRTC SDP Answer ──
            case 'webrtc_answer': {
              const pc = pcMapRef.current[msg.senderId];
              if (pc && pc.signalingState !== 'stable') {
                try {
                  await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
                  await drainIceQueue(msg.senderId);
                } catch (err) {
                  console.warn('setRemoteDescription answer error:', err);
                }
              }
              break;
            }

            // ── ICE Candidate ──
            case 'ice_candidate': {
              const pc = pcMapRef.current[msg.senderId];
              if (!msg.data) break;
              if (pc && pc.remoteDescription) {
                try { await pc.addIceCandidate(new RTCIceCandidate(msg.data)); } catch {}
              } else {
                // Queue until remote description is set
                if (!iceQueueRef.current[msg.senderId]) iceQueueRef.current[msg.senderId] = [];
                iceQueueRef.current[msg.senderId].push(msg.data);
              }
              break;
            }

            // ── Peer state: mute / video / hand ──
            case 'peer_state_changed':
              upsertPeer(msg.peerId, { [msg.key]: msg.value });
              break;

            // ── Peer disconnected ──
            case 'peer_disconnected': {
              const pc = pcMapRef.current[msg.peerId];
              if (pc) { pc.close(); delete pcMapRef.current[msg.peerId]; }
              delete iceQueueRef.current[msg.peerId];
              setPeers(prev => prev.filter(p => p.id !== msg.peerId));
              break;
            }

            // ── Participant rejected ──
            case 'request_rejected':
              alert(msg.message || 'Host declined your request.');
              break;

            // ── Live caption relay ──
            case 'live_caption':
              setLiveCaption({ speaker: msg.speaker, text: msg.text, wpm: msg.wpm });
              setTimeout(() => setLiveCaption(null), 4000);
              break;

            // ── Room full error ──
            case 'error':
              alert(msg.message || 'Room error.');
              break;

            default:
              break;
          }
        };
      } catch (e) {
        console.warn('WebSocket connect error:', e);
        setWsStatus('error');
        if (alive) reconnectTimer = setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      alive = false;
      clearTimeout(reconnectTimer);
      Object.values(pcMapRef.current).forEach(pc => pc.close());
      pcMapRef.current = {};
      iceQueueRef.current = {};
      if (wsRef.current) { try { wsRef.current.close(); } catch {} }
    };
  }, [meetingCode, isGuest, hostName, createPc, sendWs, upsertPeer, drainIceQueue]);

  // ── 4. Speech Recognition ─────────────────────────────────────────────────
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
        sendWs({ type: 'speech_telemetry', transcript, wpm: finalWpm });
      };
      recognition.onerror = () => {};
      recognition.start();
      recognitionRef.current = recognition;
    } catch {}

    return () => { try { if (recognition) recognition.stop(); } catch {} };
  }, [audioOn, hostName, sendWs]);

  // ── Controls ──────────────────────────────────────────────────────────────
  const toggleVideo = useCallback(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setVideoOn(track.enabled);
      sendWs({ type: 'state_change', key: 'videoOn', value: track.enabled });
    }
  }, [sendWs]);

  const toggleAudio = useCallback(() => {
    const track = streamRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setAudioOn(track.enabled);
      sendWs({ type: 'state_change', key: 'audioOn', value: track.enabled });
    }
  }, [sendWs]);

  const toggleHandRaise = useCallback(() => {
    setHandRaised(prev => {
      const next = !prev;
      sendWs({ type: 'state_change', key: 'handRaised', value: next });
      return next;
    });
  }, [sendWs]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      try { mediaRecorderRef.current?.stop(); } catch {}
      setIsRecording(false);
    } else if (streamRef.current) {
      try {
        recordedChunksRef.current = [];
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
          ? 'video/webm;codecs=vp9,opus' : 'video/webm';
        const recorder = new MediaRecorder(streamRef.current, { mimeType });
        recorder.ondataavailable = e => { if (e.data?.size > 0) recordedChunksRef.current.push(e.data); };
        recorder.onstop = () => {
          if (recordedChunksRef.current.length > 0) {
            const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `meeting_${meetingCode}_recording.webm`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }
        };
        recorder.start(1000);
        mediaRecorderRef.current = recorder;
        setIsRecording(true);
      } catch (err) { console.warn('Recorder error:', err); }
    }
  }, [isRecording, meetingCode]);

  const handleNotesChange = (e) => {
    const text = e.target.value;
    setNotesValue(text);
    try { localStorage.setItem(`guardianeye_notes_${meetingCode}`, text); } catch {}
  };

  const acceptParticipant = useCallback((id) => {
    sendWs({ type: 'approve_request', participantId: id });
    setJoinRequests(prev => prev.filter(r => r.id !== id));
  }, [sendWs]);

  const rejectParticipant = useCallback((id) => {
    sendWs({ type: 'reject_request', participantId: id });
    setJoinRequests(prev => prev.filter(r => r.id !== id));
  }, [sendWs]);

  const copyCode = useCallback(() => {
    const link = `${window.location.origin}/?join=${meetingCode}`;
    navigator.clipboard.writeText(link).catch(() => navigator.clipboard.writeText(meetingCode).catch(() => {}));
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  }, [meetingCode]);

  const handleEndMeeting = useCallback(() => {
    try { mediaRecorderRef.current?.stop(); } catch {}
    streamRef.current?.getTracks().forEach(t => t.stop());
    try { recognitionRef.current?.stop(); } catch {}
    Object.values(pcMapRef.current).forEach(pc => pc.close());
    pcMapRef.current = {};
    try { wsRef.current?.close(); } catch {}
    onEndMeeting();
  }, [onEndMeeting]);

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
          <span>{visiblePeers.length} / 5 {isGuest ? '(Guest)' : '(Host)'}</span>
        </div>

        {/* WS Status Indicator */}
        {wsStatus !== 'open' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            padding: '4px 10px', borderRadius: '20px',
            background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
            color: '#ef4444', fontSize: '0.75rem', fontWeight: 600
          }}>
            <WifiOff size={12} />
            <span>{wsStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span>
          </div>
        )}

        {isRecording && (
          <div className="recording-indicator">
            <Circle size={10} fill="#EF4444" stroke="none" />
            <span>REC</span>
          </div>
        )}
      </div>

      {/* Video Grid */}
      <div className={`video-grid-viewport ${gridClass}`}>
        {/* Local tile */}
        <div className={`video-tile ${handRaised ? 'hand-raised-tile' : ''}`}>
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`video-tile-video mirrored ${!videoOn ? 'camera-off' : ''}`}
          />
          {!videoOn && (
            <div className="video-tile-avatar">
              <div className="avatar-circle">{(hostName || 'Y').charAt(0).toUpperCase()}</div>
              <span className="avatar-subtext">{hostName || 'You'} (Camera Off)</span>
            </div>
          )}
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
          <RemoteVideoTile key={peer.id} peer={peer} />
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
                    <span className="join-request-label">wants to join ({visiblePeers.length}/5)</span>
                  </div>
                  <div className="join-request-actions">
                    <button className="join-accept-btn" onClick={() => acceptParticipant(req.id)} disabled={visiblePeers.length >= 5}>
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
    </div>
  );
}

export default MeetingRoom;
