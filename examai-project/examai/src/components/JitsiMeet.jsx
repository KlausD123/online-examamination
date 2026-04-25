import React, { useEffect, useRef } from 'react';

export default function JitsiMeet({ roomName, displayName, height, role }) {
  var containerRef = useRef(null);
  var apiRef       = useRef(null);

  useEffect(function() {
    if (!roomName) return;

    var room = 'DExamViva' + String(roomName).replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
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
          userInfo:   { displayName: displayName || 'User' },

          configOverwrite: {
            // Skip pre-join completely
            prejoinPageEnabled:            false,
            prejoinConfig:                 { enabled: false },

            // Camera + mic ON from the start
            startWithAudioMuted:           false,
            startWithVideoMuted:           false,
            startAudioOnly:                false,

            // No lobby / moderator gate
            requireDisplayName:            false,
            enableLobbyChat:               false,
            hideLobbyButton:               true,

            // Tile view — both people visible
            defaultRemoteDisplayName:      'Participant',

            // Disable fluff
            disableDeepLinking:            true,
            disableMobilePage:             true,
            disablePolls:                  true,
            disableReactions:              true,
            disableInviteFunctions:        true,
            hideConferenceSubject:         true,
            hideConferenceTimer:           true,
            disableProfile:                isStudent,
            enableNoisyMicDetection:       false,
            enableNoAudioDetection:        false,
            fileRecordingsEnabled:         false,
            liveStreamingEnabled:          false,
            localRecording:                { enabled: false },

            // Keep connection alive
            p2p:                           { enabled: true },
          },

          interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK:               false,
            SHOW_WATERMARK_FOR_GUESTS:          false,
            SHOW_BRAND_WATERMARK:               false,
            SHOW_POWERED_BY:                    false,
            DISPLAY_WELCOME_PAGE_CONTENT:       false,
            APP_NAME:                           'DExam Viva',
            NATIVE_APP_NAME:                    'DExam Viva',
            PROVIDER_NAME:                      'DExam',
            DEFAULT_BACKGROUND:                 '#111111',
            SETTINGS_SECTIONS:                  ['devices'],
            HIDE_INVITE_MORE_HEADER:            true,
            DISABLE_JOIN_LEAVE_NOTIFICATIONS:   true,
            DISABLE_FOCUS_INDICATOR:            true,
            TOOLBAR_ALWAYS_VISIBLE:             true,
            INITIAL_TOOLBAR_TIMEOUT:            20000,
            TOOLBAR_TIMEOUT:                    20000,
            // Student minimal — admin full
            TOOLBAR_BUTTONS: isStudent
              ? ['microphone', 'camera', 'hangup']
              : ['microphone', 'camera', 'hangup', 'fullscreen', 'tileview', 'fodeviceselection', 'settings'],
          },
        });

        // Force camera on after join (handles cases where browser blocks auto-start)
        apiRef.current.addEventListener('videoConferenceJoined', function() {
          try {
            apiRef.current.executeCommand('setVideoQuality', 720);
            // Un-mute video if it got muted on join
            apiRef.current.isVideoMuted().then(function(muted) {
              if (muted) apiRef.current.executeCommand('toggleVideo');
            }).catch(function(){});
          } catch(e) {}
        });

      } catch(e) {
        console.error('[JitsiMeet] init failed:', e);
      }
    }

    if (window.JitsiMeetExternalAPI) {
      initJitsi(); return;
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
    <div ref={containerRef}
      style={{ width: '100%', height: height || 400, borderRadius: 8, overflow: 'hidden', background: '#111' }}
    />
  );
}
