import React, { useEffect, useRef, useState } from 'react';

export default function JitsiMeet({ roomName, displayName, height }) {
  var ref = useRef(null);
  var apiRef = useRef(null);
  var [joined, setJoined] = useState(false);
  var [error, setError] = useState('');

  useEffect(function() {
    if (!roomName || !ref.current) return;
    var room = 'DExamViva' + String(roomName).replace(/[^a-zA-Z0-9]/g, '');

    function init() {
      if (!window.JitsiMeetExternalAPI || !ref.current) return;
      if (apiRef.current) { try { apiRef.current.dispose(); } catch(e) {} apiRef.current = null; }
      try {
        apiRef.current = new window.JitsiMeetExternalAPI('meet.jit.si', {
          roomName: room,
          width: '100%',
          height: height || 320,
          parentNode: ref.current,
          userInfo: {
            displayName: displayName || 'User',
            email: 'user@dexam.com'
          },
          configOverwrite: {
            prejoinPageEnabled: false,
            startWithAudioMuted: false,
            startWithVideoMuted: false,
            disableDeepLinking: true,
            enableWelcomePage: false,
            requireDisplayName: false,
            enableUserRolesBasedOnToken: false,
            enableFeaturesBasedOnToken: false,
            p2p: { enabled: true },
            analytics: { disabled: true },
            toolbarButtons: ['microphone','camera','fullscreen','tileview','desktop'],
          },
          interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            SHOW_BRAND_WATERMARK: false,
            SHOW_POWERED_BY: false,
            HIDE_INVITE_MORE_HEADER: true,
            SETTINGS_SECTIONS: ['devices'],
            MOBILE_APP_PROMO: false,
            DEFAULT_LOCAL_DISPLAY_NAME: displayName || 'User',
          }
        });
        apiRef.current.addListener('videoConferenceJoined', function() { setJoined(true); });
        apiRef.current.addListener('videoConferenceLeft', function() {
          setJoined(false);
          setTimeout(function() { if (ref.current) init(); }, 2000);
        });
      } catch(e) { setError(e.message); }
    }

    function load() {
      if (window.JitsiMeetExternalAPI) { init(); return; }
      var s = document.getElementById('jitsi-api-script');
      if (!s) {
        s = document.createElement('script');
        s.id = 'jitsi-api-script';
        s.src = 'https://meet.jit.si/external_api.js';
        document.head.appendChild(s);
      }
      s.onload = function() { setTimeout(init, 300); };
      if (window.JitsiMeetExternalAPI) init();
    }

    load();
    return function() { if (apiRef.current) { try { apiRef.current.dispose(); } catch(e) {} apiRef.current = null; } };
  }, [roomName, displayName]); // eslint-disable-line

  return (
    <div style={{ width:'100%', minHeight: height||320, background:'#1a1a2e', borderRadius:8, overflow:'hidden', position:'relative' }}>
      {!joined && !error && (
        <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', zIndex:2, background:'rgba(15,15,26,0.7)', gap:10, pointerEvents:'none' }}>
          <div className="spinner" style={{ width:28, height:28 }}/>
          <div style={{ color:'#9ca3af', fontSize:'0.8rem' }}>Joining as {displayName}…</div>
        </div>
      )}
      {error && <div style={{ color:'#f87171', padding:16, fontSize:'0.8rem' }}>Error: {error}</div>}
      <div ref={ref} style={{ width:'100%', minHeight: height||320 }}/>
    </div>
  );
}
