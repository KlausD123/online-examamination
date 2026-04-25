import React, { useEffect, useRef } from 'react';

// role: 'student' = mic+cam+hangup only | 'admin' = full toolbar
export default function JitsiMeet({ roomName, displayName, height, role }) {
  var containerRef = useRef(null);
  var apiRef       = useRef(null);

  useEffect(function() {
    if (!roomName) return;

    // Sanitise room name — alphanumeric only, consistent prefix
    var room = 'DExamViva' + String(roomName).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
    var h    = height || 400;
    var isStudent = role !== 'admin';

    function initJitsi() {
      if (!window.JitsiMeetExternalAPI) return;
      if (apiRef.current) { try { apiRef.current.dispose(); } catch(e) {} apiRef.current = null; }
      if (!containerRef.current) return;

      try {
        apiRef.current = new window.JitsiMeetExternalAPI('8x8.vc', {
          roomName: 'vpaas-magic-cookie-free/' + room,
          width:    '100%',
          height:   h,
          parentNode: containerRef.current,
          userInfo: { displayName: displayName || 'User', email: '' },

          configOverwrite: {
            // No pre-join lobby
            prejoinPageEnabled:   false,
            prejoinConfig:        { enabled: false },

            // Devices on by default
            startWithAudioMuted:  false,
            startWithVideoUnmuted: true,
            startWithVideoMuted:  false,

            // No watermarks or branding
            disableDeepLinking:   true,
            disableMobilePage:    true,

            // No extra panels
            disablePolls:           true,
            disableReactions:       true,
            disableReactionsModeration: true,
            disableInviteFunctions: true,
            hideConferenceSubject:  true,
            hideConferenceTimer:    true,
            disableProfile:         isStudent,

            // Security off — open rooms
            lobby: { enabled: false },
            securityUi: { hideLobbyButton: true, disableLobbyPassword: true },

            // No recording/live-streaming
            fileRecordingsEnabled:         false,
            liveStreamingEnabled:          false,
            localRecording:                { enabled: false },

            // Audio quality
            enableNoisyMicDetection:       false,
            enableNoAudioDetection:        false,

            // Force tile view — shows all participants including remote video
            defaultLocalDisplayName:       displayName || 'User',
            tileView:                      { numberOfVisibleTiles: 2 },
          },

          interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK:              false,
            SHOW_WATERMARK_FOR_GUESTS:         false,
            SHOW_BRAND_WATERMARK:              false,
            SHOW_POWERED_BY:                   false,
            DISPLAY_WELCOME_PAGE_CONTENT:      false,
            APP_NAME:                          'DExam Viva',
            NATIVE_APP_NAME:                   'DExam Viva',
            PROVIDER_NAME:                     'DExam',
            DEFAULT_BACKGROUND:                '#0a0a14',
            DEFAULT_LOCAL_DISPLAY_NAME:        displayName || 'User',
            SETTINGS_SECTIONS:                 ['devices'],
            HIDE_INVITE_MORE_HEADER:           true,
            DISABLE_JOIN_LEAVE_NOTIFICATIONS:  true,
            DISABLE_FOCUS_INDICATOR:           true,
            TOOLBAR_ALWAYS_VISIBLE:            false,
            INITIAL_TOOLBAR_TIMEOUT:           2000,
            TOOLBAR_TIMEOUT:                   4000,

            // Student: only mic + camera + hangup
            // Admin:   add fullscreen + device settings
            TOOLBAR_BUTTONS: isStudent
              ? ['microphone', 'camera', 'hangup']
              : ['microphone', 'camera', 'hangup', 'fullscreen', 'fodeviceselection', 'settings'],
          },
        });
      } catch(e) {
        console.error('[JitsiMeet] init failed:', e);
      }
    }

    // Load SDK once, then init
    if (window.JitsiMeetExternalAPI) {
      initJitsi();
      return;
    }

    if (!document.getElementById('jitsi-sdk')) {
      var script    = document.createElement('script');
      script.id     = 'jitsi-sdk';
      script.src    = 'https://8x8.vc/external_api.js';
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
    <div
      ref={containerRef}
      style={{ width: '100%', height: height || 400, borderRadius: 8, overflow: 'hidden', background: '#0a0a14' }}
    />
  );
}
