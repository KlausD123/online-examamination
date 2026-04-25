import React, { useEffect, useRef } from 'react';

// role: 'student' = minimal UI, 'admin' = full toolbar
export default function JitsiMeet({ roomName, displayName, height, role }) {
  var containerRef = useRef(null);
  var apiRef       = useRef(null);

  useEffect(function() {
    if (!roomName) return;

    var room = 'DExamViva' + String(roomName).replace(/[^a-zA-Z0-9]/g, '');
    var h    = height || 400;
    var isStudent = role !== 'admin';

    function initJitsi() {
      if (!window.JitsiMeetExternalAPI) return;
      if (apiRef.current) { try { apiRef.current.dispose(); } catch(e) {} apiRef.current = null; }
      if (!containerRef.current) return;

      try {
        apiRef.current = new window.JitsiMeetExternalAPI('meet.jit.si', {
          roomName: room,
          width:    '100%',
          height:   h,
          parentNode: containerRef.current,
          userInfo: { displayName: displayName || 'User' },

          configOverwrite: {
            // Skip the pre-join lobby entirely
            prejoinPageEnabled:          false,
            prejoinConfig:               { enabled: false },
            // Start with devices on
            startWithAudioMuted:         false,
            startWithVideoMuted:         false,
            // No deep-link or app prompts
            disableDeepLinking:          true,
            disableMobilePage:           true,
            // Clean up extra features
            enableNoisyMicDetection:     false,
            disablePolls:                true,
            disableReactions:            true,
            disableReactionsModeration:  true,
            hideConferenceSubject:       true,
            hideConferenceTimer:         true,
            disableInviteFunctions:      true,
            disableProfile:              isStudent,
            // Lobby / security off
            lobby: { enabled: false },
            securityUi: { hideLobbyButton: true, disableLobbyPassword: true },
          },

          interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK:        false,
            SHOW_WATERMARK_FOR_GUESTS:   false,
            SHOW_BRAND_WATERMARK:        false,
            SHOW_POWERED_BY:             false,
            DISPLAY_WELCOME_PAGE_CONTENT: false,
            DISPLAY_WELCOME_PAGE_TOOLBAR_ADDITIONAL_CONTENT: false,
            APP_NAME:                    'DExam Viva',
            NATIVE_APP_NAME:             'DExam Viva',
            PROVIDER_NAME:               'DExam',
            DEFAULT_BACKGROUND:          '#0a0a14',
            DEFAULT_LOCAL_DISPLAY_NAME:  displayName || 'User',
            SETTINGS_SECTIONS:           ['devices'],
            // Student: bare minimum — only mic + cam + hangup
            TOOLBAR_BUTTONS: isStudent
              ? ['microphone', 'camera', 'hangup']
              : ['microphone', 'camera', 'hangup', 'fullscreen', 'fodeviceselection', 'settings', 'videoquality'],
            TOOLBAR_ALWAYS_VISIBLE:      false,
            INITIAL_TOOLBAR_TIMEOUT:     1500,
            TOOLBAR_TIMEOUT:             4000,
            // Hide all the clutter
            HIDE_INVITE_MORE_HEADER:     true,
            DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
            DISABLE_FOCUS_INDICATOR:     true,
          },
        });
      } catch(e) {
        console.error('[JitsiMeet] init failed:', e);
      }
    }

    if (window.JitsiMeetExternalAPI) {
      initJitsi();
      return;
    }

    if (!document.getElementById('jitsi-sdk')) {
      var script    = document.createElement('script');
      script.id     = 'jitsi-sdk';
      script.src    = 'https://meet.jit.si/external_api.js';
      script.async  = true;
      script.onload = initJitsi;
      script.onerror = function() { console.error('[JitsiMeet] SDK load failed'); };
      document.head.appendChild(script);
    } else {
      var tries = 0;
      var iv = setInterval(function() {
        tries++;
        if (window.JitsiMeetExternalAPI) { clearInterval(iv); initJitsi(); }
        if (tries > 40) clearInterval(iv);
      }, 250);
    }

    return function() {
      if (apiRef.current) { try { apiRef.current.dispose(); } catch(e) {} apiRef.current = null; }
    };
  }, [roomName, displayName, height, role]); // eslint-disable-line

  if (!roomName) return null;

  return (
    <div ref={containerRef} style={{ width: '100%', height: height || 400, borderRadius: 8, overflow: 'hidden', background: '#0a0a14' }} />
  );
}
