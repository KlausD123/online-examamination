import React, { useEffect, useRef } from 'react';

export default function JitsiMeet({ roomName, displayName, height }) {
  var containerRef = useRef(null);
  var apiRef       = useRef(null);

  useEffect(function() {
    if (!roomName || !containerRef.current) return;

    function init() {
      if (apiRef.current) { try { apiRef.current.dispose(); } catch(e){} apiRef.current = null; }
      if (!containerRef.current) return;

      // Store name in localStorage so Jitsi remembers it on refresh
      try { localStorage.setItem('jitsiDisplayName', displayName || 'User'); } catch(e) {}

      try {
        apiRef.current = new window.JitsiMeetExternalAPI('meet.jit.si', {
          roomName: 'dexam-' + roomName,
          width: '100%',
          height: height || 380,
          parentNode: containerRef.current,
          userInfo: {
            displayName: displayName || 'User',
            email: ''
          },
          configOverwrite: {
            prejoinPageEnabled: false,         // Skip pre-join page (no login screen)
            startWithAudioMuted: false,
            startWithVideoMuted: false,
            disableDeepLinking: true,
            enableWelcomePage: false,
            requireDisplayName: false,         // Don't ask for name
            disableThirdPartyRequests: true,
            hideConferenceSubject: true,
            toolbarButtons: ['microphone', 'camera', 'fullscreen', 'tileview'],
            disablePolls: true,
            subject: ' ',
            defaultLocalDisplayName: displayName || 'User',
            enableClosePage: false,
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
            APP_NAME: 'DExam Viva',
            NATIVE_APP_NAME: 'DExam',
            PROVIDER_NAME: 'DExam',
            DEFAULT_LOCAL_DISPLAY_NAME: displayName || 'User',
          }
        });
        // Prevent accidental hangup — reconnect if user somehow leaves
        apiRef.current.addListener('videoConferenceLeft', function() {
          if (containerRef.current && roomName) {
            setTimeout(function() {
              if (containerRef.current) init();
            }, 1500);
          }
        });
      } catch(e) {
        console.error('[Jitsi] init failed:', e);
      }
    }

    if (window.JitsiMeetExternalAPI) {
      init();
    } else {
      var existing = document.querySelector('script[src*="meet.jit.si/external_api"]');
      if (existing) {
        // Script already loading — wait for it
        if (!window.JitsiMeetExternalAPI) {
          existing.addEventListener('load', init);
        } else {
          init();
        }
        return;
      }
      var script = document.createElement('script');
      script.src = 'https://meet.jit.si/external_api.js';
      script.async = true;
      script.onload = init;
      script.onerror = function() { console.error('[Jitsi] Failed to load API'); };
      document.head.appendChild(script);
    }

    return function() {
      if (apiRef.current) { try { apiRef.current.dispose(); } catch(e){} apiRef.current = null; }
    };
  }, [roomName]); // eslint-disable-line

  return (
    <div ref={containerRef} style={{
      width: '100%',
      borderRadius: 8,
      overflow: 'hidden',
      background: '#000',
      minHeight: height || 380
    }}/>
  );
}
