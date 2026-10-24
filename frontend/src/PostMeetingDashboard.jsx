import { useState, useRef } from 'react';
import {
  ArrowLeft,
  Download,
  Video,
  FileText,
  Sparkles,
  Users,
  Clock,
  Calendar,
  Check,
  Copy,
  Play,
  Share2,
  BarChart2,
  Film
} from 'lucide-react';
import './PostMeetingDashboard.css';

export default function PostMeetingDashboard({ data = {}, onBack, onAnalyze }) {
  const [copied, setCopied] = useState(false);
  const [downloadingVideo, setDownloadingVideo] = useState(false);
  const [downloadingScript, setDownloadingScript] = useState(false);

  const {
    recordingBlob = null,
    recordingUrl = null,
    recordingFilename = `meeting_recording_${Date.now()}.webm`,
    scriptText = '',
    transcriptsList = [],
    meetingName = 'Strategy Meeting',
    meetingCode = 'MTG-001',
    duration = 'Completed',
    hostName = 'Host',
    participantsCount = 1
  } = data;

  // 1. Download Full Screen Video (.mp4 / .webm)
  const handleDownloadVideo = () => {
    if (!recordingBlob && !recordingUrl) {
      alert('No recorded video file available for this meeting session.');
      return;
    }
    setDownloadingVideo(true);
    try {
      const url = recordingUrl || URL.createObjectURL(recordingBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = recordingFilename || `meeting_${meetingCode}_fullscreen_recording.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error('Failed to trigger video download:', err);
    } finally {
      setTimeout(() => setDownloadingVideo(false), 1200);
    }
  };

  // 2. Download Structured Conversation Transcript (.txt movie script format)
  const handleDownloadTranscript = () => {
    setDownloadingScript(true);
    try {
      let content = scriptText;
      if (!content && transcriptsList.length > 0) {
        content = transcriptsList.map(t => `${t.speakerLabel}: ${t.text}`).join('\n\n');
      }
      if (!content) {
        content = `GUARDIANEYE AI - MEETING CONVERSATION TRANSCRIPT\nMeeting: ${meetingName}\nCode: ${meetingCode}\nDate: ${new Date().toLocaleDateString()}\n\nNo dialogue detected.`;
      }

      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transcript_${meetingCode}_${meetingName.replace(/[^a-zA-Z0-9]/g, '_')}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.error('Failed to trigger script download:', err);
    } finally {
      setTimeout(() => setDownloadingScript(false), 1200);
    }
  };

  // 3. Copy Script to Clipboard
  const handleCopyScript = () => {
    let content = scriptText;
    if (!content && transcriptsList.length > 0) {
      content = transcriptsList.map(t => `${t.speakerLabel}: ${t.text}`).join('\n\n');
    }
    navigator.clipboard.writeText(content || 'No transcript text available.').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  // Calculate file size badge if blob exists
  const fileSizeMb = recordingBlob ? (recordingBlob.size / (1024 * 1024)).toFixed(1) : null;
  const turnsCount = transcriptsList.length;

  return (
    <div className="post-meeting-container">
      {/* Header */}
      <header className="post-meeting-header">
        <div className="post-header-left">
          <button className="back-home-btn" onClick={onBack} title="Return to Dashboard">
            <ArrowLeft size={16} />
            <span>Return to Dashboard</span>
          </button>
          <div className="post-title-group">
            <h1>
              <Film size={26} color="#38BDF8" />
              <span>{meetingName}</span>
            </h1>
            <p>Meeting Recording & Multi-Participant Speech Intelligence Report</p>
          </div>
        </div>

        <div className="post-meta-badges">
          <div className="meta-badge highlight">
            <Users size={14} />
            <span>{participantsCount} / 5 Members</span>
          </div>
          <div className="meta-badge">
            <Clock size={14} />
            <span>{duration || 'Recorded Session'}</span>
          </div>
          <div className="meta-badge">
            <Calendar size={14} />
            <span>{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </div>
        </div>
      </header>

      {/* Primary Action Banner with Two Prominent Download Buttons */}
      <section className="post-actions-banner">
        {/* Button 1: Download Full Screen Video */}
        <button
          className="download-card-btn video-dl"
          onClick={handleDownloadVideo}
          title="Download the full screen grid recording of all participants"
        >
          <div className="dl-icon-circle">
            <Video size={26} />
          </div>
          <div className="dl-text-wrap">
            <div className="dl-title">Download Full Screen Video</div>
            <div className="dl-desc">High-quality synchronized grid video & audio</div>
            <div className="dl-badge">
              {downloadingVideo ? 'Downloading...' : fileSizeMb ? `${fileSizeMb} MB • .webm/.mp4` : 'Ready to Download'}
            </div>
          </div>
          <Download size={20} color="#38BDF8" />
        </button>

        {/* Button 2: Download Structured Conversation Transcript */}
        <button
          className="download-card-btn script-dl"
          onClick={handleDownloadTranscript}
          title="Download the movie-script formatted chronological transcript"
        >
          <div className="dl-icon-circle">
            <FileText size={26} />
          </div>
          <div className="dl-text-wrap">
            <div className="dl-title">Download Structured Conversation Transcript</div>
            <div className="dl-desc">Timestamped script with speaker identity mapping</div>
            <div className="dl-badge">
              {downloadingScript ? 'Downloading...' : `${turnsCount} Spoken Turns • .txt script`}
            </div>
          </div>
          <Download size={20} color="#A855F7" />
        </button>

        {/* Action 3: Bridge to AI Audio & Behavioral Coaching */}
        {typeof onAnalyze === 'function' && (
          <button
            className="download-card-btn analyze-btn"
            onClick={() => onAnalyze(recordingBlob || data)}
            title="Send recorded meeting to GuardianEye AI Audio Analysis Engine"
          >
            <div className="dl-icon-circle">
              <Sparkles size={26} />
            </div>
            <div className="dl-text-wrap">
              <div className="dl-title">Run AI Speech & Behavioral Coaching</div>
              <div className="dl-desc">Extract speaker metrics, filler words & tone analysis</div>
              <div className="dl-badge">AI Coaching Suite</div>
            </div>
            <BarChart2 size={20} color="#10B981" />
          </button>
        )}
      </section>

      {/* Main Grid: Video Preview + Script Viewer */}
      <div className="post-main-grid">
        {/* Left Column: Full Screen Layout Video Preview */}
        <div className="post-card">
          <div className="post-card-header">
            <div className="post-card-title">
              <Video size={18} color="#38BDF8" />
              <span>Full Screen Layout Recording Preview</span>
            </div>
            <button className="card-action-btn" onClick={handleDownloadVideo}>
              <Download size={14} />
              <span>Download</span>
            </button>
          </div>

          <div className="video-preview-wrapper">
            {recordingUrl || recordingBlob ? (
              <video
                src={recordingUrl || URL.createObjectURL(recordingBlob)}
                controls
                playsInline
                preload="metadata"
              />
            ) : (
              <div className="no-video-placeholder">
                <Video size={48} strokeWidth={1.5} />
                <span>No video preview available</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Structured Chronological Conversation Script */}
        <div className="post-card">
          <div className="post-card-header">
            <div className="post-card-title">
              <FileText size={18} color="#A855F7" />
              <span>Structured Conversation Script ({turnsCount} turns)</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="card-action-btn" onClick={handleCopyScript} title="Copy script to clipboard">
                {copied ? <Check size={14} color="#10B981" /> : <Copy size={14} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
              <button className="card-action-btn" onClick={handleDownloadTranscript} title="Download .txt file">
                <Download size={14} />
                <span>Export .txt</span>
              </button>
            </div>
          </div>

          <div className="script-viewer-body">
            {transcriptsList && transcriptsList.length > 0 ? (
              transcriptsList.map((item, idx) => {
                const isHost = item.isHost || (item.speakerLabel && item.speakerLabel.startsWith('Host'));
                const lineClass = isHost
                  ? 'host-line'
                  : idx % 3 === 0
                  ? 'p1-line'
                  : idx % 3 === 1
                  ? 'p2-line'
                  : 'p3-line';

                const timeStr = item.timestamp
                  ? new Date(item.timestamp).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit'
                    })
                  : '00:00';

                return (
                  <div key={item.id || idx} className={`script-line-item ${lineClass}`}>
                    <div className="script-line-header">
                      <span className="script-speaker-name">
                        {item.speakerLabel || item.speakerName || 'Speaker'}
                      </span>
                      <span className="script-timestamp">[{timeStr}]</span>
                    </div>
                    <div className="script-text-content">{item.text}</div>
                  </div>
                );
              })
            ) : scriptText ? (
              <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.875rem', lineHeight: '1.6', color: '#CBD5E1' }}>
                {scriptText}
              </div>
            ) : (
              <div className="no-script-placeholder">
                <FileText size={42} strokeWidth={1.5} />
                <span>No live speech transcripts recorded during this session.</span>
                <span style={{ fontSize: '0.8rem', color: '#64748B' }}>
                  Microphone speech is automatically detected and mapped in real-time.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
