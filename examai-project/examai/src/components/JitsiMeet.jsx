import React from 'react';

// Jitsi Meet embedded via iframe
// Both admin and student load the same URL → same room → see each other
// No login required on meet.jit.si for participants
export default function JitsiMeet({ roomName, displayName, height }) {
  if (!roomName) return null;

  var room = 'DExamViva' + String(roomName).replace(/[^a-zA-Z0-9]/g, '');
  var h = height || 380;

  // Use hash fragment - these config params are picked up by Jitsi directly
  var url = 'https://meet.jit.si/' + room + '#'
    + 'config.prejoinPageEnabled=false'
    + '&config.startWithAudioMuted=false'
    + '&config.startWithVideoMuted=false'
    + '&config.disableDeepLinking=true'
    + '&config.enableWelcomePage=false'
    + '&config.defaultLocalDisplayName=' + encodeURIComponent(displayName || 'User')
    + '&userInfo.displayName=' + encodeURIComponent(displayName || 'User')
    + '&interfaceConfig.SHOW_JITSI_WATERMARK=false'
    + '&interfaceConfig.SHOW_POWERED_BY=false'
    + '&interfaceConfig.HIDE_INVITE_MORE_HEADER=true'
    + '&interfaceConfig.TOOLBAR_BUTTONS=["microphone","camera","fullscreen","tileview"]';

  return (
    <div style={{ width: '100%', borderRadius: 8, overflow: 'hidden', background: '#1a1a2e' }}>
      <iframe
        key={room + displayName}
        src={url}
        allow="camera *; microphone *; fullscreen *; display-capture *; autoplay *; clipboard-write *"
        allowFullScreen
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-storage-access-by-user-activation"
        style={{ width: '100%', height: h, border: 'none', display: 'block' }}
        title="Viva Video Session"
      />
    </div>
  );
}
