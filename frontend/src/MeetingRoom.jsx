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
  Users
} from 'lucide-react';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Component for rendering remote peer's video feed cleanly
function RemoteVideoTile({ peer }) {
  const remoteVideoRef = useRef(null);

  useEffect(() => {
    if (remoteVideoRef.current && peer.stream) {
      remoteVideoRef.current.srcObject = peer.stream;
    }
  }, [peer.stream]);

  const hasVideo = peer.videoOn && Boolean(peer.stream);

  return (
    <div className={`video-tile ${peer.handRaised ? 'hand-raised-tile' : ''}`}>
      <video
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
          <span className="avatar-subtext">{peer.name} (Camera Off)</span>
        </div>
      )}

      {/* Name and Role Tag */}
      <div className="tile-name-pill">
        <span>{peer.name}</span>
        <span className={`tile-role-tag ${peer.role || 'guest'}`}>
          {peer.role === 'host' ? 'Host' : 'Guest'}
        </span>
      </div>

      {/* Audio Status Pill */}
      <div className={`tile-status-pill ${!peer.audioOn ? 'muted' : ''}`} title={peer.audioOn ? 'Mic Active' : 'Muted'}>
        {peer.audioOn ? <Mic size={14} /> : <MicOff size={14} />}
      </div>

      {/* Hand Raised Badge */}
      {peer.handRaised && (
        <div className="tile-hand-tag">
          ✋ Hand Raised
        </div>
      )}
    </div>
  );
}

function MeetingRoom({
  meetingName,
  hostName,
  onEndMeeting,
  roomCode: propRoomCode,
  isGuest = false
}) {
  // Local Camera & Media
  const localVideoRef = useRef(null);
  const streamRef = useRef(null);
  const wsRef = useRef(null);
  const peerConnectionsRef = useRef({});
  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);

  // In-Meeting Controls (Available to all 1 host + 5 participants)
  const [videoOn, setVideoOn] = useState(true);
  const [audioOn, setAudioOn] = useState(true);
  const [handRaised, setHandRaised] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  // Meeting code & Copy State
  const [meetingCode] = useState(() => {
    if (propRoomCode) return propRoomCode.toUpperCase();
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 3; i++) code += chars[Math.floor(Math.random() * chars.length)];
    code += '-';
    for (let i = 0; i < 3; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  });
  const [codeCopied, setCodeCopied] = useState(false);

  // Quick Notes with Local Persistence
  const [notesText, setNotesText] = useState(() => {
    try {
      return localStorage.getItem(`guardianeye_notes_${meetingCode}`) || '';
    } catch {
      return '';
    }
  });

  // Real WebRTC Connected Remote Peers (Up to 5)
  // Each peer: { id, name, role, stream, handRaised, audioOn, videoOn }
  const [peers, setPeers] = useState([]);

  // Host Join Requests (Knocks)
  const [joinRequests, setJoinRequests] = useState([]);

  // Live Speech Telemetry Caption
  const [liveCaption, setLiveCaption] = useState(null);

  // Helper to send WebSocket message safely
  const sendWs = useCallback((payload) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  // WebRTC Peer Connection Factory
  const createPeerConnection = useCallback((peerId, peerName, peerRole, isInitiator) => {
    if (peerConnectionsRef.current[peerId]) {
      return peerConnectionsRef.current[peerId];
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionsRef.current[peerId] = pc;

    // 1. Add local media tracks to this peer connection
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, streamRef.current);
      });
    }

    // 2. Handle remote stream arrivals
    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      setPeers((prev) => {
        const existing = prev.find((p) => p.id === peerId);
        if (existing) {
          return prev.map((p) => (p.id === peerId ? { ...p, stream: remoteStream } : p));
        }
        return [
          ...prev,
          {
            id: peerId,
            name: peerName || 'Guest',
            role: peerRole || 'participant',
            stream: remoteStream,
            handRaised: false,
            audioOn: true,
            videoOn: true
          }
        ];
      });
    };

    // 3. ICE Candidate exchange
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendWs({
          type: 'ice_candidate',
          targetId: peerId,
          data: event.candidate
        });
      }
    };

    // 4. Initiator creates the SDP Offer
    if (isInitiator) {
      pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          sendWs({
            type: 'webrtc_offer',
            targetId: peerId,
            data: pc.localDescription
          });
        })
        .catch((err) => console.warn('Error creating WebRTC offer:', err));
    }

    return pc;
  }, [sendWs]);

  // Start Local Media Stream
  useEffect(() => {
    let mounted = true;

    const startLocalMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        if (mounted && localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          streamRef.current = stream;
        }
      } catch (err) {
        console.warn('Camera/mic access unavailable or denied:', err);
      }
    };

    startLocalMedia();

    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Real-Time WebSocket Signaling & WebRTC Mesh Setup
  useEffect(() => {
    let isCancelled = false;
    const wsUrl = `${WS_BASE_URL}/ws/meeting/${meetingCode}`;

    try {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        if (isCancelled) return;
        socket.send(JSON.stringify({
          role: isGuest ? 'participant' : 'host',
          name: hostName || (isGuest ? 'Guest Participant' : 'Host')
        }));
      };

      socket.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);

          // 1. Participant Knock (Host only)
          if (msg.type === 'join_request') {
            setJoinRequests((prev) => {
              if (prev.some((r) => r.id === msg.participantId)) return prev;
              return [...prev, { id: msg.participantId, name: msg.name }];
            });
          }

          // 2. Participant Approved: receives list of existing peers in room
          else if (msg.type === 'request_approved') {
            if (msg.existingPeers && Array.isArray(msg.existingPeers)) {
              // Initiate WebRTC connection to each existing peer (including Host)
              msg.existingPeers.forEach((existingPeer) => {
                createPeerConnection(existingPeer.id, existingPeer.name, existingPeer.role, true);
              });
            }
          }

          // 3. New Participant Joined: add to peer list and prepare for incoming offer
          else if (msg.type === 'participant_joined') {
            setPeers((prev) => {
              if (prev.some((p) => p.id === msg.peerId)) return prev;
              return [
                ...prev,
                {
                  id: msg.peerId,
                  name: msg.name,
                  role: msg.role || 'participant',
                  stream: null,
                  handRaised: false,
                  audioOn: true,
                  videoOn: true
                }
              ];
            });
          }

          // 4. WebRTC SDP Offer
          else if (msg.type === 'webrtc_offer') {
            const pc = createPeerConnection(msg.senderId, msg.senderName, 'participant', false);
            await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendWs({
              type: 'webrtc_answer',
              targetId: msg.senderId,
              data: pc.localDescription
            });
          }

          // 5. WebRTC SDP Answer
          else if (msg.type === 'webrtc_answer') {
            const pc = peerConnectionsRef.current[msg.senderId];
            if (pc) {
              await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
            }
          }

          // 6. ICE Candidate
          else if (msg.type === 'ice_candidate') {
            const pc = peerConnectionsRef.current[msg.senderId];
            if (pc && msg.data) {
              await pc.addIceCandidate(new RTCIceCandidate(msg.data));
            }
          }

          // 7. Peer State Change (Mute, Video, Hand Raise)
          else if (msg.type === 'peer_state_changed') {
            setPeers((prev) =>
              prev.map((p) => (p.id === msg.peerId ? { ...p, [msg.key]: msg.value } : p))
            );
          }

          // 8. Peer Disconnected
          else if (msg.type === 'peer_disconnected') {
            if (peerConnectionsRef.current[msg.peerId]) {
              peerConnectionsRef.current[msg.peerId].close();
              delete peerConnectionsRef.current[msg.peerId];
            }
            setPeers((prev) => prev.filter((p) => p.id !== msg.peerId));
          }

          // 9. Live Speech Caption
          else if (msg.type === 'live_caption') {
            setLiveCaption({
              speaker: msg.speaker,
              text: msg.text,
              wpm: msg.wpm
            });
            setTimeout(() => setLiveCaption(null), 4000);
          }
        } catch (err) {
          console.warn('Signaling message error:', err);
        }
      };
    } catch (e) {
      console.warn('Signaling connection error:', e);
    }

    return () => {
      isCancelled = true;
      Object.values(peerConnectionsRef.current).forEach((pc) => pc.close());
      peerConnectionsRef.current = {};
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
  }, [meetingCode, isGuest, hostName, createPeerConnection, sendWs]);

  // Web Speech Recognition for Real-Time Telemetry
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      let lastSpeechTime = Date.now();

      recognition.onresult = (event) => {
        const lastResultIndex = event.results.length - 1;
        const transcript = event.results[lastResultIndex][0].transcript.trim();
        if (!transcript) return;

        const words = transcript.split(/\s+/).length;
        const now = Date.now();
        const durationMin = (now - lastSpeechTime) / 60000;
        lastSpeechTime = now;
        const wpm = durationMin > 0 ? Math.min(Math.round(words / durationMin), 220) : 130;

        setLiveCaption({
          speaker: hostName || 'You',
          text: transcript,
          wpm: wpm > 40 ? wpm : 120
        });
        setTimeout(() => setLiveCaption(null), 4000);

        sendWs({
          type: 'speech_telemetry',
          transcript,
          wpm: wpm > 40 ? wpm : 120
        });
      };

      if (audioOn) {
        try { recognition.start(); } catch {}
      }

      recognitionRef.current = recognition;

      return () => {
        try { recognition.stop(); } catch {}
      };
    } catch {}
  }, [audioOn, hostName, sendWs]);

  // In-Meeting Function: Video Off / On (For All Members)
  const toggleVideo = useCallback(() => {
    if (streamRef.current) {
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        const nextState = !videoTrack.enabled;
        videoTrack.enabled = nextState;
        setVideoOn(nextState);
        sendWs({ type: 'state_change', key: 'videoOn', value: nextState });
      }
    }
  }, [sendWs]);

  // In-Meeting Function: Audio Mute / Unmute (For All Members)
  const toggleAudio = useCallback(() => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        const nextState = !audioTrack.enabled;
        audioTrack.enabled = nextState;
        setAudioOn(nextState);
        sendWs({ type: 'state_change', key: 'audioOn', value: nextState });
      }
    }
  }, [sendWs]);

  // In-Meeting Function: Record Session (With native MediaRecorder)
  const toggleRecording = useCallback(() => {
    if (isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch {}
      }
      setIsRecording(false);
    } else {
      if (streamRef.current && typeof MediaRecorder !== 'undefined') {
        try {
          recordedChunksRef.current = [];
          const recorder = new MediaRecorder(streamRef.current, {
            mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
              ? 'video/webm;codecs=vp9,opus'
              : 'video/webm'
          });
          recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
              recordedChunksRef.current.push(event.data);
            }
          };
          recorder.onstop = () => {
            if (recordedChunksRef.current.length > 0) {
              const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `meeting_${meetingCode}_recording.webm`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            }
          };
          recorder.start(1000);
          mediaRecorderRef.current = recorder;
          setIsRecording(true);
        } catch (err) {
          console.warn("MediaRecorder start error:", err);
          setIsRecording(true);
        }
      } else {
        setIsRecording(true);
      }
    }
  }, [isRecording, meetingCode]);

  // In-Meeting Function: Raise Hand (For All Members)
  const toggleHandRaise = useCallback(() => {
    const nextState = !handRaised;
    setHandRaised(nextState);
    sendWs({ type: 'state_change', key: 'handRaised', value: nextState });
  }, [handRaised, sendWs]);

  // In-Meeting Function: Take Notes (For All Members)
  const handleNotesChange = (e) => {
    const text = e.target.value;
    setNotesText(text);
    try {
      localStorage.setItem(`guardianeye_notes_${meetingCode}`, text);
    } catch {}
  };

  // Host Action: Accept Participant Knock (Max 5 allowed)
  const acceptParticipant = useCallback((id) => {
    sendWs({ type: 'approve_request', participantId: id });
    setJoinRequests((prev) => prev.filter((r) => r.id !== id));
  }, [sendWs]);

  // Host Action: Decline Participant Knock
  const rejectParticipant = useCallback((id) => {
    sendWs({ type: 'reject_request', participantId: id });
    setJoinRequests((prev) => prev.filter((r) => r.id !== id));
  }, [sendWs]);

  // Copy Meeting Code or Full Direct Join Link
  const copyCode = useCallback(() => {
    const inviteLink = `${window.location.origin}/?join=${meetingCode}`;
    navigator.clipboard.writeText(inviteLink).catch(() => {
      navigator.clipboard.writeText(meetingCode).catch(() => {});
    });
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  }, [meetingCode]);

  // End or Leave Meeting
  const handleEndMeeting = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    Object.values(peerConnectionsRef.current).forEach((pc) => pc.close());
    peerConnectionsRef.current = {};
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
    }
    onEndMeeting();
  }, [onEndMeeting]);

  // Total members in room = You (1) + Remote Peers (up to 5) = Max 6 Total
  const totalRoomMembers = 1 + peers.length;
  const gridClass = `grid-${Math.min(totalRoomMembers, 6)}`;

  return (
    <div className="meeting-room">
      {/* Top Overlay: Room Information & Code */}
      <div className="meeting-code-overlay">
        <div className="meeting-code-badge" onClick={copyCode} title="Click to copy full invite link for other devices">
          <span className="code-label">{codeCopied ? 'Link Copied!' : 'Meeting Code'}</span>
          <span className="code-value">{meetingCode}</span>
          {codeCopied ? <Check size={14} className="code-copy-icon" /> : <Copy size={14} className="code-copy-icon" />}
        </div>

        <div className="meeting-topic-badge">{meetingName || 'Strategy Sync'}</div>

        {/* Capacity Indicator: Max 5 Participants */}
        <div className="capacity-badge" title="Maximum 5 participants allowed">
          <Users size={14} />
          <span>{peers.length} / 5 Participants {isGuest ? '(Guest)' : '(Host)'}</span>
        </div>

        {isRecording && (
          <div className="recording-indicator">
            <Circle size={10} fill="#EF4444" stroke="none" />
            <span>REC</span>
          </div>
        )}
      </div>

      {/* Multi-Peer Video Grid Viewport (1 Host + up to 5 Participants) */}
      <div className={`video-grid-viewport ${gridClass}`}>
        {/* Tile 1: Local User (You) */}
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
              <div className="avatar-circle">
                {(hostName || 'Y').charAt(0).toUpperCase()}
              </div>
              <span className="avatar-subtext">{hostName || 'You'} (Camera Off)</span>
            </div>
          )}

          {/* Name Pill */}
          <div className="tile-name-pill">
            <span>{hostName || 'You'} (You)</span>
            <span className={`tile-role-tag ${isGuest ? 'guest' : 'host'}`}>
              {isGuest ? 'Guest' : 'Host'}
            </span>
          </div>

          {/* Audio Status Pill */}
          <div className={`tile-status-pill ${!audioOn ? 'muted' : ''}`} title={audioOn ? 'Mic Active' : 'Muted'}>
            {audioOn ? <Mic size={14} /> : <MicOff size={14} />}
          </div>

          {/* Hand Raised Badge */}
          {handRaised && (
            <div className="tile-hand-tag">
              ✋ Hand Raised
            </div>
          )}
        </div>

        {/* Tiles 2 to 6: Remote Connected Peers (WebRTC Streams) */}
        {peers.map((peer) => (
          <RemoteVideoTile key={peer.id} peer={peer} />
        ))}
      </div>

      {/* Live AI Speech Telemetry Caption */}
      {liveCaption && (
        <div style={{
          position: 'absolute',
          bottom: '95px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(15, 23, 42, 0.9)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(56, 189, 248, 0.4)',
          borderRadius: '24px',
          padding: '8px 22px',
          color: '#F8FAFC',
          fontSize: '0.9rem',
          maxWidth: '85%',
          textAlign: 'center',
          zIndex: 120,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <span style={{ color: '#38BDF8', fontWeight: 600 }}>{liveCaption.speaker}:</span>
          <span>"{liveCaption.text}"</span>
          {liveCaption.wpm > 0 && (
            <span style={{
              fontSize: '0.75rem',
              background: 'rgba(56, 189, 248, 0.2)',
              padding: '2px 8px',
              borderRadius: '12px',
              color: '#38BDF8',
              fontWeight: 600
            }}>
              {liveCaption.wpm} WPM
            </span>
          )}
        </div>
      )}

      {/* Bottom Control Bar (Identical Controls for All Members) */}
      <div className="meeting-controls-bar">
        <div className="controls-center">
          {/* Video Toggle (Camera Off / On) */}
          <button
            className={`control-btn ${!videoOn ? 'control-off' : ''}`}
            onClick={toggleVideo}
            title={videoOn ? 'Turn off camera' : 'Turn on camera'}
          >
            {videoOn ? <Video size={22} /> : <VideoOff size={22} />}
          </button>

          {/* Audio Toggle (Mute / Unmute) */}
          <button
            className={`control-btn ${!audioOn ? 'control-off' : ''}`}
            onClick={toggleAudio}
            title={audioOn ? 'Mute microphone' : 'Unmute microphone'}
          >
            {audioOn ? <Mic size={22} /> : <MicOff size={22} />}
          </button>

          {/* Raise Hand Toggle */}
          <button
            className={`control-btn ${handRaised ? 'control-active' : ''}`}
            onClick={toggleHandRaise}
            title={handRaised ? 'Lower hand' : 'Raise hand'}
          >
            <Hand size={22} />
          </button>

          {/* Record Session */}
          <button
            className={`control-btn ${isRecording ? 'control-recording' : ''}`}
            onClick={toggleRecording}
            title={isRecording ? 'Stop recording' : 'Start recording'}
          >
            <Circle size={22} fill={isRecording ? '#EF4444' : 'none'} />
          </button>

          {/* Take Notes Drawer */}
          <button
            className={`control-btn ${showNotes ? 'control-active' : ''}`}
            onClick={() => setShowNotes(!showNotes)}
            title="Take Meeting Notes"
          >
            <StickyNote size={22} />
          </button>

          {/* End / Leave Meeting */}
          <button
            className="control-btn control-end"
            onClick={handleEndMeeting}
            title={isGuest ? 'Leave Room' : 'End Meeting'}
          >
            <PhoneOff size={22} />
          </button>
        </div>

        {/* Host Knock Requests Panel (Bottom-Right) */}
        {!isGuest && joinRequests.length > 0 && (
          <div className="join-requests-panel">
            <div className="join-requests-list">
              {joinRequests.map((req) => (
                <div className="join-request-card" key={req.id}>
                  <div className="join-request-info">
                    <UserPlus size={16} />
                    <span className="join-request-name">{req.name}</span>
                    <span className="join-request-label">wants to join ({peers.length}/5)</span>
                  </div>
                  <div className="join-request-actions">
                    <button
                      className="join-accept-btn"
                      onClick={() => acceptParticipant(req.id)}
                      title="Accept participant"
                      disabled={peers.length >= 5}
                    >
                      <Check size={16} />
                    </button>
                    <button
                      className="join-reject-btn"
                      onClick={() => rejectParticipant(req.id)}
                      title="Decline request"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Take Notes Overlay Panel (Accessible to All Members) */}
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
            placeholder="Type your notes here... They will be automatically saved locally."
            value={notesText}
            onChange={handleNotesChange}
            autoFocus
          />
        </div>
      )}
    </div>
  );
}

export default MeetingRoom;
