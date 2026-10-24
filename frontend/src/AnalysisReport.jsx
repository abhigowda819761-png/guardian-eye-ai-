import { auth } from './firebase';
import MeetingDashboard from './MeetingDashboard';

export default function AnalysisReport({ videoTitle, audioData, onBack }) {
  const dynamicHost = audioData?.hostName ||
    audioData?.speakers?.speaker_0 ||
    auth?.currentUser?.displayName ||
    (auth?.currentUser?.email ? auth.currentUser.email.split('@')[0] : 'Host');

  const dynamicGuest = audioData?.guestName ||
    audioData?.speakers?.speaker_1 ||
    (Array.isArray(audioData?.participantNames) && audioData.participantNames[0]) ||
    'Participant';

  return (
    <MeetingDashboard
      videoTitle={videoTitle}
      initialData={audioData}
      meetingId={audioData?.meetingId || audioData?.meetingCode}
      hostName={dynamicHost}
      guestName={dynamicGuest}
      onBack={onBack}
    />
  );
}
