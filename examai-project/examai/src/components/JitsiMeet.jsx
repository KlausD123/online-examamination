import React, { useEffect, useRef } from 'react';

export default function JitsiMeet({ roomName, displayName, height }) {
  var ref = useRef(null);
  var apiRef = useRef(null);

  useEffect(function() {
    if (!roomName || !ref.current) return;
    var room = 'dexamviva' + String(roomName).replace(/\D/g,'');

    function init() {
      if (!window.JitsiMeetExternalAPI || !ref.current) return;
      if (apiRef.current) { try { apiRef.current.dispose(); } catch(e) {} apiRef.current = null; }
      apiRef.current = new window.JitsiMeetExternalAPI('meet.jit.si', {
        roomName: room,
        width: '100%',
        height: height || 320,
        parentNode: ref.current,
        userInfo: { displayName: displayName || 'User' },
        configOverwrite: {
          prejoinPageEnabled: false,
          startWithAudioMuted: false,
          startWithVideoMuted: false,
          disableDeepLinking: true,
          enableWelcomePage: false,
          requireDisplayName: false,
          p2p: { enabled: true },
          toolbarButtons: ['microphone', 'camera', 'fullscreen', 'tileview', 'desktop'],
        },
        interfaceConfigOverwrite: {
          SHOW_JITSI_WATERMARK: false,
          SHOW_WATERMARK_FOR_GUESTS: false,
          SHOW_BRAND_WATERMARK: false,
          SHOW_POWERED_BY: false,
          HIDE_INVITE_MORE_HEADER: true,
          SETTINGS_SECTIONS: ['devices'],
          MOBILE_APP_PROMO: false,
        }
      });
    }

    if (window.JitsiMeetExternalAPI) {
      init();
    } else {
      var s = document.getElementById('jitsi-api-script');
      if (!s) {
        s = document.createElement('script');
        s.id = 'jitsi-api-script';
        s.src = 'https://meet.jit.si/external_api.js';
        document.head.appendChild(s);
      }
      s.onload = function() { setTimeout(init, 200); };
      if (s.readyState === 'complete' || s.readyState === 'loaded') setTimeout(init, 200);
    }

    return function() {
      if (apiRef.current) { try { apiRef.current.dispose(); } catch(e) {} apiRef.current = null; }
    };
  }, [roomName, displayName]); // eslint-disable-line

  return (
    <div style={{ width: '100%', minHeight: height || 320, background: '#1a1a2e', borderRadius: 8, overflow: 'hidden' }}>
      <div ref={ref} style={{ width: '100%', minHeight: height || 320 }} />
    </div>
  );
}
