import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { apiGet, apiPost } from '../../utils/api';
import { io as ioClient } from 'socket.io-client';

var SOCKET_URL = 'http://localhost:5000';
var AWAY_LIMIT_SEC = 600;

function saveVJ(d) { try { sessionStorage.setItem('vj_session', JSON.stringify(d)); } catch(e) {} }
function loadVJ() { try { return JSON.parse(sessionStorage.getItem('vj_session') || 'null'); } catch(e) { return null; } }
function clearVJ() { try { sessionStorage.removeItem('vj_session'); } catch(e) {} }

export default function VivaJoin() {
  var store = useStore();
  var _s = loadVJ() || {};

  var [phase,         setPhaseRaw]    = useState(_s.phase || 'join');
  var [isAway,        setIsAway]      = useState(false);
  var [roomId,        setRoomId]      = useState(_s.roomId || '');
  var [invites,       setInvites]     = useState([]);
  var [session,       setSession]     = useState(_s.session || null);
  var [camOn,         setCamOn]       = useState(true);
  var [micOn,         setMicOn]       = useState(true);
  var [awayCountdown, setAwayCountdown] = useState(AWAY_LIMIT_SEC);
  var [peerConnected, setPeerConnected] = useState(false);
  var [camOk,         setCamOk]       = useState(false);
  var [permErr,       setPermErr]     = useState('');
  var [reGranting,    setReGranting]  = useState(false);

  var previewRef   = useRef(null);
  var selfVidRef   = useRef(null);
  var remoteCanvas = useRef(null);
  var streamRef    = useRef(null);
  var sockRef      = useRef(null);
  var frameTimer   = useRef(null);
  var audioProc    = useRef(null);
  var masterRef    = useRef(null);
  var awayStart    = useRef(null);
  var roomIdRef    = useRef(_s.roomId || '');
  var sessionRef   = useRef(_s.session || null);
  var phaseRef     = useRef(_s.phase || 'join');
  var isAwayRef    = useRef(false);
  var notified     = useRef(false);

  useEffect(function() { phaseRef.current = phase; }, [phase]);
  useEffect(function() { isAwayRef.current = isAway; }, [isAway]);
  useEffect(function() { roomIdRef.current = roomId; }, [roomId]);
  useEffect(function() { sessionRef.current = session; }, [session]);

  useEffect(function() {
    if (phase === 'join') clearVJ();
    else saveVJ({ phase, roomId, session });
  }, [phase, roomId, session]); // eslint-disable-line

  function setPhase(p) {
    setPhaseRaw(p); phaseRef.current = p;
    if (p === 'join') clearVJ();
    else saveVJ({ phase: p, roomId: roomIdRef.current, session: sessionRef.current });
  }

  useEffect(function() { loadInvites(); }, []); // eslint-disable-line
  useEffect(function() {
    return function() { clearInterval(masterRef.current); stopAll(); };
  }, []); // eslint-disable-line

  function loadInvites() {
    store.loadNotifications().then(function(n) {
      setInvites((n || []).filter(function(x) { return x.viva_room_id; }));
    });
  }

  // ── Away tracking ──────────────────────────────────────────
  useEffect(function() {
    function onVis() {
      if (document.hidden) {
        setTimeout(function() {
          if (document.hidden && phaseRef.current === 'room' && !isAwayRef.current) startAway();
        }, 2000);
      } else {
        if (isAwayRef.current) returnToRoom();
      }
    }
    document.addEventListener('visibilitychange', onVis);
    return function() { document.removeEventListener('visibilitychange', onVis); };
  }, []); // eslint-disable-line

  function startMasterInterval() {
    clearInterval(masterRef.current);
    var tick = 0;
    masterRef.current = setInterval(function() {
      if (isAwayRef.current && awayStart.current) {
        var rem = AWAY_LIMIT_SEC - Math.floor((Date.now() - awayStart.current) / 1000);
        setAwayCountdown(rem > 0 ? rem : 0);
        if (rem <= 0) { awayStart.current = null; isAwayRef.current = false; setIsAway(false); stopAll(); setPhase('timeout'); }
      }
      if (++tick >= 5) {
        tick = 0;
        var vid = roomIdRef.current;
        if (vid && phaseRef.current === 'room') {
          apiGet('/viva/' + vid).then(function(s) {
            if (s && (s.status === 'ended' || s.status === 'locked')) { clearInterval(masterRef.current); stopAll(); setPhase('ended'); }
          }).catch(function() {});
        }
      }
    }, 1000);
  }

  function startAway() {
    if (awayStart.current) return;
    awayStart.current = Date.now(); isAwayRef.current = true; setIsAway(true); setAwayCountdown(AWAY_LIMIT_SEC);
    if (!notified.current) {
      notified.current = true;
      apiPost('/notifications', { title: 'Student Left Viva Room', message: (store.currentUser.name || 'Student') + ' left the viva room.', type: 'urgent' }).catch(function() {});
    }
  }

  function returnToRoom() {
    awayStart.current = null; isAwayRef.current = false; notified.current = false;
    setIsAway(false); setAwayCountdown(AWAY_LIMIT_SEC);
    if (selfVidRef.current && streamRef.current) selfVidRef.current.srcObject = streamRef.current;
    apiPost('/notifications', { title: 'Student Returned', message: (store.currentUser.name || 'Student') + ' returned to the viva room.', type: 'success' }).catch(function() {});
  }

  // ── Stop everything ────────────────────────────────────────
  function stopAll() {
    clearInterval(frameTimer.current); frameTimer.current = null;
    if (audioProc.current) {
      try { audioProc.current.proc.disconnect(); audioProc.current.src.disconnect(); audioProc.current.ctx.close(); } catch(e) {}
      audioProc.current = null;
    }
    if (sockRef.current) { try { sockRef.current.disconnect(); } catch(e) {} sockRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(function(t) { t.stop(); }); streamRef.current = null; }
  }

  // ── Join flow ──────────────────────────────────────────────
  async function handleJoin(id) {
    var vid = (id || roomId || '').trim();
    if (!vid) return;
    try {
      var s = await apiGet('/viva/' + vid);
      if (!s) { alert('Room not found'); return; }
      if (s.status === 'ended' || s.status === 'locked') { alert('This viva session has already ended.'); return; }
      setSession(s); sessionRef.current = s;
      setRoomId(vid); roomIdRef.current = vid;
      setPhase('permission');
    } catch(e) { alert('Room not found: ' + e.message); }
  }

  async function requestPermissions() {
    setPermErr('');
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream; setCamOk(true); setReGranting(false);
      var iv = setInterval(function() { if (previewRef.current) { previewRef.current.srcObject = stream; clearInterval(iv); } }, 100);
    } catch(e) {
      setPermErr('Camera/mic denied. Please allow access in your browser and try again.');
    }
  }

  function enterRoom() {
    setPhase('room');
    startMasterInterval();
    // Attach self-video
    var att = 0;
    var iv = setInterval(function() {
      if (++att > 40) { clearInterval(iv); return; }
      if (!selfVidRef.current || !streamRef.current) return;
      clearInterval(iv);
      selfVidRef.current.srcObject = streamRef.current;
      selfVidRef.current.muted = true;
      selfVidRef.current.play().catch(function() {});
    }, 150);
    // Connect socket after a short delay so room renders first
    setTimeout(connectSocket, 500);
  }

  // ── Socket + video relay ───────────────────────────────────
  function connectSocket() {
    var vid = roomIdRef.current;
    if (!vid) return;
    if (sockRef.current) { try { sockRef.current.disconnect(); } catch(e) {} sockRef.current = null; }

    var sock = ioClient(SOCKET_URL, { transports: ['websocket', 'polling'] });
    sockRef.current = sock;

    sock.on('connect', function() {
      var name = localStorage.getItem('examai_user_name') || store.currentUser.name || 'Student';
      sock.emit('join-room', { viva_id: vid, role: 'student', name: name });
    });

    sock.on('joined-ack', function() {
      // Start sending our video + audio
      startVideo(sock);
      startAudio(sock);
    });

    sock.on('peer-joined', function(data) {
      if (data.role === 'admin') setPeerConnected(true);
    });

    sock.on('peer-left', function(data) {
      if (data.role === 'admin') setPeerConnected(false);
    });

    var adminConnectedRef = { current: false };

    sock.on('remote-frame', function(data) {
      if (data.role !== 'admin') return;
      var canvas = remoteCanvas.current;
      if (!canvas) return;
      var img = new window.Image();
      img.onload = function() {
        try {
          var ctx = canvas.getContext('2d');
          canvas.width = img.width || 320;
          canvas.height = img.height || 240;
          ctx.drawImage(img, 0, 0);
          if (!adminConnectedRef.current) {
            adminConnectedRef.current = true;
            setPeerConnected(true);
          }
        } catch(e) {}
      };
      img.src = data.frame;
    });

    var remAudioCtx = null;
    sock.on('remote-audio', function(data) {
      if (data.role !== 'admin') return;
      try {
        if (!remAudioCtx) remAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (remAudioCtx.state === 'suspended') remAudioCtx.resume();
        var buf = remAudioCtx.createBuffer(1, data.chunk.length, 44100);
        buf.getChannelData(0).set(new Float32Array(data.chunk));
        var src = remAudioCtx.createBufferSource();
        src.buffer = buf; src.connect(remAudioCtx.destination); src.start();
      } catch(e) {}
    });

    sock.on('session-ended', function() { stopAll(); setPhase('ended'); });
    sock.on('disconnect', function() { setPeerConnected(false); });
  }

  function startVideo(sock) {
    clearInterval(frameTimer.current);
    var cap = document.createElement('canvas');
    cap.width = 320; cap.height = 240;
    var ctx = cap.getContext('2d');
    var track = streamRef.current && streamRef.current.getVideoTracks()[0];
    var sent = 0;

    function sendFrame() {
      if (!sock.connected || !streamRef.current) return;
      // Try ImageCapture first (most reliable)
      if (track && window.ImageCapture) {
        try {
          var ic = new ImageCapture(track);
          ic.grabFrame().then(function(bmp) {
            ctx.drawImage(bmp, 0, 0, 320, 240);
            sock.volatile.emit('video-frame', cap.toDataURL('image/jpeg', 0.4));
            sent++;
          }).catch(function() { fallback(); });
        } catch(e) { fallback(); }
      } else { fallback(); }
    }

    function fallback() {
      var v = selfVidRef.current;
      if (v && v.readyState >= 2 && v.videoWidth > 0) {
        try {
          ctx.drawImage(v, 0, 0, 320, 240);
          sock.volatile.emit('video-frame', cap.toDataURL('image/jpeg', 0.4));
          sent++;
        } catch(e) {}
      }
    }

    frameTimer.current = setInterval(sendFrame, 200);
    // Log after 2s to confirm frames are going out
    setTimeout(function() { console.log('[Student] Frames sent so far:', sent); }, 2000);
  }

  function startAudio(sock) {
    if (!streamRef.current) return;
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var src = ctx.createMediaStreamSource(streamRef.current);
      var proc = ctx.createScriptProcessor(4096, 1, 1);
      proc.onaudioprocess = function(e) {
        if (!sock.connected) return;
        var d = e.inputBuffer.getChannelData(0);
        sock.volatile.emit('audio-chunk', Array.from(d));
      };
      src.connect(proc);
      proc.connect(ctx.destination);
      audioProc.current = { ctx, src, proc };
    } catch(e) { console.warn('[Student] Audio failed:', e); }
  }

  function toggleCam() {
    if (!streamRef.current) return;
    streamRef.current.getVideoTracks().forEach(function(t) { t.enabled = !camOn; });
    setCamOn(function(v) { return !v; });
  }
  function toggleMic() {
    if (!streamRef.current) return;
    streamRef.current.getAudioTracks().forEach(function(t) { t.enabled = !micOn; });
    setMicOn(function(v) { return !v; });
  }

  function leaveRoom() {
    clearInterval(masterRef.current); stopAll();
    clearVJ(); setPhase('join'); setSession(null); sessionRef.current = null;
    setRoomId(''); roomIdRef.current = '';
    setCamOk(false); setPeerConnected(false);
    awayStart.current = null; isAwayRef.current = false; notified.current = false;
    setIsAway(false); setAwayCountdown(AWAY_LIMIT_SEC);
  }

  // ── RENDERS ────────────────────────────────────────────────
  if ((phase === 'room' || phase === 'permission') && !streamRef.current && !reGranting) return (
    <div style={{ minHeight: 'calc(100vh - 60px)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d0d14', padding: 24 }}>
      <div style={{ textAlign: 'center', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 20, padding: '44px 52px', maxWidth: 480 }}>
        <div style={{ fontSize: '3.5rem', marginBottom: 16 }}>📷</div>
        <div style={{ fontFamily: 'Space Grotesk,sans-serif', fontWeight: 800, fontSize: '1.5rem', color: '#fff', marginBottom: 10 }}>
          {session ? session.title : 'Viva Room'} — Re-connect Camera
        </div>
        <div style={{ fontSize: '0.9rem', color: '#9ca3af', lineHeight: 1.75, marginBottom: 28 }}>
          Your camera was released. Click below to re-grant access and rejoin.
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button className="btn btn-primary btn-lg" onClick={function() { setReGranting(true); setCamOk(false); setPermErr(''); setPhaseRaw('permission'); }}>🔓 Re-grant Camera & Mic</button>
          <button className="btn btn-outline" onClick={leaveRoom}>Leave Session</button>
        </div>
      </div>
    </div>
  );

  if (phase === 'ended') return (
    <div style={{ minHeight: 'calc(100vh - 60px)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d0d14', padding: 24 }}>
      <div style={{ textAlign: 'center', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 20, padding: '44px 52px', maxWidth: 460 }}>
        <div style={{ fontSize: '4rem', marginBottom: 18 }}>🏁</div>
        <div style={{ fontFamily: 'Space Grotesk,sans-serif', fontWeight: 800, fontSize: '1.7rem', color: '#fff', marginBottom: 12 }}>Viva Session Ended</div>
        <div style={{ fontSize: '0.9rem', color: '#9ca3af', lineHeight: 1.75, marginBottom: 28 }}>Your results will appear in <strong style={{ color: '#a78bfa' }}>My Results</strong> after grading.</div>
        <button className="btn btn-primary" onClick={function() { clearVJ(); setPhaseRaw('join'); setSession(null); setRoomId(''); }}>← Back to Viva Page</button>
      </div>
    </div>
  );

  if (phase === 'timeout') return (
    <div style={{ minHeight: 'calc(100vh - 60px)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d0d14', padding: 24 }}>
      <div style={{ textAlign: 'center', background: 'rgba(220,38,38,.06)', border: '1px solid rgba(220,38,38,.2)', borderRadius: 20, padding: '44px 52px', maxWidth: 460 }}>
        <div style={{ fontSize: '4rem', marginBottom: 18 }}>⏰</div>
        <div style={{ fontFamily: 'Space Grotesk,sans-serif', fontWeight: 800, fontSize: '1.7rem', color: '#fff', marginBottom: 12 }}>Session Expired</div>
        <div style={{ fontSize: '0.9rem', color: '#9ca3af', lineHeight: 1.75, marginBottom: 28 }}>You did not return within 10 minutes.</div>
        <button className="btn btn-outline" onClick={leaveRoom}>← Back to Viva Page</button>
      </div>
    </div>
  );

  if (phase === 'join') return (
    <div className="fade-up">
      <div className="page-header"><div><div className="page-title">🎙 Viva Voce</div><div className="page-subtitle">Join your oral examination session</div></div></div>
      {invites.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>📬 Your Viva Invitations</div>
            <button className="btn btn-ghost btn-sm" onClick={loadInvites}>↻ Refresh</button>
          </div>
          <div className="grid-2">
            {invites.map(function(inv) { return (
              <div key={inv.notification_id} className="card" style={{ borderLeft: '4px solid var(--accent)' }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{inv.title}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text3)', marginBottom: 14 }}>{inv.message}</div>
                <button className="btn btn-primary btn-sm" onClick={function() { handleJoin(inv.viva_room_id); }}>🚀 Join Now</button>
              </div>
            ); })}
          </div>
        </div>
      )}
      <div className="card" style={{ maxWidth: 480 }}>
        <div className="card-title">Join by Room ID</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input className="form-input" value={roomId} onChange={function(e) { setRoomId(e.target.value); roomIdRef.current = e.target.value; }} placeholder="Paste Room ID here…" style={{ flex: 1 }}/>
          <button className="btn btn-primary" onClick={function() { handleJoin(); }} disabled={!roomId.trim()}>Join</button>
        </div>
      </div>
    </div>
  );

  if (phase === 'permission') return (
    <div className="fade-up" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
      <div style={{ fontSize: '3rem', marginBottom: 12 }}>🎥</div>
      <div style={{ fontFamily: 'Space Grotesk,sans-serif', fontWeight: 800, fontSize: '1.4rem', marginBottom: 6 }}>Camera & Microphone</div>
      <div style={{ color: 'var(--text3)', marginBottom: 24 }}>Both are required for your viva session</div>
      {camOk && <div style={{ marginBottom: 18 }}><video ref={previewRef} autoPlay muted playsInline style={{ width: '100%', maxWidth: 320, borderRadius: 12, background: '#000' }}/></div>}
      {permErr && <div style={{ padding: 12, background: 'rgba(220,38,38,.08)', border: '1px solid rgba(220,38,38,.2)', borderRadius: 8, color: 'var(--danger)', fontSize: '0.85rem', marginBottom: 16 }}>{permErr}</div>}
      {!camOk
        ? <button className="btn btn-primary btn-lg" onClick={requestPermissions}>🔓 Grant Camera & Mic Access</button>
        : <button className="btn btn-success btn-lg" onClick={enterRoom}>🚀 Enter Viva Room</button>
      }
    </div>
  );

  // ── ROOM ────────────────────────────────────────────────────
  var mm = Math.floor(awayCountdown / 60);
  var ss = awayCountdown % 60;
  var isUrgent = awayCountdown < 120;

  return (
    <div className="viva-dark fade-up" style={{ position: 'relative' }}>
      {isAway && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(13,13,20,.96)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', backdropFilter: 'blur(4px)' }}>
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: '4rem', marginBottom: 16 }}>⏸</div>
            <div style={{ fontFamily: 'Space Grotesk,sans-serif', fontWeight: 800, fontSize: '1.9rem', color: '#fff', marginBottom: 8 }}>You Left the Viva Room</div>
            <div style={{ fontSize: '0.9rem', color: '#9ca3af', marginBottom: 32 }}>Your examiner has been notified. Return before the timer expires.</div>
            <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: '5.5rem', fontWeight: 900, color: isUrgent ? '#dc2626' : '#f59e0b', letterSpacing: 8, marginBottom: 12, lineHeight: 1 }}>
              {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
            </div>
            <button className="btn btn-primary btn-lg" onClick={returnToRoom} style={{ padding: '14px 48px', fontSize: '1.05rem' }}>▶ Return to Viva Room</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="badge badge-success">🟢 Connected</span>
          <span style={{ fontWeight: 700, color: '#fff', fontSize: '1.05rem' }}>{session ? session.title : 'Viva Session'}</span>
        </div>
        <button className="btn btn-sm btn-outline" onClick={function() { if (window.confirm('Leave the viva room?')) leaveRoom(); }}>Leave</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 860, margin: '0 auto' }}>
        {/* Own video */}
        <div className="card" style={{ padding: 12 }}>
          <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#000', lineHeight: 0 }}>
            <video ref={selfVidRef} autoPlay muted playsInline style={{ width: '100%', height: 220, objectFit: 'cover', display: 'block' }}/>
            <div style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: '0.65rem', padding: '3px 12px', borderRadius: 12, whiteSpace: 'nowrap', fontWeight: 600 }}>
              You ({store.currentUser.name})
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'center' }}>
            <button className={'btn btn-sm ' + (camOn ? 'btn-success' : 'btn-danger')} onClick={toggleCam}>{camOn ? '📷 Cam On' : '📷 Cam Off'}</button>
            <button className={'btn btn-sm ' + (micOn ? 'btn-success' : 'btn-danger')} onClick={toggleMic}>{micOn ? '🎤 Mic On' : '🎤 Mic Off'}</button>
          </div>
        </div>

        {/* Examiner video (canvas) */}
        <div className="card" style={{ padding: 12 }}>
          <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#111', lineHeight: 0 }}>
            <canvas ref={remoteCanvas} width={320} height={240} style={{ width: '100%', height: 220, display: 'block', background: '#111' }}/>
            <div style={{ position: 'absolute', top: 4, right: 8, background: peerConnected ? 'rgba(22,163,74,.85)' : 'rgba(0,0,0,.6)', color: '#fff', fontSize: '0.65rem', padding: '3px 10px', borderRadius: 12, fontWeight: 700 }}>
              {peerConnected ? '🟢 Live' : '⏳ Waiting'}
            </div>
          </div>
          <div style={{ textAlign: 'center', marginTop: 10, fontSize: '0.8rem', color: peerConnected ? '#4ade80' : '#6b7280', fontWeight: 600 }}>
            {peerConnected ? '🟢 Examiner connected — speak clearly' : '⏳ Connecting to examiner…'}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: '14px auto 0', padding: '11px 16px', background: 'rgba(124,58,237,.1)', border: '1px solid rgba(124,58,237,.25)', borderRadius: 10, fontSize: '0.82rem', color: '#a78bfa', textAlign: 'center' }}>
        🎤 Speak clearly into your mic. Your examiner can see and hear you live.
      </div>
    </div>
  );
}
