import React, { useEffect, useRef } from 'react';

export default function JitsiMeet({ roomName, displayName, height }) {
  var containerRef = useRef(null);
  var apiRef       = useRef(null);

  useEffect(function() {
    if (!roomName || !containerRef.current) return;

    function init() {
      if (apiRef.current) { try { apiRef.current.dispose(); } catch(e){} apiRef.current = null; }
      if (!containerRef.current) return;

      try {
        apiRef.current = new window.JitsiMeetExternalAPI('meet.jit.si', {
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
            requireDisplayName: false,
            disableThirdPartyRequests: true,
            // Hide all branding/ads
            brandingDataUrl: '',
            dynamicBrandingUrl: '',
            hideConferenceSubject: true,
            hideConferenceTimer: false,
            toolbarButtons: ['microphone', 'camera', 'hangup', 'fullscreen', 'tileview'],
            // Disable features that show ads or external content
            disablePolls: true,
            giphy: { enabled: false },
            whiteboard: { enabled: false },
          },
          interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            SHOW_BRAND_WATERMARK: false,
            BRAND_WATERMARK_LINK: '',
            SHOW_POWERED_BY: false,
            DISPLAY_WELCOME_FOOTER: false,
            HIDE_INVITE_MORE_HEADER: true,
            TOOLBAR_BUTTONS: ['microphone', 'camera', 'hangup', 'fullscreen', 'tileview'],
            SETTINGS_SECTIONS: ['devices'],
            MOBILE_APP_PROMO: false,
            APP_NAME: 'DExam Viva',
            NATIVE_APP_NAME: 'DExam',
            PROVIDER_NAME: 'DExam',
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
        existing.addEventListener('load', init);
        return;
      }
      var script = document.createElement('script');
      script.src = 'https://meet.jit.si/external_api.js';
      script.async = true;
      script.onload = init;
      script.onerror = function() { console.error('[Jitsi] Failed to load API script'); };
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
