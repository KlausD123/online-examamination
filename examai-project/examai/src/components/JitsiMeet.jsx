import React, { useEffect, useRef, useState } from 'react';

export default function JitsiMeet({ roomName, displayName, height }) {
  var containerRef = useRef(null);
  var apiRef = useRef(null);
  var [status, setStatus] = useState('loading');

  useEffect(function() {
    if (!roomName) return;
    var clean = 'dexamviva' + String(roomName).replace(/[^a-zA-Z0-9]/g,'').toLowerCase().slice(0,24);
    console.log('[Jitsi] Room:', clean, 'Display:', displayName);

    function startJitsi() {
      if (!window.JitsiMeetExternalAPI || !containerRef.current) return;
      if (apiRef.current) { try { apiRef.current.dispose(); } catch(e){} apiRef.current = null; }

      try {
        apiRef.current = new window.JitsiMeetExternalAPI('meet.jit.si', {
          roomName: clean,
          width: '100%',
          height: height || 360,
          parentNode: containerRef.current,
          userInfo: { displayName: displayName || 'User' },
          configOverwrite: {
            prejoinPageEnabled: false,
            startWithAudioMuted: false,
            startWithVideoMuted: false,
            disableDeepLinking: true,
            enableWelcomePage: false,
            requireDisplayName: false,
            p2p: { enabled: true },
            analytics: { disabled: true },
            hideConferenceTimer: false,
            toolbarButtons: [
              'microphone','camera','desktop','fullscreen',
              'fodeviceselection','tileview','settings',
            ],
          },
          interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            SHOW_BRAND_WATERMARK: false,
            SHOW_POWERED_BY: false,
            DISPLAY_WELCOME_FOOTER: false,
            HIDE_INVITE_MORE_HEADER: true,
            SETTINGS_SECTIONS: ['devices','language'],
            MOBILE_APP_PROMO: false,
            filmStripOnly: false,
          }
        });

        apiRef.current.addListener('videoConferenceJoined', function(e) {
          console.log('[Jitsi] Joined:', e);
          setStatus('joined');
        });
        apiRef.current.addListener('videoConferenceLeft', function() {
          setStatus('left');
          setTimeout(function() {
            if (containerRef.current) { setStatus('loading'); startJitsi(); }
          }, 2000);
        });
        apiRef.current.addListener('participantJoined', function(e) {
          console.log('[Jitsi] Participant joined:', e);
        });

        setStatus('connecting');
      } catch(err) {
        console.error('[Jitsi] Error:', err);
        setStatus('error');
      }
    }

    function loadScript(cb) {
      if (window.JitsiMeetExternalAPI) { cb(); return; }
      var existing = document.querySelector('script[data-jitsi]');
      if (existing) {
        existing.addEventListener('load', cb);
        return;
      }
      var s = document.createElement('script');
      s.src = 'https://meet.jit.si/external_api.js';
      s.setAttribute('data-jitsi', '1');
      s.onload = function() { setTimeout(cb, 500); };
      s.onerror = function() { setStatus('error'); console.error('[Jitsi] Script load failed'); };
      document.head.appendChild(s);
    }

    loadScript(startJitsi);

    return function() {
      if (apiRef.current) { try { apiRef.current.dispose(); } catch(e){} apiRef.current = null; }
    };
  }, [roomName, displayName]); // eslint-disable-line

  return (
    <div style={{ position:'relative', width:'100%', borderRadius:8, overflow:'hidden', background:'#0f0f1a', minHeight: height||360 }}>
      {status !== 'joined' && (
        <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', zIndex:10, background:'rgba(15,15,26,0.92)', gap:14 }}>
          {status === 'error'
            ? <div style={{ color:'#f87171', textAlign:'center' }}>
                <div style={{ fontSize:'2rem', marginBottom:8 }}>❌</div>
                <div style={{ fontSize:'0.85rem' }}>Could not connect to video</div>
                <div style={{ fontSize:'0.75rem', color:'#6b7280', marginTop:4 }}>Check your internet connection</div>
              </div>
            : <>
                <div className="spinner" style={{ width:36, height:36, borderColor:'rgba(124,58,237,.3)', borderTopColor:'#7c3aed' }}/>
                <div style={{ color:'#9ca3af', fontSize:'0.85rem' }}>
                  {status === 'connecting' ? 'Joining meeting…' : status === 'left' ? 'Reconnecting…' : 'Loading video…'}
                </div>
                <div style={{ color:'#4b5563', fontSize:'0.72rem' }}>Room: {String(roomName).slice(0,12)}</div>
              </>
          }
        </div>
      )}
      <div ref={containerRef} style={{ width:'100%', minHeight: height||360 }}/>
    </div>
  );
}
