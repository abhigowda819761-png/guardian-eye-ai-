/**
 * GuardianEye AI - Video Meeting Analysis Client Module
 * Framework: React 19 / Vite / Capacitor (JavaScript)
 *
 * Provides a production-ready client integration for:
 * POST /api/video/extract-audio
 * Supported Platforms: Web (Chrome, Safari, Firefox) and Native Android APK
 */

import axios from 'axios';
import { API_BASE_URL, RENDER_PRODUCTION_URL } from '../config';

/**
 * Normalizes relative audio URLs to absolute URLs using the active API base URL.
 * @param {string} url - Audio stream URL or relative path
 * @param {string} baseUrl - Active backend base URL
 * @returns {string} - Fully qualified absolute audio URL
 */
function resolveAudioUrl(url, baseUrl) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) {
    return url;
  }
  const cleanBase = (baseUrl || API_BASE_URL || RENDER_PRODUCTION_URL).replace(/\/+$/, '');
  const cleanPath = url.startsWith('/') ? url : `/${url}`;
  return `${cleanBase}${cleanPath}`;
}

/**
 * Asynchronously sends a video or audio file to the Render backend for 16kHz mono audio extraction,
 * voice activity detection, acoustic clustering, and speaker turn transcription.
 *
 * @param {File|Blob} file - The recorded video/audio file (Binary/Blob)
 * @param {Object|string} [metadataOrHostName] - Host name string OR options object
 * @param {string|string[]} [participantNames] - Participant names (if metadataOrHostName is string)
 * @param {Object} [customOptions] - Additional config (timeout, baseUrl, onUploadProgress)
 * @returns {Promise<MeetingAnalysisResult>} Structured success or error result
 *
 * @example
 * // Simple usage:
 * const result = await analyzeVideoMeeting(videoFile, 'Abhishek', 'Participant 1, Participant 2');
 * if (result.success) {
 *   console.log('Turns:', result.data.timeline);
 * } else {
 *   console.error('Error:', result.error.message);
 * }
 *
 * @example
 * // Options object usage:
 * const result = await analyzeVideoMeeting(videoBlob, {
 *   host_name: 'Abhishek (Host)',
 *   participant_names: ['John', 'Sarah'],
 *   onUploadProgress: (pct) => setUploadProgress(pct)
 * });
 */
export async function analyzeVideoMeeting(
  file,
  metadataOrHostName = null,
  participantNames = null,
  customOptions = {}
) {
  // 1. Resolve flexible argument signatures
  let hostName = null;
  let participants = null;
  let options = {};

  if (metadataOrHostName && typeof metadataOrHostName === 'object' && !(metadataOrHostName instanceof String)) {
    hostName = metadataOrHostName.host_name || metadataOrHostName.hostName || null;
    participants = metadataOrHostName.participant_names || metadataOrHostName.participantNames || null;
    options = { ...metadataOrHostName, ...customOptions };
  } else {
    hostName = metadataOrHostName || null;
    participants = participantNames || null;
    options = { ...customOptions };
  }

  const {
    baseUrl = API_BASE_URL || RENDER_PRODUCTION_URL,
    timeout = 180000, // 3 minutes timeout for video processing
    onUploadProgress = null,
    headers: customHeaders = {}
  } = options;

  // 2. Client-side validation
  if (!file) {
    return {
      success: false,
      status: 400,
      error: {
        code: 'MISSING_FILE',
        message: 'No video or audio file provided for analysis.',
        details: null
      },
      data: null
    };
  }

  // Ensure file has size
  if (file.size !== undefined && file.size === 0) {
    return {
      success: false,
      status: 400,
      error: {
        code: 'EMPTY_FILE',
        message: 'The selected file is empty (0 bytes). Please upload valid meeting footage.',
        details: null
      },
      data: null
    };
  }

  // 3. Assemble multipart/form-data payload
  const formData = new FormData();
  const filename = file.name || `meeting_${Date.now()}.mp4`;
  formData.append('file', file, filename);

  if (hostName) {
    formData.append('host_name', String(hostName).trim());
  }

  if (participants) {
    if (Array.isArray(participants)) {
      formData.append('participant_names', JSON.stringify(participants));
    } else {
      formData.append('participant_names', String(participants).trim());
    }
  }

  const targetUrl = `${baseUrl.replace(/\/+$/, '')}/api/video/extract-audio`;

  // 4. Execute HTTP Request via Axios
  try {
    const response = await axios.post(targetUrl, formData, {
      timeout,
      headers: {
        // Let the browser/runtime set Content-Type with dynamic multipart boundary
        ...customHeaders
      },
      onUploadProgress: (progressEvent) => {
        if (typeof onUploadProgress === 'function' && progressEvent.total) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onUploadProgress(percentCompleted);
        }
      }
    });

    // 5. Parse Status 200 payload
    const payload = response.data;
    const rawData = payload?.data || payload || {};

    // Standardize timeline turns with required fields
    const rawTimeline = rawData.timeline || [];
    const formattedTimeline = rawTimeline.map((turn, index) => {
      const turnIdx = turn.turnIndex !== undefined ? turn.turnIndex : index + 1;
      const startSec = typeof turn.startTimeSec === 'number' ? turn.startTimeSec : parseFloat(turn.start || 0);
      const endSec = typeof turn.endTimeSec === 'number' ? turn.endTimeSec : parseFloat(turn.end || 0);
      const startFormatted = turn.start || formatSecondsToTime(startSec);
      const endFormatted = turn.end || formatSecondsToTime(endSec);

      return {
        turnIndex: turnIdx,
        speakerId: turn.speakerId || `SPEAKER_${turnIdx}`,
        speakerName: turn.speakerName || turn.speaker || 'Unknown Speaker',
        role: turn.role || (turn.isHost ? 'Host' : 'Participant'),
        isHost: Boolean(turn.isHost || turn.role === 'Host'),
        text: turn.text || '',
        audioUrl: resolveAudioUrl(turn.audioUrl, baseUrl),
        duration: turn.duration || Math.max(0, parseFloat((endSec - startSec).toFixed(2))),
        durationFormatted: turn.durationFormatted || `${(endSec - startSec).toFixed(1)}s`,
        // Timestamps in multiple convenient formats
        timestamps: {
          start: startFormatted,
          end: endFormatted,
          startSec,
          endSec,
          formatted: turn.timestamp || `${startFormatted} - ${endFormatted}`
        },
        timestamp: turn.timestamp || `${startFormatted} - ${endFormatted}`
      };
    });

    // Structure speakers list with resolved full audio URLs
    const formattedSpeakers = (rawData.speakers || []).map((spk) => ({
      ...spk,
      fullAudioUrl: resolveAudioUrl(spk.fullAudioUrl, baseUrl),
      sampleAudioUrl: resolveAudioUrl(spk.sampleAudioUrl, baseUrl)
    }));

    return {
      success: true,
      status: response.status,
      data: {
        videoId: rawData.videoId || '',
        originalFilename: rawData.originalFilename || filename,
        masterAudioUrl: resolveAudioUrl(rawData.masterAudioUrl, baseUrl),
        totalDurationSec: rawData.totalDurationSec || 0,
        totalDurationFormatted: rawData.totalDurationFormatted || formatSecondsToTime(rawData.totalDurationSec || 0),
        totalSpeechSec: rawData.totalSpeechSec || 0,
        silenceDurationSec: rawData.silenceDurationSec || 0,
        silencePercentage: rawData.silencePercentage || 0,
        speakerCount: rawData.speakerCount || formattedSpeakers.length,
        speakers: formattedSpeakers,
        timeline: formattedTimeline,
        meetingInsights: rawData.meetingInsights || null,
        dialogueScript: rawData.dialogueScript || formattedTimeline.map(t => `${t.speakerName}: ${t.text}`).join('\n'),
        raw: rawData
      },
      error: null
    };

  } catch (err) {
    // 6. Robust Error Handling for Network Timeouts, 422, 502, 500
    return handleAxiosError(err, targetUrl);
  }
}

/**
 * Converts error exceptions into a predictable structured error state.
 * @param {Error} err - Axios error or native Exception
 * @param {string} targetUrl - Attempted endpoint
 * @returns {Object} Structured error return
 */
function handleAxiosError(err, targetUrl) {
  // Network timeout
  if (err.code === 'ECONNABORTED' || (err.message && err.message.toLowerCase().includes('timeout'))) {
    return {
      success: false,
      status: 408,
      error: {
        code: 'TIMEOUT',
        message: 'The audio extraction request timed out. Video processing on cloud worker exceeded the time limit.',
        details: err.message
      },
      data: null
    };
  }

  // Response was received from server with error status
  if (err.response) {
    const status = err.response.status;
    const errorData = err.response.data;
    const detailMsg = typeof errorData === 'object'
      ? (errorData.detail || errorData.message || JSON.stringify(errorData))
      : String(errorData || '');

    // 422 Unprocessable Entity (FastAPI validation error)
    if (status === 422) {
      return {
        success: false,
        status: 422,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The uploaded payload failed validation. Ensure the video file and parameters match the multipart schema.',
          details: detailMsg
        },
        data: null
      };
    }

    // 502 Bad Gateway (Render container cold-starting, routing proxy or worker restart)
    if (status === 502) {
      return {
        success: false,
        status: 502,
        error: {
          code: 'BAD_GATEWAY',
          message: 'Render cloud gateway returned 502. The backend instance may be waking from idle or restarting. Please retry in 15 seconds.',
          details: detailMsg || 'Bad Gateway from Render routing mesh'
        },
        data: null
      };
    }

    // 500 Internal Server Error
    if (status === 500) {
      return {
        success: false,
        status: 500,
        error: {
          code: 'SERVER_ERROR',
          message: 'Audio extraction failed on the server. Ensure the video contains a valid acoustic audio track.',
          details: detailMsg
        },
        data: null
      };
    }

    // 400 Bad Request
    if (status === 400) {
      return {
        success: false,
        status: 400,
        error: {
          code: 'BAD_REQUEST',
          message: detailMsg || 'Invalid video file format or parameters.',
          details: detailMsg
        },
        data: null
      };
    }

    // Other HTTP error statuses
    return {
      success: false,
      status,
      error: {
        code: `HTTP_${status}`,
        message: detailMsg || `Request failed with HTTP status ${status}.`,
        details: errorData
      },
      data: null
    };
  }

  // No response received (Network failure / CORS / offline device)
  if (err.request) {
    return {
      success: false,
      status: 0,
      error: {
        code: 'NETWORK_ERROR',
        message: `Failed to connect to backend server at ${targetUrl}. Check your internet connection or verify the Render cloud service is running.`,
        details: err.message
      },
      data: null
    };
  }

  // Generic client-side setup error
  return {
    success: false,
    status: 0,
    error: {
      code: 'CLIENT_ERROR',
      message: err.message || 'An unexpected client error occurred.',
      details: String(err)
    },
    data: null
  };
}

/**
 * Utility: Formats numeric seconds into MM:SS string
 * @param {number} sec
 * @returns {string}
 */
export function formatSecondsToTime(sec) {
  if (isNaN(sec) || sec < 0) return '00:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default {
  analyzeVideoMeeting,
  formatSecondsToTime
};
