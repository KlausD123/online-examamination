import React from 'react';

export default function JitsiMeet({ roomName, displayName, height }) {
  if (!roomName) return null;
  var clean = 'DExamViva' + String(roomName).replace(/[^a-zA-Z0-9]/g,'').slice(0,24);
  var h = height || 360;

  return (
    <iframe
      src={'https://meet.jit.si/' + clean + '#userInfo.displayName=' + encodeURIComponent(displayName||'User') + '&config.prejoinPageEnabled=false&config.startWithAudioMuted=false&config.startWithVideoMuted=false&config.disableDeepLinking=true&config.enableWelcomePage=false&interfaceConfig.SHOW_JITSI_WATERMARK=false&interfaceConfig.SHOW_POWERED_BY=false'}
      allow="camera; microphone; display-capture; fullscreen; autoplay"
      allowFullScreen
      style={{ width:'100%', height:h, border:'none', display:'block', borderRadius:8 }}
      title="Viva Video"
    />
  );
}
