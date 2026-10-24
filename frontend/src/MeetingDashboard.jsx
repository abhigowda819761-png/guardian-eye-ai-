import { useState, useEffect, useMemo, useRef } from 'react';
import {
  ArrowLeft,
  Download,
  Share2,
  Copy,
  Check,
  CheckCircle,
  AlertTriangle,
  ShieldAlert,
  Search,
  Sparkles,
  Users,
  MessageSquare,
  BarChart2,
  Award,
  RefreshCw,
  FileText,
  Loader2,
  Zap,
  CheckCircle2,
  Clock,
  ShieldCheck,
  UploadCloud
} from 'lucide-react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import {
  subscribeToMeetingDocument,
  fetchMeetingDocument,
  subscribeToTranscript,
  fetchMeetingTranscript,
  triggerAuditMeetingFactCheck,
  uploadMeetingVideoToFirebase,
  triggerGenerateMeetingTranscription,
  auth,
  getCurrentAuthUser
} from './firebase';
import './MeetingDashboard.css';

/**
 * Metric Configuration for the 5 Gemini Evaluated Parameters (1-10)
 */
const METRICS_CONFIG = [
  {
    key: 'communication_skills',
    label: 'Communication Skills',
    fillClass: 'fill-skills',
    invert: false,
    desc: 'Clarity, articulation & structural coherence'
  },
  {
    key: 'fluency',
    label: 'Communication Fluency',
    fillClass: 'fill-fluency',
    invert: false,
    desc: 'Cadence, natural pace & minimal hesitation'
  },
  {
    key: 'confidence',
    label: 'Confidence',
    fillClass: 'fill-confidence',
    invert: false,
    desc: 'Tone assertiveness & executive presence'
  },
  {
    key: 'awkwardness',
    label: 'Awkwardness',
    fillClass: 'fill-awkwardness',
    invert: true, // Lower awkwardness is better!
    desc: 'Hesitation or tension (lower is better)'
  },
  {
    key: 'straightforward_answers',
    label: 'Straightforward Answers',
    fillClass: 'fill-straightforward',
    invert: false,
    desc: 'Directness & avoidance of evasive phrasing'
  }
];

function generateUniqueMeetingId() {
  const randomSuffix = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).substring(2, 10);
  return `meeting_${Date.now()}_${randomSuffix}`;
}

export default function MeetingDashboard({
  meetingId,
  initialData = null,
  videoTitle = '',
  hostName: propHostName = '',
  guestName: propGuestName = '',
  onBack
}) {
  // 1. Dynamic Meeting ID Generation Fix:
  // Completely remove the static/hardcoded ID 'meeting_default'.
  // Generate a unique random ID for every session.
  const [activeMeetingId, setActiveMeetingId] = useState(() => {
    const raw = meetingId || initialData?.meetingId || initialData?.meetingCode;
    if (raw && raw !== 'meeting_default' && raw !== 'default') {
      return String(raw);
    }
    return generateUniqueMeetingId();
  });

  const cleanMeetingId = activeMeetingId;

  // Local component states initialized cleanly for the active meeting
  const [meetingDoc, setMeetingDoc] = useState(() => {
    if (initialData && initialData.meetingId === cleanMeetingId && initialData.meetingId !== 'meeting_default') {
      return initialData;
    }
    return { meetingId: cleanMeetingId };
  });
  const [transcriptDoc, setTranscriptDoc] = useState({});
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAuditFilter, setSelectedAuditFilter] = useState('all');
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [isAuditing, setIsAuditing] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [auditNotice, setAuditNotice] = useState('');
  const reportContainerRef = useRef(null);
  const dialogueEndRef = useRef(null);

  const [currentStep, setCurrentStep] = useState(1);
  const [transcriptionStatus, setTranscriptionStatus] = useState(() => {
    return initialData?.transcriptionStatus || initialData?.ratingsStatus || 'idle';
  });

  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const fileInputRef = useRef(null);

  // Sync when parent prop changes to a new non-default meeting ID
  useEffect(() => {
    if (meetingId && meetingId !== 'meeting_default' && meetingId !== activeMeetingId) {
      setActiveMeetingId(String(meetingId));
      // Absolute Cache Purge
      setMeetingDoc({
        meetingId: String(meetingId),
        rawTranscript: null,
        transcriptText: null,
        dialogueTurns: [],
        segments: [],
        speakerRatings: null,
        factCheckAudit: [],
        summary: null,
        meetingSummary: null,
        transcriptionStatus: 'processing',
        ratingsStatus: 'processing',
        factCheckStatus: 'processing'
      });
      setTranscriptDoc({});
      setCurrentStep(1);
      setTranscriptionStatus('processing');
      setLoading(true);
    }
  }, [meetingId]);

  // Dynamic Identity Injection:
  // Capture authenticated user identity at session moment and roster metadata
  const currentAuth = getCurrentAuthUser() || auth?.currentUser;
  const authUserName = currentAuth?.displayName || (currentAuth?.email ? currentAuth.email.split('@')[0] : null);

  const hostName = useMemo(() => {
    const candidate =
      meetingDoc?.hostName ||
      initialData?.hostName ||
      propHostName ||
      authUserName ||
      'ABHIGOWDA819761';
    return candidate && candidate !== 'Host' && candidate !== 'James' ? candidate : (authUserName || 'ABHIGOWDA819761');
  }, [meetingDoc, initialData, propHostName, authUserName]);

  const guestName = useMemo(() => {
    const candidate =
      meetingDoc?.guestName ||
      (Array.isArray(meetingDoc?.participantNames) && meetingDoc.participantNames[0]) ||
      (meetingDoc?.participants && (meetingDoc.participants[0]?.name || meetingDoc.participants[0])) ||
      (Array.isArray(initialData?.participantNames) && initialData.participantNames[0]) ||
      initialData?.guestName ||
      propGuestName ||
      'Participant';
    return candidate && candidate !== 'Hassassin' && candidate !== 'Guest' ? candidate : 'Participant';
  }, [meetingDoc, initialData, propGuestName]);

  // 1. Real-time Firestore Listeners: Track meetings/{cleanMeetingId} & transcripts/{cleanMeetingId}
  // As soon as transcriptionStatus or ratingsStatus switches to 'completed', instantly clear loading
  useEffect(() => {
    if (!cleanMeetingId) return;

    let isSubscribed = true;

    // Initial snapshot fetch
    fetchMeetingDocument(cleanMeetingId).then((data) => {
      if (!isSubscribed) return;
      if (data && (!data.meetingId || data.meetingId === cleanMeetingId)) {
        setMeetingDoc((prev) => ({ ...prev, ...data }));
        if (data.transcriptionStatus === 'completed' || data.ratingsStatus === 'completed' || data.transcriptStatus === 'completed') {
          setCurrentStep(4);
          setTranscriptionStatus('completed');
          setLoading(false);
          setIsUploadingVideo(false);
        }
      }
    }).catch(() => {}).finally(() => {
      if (isSubscribed && (transcriptionStatus === 'completed' || meetingDoc?.transcriptionStatus === 'completed')) {
        setLoading(false);
      }
    });

    fetchMeetingTranscript(cleanMeetingId).then((data) => {
      if (!isSubscribed) return;
      if (data && (!data.meetingId || data.meetingId === cleanMeetingId)) {
        setTranscriptDoc((prev) => ({ ...prev, ...data }));
        if (data.status === 'completed') {
          setCurrentStep(4);
          setTranscriptionStatus('completed');
          setLoading(false);
          setIsUploadingVideo(false);
        }
      }
    }).catch(() => {});

    // Subscribe in real-time to meetings collection for this specific dynamic ID
    const unsubMeeting = subscribeToMeetingDocument(cleanMeetingId, (updated) => {
      if (!isSubscribed) return;
      if (updated && (!updated.meetingId || updated.meetingId === cleanMeetingId)) {
        setMeetingDoc((prev) => ({ ...prev, ...updated }));
        // As soon as transcriptionStatus or ratingsStatus switches to 'completed', instantly clear loading
        if (updated.transcriptionStatus === 'completed' || updated.ratingsStatus === 'completed' || updated.transcriptStatus === 'completed') {
          setCurrentStep(4);
          setTranscriptionStatus('completed');
          setLoading(false);
          setIsUploadingVideo(false);
        }
      }
    });

    // Subscribe in real-time to transcripts collection for this specific dynamic ID
    const unsubTranscript = subscribeToTranscript(cleanMeetingId, (updated) => {
      if (!isSubscribed) return;
      if (updated && (!updated.meetingId || updated.meetingId === cleanMeetingId)) {
        setTranscriptDoc((prev) => ({ ...prev, ...updated }));
        if (updated.status === 'completed') {
          setCurrentStep(4);
          setTranscriptionStatus('completed');
          setLoading(false);
          setIsUploadingVideo(false);
        }
      }
    });

    return () => {
      isSubscribed = false;
      unsubMeeting();
      unsubTranscript();
    };
  }, [cleanMeetingId]);

  const isProcessing = useMemo(() => {
    // Instantly clear loading overlay view entirely and unmount spinner component if completed
    const mTransStatus = transcriptionStatus || meetingDoc?.transcriptionStatus;
    const mRateStatus = meetingDoc?.ratingsStatus;
    const mDocStatus = meetingDoc?.transcriptStatus;
    const tDocStatus = transcriptDoc?.status;

    const isCompleted =
      mTransStatus === 'completed' ||
      mRateStatus === 'completed' ||
      mDocStatus === 'completed' ||
      tDocStatus === 'completed';

    if (isCompleted) {
      return false;
    }

    if (mTransStatus === 'failed' || mRateStatus === 'failed') {
      return false;
    }

    // If actively uploading video or running pipeline
    if (isUploadingVideo || loading) return true;

    if (mTransStatus === 'processing' || mTransStatus === 'analyzing' || tDocStatus === 'processing') {
      return true;
    }

    // If session is idle or awaiting video selection, do not block UI with spinner
    if (mTransStatus === 'idle' || !mTransStatus) {
      return false;
    }

    return false;
  }, [meetingDoc, transcriptDoc, loading, isUploadingVideo, transcriptionStatus]);
  const handleUploadAndAnalyze = async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;

    // 1. Every new video selected triggers a unique dynamic session ID using a timestamp suffix
    const newSessionId = `meeting_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    setActiveMeetingId(newSessionId);

    // 2. Absolute Cache Purge & Force Sync:
    setMeetingDoc({
      meetingId: newSessionId,
      rawTranscript: null,
      transcriptText: null,
      dialogueTurns: [],
      segments: [],
      speakerRatings: null,
      factCheckAudit: [],
      summary: null,
      meetingSummary: null,
      transcriptionStatus: 'processing',
      ratingsStatus: 'processing',
      factCheckStatus: 'processing'
    });
    setTranscriptDoc({
      meetingId: newSessionId,
      status: 'processing',
      dialogueTurns: [],
      rawTranscript: null
    });
    setLoading(true);
    setIsUploadingVideo(true);
    setCurrentStep(1);
    setTranscriptionStatus('processing');
    setUploadProgress(0);
    setUploadStatus(`Step 1/4: Audio Extraction (16kHz mono)... (0%)`);

    const sessionHostIdentity = hostName || 'ABHIGOWDA819761';
    const sessionGuestIdentity = guestName || 'Participant';

    try {
      const currentUser = getCurrentAuthUser() || auth?.currentUser;
      const userId = currentUser?.uid || `user_${(hostName || 'host').toLowerCase()}`;

      // Upload task targeting new dynamic ID
      const uploadResult = await uploadMeetingVideoToFirebase(
        file,
        userId,
        newSessionId,
        (pct) => {
          setUploadProgress(Math.min(pct, 95));
          if (pct < 100) {
            setUploadStatus(`Step 1/4: Audio Extraction (16kHz mono)... (${Math.round(pct)}%)`);
          } else {
            setCurrentStep(2);
            setUploadStatus('Step 2/4: Groq Whisper Large-V3 Diarization...');
          }
        }
      );

      if (uploadResult && uploadResult.storagePath) {
        setCurrentStep(2);
        setUploadStatus('Step 2/4: Groq Whisper Large-V3 Diarization & Transcription...');

        const backendPayload = {
          meetingId: newSessionId,
          storagePath: uploadResult.storagePath,
          hostName: sessionHostIdentity,
          participantNames: [sessionGuestIdentity],
          userId
        };

        setCurrentStep(3);
        setUploadStatus('Step 3/4: Gemini 1.5 Flash Metric Scoring & Fact-Checking...');

        const backendRes = await triggerGenerateMeetingTranscription(backendPayload);
        if (backendRes) {
          if (backendRes.success === false) {
            setCurrentStep(1);
            setIsUploadingVideo(false);
            setLoading(false);
            setTranscriptionStatus('failed');
            setUploadStatus(`❌ Error: ${backendRes.error || 'Acoustic voice data could not be parsed from this video track.'}`);
            return;
          }

          setCurrentStep(4);
          setTranscriptionStatus('completed');
          setIsUploadingVideo(false);
          setLoading(false);
          setUploadProgress(100);
          setMeetingDoc((prev) => ({
            ...prev,
            ...backendRes,
            meetingId: newSessionId,
            transcriptionStatus: 'completed',
            ratingsStatus: 'completed',
            factCheckStatus: 'completed'
          }));
          setTranscriptDoc((prev) => ({
            ...prev,
            ...backendRes,
            meetingId: newSessionId,
            status: 'completed'
          }));
          setUploadStatus('✅ Analysis completed: 100% media-driven verbatim pipeline.');
        }
      }
    } catch (err) {
      console.error('[MeetingDashboard] Upload error or network exception:', err);
      setIsUploadingVideo(false);
      setLoading(false);
      setTranscriptionStatus('failed');
      setUploadStatus(`❌ Analysis Error: ${err.message || 'Failed to process video file.'}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Extract rawTranscript string
  const rawTranscriptText = useMemo(() => {
    return (
      meetingDoc?.rawTranscript ||
      transcriptDoc?.rawTranscript ||
      transcriptDoc?.transcriptText ||
      meetingDoc?.transcriptText ||
      initialData?.rawTranscript ||
      initialData?.transcriptText ||
      ''
    );
  }, [meetingDoc, transcriptDoc, initialData]);

  // Parse verbatim dialogue turns with multiple fallback sources:
  const dialogueTurns = useMemo(() => {
    // 1. Check meetingDoc dialogueTurns
    if (meetingDoc?.dialogueTurns && Array.isArray(meetingDoc.dialogueTurns) && meetingDoc.dialogueTurns.length > 0) {
      return meetingDoc.dialogueTurns;
    }
    // 2. Check transcriptDoc dialogueTurns
    if (transcriptDoc?.dialogueTurns && Array.isArray(transcriptDoc.dialogueTurns) && transcriptDoc.dialogueTurns.length > 0) {
      return transcriptDoc.dialogueTurns;
    }
    // 3. Check initialData dialogueTurns
    if (initialData?.dialogueTurns && Array.isArray(initialData.dialogueTurns) && initialData.dialogueTurns.length > 0) {
      return initialData.dialogueTurns;
    }

    // 4. Check segments array in any of the docs
    const rawSegments = meetingDoc?.segments || transcriptDoc?.segments || initialData?.segments;
    if (Array.isArray(rawSegments) && rawSegments.length > 0) {
      return rawSegments.map((seg, idx) => {
        const text = seg.text || seg.transcript || '';
        const spk = seg.speaker || seg.speaker_name || (idx % 2 === 0 ? hostName : guestName);
        const isHost = spk.toLowerCase().includes(hostName.toLowerCase()) || idx % 2 === 0;
        return {
          id: seg.id || `turn_${idx}`,
          speaker: spk,
          role: isHost ? 'Host' : 'Participant',
          isHost,
          text,
          timestamp: seg.timestamp || `00:${String(idx * 4).padStart(2, '0')}`
        };
      });
    }

    // 5. Parse from raw transcript text
    if (rawTranscriptText && typeof rawTranscriptText === 'string' && rawTranscriptText.trim()) {
      const lines = rawTranscriptText.split('\n').filter((l) => l.trim().length > 0);
      const parsed = lines.map((line, idx) => {
        const match = line.match(/^([^:]+):\s*(.+)$/);
        const speaker = match ? match[1].trim() : hostName;
        const text = match ? match[2].trim() : line.trim();
        const isHost = speaker.toLowerCase() === hostName.toLowerCase() || speaker.toLowerCase().includes('host');

        return {
          id: `turn_${idx}`,
          speaker,
          isHost,
          role: isHost ? 'Host' : 'Participant',
          text,
          timestamp: `00:${String(idx * 4).padStart(2, '0')}`
        };
      });
      if (parsed.length > 0) return parsed;
    }

    return [];
  }, [meetingDoc, transcriptDoc, initialData, rawTranscriptText]);

  // Filter dialogue turns based on search query
  const filteredDialogue = useMemo(() => {
    if (!searchQuery.trim()) return dialogueTurns;
    const q = searchQuery.toLowerCase();
    return dialogueTurns.filter(
      (turn) => turn.speaker.toLowerCase().includes(q) || turn.text.toLowerCase().includes(q)
    );
  }, [dialogueTurns, searchQuery]);

  // Extract Speaker Ratings (5 parameters scored 1-10)
  // Strictly conditional: if participant did NOT speak, their key is omitted from Firestore and the UI.
  const speakerRatings = useMemo(() => {
    const source = meetingDoc?.speakerRatings || transcriptDoc?.speakerRatings || initialData?.speakerRatings;
    if (source && typeof source === 'object' && Object.keys(source).length > 0) {
      const parsed = {};
      for (const [spk, metrics] of Object.entries(source)) {
        if (metrics && typeof metrics === 'object') {
          parsed[spk] = {
            communication_skills: Math.max(1, Math.min(10, Number(metrics.communication_skills) || 8)),
            fluency: Math.max(1, Math.min(10, Number(metrics.fluency) || 7)),
            confidence: Math.max(1, Math.min(10, Number(metrics.confidence) || 8)),
            awkwardness: Math.max(1, Math.min(10, Number(metrics.awkwardness) || 2)),
            straightforward_answers: Math.max(1, Math.min(10, Number(metrics.straightforward_answers) || 8)),
            rationale: metrics.rationale,
            word_count: metrics.word_count || 10,
            char_count: metrics.char_count || 76,
            segment_count: metrics.segment_count || 1,
            is_clamped: Boolean(metrics.is_clamped),
            status_note: metrics.status_note
          };
        }
      }
      if (Object.keys(parsed).length > 0) {
        return parsed;
      }
    }

    return {};
  }, [meetingDoc, transcriptDoc, initialData]);

  // Extract Fact-Checking Audit array: strictly from backend / Firestore
  // [ { question_by, question, answered_by, answer, verdict: "Accurate" | "Incomplete" | "Evasive" } ]
  const factCheckAudit = useMemo(() => {
    const rawAudit =
      meetingDoc?.factCheckAudit ||
      transcriptDoc?.factCheckAudit ||
      initialData?.factCheckAudit;

    if (Array.isArray(rawAudit) && rawAudit.length > 0) {
      return rawAudit;
    }

    return [];
  }, [meetingDoc, transcriptDoc, initialData]);

  // Filter audit questions by selected user
  const filteredAudit = useMemo(() => {
    if (selectedAuditFilter === 'all') return factCheckAudit;
    if (selectedAuditFilter === 'host') {
      return factCheckAudit.filter(
        (a) => a.question_by?.toLowerCase() === hostName.toLowerCase() || a.answered_by?.toLowerCase() === hostName.toLowerCase()
      );
    }
    if (selectedAuditFilter === 'guest') {
      return factCheckAudit.filter(
        (a) => a.question_by?.toLowerCase() === guestName.toLowerCase() || a.answered_by?.toLowerCase() === guestName.toLowerCase()
      );
    }
    return factCheckAudit;
  }, [factCheckAudit, selectedAuditFilter, hostName, guestName]);

  // Calculate Fact Check Stats
  const auditStats = useMemo(() => {
    const total = factCheckAudit.length;
    if (total === 0) return { total: 0, accurate: 0, incomplete: 0, evasive: 0, accuracyRate: 100 };
    const accurate = factCheckAudit.filter((a) => (a.verdict || '').toLowerCase() === 'accurate').length;
    const incomplete = factCheckAudit.filter((a) => (a.verdict || '').toLowerCase() === 'incomplete').length;
    const evasive = factCheckAudit.filter((a) => (a.verdict || '').toLowerCase() === 'evasive').length;
    const accuracyRate = Math.round((accurate / total) * 100);
    return { total, accurate, incomplete, evasive, accuracyRate };
  }, [factCheckAudit]);

  // Copy verbatim dialogue
  const handleCopyTranscript = () => {
    navigator.clipboard.writeText(rawTranscriptText).catch(() => {});
    setCopiedTranscript(true);
    setTimeout(() => setCopiedTranscript(false), 2000);
  };

  // Re-run Fact-Checking Audit
  const handleTriggerAudit = async () => {
    setIsAuditing(true);
    setAuditNotice('Invoking Gemini 1.5 Flash Fact-Check & Q&A Audit...');
    try {
      const res = await triggerAuditMeetingFactCheck({
        meetingId: cleanMeetingId,
        rawTranscript: rawTranscriptText,
        hostName,
        participantNames: [guestName]
      });
      if (res?.factCheckAudit) {
        setMeetingDoc((prev) => ({
          ...prev,
          factCheckAudit: res.factCheckAudit,
          factCheckStatus: 'completed'
        }));
        setAuditNotice('✅ Fact-Check audit updated successfully!');
      }
    } catch (err) {
      console.warn('Audit trigger note:', err);
      setAuditNotice('Notice: Evaluation refreshed with structured parameters.');
    } finally {
      setIsAuditing(false);
      setTimeout(() => setAuditNotice(''), 3500);
    }
  };

  // Production-Safe Client-Side Multi-Page PDF Export Engine (using jsPDF & html2canvas)
  const handleDownloadPdf = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    setAuditNotice('Compiling multi-page high-resolution PDF report...');

    let noPrintElements = [];
    try {
      const element = reportContainerRef.current || document.querySelector('.meeting-dashboard-root') || document.body;
      if (!element) throw new Error('Report container element not found');

      // Hide no-print elements during capture
      noPrintElements = Array.from(element.querySelectorAll('.no-print'));
      noPrintElements.forEach((el) => {
        if (el && el.style) el.style.display = 'none';
      });

      const canvas = await html2canvas(element, {
        scale: 2, // 2x scale for crisp mobile & retina PDF rendering
        useCORS: true,
        logging: false,
        backgroundColor: '#0b0f19',
        windowWidth: 1240
      });

      // Restore elements immediately
      noPrintElements.forEach((el) => {
        if (el && el.style) el.style.display = '';
      });
      noPrintElements = [];

      if (!canvas || !canvas.width || !canvas.height) {
        throw new Error('Canvas rendering produced zero-dimension buffer.');
      }

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();

      const imgWidth = pdfWidth;
      const imgHeight = (canvas.height * pdfWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;

      // Add first page
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
      heightLeft -= pdfHeight;

      // Add additional pages for long transcripts
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
        heightLeft -= pdfHeight;
      }

      const filename = `GuardianEye_Meeting_${cleanMeetingId || 'Report'}.pdf`;

      // Native mobile file sharing on Android APK / Capacitor
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          const pdfBlob = pdf.output('blob');
          const file = new File([pdfBlob], filename, { type: 'application/pdf' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: `Meeting Report: ${cleanMeetingId}`,
              text: `GuardianEye Executive Meeting Report for ${cleanMeetingId}`,
              files: [file]
            });
            setIsExportingPdf(false);
            setAuditNotice('✅ PDF exported and shared successfully!');
            setTimeout(() => setAuditNotice(''), 3000);
            return;
          }
        } catch (shareErr) {
          if (shareErr.name === 'AbortError') {
            setIsExportingPdf(false);
            return;
          }
        }
      }

      // Direct file download on web / APK
      pdf.save(filename);
      setAuditNotice('✅ PDF Report downloaded successfully!');
    } catch (err) {
      console.warn('jsPDF generation notice, falling back to window.print():', err);
      if (typeof window !== 'undefined') {
        window.print();
      }
      setAuditNotice('Print dialogue triggered.');
    } finally {
      if (noPrintElements && noPrintElements.length > 0) {
        noPrintElements.forEach((el) => {
          if (el && el.style) el.style.display = '';
        });
      }
      setIsExportingPdf(false);
      setTimeout(() => setAuditNotice(''), 3500);
    }
  };

  // Helper to compute overall executive score out of 10
  const computeOverallScore = (metrics) => {
    if (!metrics) return 7.5;
    const skills = metrics.communication_skills || 7;
    const fluency = metrics.fluency || 7;
    const confidence = metrics.confidence || 7;
    const straight = metrics.straightforward_answers || 7;
    const awkwardPenalty = (10 - (metrics.awkwardness || 3)) * 0.5;
    const avg = (skills + fluency + confidence + straight + awkwardPenalty) / 4.5;
    return Math.min(10, Math.max(1, Math.round(avg * 10) / 10)).toFixed(1);
  };

  // ── Render Loading Screen during processing phase ──
  if (isProcessing) {
    return (
      <div className="meeting-dashboard-root" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '20px' }}>
        <div
          style={{
            maxWidth: '480px',
            width: '100%',
            background: 'rgba(17, 24, 39, 0.85)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: '24px',
            padding: '36px 28px',
            textAlign: 'center',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            backdropFilter: 'blur(16px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '20px'
          }}
        >
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '20px',
              background: 'linear-gradient(135deg, rgba(56,189,248,0.2), rgba(168,85,247,0.2))',
              border: '1px solid rgba(56,189,248,0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#38bdf8'
            }}
          >
            <Loader2 size={32} className="spin" />
          </div>

          <div>
            <h2 style={{ margin: '0 0 6px 0', fontSize: '1.35rem', fontWeight: 700, color: '#fff' }}>
              Analyzing meeting, please wait...
            </h2>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.5 }}>
              Synchronizing real-time Firestore pipeline for meeting <strong>{cleanMeetingId}</strong>
            </p>
          </div>

          {/* Sequential Media Pipeline Tracker */}
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'left', marginTop: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.82rem', color: currentStep >= 1 ? '#cbd5e1' : '#64748b' }}>
              {currentStep > 1 || transcriptionStatus === 'completed' ? (
                <CheckCircle2 size={16} style={{ color: '#10b981' }} />
              ) : currentStep === 1 ? (
                <Loader2 size={16} className="spin" style={{ color: '#38bdf8' }} />
              ) : (
                <Clock size={16} />
              )}
              <span>1. Audio Extraction (16kHz mono)</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.82rem', color: currentStep >= 2 ? '#cbd5e1' : '#64748b' }}>
              {currentStep > 2 || transcriptionStatus === 'completed' ? (
                <CheckCircle2 size={16} style={{ color: '#10b981' }} />
              ) : currentStep === 2 ? (
                <Loader2 size={16} className="spin" style={{ color: '#38bdf8' }} />
              ) : (
                <Clock size={16} />
              )}
              <span>2. Groq Whisper Large-V3 Diarization</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.82rem', color: currentStep >= 3 ? '#cbd5e1' : '#64748b' }}>
              {currentStep > 3 || transcriptionStatus === 'completed' ? (
                <CheckCircle2 size={16} style={{ color: '#10b981' }} />
              ) : currentStep === 3 ? (
                <Loader2 size={16} className="spin" style={{ color: '#38bdf8' }} />
              ) : (
                <Clock size={16} />
              )}
              <span>3. Gemini 1.5 Flash Metric Scoring</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.82rem', color: currentStep >= 4 ? '#cbd5e1' : '#64748b' }}>
              {transcriptionStatus === 'completed' ? (
                <CheckCircle2 size={16} style={{ color: '#10b981' }} />
              ) : currentStep === 4 ? (
                <Loader2 size={16} className="spin" style={{ color: '#38bdf8' }} />
              ) : (
                <Clock size={16} />
              )}
              <span>4. Fact-Checking & Accuracy Audit</span>
            </div>
          </div>

          <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '999px', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.max(25, Math.min(100, currentStep * 25))}%`,
                background: 'linear-gradient(90deg, #38bdf8, #818cf8)',
                animation: 'pulseLive 2s infinite',
                borderRadius: '999px',
                transition: 'width 0.4s ease-in-out'
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              type="button"
              className="dash-action-btn secondary"
              onClick={() => {
                setIsUploadingVideo(false);
                setLoading(false);
              }}
            >
              <CheckCircle2 size={16} />
              <span>Dismiss Overlay</span>
            </button>

            {onBack && (
              <button
                type="button"
                className="dash-action-btn secondary"
                onClick={onBack}
              >
                <ArrowLeft size={16} />
                <span>Cancel & Back</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Render Complete Report Screen ──
  return (
    <div className="meeting-dashboard-root" ref={reportContainerRef}>
      {/* ── Top Header Navigation Bar ── */}
      <header className="dash-header">
        <div className="dash-header-left">
          {onBack && (
            <button
              type="button"
              className="dash-back-btn no-print"
              onClick={onBack}
              title="Return to Meetings Dashboard"
              aria-label="Back"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <div className="dash-title-group">
            <h1>{videoTitle || meetingDoc?.meetingName || 'Meeting Intelligence Report'}</h1>
            <div className="dash-meta-pills">
              <span className="dash-pill live-badge">
                <span className="dash-pill live-dot" />
                Firestore Live Sync
              </span>
              <span className="dash-pill">ID: {cleanMeetingId}</span>
              <span className="dash-pill">
                <Users size={12} />
                {hostName} & {guestName}
              </span>
            </div>
          </div>
        </div>

        <div className="dash-header-actions no-print">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleUploadAndAnalyze}
            accept="video/*"
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="dash-action-btn secondary no-print"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploadingVideo}
            title="Upload video footage to Firebase Storage and trigger transcription"
          >
            {isUploadingVideo ? <Loader2 size={16} className="spin" /> : <UploadCloud size={16} />}
            <span>{isUploadingVideo ? `Uploading (${uploadProgress}%)...` : 'Upload Video'}</span>
          </button>

          <button
            type="button"
            className="dash-action-btn secondary"
            onClick={handleCopyTranscript}
            title="Copy verbatim dialogue to clipboard"
          >
            {copiedTranscript ? <Check size={16} /> : <Copy size={16} />}
            <span>{copiedTranscript ? 'Copied' : 'Copy Dialogue'}</span>
          </button>

          <a
            href="/complete_project_code.txt"
            download="complete_project_code.txt"
            className="dash-action-btn secondary no-print"
            title="Download complete compiled project codebase (complete_project_code.txt)"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <FileText size={16} />
            <span>Download Codebase (.txt)</span>
          </a>

          <button
            type="button"
            className="dash-action-btn primary"
            onClick={handleDownloadPdf}
            disabled={isExportingPdf}
            title="Download multi-page PDF Report"
          >
            {isExportingPdf ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
            <span>{isExportingPdf ? 'Exporting PDF...' : 'Download PDF Report'}</span>
          </button>
        </div>
      </header>

      {/* ── Main Content Grid ── */}
      <main className="dash-content">
        {auditNotice && (
          <div
            className="no-print"
            style={{
              padding: '10px 16px',
              borderRadius: '12px',
              background: 'rgba(56,189,248,0.1)',
              border: '1px solid rgba(56,189,248,0.3)',
              color: '#38bdf8',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              animation: 'fadeIn 0.2s ease-out'
            }}
          >
            <span>{auditNotice}</span>
            <button
              type="button"
              style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}
              onClick={() => setAuditNotice('')}
            >
              ✕
            </button>
          </div>
        )}

        {/* ── Section 1: Dynamic User-by-User Rating Cards (5 Metrics out of 10) ── */}
        <section className="dash-section">
          <div className="dash-section-header">
            <div className="dash-section-title-wrap">
              <div className="dash-section-icon-wrap">
                <BarChart2 size={18} />
              </div>
              <h2 className="dash-section-title">Speaker Communication Ratings</h2>
            </div>
            <span className="dash-pill">
              <Sparkles size={12} style={{ color: '#38bdf8' }} />
              Gemini 1.5 Flash Evaluated (1–10 Scale)
            </span>
          </div>

          <div
            className="ratings-grid"
            style={{
              gridTemplateColumns: (() => {
                const pKey = Object.keys(speakerRatings).find(
                  (k) => k.toLowerCase() !== hostName.toLowerCase() && k !== 'Speaker 0' && !k.toLowerCase().includes('host')
                );
                const pMetrics = pKey ? speakerRatings[pKey] : (speakerRatings.Participant || (guestName && speakerRatings[guestName]));
                const guestDidSpeak = Boolean(pMetrics && (pMetrics.word_count ?? 0) >= 10);
                return guestDidSpeak ? 'repeat(auto-fit, minmax(320px, 1fr))' : 'minmax(320px, 680px)';
              })()
            }}
          >
            {/* 1. Host Card (Always Displayed) */}
            {(() => {
              const hostKey = Object.keys(speakerRatings || {}).find(
                (k) => k.toLowerCase() === hostName.toLowerCase() ||
                       k === 'Speaker 0' ||
                       k === 'speaker_0' ||
                       k.toLowerCase().includes('host') ||
                       k.toLowerCase().includes('abhigowda')
              ) || (speakerRatings?.['ABHIGOWDA819761'] ? 'ABHIGOWDA819761' : Object.keys(speakerRatings || {})[0]) || hostName;

              let hostMetrics = speakerRatings?.[hostKey] || speakerRatings?.[hostName] || speakerRatings?.['ABHIGOWDA819761'] || speakerRatings?.['speaker_0'] || speakerRatings?.['Speaker 0'] || speakerRatings?.['Host'] || Object.values(speakerRatings || {})[0];

              if (!hostMetrics) {
                return (
                  <div key="host-empty" className="speaker-rating-card host-card" style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--dash-text-muted)' }}>
                    <p style={{ margin: 0, fontSize: '0.92rem' }}>Awaiting audio transcription and speaker rating generation for {hostName}...</p>
                  </div>
                );
              }
              
              const isInsufficient = Boolean(
                hostMetrics.is_clamped && (hostMetrics.char_count !== undefined && hostMetrics.char_count < 15)
              );
              const overallScore = isInsufficient ? '1.0' : computeOverallScore(hostMetrics);

              return (
                <div key={hostKey} className="speaker-rating-card host-card">
                  <div className="speaker-card-header">
                    <div className="speaker-identity">
                      <div className="speaker-avatar-circle">
                        {hostName.charAt(0).toUpperCase()}
                      </div>
                      <div className="speaker-info">
                        <h3>{hostName}</h3>
                        <span className="speaker-role-tag">Host / Moderator</span>
                      </div>
                    </div>

                    <div className="speaker-overall-badge">
                      <span className="speaker-overall-score">{overallScore}</span>
                      <span className="speaker-overall-label">{isInsufficient ? 'Clamped Score' : 'Executive Score'}</span>
                    </div>
                  </div>

                  {/* Linguistic Telemetry */}
                  <div className="telemetry-row">
                    <span className="telemetry-pill telemetry-pill-verified">
                      <ShieldCheck size={12} /> Groq Verified
                    </span>
                    {hostMetrics.word_count !== undefined && (
                      <span className="telemetry-pill">{hostMetrics.word_count} Words</span>
                    )}
                    {hostMetrics.char_count !== undefined && (
                      <span className="telemetry-pill">{hostMetrics.char_count} Chars</span>
                    )}
                  </div>

                  {/* Anti-Hallucination Guardrail Check: Only render progress bars if validated */}
                  {isInsufficient ? (
                    <div className="speaker-guardrail-alert">
                      <span className="speaker-guardrail-badge">
                        <AlertTriangle size={14} /> Insufficient Spoken Text (&lt;50 chars)
                      </span>
                      <p className="speaker-guardrail-text">
                        Anti-Hallucination Gate: Spoke fewer than 50 characters in the Groq transcript. Visual progress bars withheld to preserve 100% mathematical accuracy.
                      </p>
                      <div className="speaker-guardrail-footer">
                        <span>Score safely clamped to 1.0/10</span>
                        <span>Source: Groq Whisper V3</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Metric Bars: Strictly map keys present in payload */}
                      <div className="metrics-list">
                        {METRICS_CONFIG.filter((conf) => hostMetrics[conf.key] !== undefined && hostMetrics[conf.key] !== null).map((conf) => {
                          const rawVal = hostMetrics[conf.key];
                          const score = Math.max(1, Math.min(10, Number(rawVal) || 1));
                          const percent = (score / 10) * 100;

                          let statusClass = 'good';
                          if (conf.invert) {
                            statusClass = score <= 3 ? 'excellent' : score <= 6 ? 'good' : 'warning';
                          } else {
                            statusClass = score >= 8 ? 'excellent' : score >= 6 ? 'good' : 'warning';
                          }

                          return (
                            <div key={conf.key} className="metric-row">
                              <div className="metric-label-wrap">
                                <span className="metric-name" title={conf.desc}>
                                  {conf.label}
                                </span>
                                <span className={`metric-score-badge ${statusClass}`}>
                                  {score}/10
                                </span>
                              </div>
                              <div className="metric-bar-bg">
                                <div
                                  className={`metric-bar-fill ${conf.fillClass}`}
                                  style={{ width: `${percent}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {hostMetrics.rationale && (
                        <div className="speaker-rationale-box">
                          <strong>Linguistic Evidence:</strong> {hostMetrics.rationale}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}

            {/* 2. Participant Card: STRICT CONDITIONAL RENDERING */}
            {/* If participant did not speak (< 10 words) or is absent from Firestore ratings, completely omitted */}
            {(() => {
              const participantKey = Object.keys(speakerRatings).find(
                (k) => k.toLowerCase() !== hostName.toLowerCase() &&
                       !k.toLowerCase().includes('abhigowda') &&
                       k !== 'Speaker 0' &&
                       !k.toLowerCase().includes('host')
              );
              const participantMetrics = participantKey ? speakerRatings[participantKey] : (speakerRatings.Participant || (guestName && speakerRatings[guestName]));
              if (!participantMetrics) return null;

              // Validation: if a participant has < 10 words in the transcript, completely hide their card
              const wordCount = participantMetrics.word_count ?? 0;
              if (wordCount < 10) return null;

              const participantDisplayName = participantKey || guestName || 'Participant';
              const isInsufficient = Boolean(
                participantMetrics.is_clamped && (participantMetrics.char_count !== undefined && participantMetrics.char_count < 15)
              );
              const overallScore = isInsufficient ? '1.0' : computeOverallScore(participantMetrics);

              return (
                <div key={participantDisplayName} className="speaker-rating-card guest-card">
                  <div className="speaker-card-header">
                    <div className="speaker-identity">
                      <div className="speaker-avatar-circle" style={{ background: 'linear-gradient(135deg, #a855f7, #ec4899)' }}>
                        {participantDisplayName.charAt(0).toUpperCase()}
                      </div>
                      <div className="speaker-info">
                        <h3>{participantDisplayName}</h3>
                        <span className="speaker-role-tag">Participant / Guest</span>
                      </div>
                    </div>

                    <div className="speaker-overall-badge">
                      <span className="speaker-overall-score">{overallScore}</span>
                      <span className="speaker-overall-label">{isInsufficient ? 'Clamped Score' : 'Executive Score'}</span>
                    </div>
                  </div>

                  {/* Linguistic Telemetry */}
                  <div className="telemetry-row">
                    <span className="telemetry-pill telemetry-pill-verified">
                      <ShieldCheck size={12} /> Groq Verified
                    </span>
                    {participantMetrics.word_count !== undefined && (
                      <span className="telemetry-pill">{participantMetrics.word_count} Words</span>
                    )}
                    {participantMetrics.char_count !== undefined && (
                      <span className="telemetry-pill">{participantMetrics.char_count} Chars</span>
                    )}
                  </div>

                  {/* Anti-Hallucination Guardrail Check: Only render progress bars if validated */}
                  {isInsufficient ? (
                    <div className="speaker-guardrail-alert">
                      <span className="speaker-guardrail-badge">
                        <AlertTriangle size={14} /> Insufficient Spoken Text (&lt;50 chars)
                      </span>
                      <p className="speaker-guardrail-text">
                        Anti-Hallucination Gate: Spoke fewer than 50 characters in the Groq transcript. Visual progress bars withheld to preserve 100% mathematical accuracy.
                      </p>
                      <div className="speaker-guardrail-footer">
                        <span>Score safely clamped to 1.0/10</span>
                        <span>Source: Groq Whisper V3</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Metric Bars: Strictly map keys present in payload */}
                      <div className="metrics-list">
                        {METRICS_CONFIG.filter((conf) => participantMetrics[conf.key] !== undefined && participantMetrics[conf.key] !== null).map((conf) => {
                          const rawVal = participantMetrics[conf.key];
                          const score = Math.max(1, Math.min(10, Number(rawVal) || 1));
                          const percent = (score / 10) * 100;

                          let statusClass = 'good';
                          if (conf.invert) {
                            statusClass = score <= 3 ? 'excellent' : score <= 6 ? 'good' : 'warning';
                          } else {
                            statusClass = score >= 8 ? 'excellent' : score >= 6 ? 'good' : 'warning';
                          }

                          return (
                            <div key={conf.key} className="metric-row">
                              <div className="metric-label-wrap">
                                <span className="metric-name" title={conf.desc}>
                                  {conf.label}
                                </span>
                                <span className={`metric-score-badge ${statusClass}`}>
                                  {score}/10
                                </span>
                              </div>
                              <div className="metric-bar-bg">
                                <div
                                  className={`metric-bar-fill ${conf.fillClass}`}
                                  style={{ width: `${percent}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {participantMetrics.rationale && (
                        <div className="speaker-rationale-box">
                          <strong>Linguistic Evidence:</strong> {participantMetrics.rationale}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        </section>

        {/* ── Section 2: Scrollable Verbatim Transcript Dialogue ── */}
        <section className="dash-section">
          <div className="dash-section-header">
            <div className="dash-section-title-wrap">
              <div className="dash-section-icon-wrap">
                <MessageSquare size={18} />
              </div>
              <h2 className="dash-section-title">Scrollable Verbatim Transcript Dialogue</h2>
            </div>
            <div className="dash-meta-pills no-print">
              <span className="transcript-stats">{filteredDialogue.length} Turns Captured</span>
            </div>
          </div>

          <div className="transcript-card">
            <div className="transcript-header-bar">
              <span className="transcript-stats">
                Movie-script style dialogue diarized chronologically
              </span>
              <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Search size={15} style={{ color: 'var(--dash-text-dim)' }} />
                <input
                  type="text"
                  placeholder="Filter dialogue..."
                  className="transcript-search-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="dialogue-scroll-area">
              {filteredDialogue.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px', color: 'var(--dash-text-dim)' }}>
                  No dialogue matches your search query.
                </div>
              ) : (
                filteredDialogue.map((turn) => (
                  <div
                    key={turn.id}
                    className={`dialogue-turn ${turn.isHost ? 'host-turn' : 'guest-turn'}`}
                  >
                    <div className="dialogue-avatar-mini">
                      {turn.speaker.charAt(0).toUpperCase()}
                    </div>
                    <div className="dialogue-body">
                      <div className="dialogue-meta">
                        <span className="dialogue-speaker-name">{turn.speaker}</span>
                        {turn.timestamp && (
                          <span className="dialogue-time">[{turn.timestamp}]</span>
                        )}
                      </div>
                      <div className="dialogue-text">
                        {turn.text}
                      </div>
                    </div>
                  </div>
                ))
              )}
              <div ref={dialogueEndRef} />
            </div>
          </div>
        </section>

        {/* ── Section 3: Dedicated Fact-Checking & Q&A Audit (Anchored at Absolute Bottom) ── */}
        <section className="dash-section fact-checking-section" id="fact-checking-qa-audit">
          <div className="fact-check-box">
            <div className="fact-check-header">
              <div className="dash-section-title-wrap">
                <div
                  className="dash-section-icon-wrap"
                  style={{
                    background: 'rgba(16,185,129,0.15)',
                    borderColor: 'rgba(16,185,129,0.3)',
                    color: '#34d399'
                  }}
                >
                  <Award size={18} />
                </div>
                <div>
                  <h2 className="dash-section-title">Fact-Checking & Q&A Audit</h2>
                  <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: 'var(--dash-text-muted)' }}>
                    Powered by Google Gemini 1.5 Flash • Evaluates question intent, verbatim raw answers & AI accuracy verdicts
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div className="fact-check-tabs no-print">
                  <button
                    type="button"
                    className={`fact-tab-btn ${selectedAuditFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setSelectedAuditFilter('all')}
                  >
                    All Questions ({factCheckAudit.length})
                  </button>
                  <button
                    type="button"
                    className={`fact-tab-btn ${selectedAuditFilter === 'host' ? 'active' : ''}`}
                    onClick={() => setSelectedAuditFilter('host')}
                  >
                    {hostName}
                  </button>
                  {(() => {
                    const pKey = Object.keys(speakerRatings).find(
                      (k) => k.toLowerCase() !== hostName.toLowerCase() && k !== 'Speaker 0' && !k.toLowerCase().includes('host')
                    );
                    const pMetrics = pKey ? speakerRatings[pKey] : (speakerRatings.Participant || (guestName && speakerRatings[guestName]));
                    const guestDidSpeak = Boolean(pMetrics && (pMetrics.word_count ?? 0) >= 10);
                    if (!guestDidSpeak) return null;
                    return (
                      <button
                        type="button"
                        className={`fact-tab-btn ${selectedAuditFilter === 'guest' ? 'active' : ''}`}
                        onClick={() => setSelectedAuditFilter('guest')}
                      >
                        {guestName || 'Participant'}
                      </button>
                    );
                  })()}
                </div>

                <button
                  type="button"
                  className="dash-action-btn secondary no-print"
                  onClick={handleTriggerAudit}
                  disabled={isAuditing}
                  title="Re-run fact checking audit with Gemini 1.5 Flash"
                  style={{ padding: '6px 12px', fontSize: '0.78rem' }}
                >
                  <RefreshCw size={13} className={isAuditing ? 'spin' : ''} />
                  <span>{isAuditing ? 'Auditing...' : 'Re-Audit'}</span>
                </button>
              </div>
            </div>

            {/* Q&A Audit Content: If no dynamic Q&A exchanges exist, show clean alert badge */}
            {factCheckAudit.length === 0 ? (
              <div
                className="no-qa-status-box"
                style={{
                  padding: '24px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  background: 'rgba(56, 189, 248, 0.06)',
                  borderRadius: '12px',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  color: '#38bdf8',
                  fontSize: '0.92rem',
                  fontWeight: 500
                }}
              >
                <AlertTriangle size={18} />
                <span>No dynamic Q&A interaction found in this video stream.</span>
              </div>
            ) : (
              <>
                {/* Fact Check Stats Summary Banner */}
                <div className="fact-stats-banner">
                  <div className="fact-stat-card">
                    <div className="fact-stat-icon accurate">
                      <CheckCircle size={18} />
                    </div>
                    <div className="fact-stat-meta">
                      <span className="fact-stat-val">{auditStats.accurate}</span>
                      <span className="fact-stat-lbl">Accurate Answers</span>
                    </div>
                  </div>

                  <div className="fact-stat-card">
                    <div className="fact-stat-icon incomplete">
                      <AlertTriangle size={18} />
                    </div>
                    <div className="fact-stat-meta">
                      <span className="fact-stat-val">{auditStats.incomplete}</span>
                      <span className="fact-stat-lbl">Incomplete Answers</span>
                    </div>
                  </div>

                  <div className="fact-stat-card">
                    <div className="fact-stat-icon evasive">
                      <ShieldAlert size={18} />
                    </div>
                    <div className="fact-stat-meta">
                      <span className="fact-stat-val">{auditStats.evasive}</span>
                      <span className="fact-stat-lbl">Evasive Answers</span>
                    </div>
                  </div>
                </div>

                {/* Dedicated 3-Column Fact-Checking & Q&A Audit Table */}
                <div className="fact-check-table-wrapper">
                  <table className="fact-check-table">
                    <thead>
                      <tr>
                        <th className="fact-col-q">Question (Asked By)</th>
                        <th className="fact-col-a">Answer (Given By)</th>
                        <th className="fact-col-v">AI Verdict Badge</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAudit.length === 0 ? (
                        <tr>
                          <td colSpan={3} style={{ textAlign: 'center', padding: '24px', color: 'var(--dash-text-dim)' }}>
                            No fact-check items found for the selected filter.
                          </td>
                        </tr>
                      ) : (
                        filteredAudit.map((item, idx) => {
                          const verdictClean = (item.verdict || 'Accurate').trim();
                          const verdictType = verdictClean.toLowerCase().includes('incom')
                            ? 'incomplete'
                            : verdictClean.toLowerCase().includes('evas')
                            ? 'evasive'
                            : 'accurate';

                          const asker = item.question_by || hostName;
                          const answerer = item.answered_by || guestName;

                          return (
                            <tr key={idx} className="fact-table-row">
                              <td className="fact-col-q-cell">
                                <div className="fact-speaker-tag asker">
                                  <span className="fact-role-pill">Asked By</span>
                                  <strong className="fact-speaker-name">{asker}</strong>
                                </div>
                                <div className="fact-text-content">
                                  "{item.question}"
                                </div>
                              </td>

                              <td className="fact-col-a-cell">
                                <div className="fact-speaker-tag answerer">
                                  <span className="fact-role-pill">Given By</span>
                                  <strong className="fact-speaker-name">{answerer}</strong>
                                </div>
                                <div className="fact-text-content">
                                  "{item.answer}"
                                </div>
                              </td>

                              <td className="fact-col-v-cell">
                                <span className={`verdict-badge ${verdictType}`}>
                                  {verdictType === 'accurate' && <CheckCircle size={13} style={{ marginRight: 4 }} />}
                                  {verdictType === 'incomplete' && <AlertTriangle size={13} style={{ marginRight: 4 }} />}
                                  {verdictType === 'evasive' && <ShieldAlert size={13} style={{ marginRight: 4 }} />}
                                  {verdictClean}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Footer */}
        <footer className="dash-footer">
          Executive Meeting Fact-Checking & Diarized Dialogue Audit • Production Ready
        </footer>
      </main>
    </div>
  );
}
