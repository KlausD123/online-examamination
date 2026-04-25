import React, { useRef, useEffect, useState } from 'react';

// Use direct iframe — more reliable than External API
export default function JitsiMeet({ roomName, displayName, height }) {
  var iframeRef = useRef(null);
  var [loaded, setLoaded] = useState(false);

  var clean = 'DExamViva' + String(roomName || '').replace(/[^a-zA-Z0-9]/g,'').slice(0,24);
  var name = encodeURIComponent(displayName || 'User');
  // Jitsi URL with config params to skip prejoin
  var jitsiUrl = 'https://meet.jit.si/' + clean +
    '#config.prejoinPageEnabled=false' +
    '&config.startWithAudioMuted=false' +
    '&config.startWithVideoMuted=false' +
    '&config.disableDeepLinking=true' +
    '&config.toolbarButtons=["microphone","camera","fullscreen","tileview","desktop"]' +
    '&config.hideConferenceSubject=true' +
    '&userInfo.displayName=' + name;

  useEffect(function() {
    setLoaded(false);
  }, [roomName]);

  if (!roomName) return null;

  return (
    <div style={{ position:'relative', width:'100%', borderRadius:8, overflow:'hidden', background:'#0f0f1a', minHeight: height||360 }}>
      {!loaded && (
        <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', zIndex:5, background:'rgba(15,15,26,0.95)', gap:12 }}>
          <div className="spinner" style={{ width:32, height:32 }}/>
          <div style={{ color:'#9ca3af', fontSize:'0.85rem' }}>Connecting to video room…</div>
          <div style={{ color:'#6b7280', fontSize:'0.72rem' }}>Room: {clean}</div>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={jitsiUrl}
        allow="camera; microphone; display-capture; fullscreen; autoplay"
        allowFullScreen
        style={{ width:'100%', height: height||360, border:'none', display:'block' }}
        onLoad={function() { setLoaded(true); }}
        title="Viva Video"
      />
    </div>
  );
}
