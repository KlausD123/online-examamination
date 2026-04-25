import React, { useEffect, useRef, useState } from 'react';

export default function JitsiMeet({ roomName, displayName, height }) {
  var containerRef = useRef(null);
  var apiRef = useRef(null);
  var [status, setStatus] = useState('loading');

  useEffect(function() {
    if (!roomName) return;
    var cleanRoom = 'DExamViva' + String(roomName).replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);

    function startJitsi() {
      if (!containerRef.current) return;
      if (apiRef.current) { try { apiRef.current.dispose(); } catch(e){} apiRef.current = null; }

      try {
        apiRef.current = new window.JitsiMeetExternalAPI('meet.jit.si', {
          roomName: cleanRoom,
          width: '100%',
          height: height || 380,
          parentNode: containerRef.current,
          userInfo: { displayName: displayName || 'User', email: '' },
          configOverwrite: {
            prejoinPageEnabled: false,
            startWithAudioMuted: false,
            startWithVideoMuted: false,
            disableDeepLinking: true,
            enableWelcomePage: false,
            requireDisplayName: false,
            toolbarButtons: ['microphone', 'camera', 'fullscreen', 'tileview'],
            disablePolls: true,
            disableReactions: true,
            hideConferenceSubject: true,
            defaultLocalDisplayName: displayName || 'User',
            // Auto-join without needing to type name
            p2p: { enabled: true },
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
            DEFAULT_LOCAL_DISPLAY_NAME: displayName || 'User',
          }
        });

        apiRef.current.addListener('videoConferenceJoined', function() {
          setStatus('joined');
        });

        apiRef.current.addListener('videoConferenceLeft', function() {
          setStatus('loading');
          setTimeout(function() { if (containerRef.current) startJitsi(); }, 2000);
        });

        setStatus('connecting');
      } catch(e) {
        console.error('[Jitsi] init failed:', e);
        setStatus('error');
      }
    }

    function loadScript() {
      if (window.JitsiMeetExternalAPI) { setTimeout(startJitsi, 100); return; }
      var existing = document.querySelector('script[src*="meet.jit.si/external_api"]');
      if (existing) { existing.addEventListener('load', function(){ setTimeout(startJitsi, 100); }); return; }
      var s = document.createElement('script');
      s.src = 'https://meet.jit.si/external_api.js';
      s.async = true;
      s.onload = function() { setTimeout(startJitsi, 300); };
      s.onerror = function() { setStatus('error'); };
      document.head.appendChild(s);
    }

    loadScript();

    return function() {
      if (apiRef.current) { try { apiRef.current.dispose(); } catch(e){} apiRef.current = null; }
    };
  }, [roomName, displayName]); // eslint-disable-line

  return (
    <div style={{ position:'relative', width:'100%', borderRadius:8, overflow:'hidden', background:'#1a1a2e', minHeight: height||380 }}>
      {status !== 'joined' && (
        <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', zIndex:1, background:'rgba(26,26,46,0.9)', gap:12 }}>
          <div className="spinner" style={{ width:32, height:32 }}/>
          <div style={{ color:'#9ca3af', fontSize:'0.85rem' }}>
            {status === 'error' ? '❌ Could not connect to video' : status === 'connecting' ? 'Connecting to video room…' : 'Loading video…'}
          </div>
          <div style={{ color:'#6b7280', fontSize:'0.75rem' }}>Room: {String(roomName).slice(0,8)}…</div>
        </div>
      )}
      <div ref={containerRef} style={{ width:'100%', minHeight: height||380 }}/>
    </div>
  );
}
