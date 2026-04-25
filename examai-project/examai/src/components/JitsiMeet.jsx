import React, { useEffect, useRef } from 'react';

export default function JitsiMeet({ roomName, displayName, height }) {
  var containerRef = useRef(null);
  var apiRef       = useRef(null);

  useEffect(function() {
    if (!roomName) return;

    var room = 'DExamViva' + String(roomName).replace(/[^a-zA-Z0-9]/g, '');
    var h    = height || 400;

    function initJitsi() {
      if (!window.JitsiMeetExternalAPI) return;
      if (apiRef.current) {
        try { apiRef.current.dispose(); } catch(e) {}
        apiRef.current = null;
      }
      if (!containerRef.current) return;

      try {
        apiRef.current = new window.JitsiMeetExternalAPI('meet.jit.si', {
          roomName: room,
          width:    '100%',
          height:   h,
          parentNode: containerRef.current,
          userInfo: { displayName: displayName || 'User' },
          configOverwrite: {
            prejoinPageEnabled:   false,
            startWithAudioMuted:  false,
            startWithVideoMuted:  false,
            disableDeepLinking:   true,
            enableNoisyMicDetection: false,
            disableAudioLevels: false,
          },
          interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK:      false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            TOOLBAR_BUTTONS: [
              'microphone', 'camera', 'hangup',
              'fullscreen', 'fodeviceselection',
              'settings', 'videoquality',
            ],
            SETTINGS_SECTIONS: ['devices'],
            DEFAULT_BACKGROUND: '#0a0a14',
          },
        });
      } catch(e) {
        console.error('[JitsiMeet] init failed:', e);
      }
    }

    // If SDK already loaded, init immediately
    if (window.JitsiMeetExternalAPI) {
      initJitsi();
      return;
    }

    // Load the Jitsi External API script
    if (!document.getElementById('jitsi-sdk')) {
      var script = document.createElement('script');
      script.id  = 'jitsi-sdk';
      script.src = 'https://meet.jit.si/external_api.js';
      script.async = true;
      script.onload = initJitsi;
      script.onerror = function() {
        console.error('[JitsiMeet] Failed to load external_api.js');
      };
      document.head.appendChild(script);
    } else {
      // Script tag exists but SDK not ready yet — poll
      var tries = 0;
      var iv = setInterval(function() {
        tries++;
        if (window.JitsiMeetExternalAPI) { clearInterval(iv); initJitsi(); }
        if (tries > 30) clearInterval(iv);
      }, 300);
    }

    return function() {
      if (apiRef.current) {
        try { apiRef.current.dispose(); } catch(e) {}
        apiRef.current = null;
      }
    };
  }, [roomName, displayName, height]); // eslint-disable-line

  if (!roomName) return null;

  return (
    <div
      ref={containerRef}
      style={{
        width:        '100%',
        height:       height || 400,
        borderRadius: 8,
        overflow:     'hidden',
        background:   '#0a0a14',
      }}
    />
  );
}
