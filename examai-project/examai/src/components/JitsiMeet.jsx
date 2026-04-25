import React from 'react';

// Simple iframe approach - works for both admin and student
export default function JitsiMeet({ roomName, displayName, height }) {
  if (!roomName) return null;

  // Create consistent room name from viva_id
  var room = 'dexamviva' + String(roomName).replace(/[^a-zA-Z0-9]/g, '');
  var name  = encodeURIComponent(displayName || 'User');
  var h     = height || 360;

  var src = 'https://meet.jit.si/' + room
    + '?config.prejoinPageEnabled=false'
    + '&config.startWithAudioMuted=false'
    + '&config.startWithVideoMuted=false'
    + '&config.disableDeepLinking=true'
    + '&config.enableWelcomePage=false'
    + '&config.requireDisplayName=false'
    + '&config.p2p.enabled=true'
    + '&userInfo.displayName=' + name
    + '&interfaceConfig.SHOW_JITSI_WATERMARK=false'
    + '&interfaceConfig.SHOW_POWERED_BY=false'
    + '&interfaceConfig.HIDE_INVITE_MORE_HEADER=true'
    + '&interfaceConfig.MOBILE_APP_PROMO=false';

  return (
    <div style={{ width:'100%', borderRadius:8, overflow:'hidden', background:'#0f0f1a' }}>
      <iframe
        key={room}
        src={src}
        allow="camera *; microphone *; display-capture *; fullscreen *; autoplay *"
        allowFullScreen
        style={{ width:'100%', height:h, border:'none', display:'block' }}
        title={'Viva: ' + room}
      />
    </div>
  );
}
