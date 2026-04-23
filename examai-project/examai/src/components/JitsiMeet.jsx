import React, { useEffect, useRef } from 'react';

export default function JitsiMeet({ roomName, displayName, height }) {
  var containerRef = useRef(null);
  var apiRef = useRef(null);

  useEffect(function() {
    if (!roomName || !containerRef.current) return;

    // Load Jitsi External API script
    function initJitsi() {
      if (apiRef.current) { try { apiRef.current.dispose(); } catch(e){} apiRef.current = null; }
      
      var domain = 'meet.jit.si';
      var options = {
        roomName: 'dexam-viva-' + roomName,
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
          toolbarButtons: ['microphone', 'camera', 'hangup', 'fullscreen'],
          hideConferenceSubject: true,
          hideConferenceTimer: false,
          requireDisplayName: false,
        },
        interfaceConfigOverwrite: {
          SHOW_JITSI_WATERMARK: false,
          SHOW_WATERMARK_FOR_GUESTS: false,
          TOOLBAR_BUTTONS: ['microphone', 'camera', 'hangup', 'fullscreen'],
          HIDE_INVITE_MORE_HEADER: true,
        }
      };

      try {
        apiRef.current = new window.JitsiMeetExternalAPI(domain, options);
      } catch(e) {
        console.error('Jitsi init failed:', e);
      }
    }

    if (window.JitsiMeetExternalAPI) {
      initJitsi();
    } else {
      var script = document.createElement('script');
      script.src = 'https://meet.jit.si/external_api.js';
      script.async = true;
      script.onload = initJitsi;
      script.onerror = function() { console.error('Failed to load Jitsi API'); };
      document.head.appendChild(script);
    }

    return function() {
      if (apiRef.current) { try { apiRef.current.dispose(); } catch(e){} apiRef.current = null; }
    };
  }, [roomName]); // eslint-disable-line

  return (
    <div ref={containerRef} style={{ width: '100%', borderRadius: 8, overflow: 'hidden', background: '#000', minHeight: height || 380 }}/>
  );
}
