import React, { useEffect, useRef } from 'react';

export default function JitsiMeet({ roomName, displayName, height }) {
  var containerRef = useRef(null);
  var apiRef = useRef(null);

  useEffect(function() {
    if (!roomName || !containerRef.current) return;

    function init() {
      if (apiRef.current) { try { apiRef.current.dispose(); } catch(e){} apiRef.current = null; }
      if (!containerRef.current) return;
      try {
        apiRef.current = new window.JitsiMeetExternalAPI('meet.jit.si', {
          roomName: 'dexam-viva-' + String(roomName).replace(/[^a-zA-Z0-9]/g, ''),
          width: '100%',
          height: height || 380,
          parentNode: containerRef.current,
          userInfo: { displayName: displayName || 'User' },
          configOverwrite: {
            prejoinPageEnabled: false,
            startWithAudioMuted: false,
            startWithVideoMuted: false,
            disableDeepLinking: true,
            enableWelcomePage: false,
            requireDisplayName: false,
            hideConferenceSubject: true,
            toolbarButtons: ['microphone', 'camera', 'fullscreen', 'tileview'],
            disablePolls: true,
            disableReactions: true,
            subject: 'DExam Viva',
          },
          interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            SHOW_BRAND_WATERMARK: false,
            SHOW_POWERED_BY: false,
            DISPLAY_WELCOME_FOOTER: false,
            HIDE_INVITE_MORE_HEADER: true,
            TOOLBAR_BUTTONS: ['microphone', 'camera', 'fullscreen', 'tileview'],
            SETTINGS_SECTIONS: ['devices'],
            MOBILE_APP_PROMO: false,
          }
        });
        // Rejoin if accidentally leaves
        apiRef.current.addListener('videoConferenceLeft', function() {
          if (containerRef.current) setTimeout(function() { if (containerRef.current) init(); }, 2000);
        });
      } catch(e) { console.error('[Jitsi] init failed:', e); }
    }

    if (window.JitsiMeetExternalAPI) {
      init();
    } else {
      var existing = document.querySelector('script[src*="meet.jit.si/external_api"]');
      if (existing) { existing.addEventListener('load', function() { setTimeout(init, 300); }); return; }
      var script = document.createElement('script');
      script.src = 'https://meet.jit.si/external_api.js';
      script.async = true;
      script.onload = function() { setTimeout(init, 300); };
      script.onerror = function() { console.error('[Jitsi] script failed to load'); };
      document.head.appendChild(script);
    }

    return function() {
      if (apiRef.current) { try { apiRef.current.dispose(); } catch(e){} apiRef.current = null; }
    };
  }, [roomName]); // eslint-disable-line

  return (
    <div style={{ width:'100%', borderRadius:8, overflow:'hidden', background:'#1a1a2e', minHeight: height || 380 }}>
      <div ref={containerRef} style={{ width:'100%', minHeight: height || 380 }}/>
    </div>
  );
}
