import { useState, useEffect, useRef } from 'react';
import {
  Video,
  Upload,
  Play,
  Search,
  Moon,
  Sun,
  LogOut,
  Calendar,
  Clock,
  BarChart2,
  AlertCircle,
  CheckCircle,
  Sparkles,
  ChevronRight,
  Shield,
  ArrowLeft,
  Users,
  Smartphone
} from 'lucide-react';
import logoImg from './assets/logo.png';
import MeetingRoom from './MeetingRoom';
import AnalysisReport from './AnalysisReport';
import { API_BASE_URL, WS_BASE_URL } from './config';
import {
  loginUser,
  registerUser,
  logoutUser,
  saveMeetingToDb,
  fetchMeetingsFromDb,
  isFirebaseConfigured
} from './firebase';

function App() {
  // Theme State
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('theme') || 'dark';
  });

  // Flow Phases: 'loading' | 'login' | 'dashboard'
  const [phase, setPhase] = useState('loading');
  const [progress, setProgress] = useState(0);

  // User States
  const [hostName, setHostName] = useState(() => {
    return localStorage.getItem('hostName') || '';
  });
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [authSuccessMsg, setAuthSuccessMsg] = useState('');
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [meetingCodeInput, setMeetingCodeInput] = useState('');
  const [participantNameInput, setParticipantNameInput] = useState('');
  const [isRequestSent, setIsRequestSent] = useState(false);
  const [participantWsError, setParticipantWsError] = useState('');
  const participantWsRef = useRef(null);

  // Search State
  const [searchQuery, setSearchQuery] = useState('');

  // Modal States
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newMeetingName, setNewMeetingName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Active Meeting Room
  const [activeMeetingName, setActiveMeetingName] = useState('');

  // Analysis Report & Audio Extraction State
  const [uploadedVideoTitle, setUploadedVideoTitle] = useState('');
  const [extractedAudioData, setExtractedAudioData] = useState(null);
  const [uploadStatusText, setUploadStatusText] = useState('Uploading video recording...');

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  // Mobile App Install (PWA / Standalone) states
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null);
  const [canInstallApp, setCanInstallApp] = useState(() => {
    if (typeof window === 'undefined') return false;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || Boolean(window.navigator.standalone);
    if (isStandalone) return false;
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  });
  const [showIosInstallModal, setShowIosInstallModal] = useState(false);

  // App Mock Database
  const [meetings, setMeetings] = useState([
    {
      id: 1,
      name: "Q3 Strategy Planning & Roadmap",
      duration: "45 mins",
      date: "Aug 20, 2026",
      time: "10:30 AM",
      fluency: "82% Fluency",
      status: "positive",
      sentiment: "Positive / Active"
    },
    {
      id: 2,
      name: "AI Features Alignment Session",
      duration: "1 hr 12 mins",
      date: "Aug 18, 2026",
      time: "3:00 PM",
      fluency: "68% Fluency",
      status: "neutral",
      sentiment: "Neutral / Silence"
    },
    {
      id: 3,
      name: "Client Feedback Sync & Bug Review",
      duration: "30 mins",
      date: "Aug 15, 2026",
      time: "11:15 AM",
      fluency: "54% Fluency",
      status: "negative",
      sentiment: "High Interruption"
    },
    {
      id: 4,
      name: "Sprint 14 Retro & Engineering Sync",
      duration: "50 mins",
      date: "Aug 12, 2026",
      time: "9:00 AM",
      fluency: "88% Fluency",
      status: "positive",
      sentiment: "High Collaboration"
    }
  ]);

  const [videos, setVideos] = useState([
    { id: 1, name: "meeting_recording_2026-08-20.mp4", duration: "45 mins", date: "Aug 20" },
    { id: 2, name: "meeting_recording_2026-08-18.mp4", duration: "1h 12m", date: "Aug 18" },
    { id: 3, name: "meeting_recording_2026-08-15.mp4", duration: "30 mins", date: "Aug 15" }
  ]);

  // Apply Theme class to body
  useEffect(() => {
    const bodyClass = document.body.classList;
    if (theme === 'light') {
      bodyClass.add('light-theme');
    } else {
      bodyClass.remove('light-theme');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Fetch meetings from Firestore if connected
  useEffect(() => {
    async function loadCloudMeetings() {
      const cloudMeetings = await fetchMeetingsFromDb();
      if (cloudMeetings && cloudMeetings.length > 0) {
        setMeetings(cloudMeetings);
      }
    }
    loadCloudMeetings();
  }, []);

  // 3-Second Loading Progress Bar Animation
  useEffect(() => {
    if (phase === 'loading') {
      const durationMs = 3000;
      const intervalMs = 30;
      const step = 100 / (durationMs / intervalMs);

      const timer = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 100) {
            clearInterval(timer);
            // After 3 seconds of loading, transition to login or dashboard
            setTimeout(() => {
              if (hostName) {
                setPhase('dashboard');
              } else {
                setPhase('role-selection');
              }
            }, 200);
            return 100;
          }
          return prev + step;
        });
      }, intervalMs);

      return () => clearInterval(timer);
    }
  }, [phase, hostName]);

  // Listen for mobile install prompt (PWA standalone app mode)
  useEffect(() => {
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredInstallPrompt(e);
      setCanInstallApp(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  const handleInstallAppClick = async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choiceResult = await deferredInstallPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        setCanInstallApp(false);
      }
      setDeferredInstallPrompt(null);
    } else {
      const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isIos) {
        setShowIosInstallModal(true);
      } else {
        alert("To install GuardianEye AI on your phone:\n1. Tap the browser options (⋮ menu)\n2. Tap 'Install app' or 'Add to Home screen'");
      }
    }
  };
  // Gmail ID and password authentication
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    const inputEmail = usernameInput.trim();
    const inputPass = passwordInput.trim();
    setLoginError('');
    setAuthSuccessMsg('');

    try {
      if (isRegisterMode) {
        const user = await registerUser(inputEmail, inputPass, displayNameInput.trim());
        setAuthSuccessMsg("Account created successfully! Redirecting to dashboard...");
        setTimeout(() => {
          setHostName(user.displayName);
          localStorage.setItem('hostName', user.displayName);
          setPhase('dashboard');
        }, 500);
      } else {
        const user = await loginUser(inputEmail, inputPass);
        setHostName(user.displayName);
        localStorage.setItem('hostName', user.displayName);
        setPhase('dashboard');
      }
    } catch (err) {
      setLoginError(err.message || "Invalid Gmail ID or password");
    }
  };

  const handleParticipantSubmit = (e) => {
    e.preventDefault();
    const cleanCode = meetingCodeInput.trim().toUpperCase();
    const name = participantNameInput.trim();
    if (!cleanCode || !name) return;

    setParticipantWsError('');
    setIsRequestSent(true);

    try {
      const socket = new WebSocket(`${WS_BASE_URL}/ws/meeting/${cleanCode}`);
      participantWsRef.current = socket;

      socket.onopen = () => {
        socket.send(JSON.stringify({
          role: 'participant',
          name: name
        }));
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'request_approved') {
            setActiveMeetingName(cleanCode);
            setHostName(name);
            setPhase('meeting-room');
            setIsRequestSent(false);
          } else if (msg.type === 'request_rejected') {
            setParticipantWsError(msg.message || "Host declined your join request.");
            setIsRequestSent(false);
          } else if (msg.type === 'error') {
            setParticipantWsError(msg.message || "Meeting room is not active.");
            setIsRequestSent(false);
          }
        } catch {}
      };

      socket.onerror = () => {
        // If websocket cannot connect, show informative alert
        setParticipantWsError("Could not connect to live room. Make sure host is active.");
        setIsRequestSent(false);
      };
    } catch (err) {
      console.warn("WebSocket error:", err);
      setIsRequestSent(false);
    }
  };

  const handleCancelRequest = () => {
    if (participantWsRef.current) {
      try { participantWsRef.current.close(); } catch {}
    }
    setIsRequestSent(false);
    setParticipantWsError('');
  };

  const handleLogout = async () => {
    await logoutUser();
    setHostName('');
    setUsernameInput('');
    setPasswordInput('');
    setLoginError('');
    setAuthSuccessMsg('');
    setPhase('role-selection');
    setProgress(0);
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const handleCreateMeeting = (e) => {
    e.preventDefault();
    if (!newMeetingName.trim()) return;

    setIsCreating(true);

    // Mock loading spinner and transition to meeting room
    setTimeout(() => {
      setActiveMeetingName(newMeetingName.trim());
      setIsCreating(false);
      setShowCreateModal(false);
      setPhase('meeting-room');
      setNewMeetingName('');
    }, 1200);
  };

  const handleEndMeeting = async () => {
    const now = new Date();
    const optionsDate = { month: 'short', day: 'numeric', year: 'numeric' };
    const optionsTime = { hour: '2-digit', minute: '2-digit' };

    const completedMeeting = {
      name: activeMeetingName || "Strategy Meeting",
      duration: "Completed",
      date: now.toLocaleDateString('en-US', optionsDate),
      time: now.toLocaleTimeString('en-US', optionsTime),
      fluency: `${Math.floor(70 + Math.random() * 25)}% Fluency`,
      status: "positive",
      sentiment: "Completed Session"
    };

    const saved = await saveMeetingToDb(completedMeeting);

    const newVideo = {
      id: Date.now(),
      name: `meeting_recording_${now.toISOString().split('T')[0]}.mp4`,
      duration: "Completed",
      date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    };

    setMeetings(prev => [saved, ...prev]);
    setVideos(prev => [newVideo, ...prev]);
    setActiveMeetingName('');
    setPhase('dashboard');
  };

  const handleUploadFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setUploadFile(file);
    }
  };

  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (!uploadFile) return;

    setIsUploading(true);
    setUploadProgress(10);
    setUploadStatusText('Uploading video to GuardianEye AI extraction engine...');

    const formData = new FormData();
    formData.append('file', uploadFile);

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE_URL}/api/video/extract-audio`, true);

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          const pct = Math.round((evt.loaded / evt.total) * 85);
          setUploadProgress(pct);
          if (pct >= 85) {
            setUploadStatusText('Extracting 16kHz master WAV audio & isolating speaker voices...');
          }
        }
      };

      xhr.onload = async () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const res = JSON.parse(xhr.responseText);
            const audioResult = res.data;
            setUploadProgress(100);
            setUploadStatusText('Audio extraction & speaker diarization completed successfully!');

            const now = new Date();
            const optionsDate = { month: 'short', day: 'numeric', year: 'numeric' };

            const newMeeting = {
              name: uploadFile.name.replace(/\.[^/.]+$/, "") + " Analysis",
              duration: audioResult.totalDurationFormatted || "Analyzed",
              date: now.toLocaleDateString('en-US', optionsDate),
              time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
              fluency: "82% Fluency",
              status: "positive",
              sentiment: `${audioResult.speakerCount} Speakers Isolated`,
              videoUrl: audioResult.masterAudioUrl
            };

            await saveMeetingToDb(newMeeting);

            const newVideo = {
              id: Date.now(),
              name: uploadFile.name,
              duration: audioResult.totalDurationFormatted || "Analyzed",
              date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
              url: audioResult.masterAudioUrl
            };

            setMeetings(prev => [newMeeting, ...prev]);
            setVideos(prev => [newVideo, ...prev]);
            setUploadedVideoTitle(uploadFile.name.replace(/\.[^/.]+$/, ""));
            setExtractedAudioData(audioResult);

            setTimeout(() => {
              setIsUploading(false);
              setShowUploadModal(false);
              setUploadFile(null);
              setUploadProgress(0);
              setPhase('analysis');
            }, 600);
          } catch (err) {
            console.error("Parse error:", err);
            setIsUploading(false);
            alert("Error parsing audio extraction output: " + err.message);
          }
        } else {
          let errorMsg = "Extraction failed";
          try {
            const errRes = JSON.parse(xhr.responseText);
            errorMsg = errRes.detail || errorMsg;
          } catch {}
          setIsUploading(false);
          alert("Audio extraction failed: " + errorMsg);
        }
      };

      xhr.onerror = () => {
        setIsUploading(false);
        alert(`Failed to communicate with GuardianEye AI backend at ${API_BASE_URL}`);
      };

      xhr.send(formData);
    } catch (err) {
      console.error("Upload error:", err);
      setIsUploading(false);
      alert("Failed to upload recording: " + err.message);
    }
  };

  const filteredMeetings = meetings.filter((meeting) =>
    meeting.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Render Meeting Room
  if (phase === 'meeting-room') {
    return (
      <MeetingRoom
        meetingName={activeMeetingName}
        hostName={hostName}
        roomCode={meetingCodeInput.trim() || undefined}
        isGuest={Boolean(participantNameInput && hostName === participantNameInput)}
        onEndMeeting={handleEndMeeting}
      />
    );
  }

  // Render Analysis Report
  if (phase === 'analysis') {
    return (
      <AnalysisReport
        videoTitle={uploadedVideoTitle}
        audioData={extractedAudioData}
        onBack={() => setPhase('dashboard')}
      />
    );
  }

  // Render Loader Splash Screen
  if (phase === 'loading') {
    return (
      <div className="splash-container">
        <img src={logoImg} className="splash-logo-img" alt="GuardianEye Logo" />
        <div className="progress-track">
          <div className="progress-bar" style={{ width: `${progress}%` }}></div>
        </div>
        <div className="progress-text">{Math.min(Math.round(progress), 100)}% Loaded</div>
      </div>
    );
  }

  // Render role selction like host login and participant login
  if (phase === 'role-selection') {
    return (
      <div className="login-container">
        <div className="login-card" style={{ maxWidth: '600px' }}>
          <div className="login-header" style={{ textAlign: 'center' }}>
            <div className="logo-section" style={{ justifyContent: 'center', marginBottom: '1rem', fontSize: '2rem' }}>
              <Sparkles size={32} />
              <span>GuardianEye AI</span>
            </div>
            <h2>Select Your Role</h2>
            <p>Choose how you want to enter the meeting analysis platform.</p>

            {canInstallApp && (
              <div style={{ marginTop: '0.75rem', marginBottom: '0.5rem' }}>
                <button
                  type="button"
                  onClick={handleInstallAppClick}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 16px',
                    borderRadius: '24px',
                    background: 'rgba(59, 130, 246, 0.15)',
                    border: '1px solid rgba(59, 130, 246, 0.4)',
                    color: '#60a5fa',
                    fontSize: '0.85rem',
                    fontWeight: '600',
                    cursor: 'pointer',
                    boxShadow: '0 2px 10px rgba(59, 130, 246, 0.2)',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <Smartphone size={16} />
                  <span>📲 Install Mobile App on Phone</span>
                </button>
              </div>
            )}
          </div>

          <div className="role-selection-grid">
            <div className="role-card" onClick={() => setPhase('login')}>
              <div className="role-icon-wrapper host">
                <Shield size={36} />
              </div>
              <h3>HOST (Organizer)</h3>
              <p>Configure live sessions, view analytics, and manage recorded meetings.</p>
              <div className="role-arrow">
                <ChevronRight size={20} />
              </div>
            </div>

            <div className="role-card" onClick={() => setPhase('participant')}>
              <div className="role-icon-wrapper participant">
                <Users size={36} />
              </div>
              <h3>Participant (Guest)</h3>
              <p>Join a live meeting session and contribute communication audio data.</p>
              <div className="role-arrow">
                <ChevronRight size={20} />
              </div>
            </div>
          </div>

          {showIosInstallModal && (
            <div className="modal-overlay" onClick={() => setShowIosInstallModal(false)} style={{ zIndex: 1100 }}>
              <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px', textAlign: 'center' }}>
                <div style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  background: 'rgba(59, 130, 246, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 1rem',
                  color: '#3b82f6'
                }}>
                  <Smartphone size={28} />
                </div>
                <h3 style={{ marginBottom: '0.5rem', fontFamily: 'var(--font-heading)' }}>Install on iPhone / iPad</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: '1.5', marginBottom: '1.25rem' }}>
                  Install GuardianEye AI onto your home screen to use it as a native standalone app:
                </p>
                <div style={{
                  textAlign: 'left',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid var(--border)',
                  padding: '1rem 1.25rem',
                  borderRadius: '12px',
                  fontSize: '0.875rem',
                  lineHeight: '1.8',
                  marginBottom: '1.5rem',
                  color: 'var(--text)'
                }}>
                  <div>1. Tap the <strong>Share</strong> icon (bottom toolbar)</div>
                  <div>2. Scroll down & tap <strong>Add to Home Screen</strong> (+)</div>
                  <div>3. Tap <strong>Add</strong> in the top right corner</div>
                </div>
                <button className="primary-btn" onClick={() => setShowIosInstallModal(false)} style={{ width: '100%', padding: '0.85rem' }}>
                  Got it!
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Render Login/Entrance Screen for host and participants
  if (phase === 'login') {
    return (
      <div className="login-container">
        <div className="login-card" style={{ maxWidth: '440px' }}>
          <button className="back-btn" onClick={() => { setPhase('role-selection'); setLoginError(''); setAuthSuccessMsg(''); }}>
            <ArrowLeft size={16} /> Back to roles
          </button>

          <div className="login-header" style={{ textAlign: 'center', marginTop: '1.25rem' }}>
            <div className="logo-section" style={{ justifyContent: 'center', marginBottom: '0.75rem', fontSize: '1.85rem' }}>
              <Sparkles size={30} />
              <span>GuardianEye AI</span>
            </div>
            <h2>{isRegisterMode ? "Create Host Account" : "Host Sign In"}</h2>
            <p>
              {isRegisterMode
                ? "Register with your Gmail ID to host and analyze meetings."
                : "Enter your Gmail ID and password to access the host dashboard."}
            </p>
          </div>

          <form onSubmit={handleLoginSubmit}>
            {loginError && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                color: 'var(--negative)',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                marginBottom: '1.25rem',
                fontSize: '0.875rem',
                animation: 'fadeIn 0.3s ease-in-out'
              }}>
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>{loginError}</span>
              </div>
            )}

            {authSuccessMsg && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                color: 'var(--positive)',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.2)',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                marginBottom: '1.25rem',
                fontSize: '0.875rem',
                animation: 'fadeIn 0.3s ease-in-out'
              }}>
                <CheckCircle size={16} style={{ flexShrink: 0 }} />
                <span>{authSuccessMsg}</span>
              </div>
            )}

            {isRegisterMode && (
              <div className="form-group">
                <label htmlFor="host-display-name">FULL NAME</label>
                <input
                  type="text"
                  id="host-display-name"
                  className="text-input"
                  placeholder="e.g. Abhishek"
                  value={displayNameInput}
                  onChange={(e) => setDisplayNameInput(e.target.value)}
                  required
                />
              </div>
            )}

            <div className="form-group">
              <label htmlFor="host-email">GMAIL / EMAIL ID</label>
              <input
                type="email"
                id="host-email"
                className="text-input"
                placeholder="e.g. abhi@gmail.com"
                value={usernameInput}
                onChange={(e) => {
                  setUsernameInput(e.target.value);
                  if (loginError) setLoginError('');
                }}
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <label htmlFor="host-password">PASSWORD</label>
              <input
                type="password"
                id="host-password"
                className="text-input"
                placeholder="Enter your password"
                value={passwordInput}
                onChange={(e) => {
                  setPasswordInput(e.target.value);
                  if (loginError) setLoginError('');
                }}
                required
              />
            </div>

            <button type="submit" className="submit-btn" style={{ marginTop: '0.75rem' }}>
              {isRegisterMode ? "Create Account & Access Dashboard" : "Sign In & Access Dashboard"}
            </button>

            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <button
                type="button"
                onClick={() => {
                  setIsRegisterMode(!isRegisterMode);
                  setLoginError('');
                  setAuthSuccessMsg('');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--primary-accent)',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  textDecoration: 'underline'
                }}
              >
                {isRegisterMode
                  ? "Already have an account? Sign in"
                  : "Need an account? Register with Gmail"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Render Participant Entry Screen
  if (phase === 'participant') {
    return (
      <div className="login-container">
        <div className="login-card" style={{ maxWidth: '480px' }}>
          <button className="back-btn" onClick={() => { setPhase('role-selection'); setIsRequestSent(false); }}>
            <ArrowLeft size={16} /> Back to roles
          </button>

          <div className="login-header" style={{ textAlign: 'center', marginTop: '1.25rem', marginBottom: '2rem' }}>
            <div className="logo-section" style={{ justifyContent: 'center', marginBottom: '0.75rem', fontSize: '1.75rem' }}>
              <Sparkles size={28} />
              <span>GuardianEye AI</span>
            </div>
            <h2>Participant Entrance</h2>
          </div>

          {participantWsError && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: 'var(--negative)',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              marginBottom: '1.25rem',
              fontSize: '0.875rem'
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{participantWsError}</span>
            </div>
          )}

          {isRequestSent ? (
            <div className="waiting-container">
              <div className="waiting-spinner"></div>
              <h3>Request Sent to Host</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.5' }}>
                Knocked on room <strong>{meetingCodeInput.toUpperCase()}</strong>. Waiting for host to click Accept...
              </p>
              <button
                type="button"
                className="submit-btn"
                style={{ marginTop: '1.5rem', background: 'var(--neutral)' }}
                onClick={handleCancelRequest}
              >
                Cancel Request
              </button>
            </div>
          ) : (
            <form onSubmit={handleParticipantSubmit} className="participant-card-layout">
              {/* Box 1: Enter meeting code */}
              <input
                type="text"
                className="large-input-box"
                placeholder="Enter meeting code"
                value={meetingCodeInput}
                onChange={(e) => setMeetingCodeInput(e.target.value)}
                required
                autoFocus
              />

              {/* Box 2: Enter your name */}
              <input
                type="text"
                className="large-input-box"
                placeholder="Enter your name"
                value={participantNameInput}
                onChange={(e) => setParticipantNameInput(e.target.value)}
                required
              />

              {/* Box 3: Request to join */}
              <button type="submit" className="large-submit-btn">
                Request to join
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // Render Main Dashboard
  return (
    <div className="dashboard-container">
      {/* Header */}
      <header className="dashboard-header">
        <div className="logo-section">
          <Sparkles size={28} />
          <span>GuardianEye AI</span>
        </div>

        <div className="user-profile-section">
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.75rem',
            padding: '4px 10px',
            borderRadius: '20px',
            background: isFirebaseConfigured ? 'rgba(16, 185, 129, 0.15)' : 'rgba(234, 179, 8, 0.15)',
            color: isFirebaseConfigured ? '#10B981' : '#EAB308',
            border: `1px solid ${isFirebaseConfigured ? 'rgba(16, 185, 129, 0.3)' : 'rgba(234, 179, 8, 0.3)'}`
          }}>
            <span style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              background: isFirebaseConfigured ? '#10B981' : '#EAB308'
            }}></span>
            <span>{isFirebaseConfigured ? 'Firebase Connected' : 'Local Mode'}</span>
          </div>

          {canInstallApp && (
            <button
              onClick={handleInstallAppClick}
              title="Install GuardianEye AI on your device"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 12px',
                borderRadius: '20px',
                background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                color: '#ffffff',
                border: 'none',
                fontSize: '0.8rem',
                fontWeight: '600',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(59, 130, 246, 0.4)'
              }}
            >
              <Smartphone size={14} />
              <span>Install App</span>
            </button>
          )}

          <div className="greeting-text">
            Hii <span>{hostName}</span>
          </div>

          <button
            className="theme-toggle-btn"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <button className="logout-btn" onClick={handleLogout} title="Log Out">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* Main Body */}
      <div className="dashboard-grid">
        {/* Left Sidebar */}
        <aside className="sidebar-panel">
          <h4 className="sidebar-title">Controls</h4>

          {/* Card: Create New Meeting */}
          <div className="action-card premium" onClick={() => setShowCreateModal(true)}>
            <div className="card-icon">
              <Video size={24} />
            </div>
            <h3>Create New</h3>
            <p>Launch a live room with real-time fluency monitoring and fact-checking assistance.</p>
          </div>

          {/* Card: Upload Recorded Meeting */}
          <div className="action-card" onClick={() => setShowUploadModal(true)}>
            <div className="card-icon">
              <Upload size={24} />
            </div>
            <h3>Upload Recorded Meeting</h3>
            <p>Upload a video or audio file to run retrospective communication and silence analysis.</p>
          </div>

          {/* Bottom Left: Recorded Videos */}
          <div className="recorded-videos-container">
            <h4 className="sidebar-title">Recorded Videos</h4>
            {videos.length === 0 ? (
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>No recordings available.</p>
            ) : (
              <div className="video-list">
                {videos.map((vid) => (
                  <div className="video-item" key={vid.id}>
                    <div className="video-info">
                      <Play size={16} className="video-icon" />
                      <div className="video-details">
                        <div className="video-name" title={vid.name}>{vid.name}</div>
                        <div className="video-meta">{vid.date} • {vid.duration}</div>
                      </div>
                    </div>
                    <button
                      className="play-badge"
                      onClick={() => {
                        setUploadedVideoTitle(vid.name.replace(/\.[^/.]+$/, ""));
                        setPhase('analysis');
                      }}
                    >
                      Play
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Main Panel: Old Meetings History */}
        <main className="main-history-panel">
          <div className="panel-header-section">
            <h2>Meeting & Analytics History</h2>

            <div className="search-bar-wrapper">
              <Search size={16} className="search-icon" />
              <input
                type="text"
                className="search-input"
                placeholder="Search history..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* History List */}
          {filteredMeetings.length === 0 ? (
            <div className="empty-history-state">
              <AlertCircle size={32} style={{ marginBottom: '0.75rem' }} />
              <h3>No meetings found</h3>
              <p>Try searching for another topic or create a new meeting to populate history.</p>
            </div>
          ) : (
            <div className="meetings-history-list">
              {filteredMeetings.map((mtg) => (
                <div className="meeting-history-item" key={mtg.id}>
                  <div className="meeting-main-info">
                    <div className="meeting-topic">{mtg.name}</div>
                    <div className="meeting-time-meta">
                      <Calendar size={13} />
                      <span>{mtg.date}</span>
                      <span className="bullet-separator"></span>
                      <Clock size={13} />
                      <span>{mtg.time}</span>
                      <span className="bullet-separator"></span>
                      <span>{mtg.duration}</span>
                    </div>
                  </div>

                  <div className="meeting-analytics-metrics">
                    <div className="metric-pill neutral">
                      <BarChart2 size={13} />
                      <span>{mtg.fluency}</span>
                    </div>
                    <div className={`metric-pill ${mtg.status}`}>
                      {mtg.status === 'positive' && <CheckCircle size={13} />}
                      {mtg.status === 'neutral' && <AlertCircle size={13} />}
                      {mtg.status === 'negative' && <AlertCircle size={13} />}
                      <span>{mtg.sentiment}</span>
                    </div>
                  </div>

                  <button
                    className="view-details-btn"
                    onClick={() => {
                      setUploadedVideoTitle(mtg.name);
                      setPhase('analysis');
                    }}
                  >
                    Details
                  </button>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Create Meeting Modal */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">Create New Meeting</div>
            {isCreating ? (
              <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                <div className="progress-track" style={{ margin: '0 auto 1.5rem auto' }}>
                  <div className="progress-bar animate-pulse" style={{ width: '100%' }}></div>
                </div>
                <h3>Spinning up Live AI Monitor Room...</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.5rem' }}>Allocating signal relays and noise canceling filters.</p>
              </div>
            ) : (
              <form onSubmit={handleCreateMeeting}>
                <div className="form-group">
                  <label htmlFor="meeting-name">MEETING TOPIC</label>
                  <input
                    type="text"
                    id="meeting-name"
                    className="text-input"
                    placeholder="e.g. Weekly Standup, Brainstorming"
                    value={newMeetingName}
                    onChange={(e) => setNewMeetingName(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="modal-buttons">
                  <button type="button" className="modal-btn-cancel" onClick={() => setShowCreateModal(false)}>Cancel</button>
                  <button type="submit" className="modal-btn-confirm">Launch Room</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Upload Meeting Modal */}
      {showUploadModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">Upload Meeting Recording</div>
            {isUploading ? (
              <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                <div className="progress-track" style={{ margin: '0 auto 1rem auto' }}>
                  <div className="progress-bar" style={{ width: `${uploadProgress}%` }}></div>
                </div>
                <h3>{uploadStatusText}</h3>
                <div className="progress-text">{uploadProgress}%</div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                  Extracting 16kHz WAV audio, Voice Activity Detection, and speaker clustering...
                </p>
              </div>
            ) : (
              <form onSubmit={handleUploadSubmit}>
                <div className="form-group">
                  <label>DRAG & DROP OR CHOOSE FILE</label>
                  <label className="upload-drag-area">
                    <Upload size={32} className="upload-drag-icon" />
                    <span>{uploadFile ? uploadFile.name : 'Select recorded meeting (mp4, webm, mp3)'}</span>
                    {uploadFile && <span style={{ fontSize: '0.75rem', color: 'var(--positive)' }}>File selected successfully</span>}
                    <input
                      type="file"
                      className="hidden-file-input"
                      accept="video/*,audio/*"
                      onChange={handleUploadFileChange}
                      required
                    />
                  </label>
                </div>
                <div className="modal-buttons">
                  <button type="button" className="modal-btn-cancel" onClick={() => { setShowUploadModal(false); setUploadFile(null); }}>Cancel</button>
                  <button type="submit" className="modal-btn-confirm" disabled={!uploadFile}>Start Analysis</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
      {/* iOS App Install Helper Modal in Dashboard */}
      {showIosInstallModal && (
        <div className="modal-overlay" onClick={() => setShowIosInstallModal(false)} style={{ zIndex: 1100 }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px', textAlign: 'center' }}>
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              background: 'rgba(59, 130, 246, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem',
              color: '#3b82f6'
            }}>
              <Smartphone size={28} />
            </div>
            <h3 style={{ marginBottom: '0.5rem', fontFamily: 'var(--font-heading)' }}>Install on iPhone / iPad</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: '1.5', marginBottom: '1.25rem' }}>
              Install GuardianEye AI onto your home screen to use it as a native standalone app:
            </p>
            <div style={{
              textAlign: 'left',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid var(--border)',
              padding: '1rem 1.25rem',
              borderRadius: '12px',
              fontSize: '0.875rem',
              lineHeight: '1.8',
              marginBottom: '1.5rem',
              color: 'var(--text)'
            }}>
              <div>1. Tap the <strong>Share</strong> icon (bottom toolbar)</div>
              <div>2. Scroll down & tap <strong>Add to Home Screen</strong> (+)</div>
              <div>3. Tap <strong>Add</strong> in the top right corner</div>
            </div>
            <button className="primary-btn" onClick={() => setShowIosInstallModal(false)} style={{ width: '100%', padding: '0.85rem' }}>
              Got it!
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
