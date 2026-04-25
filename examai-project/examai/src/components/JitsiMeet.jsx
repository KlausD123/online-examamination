import React from 'react';

// Direct iframe to meet.jit.si — shows full Jitsi UI including Join button
// Same experience for both admin (Examiner) and student
export default function JitsiMeet({ roomName, displayName, height }) {
  if (!roomName) return null;

  var room = 'DExamViva' + String(roomName).replace(/[^a-zA-Z0-9]/g, '');
  var h = height || 360;

  // Use iframe directly - this is what makes the "Join Meeting" button appear
  // The # config params are handled by Jitsi client-side
  var url = 'https://meet.jit.si/' + room
    + '#userInfo.displayName=' + encodeURIComponent(displayName || 'User')
    + '&config.startWithAudioMuted=false'
    + '&config.startWithVideoMuted=false'
    + '&config.disableDeepLinking=true';

  return (
    <div style={{ width:'100%', borderRadius:8, overflow:'hidden', background:'#1a1a2e' }}>
      <iframe
        key={room}
        src={url}
        allow="camera *; microphone *; fullscreen *; display-capture *; autoplay *; clipboard-write"
        allowFullScreen
        style={{ width:'100%', height:h, border:'none', display:'block' }}
        title="Viva Meeting"
        sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-downloads allow-presentation"
      />
    </div>
  );
}
