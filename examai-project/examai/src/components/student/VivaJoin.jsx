import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { apiGet, apiPost } from '../../utils/api';
import { io as ioClient } from 'socket.io-client';

var SOCKET_URL = 'http://localhost:5000';
var AWAY_LIMIT  = 600;

// STUN + free TURN for production (works through firewalls/NAT)
var ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80',  username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443',username: 'openrelayproject', credential: 'openrelayproject' },
];

function saveS(d) { try { sessionStorage.setItem('vj', JSON.stringify(d)); } catch(e) {} }
function loadS() { try { return JSON.parse(sessionStorage.getItem('vj') || 'null'); } catch(e) { return null; } }
function clearS() { try { sessionStorage.removeItem('vj'); } catch(e) {} }

export default function VivaJoin() {
  var store = useStore();
  var _s = loadS() || {};

  var [phase,      setPhaseRaw] = useState(_s.phase || 'join');
  var [roomId,     setRoomId]   = useState(_s.roomId || '');
  var [session,    setSession]  = useState(_s.session || null);
  var [invites,    setInvites]  = useState([]);
  var [camOk,      setCamOk]    = useState(false);
  var [permErr,    setPermErr]  = useState('');
  var [reGranting, setReGranting] = useState(false);
  var [isAway,     setIsAway]   = useState(false);
  var [countdown,  setCountdown] = useState(AWAY_LIMIT);
  var [camOn,      setCamOn]    = useState(true);
  var [micOn,      setMicOn]    = useState(true);
  var [status,     setStatus]   = useState('waiting'); // waiting|connecting|connected|failed

  // Refs
  var selfVid    = useRef(null);
  var remoteVid  = useRef(null);
  var stream     = useRef(null);
  var sock       = useRef(null);
  var pc         = useRef(null);
  var masterInt  = useRef(null);
  var awayStart  = useRef(null);
  var roomIdRef  = useRef(_s.roomId || '');
  var sessionRef = useRef(_s.session || null);
  var phaseRef   = useRef(_s.phase || 'join');
  var isAwayRef  = useRef(false);
  var notified   = useRef(false);
  var adminId    = useRef(null); // admin's socket ID

  useEffect(function() { phaseRef.current = phase; }, [phase]);
  useEffect(function() { isAwayRef.current = isAway; }, [isAway]);
  useEffect(function() { roomIdRef.current = roomId; }, [roomId]);
  useEffect(function() { sessionRef.current = session; }, [session]);

  useEffect(function() {
    if (phase === 'join') clearS();
    else saveS({ phase, roomId, session });
  }, [phase, roomId, session]); // eslint-disable-line

  function setPhase(p) { setPhaseRaw(p); phaseRef.current = p; if (p === 'join') clearS(); else saveS({ phase: p, roomId: roomIdRef.current, session: sessionRef.current }); }

  useEffect(function() { loadInvites(); }, []); // eslint-disable-line
  useEffect(function() { return function() { cleanup(); }; }, []); // eslint-disable-line
  useEffect(function() {
    function onVis() {
      if (document.hidden) {
        setTimeout(function() { if (document.hidden && phaseRef.current === 'room' && !isAwayRef.current) goAway(); }, 2000);
      } else { if (isAwayRef.current) comeback(); }
    }
    document.addEventListener('visibilitychange', onVis);
    return function() { document.removeEventListener('visibilitychange', onVis); };
  }, []); // eslint-disable-line

  function loadInvites() { store.loadNotifications().then(function(n) { setInvites((n||[]).filter(function(x){return x.viva_room_id;})); }); }

  function startMaster() {
    clearInterval(masterInt.current);
    var t = 0;
    masterInt.current = setInterval(function() {
      if (isAwayRef.current && awayStart.current) {
        var rem = AWAY_LIMIT - Math.floor((Date.now() - awayStart.current) / 1000);
        setCountdown(rem > 0 ? rem : 0);
        if (rem <= 0) { awayStart.current = null; isAwayRef.current = false; setIsAway(false); cleanup(); setPhase('timeout'); }
      }
      if (++t >= 5) { t = 0; var vid = roomIdRef.current; if (vid && phaseRef.current === 'room') { apiGet('/viva/' + vid).then(function(s) { if (s && (s.status === 'ended' || s.status === 'locked')) { cleanup(); setPhase('ended'); } }).catch(function(){}); } }
    }, 1000);
  }

  function goAway() {
    if (awayStart.current) return;
    awayStart.current = Date.now(); isAwayRef.current = true; setIsAway(true); setCountdown(AWAY_LIMIT);
    if (!notified.current) { notified.current = true; apiPost('/notifications', { title: 'Student Left Viva', message: (store.currentUser.name||'Student') + ' left the viva room.', type: 'urgent' }).catch(function(){}); }
  }

  function comeback() {
    awayStart.current = null; isAwayRef.current = false; notified.current = false; setIsAway(false); setCountdown(AWAY_LIMIT);
    if (selfVid.current && stream.current) selfVid.current.srcObject = stream.current;
    apiPost('/notifications', { title: 'Student Returned', message: (store.currentUser.name||'Student') + ' returned.', type: 'success' }).catch(function(){});
  }

  function cleanup() {
    clearInterval(masterInt.current);
    if (pc.current) { try { pc.current.close(); } catch(e){} pc.current = null; }
    if (sock.current) { try { sock.current.disconnect(); } catch(e){} sock.current = null; }
    if (stream.current) { stream.current.getTracks().forEach(function(t){t.stop();}); stream.current = null; }
    adminId.current = null;
  }

  // ── Join flow ───────────────────────────────────────────────────────────────
  async function handleJoin(id) {
    var vid = (id || roomId || '').trim(); if (!vid) return;
    try {
      var s = await apiGet('/viva/' + vid);
      if (!s) { alert('Room not found'); return; }
      if (s.status === 'ended' || s.status === 'locked') { alert('Session already ended.'); return; }
      setSession(s); sessionRef.current = s; setRoomId(vid); roomIdRef.current = vid; setPhase('permission');
    } catch(e) { alert('Room not found: ' + e.message); }
  }

  async function requestPermissions() {
    setPermErr('');
    try {
      var s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.current = s; setCamOk(true); setReGranting(false);
      var iv = setInterval(function() { if (document.querySelector('video[data-preview]')) { document.querySelector('video[data-preview]').srcObject = s; clearInterval(iv); } }, 100);
    } catch(e) { setPermErr('Camera/mic denied — please allow in browser settings.'); }
  }

  function enterRoom() {
    setPhase('room'); startMaster(); setStatus('connecting');
    // Attach self video
    var att = 0;
    var iv = setInterval(function() {
      if (++att > 40) { clearInterval(iv); return; }
      if (!selfVid.current || !stream.current) return;
      clearInterval(iv);
      selfVid.current.srcObject = stream.current;
      selfVid.current.muted = true;
      selfVid.current.play().catch(function(){});
      connectSocket();
    }, 150);
  }

  // ── WebRTC signaling via Socket.IO ──────────────────────────────────────────
  function connectSocket() {
    var vid = roomIdRef.current; if (!vid) return;
    if (sock.current) { try { sock.current.disconnect(); } catch(e){} }

    var s = ioClient(SOCKET_URL, { transports: ['websocket', 'polling'] });
    sock.current = s;

    s.on('connect', function() {
      var name = localStorage.getItem('examai_user_name') || store.currentUser.name || 'Student';
      s.emit('join-viva', { viva_id: vid, role: 'student', name: name });
    });

    s.on('room-joined', function() {
      console.log('[Student] Joined room, waiting for admin...');
    });

    // Admin is ready — student creates peer and waits for admin's offer
    s.on('admin-ready', function(data) {
      console.log('[Student] Admin is ready:', data.adminId);
      adminId.current = data.adminId;
      createPeer(s);
    });

    // Buffer ICE candidates before offer/remoteDescription is set
    var pendingIce = [];
    var remoteSet = false;

    s.on('offer', async function(data) {
      console.log('[Student] Received offer from admin');
      if (!pc.current) createPeer(s);
      try {
        await pc.current.setRemoteDescription(new RTCSessionDescription(data.offer));
        remoteSet = true;
        // Drain buffered ICE candidates
        console.log('[Student] Remote desc set, draining', pendingIce.length, 'buffered candidates');
        for (var c of pendingIce) {
          try { await pc.current.addIceCandidate(new RTCIceCandidate(c)); } catch(e) {}
        }
        pendingIce = [];
        var answer = await pc.current.createAnswer();
        await pc.current.setLocalDescription(answer);
        s.emit('answer', { to: data.from, answer: pc.current.localDescription });
        console.log('[Student] Answer sent');
      } catch(e) { console.error('[Student] answer failed:', e); }
    });

    s.on('ice', async function(data) {
      if (!data.candidate) return;
      if (!remoteSet) {
        pendingIce.push(data.candidate);
        return;
      }
      if (pc.current) {
        try { await pc.current.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch(e) {}
      }
    });

    s.on('admin-left', function() { setStatus('waiting'); });
    s.on('viva-ended', function() { cleanup(); setPhase('ended'); });
    s.on('disconnect', function() { setStatus('waiting'); });
    s.on('connect_error', function(e) { console.error('[Student] Socket error:', e); });
  }

  function createPeer(s) {
    if (pc.current) { try { pc.current.close(); } catch(e){} }
    var vid = roomIdRef.current;

    var p = new RTCPeerConnection({ iceServers: ICE });
    pc.current = p;

    // Add our tracks so admin can see/hear us
    if (stream.current) {
      stream.current.getTracks().forEach(function(t) {
        p.addTrack(t, stream.current);
      });
    }

    // When admin's stream arrives — attach to remote video
    p.ontrack = function(e) {
      console.log('[Student] Remote track received:', e.track.kind);
      if (remoteVid.current && e.streams && e.streams[0]) {
        remoteVid.current.srcObject = e.streams[0];
        remoteVid.current.play().catch(function(){});
        setStatus('connected');
      }
    };

    // Send our ICE candidates to admin
    p.onicecandidate = function(e) {
      if (e.candidate && adminId.current) {
        s.emit('ice', { to: adminId.current, candidate: e.candidate });
      }
    };

    p.oniceconnectionstatechange = function() {
      console.log('[Student] ICE:', p.iceConnectionState, '| Connection:', p.connectionState);
      if (p.iceConnectionState === 'connected' || p.iceConnectionState === 'completed') {
        setStatus('connected');
        console.log('[Student] ✅ WebRTC CONNECTED — live video active!');
      }
      if (p.iceConnectionState === 'failed') {
        setStatus('failed');
        console.warn('[Student] ❌ ICE failed — restarting');
        try { p.restartIce(); } catch(er) {}
      }
      if (p.iceConnectionState === 'disconnected') setStatus('waiting');
    };

    p.onicegatheringstatechange = function() {
      console.log('[Student] ICE gathering:', p.iceGatheringState);
    };

    p.onconnectionstatechange = function() {
      console.log('[Student] Connection state:', p.connectionState);
    };
  }

  function toggleCam() { if (!stream.current) return; stream.current.getVideoTracks().forEach(function(t){t.enabled=!camOn;}); setCamOn(function(v){return !v;}); }
  function toggleMic() { if (!stream.current) return; stream.current.getAudioTracks().forEach(function(t){t.enabled=!micOn;}); setMicOn(function(v){return !v;}); }

  function leaveRoom() {
    cleanup(); clearS(); setPhase('join'); setSession(null); sessionRef.current = null;
    setRoomId(''); roomIdRef.current = ''; setCamOk(false); setStatus('waiting');
    awayStart.current = null; isAwayRef.current = false; notified.current = false;
    setIsAway(false); setCountdown(AWAY_LIMIT);
  }

  // ── RENDERS ──────────────────────────────────────────────────────────────────
  if ((phase === 'room' || phase === 'permission') && !stream.current && !reGranting) return (
    <div style={{minHeight:'calc(100vh - 60px)',display:'flex',alignItems:'center',justifyContent:'center',background:'#0d0d14',padding:24}}>
      <div style={{textAlign:'center',background:'rgba(255,255,255,.05)',border:'1px solid rgba(255,255,255,.12)',borderRadius:20,padding:'40px 48px',maxWidth:480}}>
        <div style={{fontSize:'3rem',marginBottom:12}}>📷</div>
        <div style={{fontFamily:'Space Grotesk,sans-serif',fontWeight:800,fontSize:'1.4rem',color:'#fff',marginBottom:10}}>Camera Disconnected</div>
        <div style={{fontSize:'0.88rem',color:'#9ca3af',marginBottom:24}}>Your camera was released. Re-grant access to continue.</div>
        <div style={{display:'flex',gap:12,justifyContent:'center'}}>
          <button className="btn btn-primary btn-lg" onClick={function(){setReGranting(true);setCamOk(false);setPermErr('');setPhaseRaw('permission');}}>🔓 Re-grant Camera</button>
          <button className="btn btn-outline" onClick={leaveRoom}>Leave</button>
        </div>
      </div>
    </div>
  );

  if (phase === 'ended') return (
    <div style={{minHeight:'calc(100vh - 60px)',display:'flex',alignItems:'center',justifyContent:'center',background:'#0d0d14'}}>
      <div style={{textAlign:'center',padding:40}}>
        <div style={{fontSize:'4rem',marginBottom:16}}>🏁</div>
        <div style={{fontFamily:'Space Grotesk,sans-serif',fontWeight:800,fontSize:'1.6rem',color:'#fff',marginBottom:12}}>Viva Session Ended</div>
        <div style={{color:'#9ca3af',marginBottom:24}}>Your results will appear in <strong style={{color:'#a78bfa'}}>My Results</strong>.</div>
        <button className="btn btn-primary" onClick={function(){clearS();setPhaseRaw('join');setSession(null);setRoomId('');}}>← Back</button>
      </div>
    </div>
  );

  if (phase === 'timeout') return (
    <div style={{minHeight:'calc(100vh - 60px)',display:'flex',alignItems:'center',justifyContent:'center',background:'#0d0d14'}}>
      <div style={{textAlign:'center',padding:40}}>
        <div style={{fontSize:'4rem',marginBottom:16}}>⏰</div>
        <div style={{fontFamily:'Space Grotesk,sans-serif',fontWeight:800,fontSize:'1.6rem',color:'#fff',marginBottom:12}}>Session Expired</div>
        <button className="btn btn-outline" onClick={leaveRoom}>← Back</button>
      </div>
    </div>
  );

  if (phase === 'join') return (
    <div className="fade-up">
      <div className="page-header"><div><div className="page-title">🎙 Viva Voce</div><div className="page-subtitle">Join your oral examination</div></div></div>
      {invites.length > 0 && (
        <div style={{marginBottom:28}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
            <div style={{fontWeight:700}}>📬 Your Invitations</div>
            <button className="btn btn-ghost btn-sm" onClick={loadInvites}>↻ Refresh</button>
          </div>
          <div className="grid-2">
            {invites.map(function(inv){return(
              <div key={inv.notification_id} className="card" style={{borderLeft:'4px solid var(--accent)'}}>
                <div style={{fontWeight:700,marginBottom:6}}>{inv.title}</div>
                <div style={{fontSize:'0.85rem',color:'var(--text3)',marginBottom:14}}>{inv.message}</div>
                <button className="btn btn-primary btn-sm" onClick={function(){handleJoin(inv.viva_room_id);}}>🚀 Join Now</button>
              </div>
            );})}
          </div>
        </div>
      )}
      <div className="card" style={{maxWidth:480}}>
        <div className="card-title">Join by Room ID</div>
        <div style={{display:'flex',gap:8,marginTop:12}}>
          <input className="form-input" value={roomId} onChange={function(e){setRoomId(e.target.value);roomIdRef.current=e.target.value;}} placeholder="Paste Room ID…" style={{flex:1}}/>
          <button className="btn btn-primary" onClick={function(){handleJoin();}} disabled={!roomId.trim()}>Join</button>
        </div>
      </div>
    </div>
  );

  if (phase === 'permission') return (
    <div className="fade-up" style={{maxWidth:520,margin:'40px auto',textAlign:'center'}}>
      <div style={{fontSize:'3rem',marginBottom:12}}>🎥</div>
      <div style={{fontFamily:'Space Grotesk,sans-serif',fontWeight:800,fontSize:'1.4rem',marginBottom:20}}>Camera & Microphone Required</div>
      {camOk && <div style={{marginBottom:18}}><video data-preview autoPlay muted playsInline style={{width:'100%',maxWidth:320,borderRadius:12,background:'#000'}}/></div>}
      {permErr && <div style={{padding:12,background:'rgba(220,38,38,.08)',border:'1px solid rgba(220,38,38,.2)',borderRadius:8,color:'var(--danger)',fontSize:'0.85rem',marginBottom:16}}>{permErr}</div>}
      {!camOk
        ? <button className="btn btn-primary btn-lg" onClick={requestPermissions}>🔓 Grant Camera & Mic</button>
        : <button className="btn btn-success btn-lg" onClick={enterRoom}>🚀 Enter Viva Room</button>
      }
    </div>
  );

  // ── ROOM ─────────────────────────────────────────────────────────────────────
  var mm = Math.floor(countdown/60), ss = countdown%60, urgent = countdown < 120;
  var statusColor = { waiting:'#6b7280', connecting:'#f59e0b', connected:'#22c55e', failed:'#dc2626' }[status] || '#6b7280';
  var statusLabel = { waiting:'⏳ Waiting for examiner…', connecting:'🔄 Connecting…', connected:'🟢 Examiner connected', failed:'❌ Connection failed — try reconnecting' }[status] || '';

  return (
    <div className="viva-dark fade-up" style={{position:'relative'}}>
      {isAway && (
        <div style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(13,13,20,.96)',display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(4px)'}}>
          <div style={{textAlign:'center',padding:40}}>
            <div style={{fontSize:'4rem',marginBottom:12}}>⏸</div>
            <div style={{fontFamily:'Space Grotesk,sans-serif',fontWeight:800,fontSize:'1.8rem',color:'#fff',marginBottom:8}}>You Left the Room</div>
            <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:'4.5rem',fontWeight:900,color:urgent?'#dc2626':'#f59e0b',marginBottom:20}}>{String(mm).padStart(2,'0')}:{String(ss).padStart(2,'0')}</div>
            <button className="btn btn-primary btn-lg" onClick={comeback} style={{padding:'14px 48px'}}>▶ Return to Room</button>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20,flexWrap:'wrap',gap:10}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <span className="badge badge-success">🟢 In Room</span>
          <span style={{fontWeight:700,color:'#fff',fontSize:'1.05rem'}}>{session ? session.title : 'Viva Session'}</span>
        </div>
        <button className="btn btn-sm btn-outline" onClick={function(){if(window.confirm('Leave the viva room?'))leaveRoom();}}>Leave</button>
      </div>

      {/* Video panels */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,maxWidth:900,margin:'0 auto'}}>

        {/* Your camera */}
        <div className="card" style={{padding:12}}>
          <div style={{fontSize:'0.7rem',fontWeight:700,color:'#9ca3af',letterSpacing:1,marginBottom:8,textAlign:'center',fontFamily:'JetBrains Mono,monospace'}}>📹 YOU</div>
          <div style={{position:'relative',borderRadius:8,overflow:'hidden',background:'#000',aspectRatio:'4/3'}}>
            <video ref={selfVid} autoPlay muted playsInline style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
            <div style={{position:'absolute',bottom:8,left:'50%',transform:'translateX(-50%)',background:'rgba(0,0,0,.7)',color:'#fff',fontSize:'0.65rem',padding:'3px 12px',borderRadius:12,whiteSpace:'nowrap',fontWeight:600}}>{store.currentUser.name}</div>
          </div>
          <div style={{display:'flex',gap:8,marginTop:10,justifyContent:'center'}}>
            <button className={'btn btn-sm '+(camOn?'btn-success':'btn-danger')} onClick={toggleCam}>{camOn?'📷 Cam On':'📷 Cam Off'}</button>
            <button className={'btn btn-sm '+(micOn?'btn-success':'btn-danger')} onClick={toggleMic}>{micOn?'🎤 Mic On':'🎤 Mic Off'}</button>
          </div>
        </div>

        {/* Examiner camera — real WebRTC video */}
        <div className="card" style={{padding:12}}>
          <div style={{fontSize:'0.7rem',fontWeight:700,color:'#9ca3af',letterSpacing:1,marginBottom:8,textAlign:'center',fontFamily:'JetBrains Mono,monospace'}}>👨‍🏫 EXAMINER</div>
          <div style={{position:'relative',borderRadius:8,overflow:'hidden',background:'#111',aspectRatio:'4/3'}}>
            <video ref={remoteVid} autoPlay playsInline style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
            {status !== 'connected' && (
              <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:10,background:'#111'}}>
                <div style={{fontSize:'3rem',opacity:.3}}>👨‍🏫</div>
                <div style={{fontSize:'0.8rem',color:'#6b7280',fontWeight:600}}>{statusLabel}</div>
                {status === 'failed' && (
                  <button onClick={function(){if(sock.current)sock.current.disconnect();connectSocket();}} style={{padding:'6px 16px',borderRadius:8,border:'none',background:'rgba(124,58,237,.4)',color:'#a78bfa',fontSize:'0.75rem',fontWeight:700,cursor:'pointer'}}>🔄 Reconnect</button>
                )}
              </div>
            )}
          </div>
          <div style={{textAlign:'center',marginTop:8,fontSize:'0.8rem',fontWeight:600,color:statusColor}}>{statusLabel}</div>
        </div>
      </div>

      <div style={{maxWidth:900,margin:'14px auto 0',padding:'10px 16px',background:'rgba(124,58,237,.1)',border:'1px solid rgba(124,58,237,.25)',borderRadius:10,fontSize:'0.82rem',color:'#a78bfa',textAlign:'center'}}>
        🎤 Speak clearly. Your examiner can see and hear you in real time.
      </div>
    </div>
  );
}
