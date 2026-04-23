import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { apiGet, apiPost } from '../../utils/api';
import { io } from 'socket.io-client';

var ICE_SERVERS = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
]};

var AWAY_LIMIT = 600;
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
  var [peerStatus, setPeerStatus] = useState('waiting'); // waiting|connected|streaming|disconnected

  // Refs — same pattern as the shared VivaRoom component
  var localVid   = useRef(null);  // student's own camera
  var remoteVid  = useRef(null);  // admin's camera
  var streamRef  = useRef(null);
  var socketRef  = useRef(null);
  var pcRef      = useRef(null);
  var masterInt  = useRef(null);
  var awayStart  = useRef(null);
  var roomIdRef  = useRef(_s.roomId || '');
  var sessionRef = useRef(_s.session || null);
  var phaseRef   = useRef(_s.phase || 'join');
  var isAwayRef  = useRef(false);
  var notified   = useRef(false);
  var previewRef = useRef(null);

  useEffect(function() { phaseRef.current = phase; }, [phase]);
  useEffect(function() { isAwayRef.current = isAway; }, [isAway]);
  useEffect(function() { roomIdRef.current = roomId; }, [roomId]);
  useEffect(function() { sessionRef.current = session; }, [session]);
  useEffect(function() {
    if (phase === 'join') clearS(); else saveS({ phase, roomId, session });
  }, [phase, roomId, session]); // eslint-disable-line

  // Cleanup on unmount — same as shared component
  useEffect(function() {
    return function() {
      if (socketRef.current) socketRef.current.disconnect();
      if (pcRef.current) pcRef.current.close();
      if (streamRef.current) streamRef.current.getTracks().forEach(function(t) { t.stop(); });
      clearInterval(masterInt.current);
    };
  }, []); // eslint-disable-line

  // Visibility change handler
  useEffect(function() {
    function onVis() {
      if (document.hidden) {
        setTimeout(function() { if (document.hidden && phaseRef.current === 'room' && !isAwayRef.current) goAway(); }, 2000);
      } else { if (isAwayRef.current) comeback(); }
    }
    document.addEventListener('visibilitychange', onVis);
    return function() { document.removeEventListener('visibilitychange', onVis); };
  }, []); // eslint-disable-line

  useEffect(function() { loadInvites(); }, []); // eslint-disable-line

  function setPhase(p) {
    setPhaseRaw(p); phaseRef.current = p;
    if (p === 'join') clearS(); else saveS({ phase: p, roomId: roomIdRef.current, session: sessionRef.current });
  }

  function loadInvites() {
    store.loadNotifications().then(function(n) { setInvites((n||[]).filter(function(x){return x.viva_room_id;})); });
  }

  function startMaster() {
    clearInterval(masterInt.current);
    var t = 0;
    masterInt.current = setInterval(function() {
      if (isAwayRef.current && awayStart.current) {
        var rem = AWAY_LIMIT - Math.floor((Date.now() - awayStart.current) / 1000);
        setCountdown(rem > 0 ? rem : 0);
        if (rem <= 0) { awayStart.current = null; isAwayRef.current = false; setIsAway(false); cleanup(); setPhase('timeout'); }
      }
      if (++t >= 5) {
        t = 0;
        var vid = roomIdRef.current;
        if (vid && phaseRef.current === 'room') {
          apiGet('/viva/' + vid).then(function(s) {
            if (s && (s.status === 'ended' || s.status === 'locked')) { cleanup(); setPhase('ended'); }
          }).catch(function(){});
        }
      }
    }, 1000);
  }

  function goAway() {
    if (awayStart.current) return;
    awayStart.current = Date.now(); isAwayRef.current = true; setIsAway(true); setCountdown(AWAY_LIMIT);
    if (!notified.current) { notified.current = true; apiPost('/notifications', { title: 'Student Left Viva', message: (store.currentUser.name||'Student') + ' left the viva room.', type: 'urgent' }).catch(function(){}); }
  }

  function comeback() {
    awayStart.current = null; isAwayRef.current = false; notified.current = false; setIsAway(false); setCountdown(AWAY_LIMIT);
    if (localVid.current && streamRef.current) localVid.current.srcObject = streamRef.current;
    apiPost('/notifications', { title: 'Student Returned', message: (store.currentUser.name||'Student') + ' returned.', type: 'success' }).catch(function(){});
  }

  function cleanup() {
    clearInterval(masterInt.current);
    if (pcRef.current) { try { pcRef.current.close(); } catch(e){} pcRef.current = null; }
    if (socketRef.current) { try { socketRef.current.disconnect(); } catch(e){} socketRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(function(t){t.stop();}); streamRef.current = null; }
  }

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
      streamRef.current = s; setCamOk(true); setReGranting(false);
      // Show preview
      var iv = setInterval(function() { if (previewRef.current) { previewRef.current.srcObject = s; clearInterval(iv); } }, 100);
    } catch(e) { setPermErr('Camera/mic denied — please allow in browser settings.'); }
  }

  function enterRoom() {
    setPhase('room'); startMaster();
    // Attach own video
    var att = 0;
    var iv = setInterval(function() {
      if (++att > 40) { clearInterval(iv); return; }
      if (!localVid.current || !streamRef.current) return;
      clearInterval(iv);
      localVid.current.srcObject = streamRef.current;
      localVid.current.muted = true;
      localVid.current.play().catch(function(){});
    }, 100);
    // Connect socket immediately — same pattern as shared VivaRoom
    startSignaling(roomIdRef.current);
  }

  // ── WebRTC signaling — mirrors the shared VivaRoom component exactly ────────
  function startSignaling(vivaId) {
    if (socketRef.current) { try { socketRef.current.disconnect(); } catch(e){} }

    var socket = io('http://localhost:5000');
    socketRef.current = socket;

    socket.on('connect', function() {
      var name = localStorage.getItem('examai_user_name') || store.currentUser.name || 'Student';
      console.log('[Student] Connected, joining room', vivaId);
      socket.emit('join-viva-room', { vivaId: vivaId, role: 'student', userName: name });
    });

    // Admin is already in room — create peer connection and wait for their offer
    socket.on('room-members', function(members) {
      members.forEach(function(m) {
        if (m.role === 'admin') {
          console.log('[Student] Admin already in room, creating peer');
          setPeerStatus('connected');
          createPeerConnection(vivaId, socket);
        }
      });
    });

    // Admin just joined — create peer connection
    socket.on('peer-joined', function(data) {
      if (data.role === 'admin') {
        console.log('[Student] Admin joined room');
        setPeerStatus('connected');
        createPeerConnection(vivaId, socket);
      }
    });

    // Receive offer from admin — set remote desc and send answer
    socket.on('webrtc-offer', async function(data) {
      console.log('[Student] Received offer from admin');
      if (!pcRef.current) createPeerConnection(vivaId, socket);
      var pc = pcRef.current;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        var answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc-answer', { vivaId: vivaId, answer: pc.localDescription });
        console.log('[Student] Answer sent');
      } catch(e) { console.error('[Student] Answer failed:', e); }
    });

    // Receive ICE candidates from admin
    socket.on('webrtc-ice-candidate', function(data) {
      if (pcRef.current && data.candidate) {
        pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(function(){});
      }
    });

    socket.on('peer-left', function(data) {
      if (data.role === 'admin') {
        console.log('[Student] Admin left');
        setPeerStatus('disconnected');
        if (remoteVid.current) remoteVid.current.srcObject = null;
        if (pcRef.current) { try { pcRef.current.close(); } catch(e){} pcRef.current = null; }
      }
    });

    socket.on('disconnect', function() { setPeerStatus('disconnected'); });
  }

  function createPeerConnection(vivaId, socket) {
    if (pcRef.current) { try { pcRef.current.close(); } catch(e){} }

    var pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    // Add our local tracks so admin can see/hear us
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(function(t) {
        pc.addTrack(t, streamRef.current);
        console.log('[Student] Added track:', t.kind);
      });
    }

    // When admin's stream arrives — show it
    pc.ontrack = function(e) {
      console.log('[Student] Got remote track:', e.track.kind);
      if (!e.streams || !e.streams[0]) return;
      var remoteStream = e.streams[0];
      setPeerStatus('streaming');
      var att = 0;
      var iv = setInterval(function() {
        if (++att > 50) { clearInterval(iv); return; }
        if (!remoteVid.current) return;
        clearInterval(iv);
        remoteVid.current.srcObject = remoteStream;
        remoteVid.current.play().catch(function(){});
        console.log('[Student] ✅ Admin video LIVE!');
      }, 100);
    };

    // Send ICE candidates to admin
    pc.onicecandidate = function(e) {
      if (e.candidate && socketRef.current) {
        socketRef.current.emit('webrtc-ice-candidate', { vivaId: vivaId, candidate: e.candidate });
      }
    };

    pc.onconnectionstatechange = function() {
      console.log('[Student] Connection state:', pc.connectionState);
      if (pc.connectionState === 'connected') setPeerStatus('streaming');
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') setPeerStatus('disconnected');
    };

    return pc;
  }

  function toggleCam() {
    if (!streamRef.current) return;
    streamRef.current.getVideoTracks().forEach(function(t){t.enabled=!camOn;});
    setCamOn(function(v){return !v;});
  }
  function toggleMic() {
    if (!streamRef.current) return;
    streamRef.current.getAudioTracks().forEach(function(t){t.enabled=!micOn;});
    setMicOn(function(v){return !v;});
  }

  function leaveRoom() {
    cleanup(); clearS(); setPhase('join'); setSession(null); sessionRef.current = null;
    setRoomId(''); roomIdRef.current = ''; setCamOk(false); setPeerStatus('waiting');
    awayStart.current = null; isAwayRef.current = false; notified.current = false;
    setIsAway(false); setCountdown(AWAY_LIMIT);
  }

  // ── RENDERS ────────────────────────────────────────────────────────────────
  if ((phase === 'room' || phase === 'permission') && !streamRef.current && !reGranting) return (
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
      {camOk && <div style={{marginBottom:18}}><video ref={previewRef} autoPlay muted playsInline style={{width:'100%',maxWidth:320,borderRadius:12,background:'#000'}}/></div>}
      {permErr && <div style={{padding:12,background:'rgba(220,38,38,.08)',border:'1px solid rgba(220,38,38,.2)',borderRadius:8,color:'var(--danger)',fontSize:'0.85rem',marginBottom:16}}>{permErr}</div>}
      {!camOk
        ? <button className="btn btn-primary btn-lg" onClick={requestPermissions}>🔓 Grant Camera & Mic</button>
        : <button className="btn btn-success btn-lg" onClick={enterRoom}>🚀 Enter Viva Room</button>
      }
    </div>
  );

  // ── ROOM ──────────────────────────────────────────────────────────────────
  var mm = Math.floor(countdown/60), ss = countdown%60, urgent = countdown < 120;
  var statusColor = peerStatus==='streaming'?'#22c55e':peerStatus==='connected'?'#eab308':'#9ca3af';
  var statusText  = peerStatus==='streaming'?'🟢 Examiner Connected':peerStatus==='connected'?'🔄 Connecting...':peerStatus==='disconnected'?'🔴 Examiner Disconnected':'⏳ Waiting for Examiner...';

  return (
    <div className="viva-dark fade-up" style={{position:'relative'}}>
      {isAway && (
        <div style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(13,13,20,.96)',display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(4px)'}}>
          <div style={{textAlign:'center',padding:40}}>
            <div style={{fontSize:'4rem',marginBottom:12}}>⏸</div>
            <div style={{fontFamily:'Space Grotesk,sans-serif',fontWeight:800,fontSize:'1.8rem',color:'#fff',marginBottom:8}}>You Left the Room</div>
            <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:'4rem',fontWeight:900,color:urgent?'#dc2626':'#f59e0b',marginBottom:20}}>{String(mm).padStart(2,'0')}:{String(ss).padStart(2,'0')}</div>
            <button className="btn btn-primary btn-lg" onClick={comeback} style={{padding:'14px 48px'}}>▶ Return</button>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20,flexWrap:'wrap',gap:10}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <span className="badge badge-success">🟢 In Room</span>
          <span style={{fontWeight:700,color:'#fff',fontSize:'1.05rem'}}>{session ? session.title : 'Viva Session'}</span>
          <span style={{fontSize:'0.8rem',fontWeight:600,color:statusColor}}>{statusText}</span>
        </div>
        <button className="btn btn-sm btn-outline" onClick={function(){if(window.confirm('Leave?'))leaveRoom();}}>Leave</button>
      </div>

      {/* Video panels — same layout as shared VivaRoom */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,maxWidth:900,margin:'0 auto'}}>
        {/* Own camera */}
        <div className="card" style={{padding:12}}>
          <video ref={localVid} autoPlay muted playsInline style={{width:'100%',borderRadius:8,background:'#000',display:'block'}}/>
          <div style={{fontSize:'0.75rem',textAlign:'center',marginTop:6,color:'#9ca3af'}}>📹 You ({store.currentUser.name})</div>
          <div style={{display:'flex',gap:8,marginTop:8,justifyContent:'center'}}>
            <button className={'btn btn-sm '+(camOn?'btn-success':'btn-danger')} onClick={toggleCam}>{camOn?'📷 Cam On':'📷 Cam Off'}</button>
            <button className={'btn btn-sm '+(micOn?'btn-success':'btn-danger')} onClick={toggleMic}>{micOn?'🎤 Mic On':'🎤 Mic Off'}</button>
          </div>
        </div>

        {/* Examiner camera */}
        <div className="card" style={{padding:12,position:'relative'}}>
          <video ref={remoteVid} autoPlay playsInline style={{width:'100%',borderRadius:8,background:'#000',minHeight:180,display:'block'}}/>
          {peerStatus !== 'streaming' && (
            <div style={{position:'absolute',top:12,left:12,right:12,bottom:36,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:8,background:'rgba(0,0,0,.75)'}}>
              <div style={{textAlign:'center',color:'#9ca3af'}}>
                <div style={{fontSize:'2.5rem',marginBottom:8}}>{peerStatus==='waiting'?'⏳':peerStatus==='connected'?'🔄':'❌'}</div>
                <div style={{fontSize:'0.8rem',fontWeight:600,color:statusColor}}>{statusText}</div>
              </div>
            </div>
          )}
          <div style={{fontSize:'0.75rem',textAlign:'center',marginTop:6,color:'#9ca3af'}}>👨‍🏫 Examiner</div>
        </div>
      </div>

      <div style={{maxWidth:900,margin:'14px auto 0',padding:'10px 16px',background:'rgba(124,58,237,.1)',border:'1px solid rgba(124,58,237,.25)',borderRadius:10,fontSize:'0.82rem',color:'#a78bfa',textAlign:'center'}}>
        🎤 Speak clearly. Your examiner can see and hear you in real time.
      </div>
    </div>
  );
}
