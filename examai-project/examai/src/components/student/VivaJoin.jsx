import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { apiGet, apiPost } from '../../utils/api';
import { io } from 'socket.io-client';

var SOCKET_URL = 'http://localhost:5000';
var ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

export default function VivaJoin() {
  var store = useStore();
  var [phase,       setPhase]      = useState('join');
  var [roomId,      setRoomId]     = useState('');
  var [session,     setSession]    = useState(null);
  var [invites,     setInvites]    = useState([]);
  var [status,      setStatus]     = useState('waiting');
  var [camOn,       setCamOn]      = useState(true);
  var [micOn,       setMicOn]      = useState(true);
  var [camState,    setCamState]   = useState('off'); // off | requesting | on
  var [adminName,   setAdminName]  = useState('Examiner');

  var localVid   = useRef(null);
  var remoteVid  = useRef(null);
  var myStream   = useRef(null);
  var sock       = useRef(null);
  var pc         = useRef(null);
  var roomIdRef  = useRef('');
  var vivaIdRef  = useRef('');

  useEffect(function() {
    apiGet('/notifications').then(function(n) {
      setInvites((n||[]).filter(function(x){return x.viva_room_id;}));
    }).catch(function(){});
  }, []); // eslint-disable-line

  useEffect(function() {
    return function() { stopEverything(); };
  }, []); // eslint-disable-line

  function stopEverything() {
    if (sock.current)     { sock.current.disconnect(); sock.current = null; }
    if (pc.current)       { pc.current.close(); pc.current = null; }
    if (myStream.current) { myStream.current.getTracks().forEach(function(t){t.stop();}); myStream.current = null; }
  }

  // ── JOIN ──────────────────────────────────────────────────────────────────
  async function handleJoin(id) {
    var vid = (id || roomId || '').trim();
    if (!vid) return;
    try {
      var s = await apiGet('/viva/' + vid);
      if (!s) { alert('Room not found'); return; }
      setSession(s); setRoomId(vid); roomIdRef.current = vid;
      setPhase('room');
      // Enter room immediately — camera will be started by admin
      setTimeout(function() { startSignaling(vid); }, 200);
    } catch(e) { alert('Room not found'); }
  }

  // ── SIGNALING ─────────────────────────────────────────────────────────────
  function startSignaling(vivaId) {
    vivaIdRef.current = vivaId;
    if (sock.current) { sock.current.disconnect(); sock.current = null; }

    var socket = io(SOCKET_URL);
    sock.current = socket;

    socket.on('connect', function() {
      var name = store.currentUser ? (store.currentUser.name || 'Student') : 'Student';
      console.log('[Student] socket connected:', socket.id);
      socket.emit('join-viva-room', { vivaId: vivaId, role: 'student', userName: name });
    });

    socket.on('room-members', function(members) {
      members.forEach(function(m) {
        if (m.role === 'admin') { setAdminName(m.userName || 'Examiner'); setStatus('connecting'); }
      });
    });

    socket.on('peer-joined', function(data) {
      if (data.role === 'admin') { setAdminName(data.userName || 'Examiner'); setStatus('connecting'); }
    });

    // ★ Admin pressed "Start Student Camera" button
    socket.on('camera-requested', function(data) {
      console.log('[Student] Admin requested camera start');
      setCamState('requesting');
      startCamera(socket, vivaId);
    });

    // ★ Admin pressed "Stop Camera"
    socket.on('camera-stop', function() {
      console.log('[Student] Admin stopped camera');
      stopCamera();
    });

    // Receive WebRTC offer from admin
    socket.on('webrtc-offer', function(data) {
      console.log('[Student] got offer');
      handleOffer(socket, vivaId, data.offer);
    });

    socket.on('webrtc-ice-candidate', function(data) {
      if (pc.current && data.candidate) {
        pc.current.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(function(){});
      }
    });

    socket.on('peer-left', function(data) {
      if (data.role === 'admin') { setStatus('waiting'); if (remoteVid.current) remoteVid.current.srcObject = null; }
    });

    socket.on('connect_error', function(e) { console.error('[Student] socket error:', e.message); });
  }

  // ── CAMERA START (triggered by admin) ─────────────────────────────────────
  async function startCamera(socket, vivaId) {
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      myStream.current = stream;
      setCamState('on'); setCamOn(true); setMicOn(true);

      // Attach self-view
      var a = 0;
      var t = setInterval(function() {
        if (++a > 50) { clearInterval(t); return; }
        if (!localVid.current) return;
        clearInterval(t);
        localVid.current.srcObject = stream;
        localVid.current.muted = true;
        localVid.current.play().catch(function(){});
      }, 100);

      // Tell admin camera is ready
      socket.emit('camera-ready', { vivaId: vivaId });
      console.log('[Student] camera started, told admin');
    } catch(e) {
      console.error('[Student] camera failed:', e);
      setCamState('off');
      alert('Camera/mic denied. Please allow access in your browser.');
    }
  }

  function stopCamera() {
    if (myStream.current) { myStream.current.getTracks().forEach(function(t){t.stop();}); myStream.current = null; }
    if (localVid.current) localVid.current.srcObject = null;
    setCamState('off'); setCamOn(false);
  }

  // ── WEBRTC PEER ───────────────────────────────────────────────────────────
  async function handleOffer(socket, vivaId, offer) {
    if (pc.current) { pc.current.close(); pc.current = null; }
    var p = new RTCPeerConnection(ICE);
    pc.current = p;

    // Add local tracks (if camera is on)
    if (myStream.current) {
      myStream.current.getTracks().forEach(function(t) {
        p.addTrack(t, myStream.current);
        console.log('[Student] added track:', t.kind);
      });
    }

    p.ontrack = function(e) {
      console.log('[Student] got remote track:', e.track.kind);
      if (!e.streams || !e.streams[0]) return;
      var rs = e.streams[0];
      setStatus('connected');
      var tries = 0;
      var t = setInterval(function() {
        if (++tries > 100) { clearInterval(t); return; }
        if (!remoteVid.current) return;
        clearInterval(t);
        remoteVid.current.srcObject = rs;
        remoteVid.current.play().catch(function(){});
        console.log('[Student] ✅ admin video live!');
      }, 50);
    };

    p.onicecandidate = function(e) {
      if (e.candidate) socket.emit('webrtc-ice-candidate', { vivaId: vivaId, candidate: e.candidate });
    };

    p.onconnectionstatechange = function() {
      console.log('[Student] conn:', p.connectionState);
      if (p.connectionState === 'connected') setStatus('connected');
      if (p.connectionState === 'failed') setStatus('waiting');
    };

    p.oniceconnectionstatechange = function() { console.log('[Student] ICE:', p.iceConnectionState); };

    try {
      await p.setRemoteDescription(new RTCSessionDescription(offer));
      var answer = await p.createAnswer();
      await p.setLocalDescription(answer);
      socket.emit('webrtc-answer', { vivaId: vivaId, answer: p.localDescription });
      console.log('[Student] ✅ answer sent');
    } catch(e) { console.error('[Student] offer handling failed:', e); }
  }

  function toggleCam() {
    if (!myStream.current) return;
    myStream.current.getVideoTracks().forEach(function(t){ t.enabled = !camOn; });
    setCamOn(function(v){return !v;});
  }
  function toggleMic() {
    if (!myStream.current) return;
    myStream.current.getAudioTracks().forEach(function(t){ t.enabled = !micOn; });
    setMicOn(function(v){return !v;});
  }

  function leave() {
    stopEverything();
    setPhase('join'); setSession(null); setRoomId(''); roomIdRef.current = '';
    setStatus('waiting'); setCamState('off');
  }

  // ── RENDERS ───────────────────────────────────────────────────────────────
  if (phase === 'join') return (
    <div className="fade-up">
      <div className="page-header">
        <div><div className="page-title">🎙 Viva Voce</div><div className="page-subtitle">Join your oral examination</div></div>
      </div>
      {invites.length > 0 && (
        <div style={{marginBottom:28}}>
          <div style={{fontWeight:700,marginBottom:14}}>📬 Your Invitations</div>
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
          <input className="form-input" value={roomId}
            onChange={function(e){setRoomId(e.target.value); roomIdRef.current=e.target.value;}}
            placeholder="Paste Room ID…" style={{flex:1}}/>
          <button className="btn btn-primary" onClick={function(){handleJoin();}} disabled={!roomId.trim()}>Join</button>
        </div>
      </div>
    </div>
  );

  // ── ROOM ─────────────────────────────────────────────────────────────────
  var statusColor = status==='connected'?'#22c55e':status==='connecting'?'#eab308':'#9ca3af';
  var statusText  = status==='connected'?'🟢 Live':status==='connecting'?'🔄 Connecting…':'⏳ Waiting';

  return (
    <div className="viva-dark fade-up">
      {/* Top bar */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20,flexWrap:'wrap',gap:10}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <span className="badge badge-success">🟢 In Room</span>
          <span style={{fontWeight:700,color:'#fff'}}>{session ? session.title : 'Viva Session'}</span>
        </div>
        <button className="btn btn-sm btn-outline" onClick={function(){if(window.confirm('Leave?'))leave();}}>Leave</button>
      </div>

      {/* Camera status banner */}
      {camState === 'off' && (
        <div style={{padding:'14px 20px',background:'rgba(245,158,11,.1)',border:'1px solid rgba(245,158,11,.3)',borderRadius:12,marginBottom:16,display:'flex',alignItems:'center',gap:12}}>
          <span style={{fontSize:'1.5rem'}}>⏳</span>
          <div>
            <div style={{fontWeight:700,color:'#fbbf24',fontSize:'0.9rem'}}>Waiting for examiner to start your camera</div>
            <div style={{fontSize:'0.78rem',color:'#9ca3af',marginTop:2}}>The examiner will enable your camera when the viva begins. Please wait.</div>
          </div>
        </div>
      )}
      {camState === 'requesting' && (
        <div style={{padding:'14px 20px',background:'rgba(124,58,237,.15)',border:'1px solid rgba(124,58,237,.4)',borderRadius:12,marginBottom:16,display:'flex',alignItems:'center',gap:12}}>
          <span style={{fontSize:'1.5rem'}}>🎥</span>
          <div>
            <div style={{fontWeight:700,color:'#a78bfa',fontSize:'0.9rem'}}>Starting your camera…</div>
            <div style={{fontSize:'0.78rem',color:'#9ca3af',marginTop:2}}>Please allow camera access in your browser if prompted.</div>
          </div>
        </div>
      )}
      {camState === 'on' && (
        <div style={{padding:'10px 20px',background:'rgba(22,163,74,.1)',border:'1px solid rgba(22,163,74,.3)',borderRadius:12,marginBottom:16,display:'flex',alignItems:'center',gap:12}}>
          <span style={{fontSize:'1.2rem'}}>✅</span>
          <div style={{fontWeight:700,color:'#4ade80',fontSize:'0.88rem'}}>Camera active — examiner can see you</div>
        </div>
      )}

      {/* Video grid */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,maxWidth:900,margin:'0 auto'}}>
        {/* Your camera */}
        <div className="card" style={{padding:12}}>
          <div style={{fontSize:'0.72rem',fontWeight:700,color:'#9ca3af',textAlign:'center',marginBottom:8,letterSpacing:1,fontFamily:'JetBrains Mono,monospace'}}>📹 YOU</div>
          <div style={{position:'relative',borderRadius:8,overflow:'hidden',background:'#111',minHeight:180}}>
            <video ref={localVid} autoPlay muted playsInline style={{width:'100%',display:'block',minHeight:180,objectFit:'cover'}}/>
            {camState === 'off' && (
              <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:8}}>
                <div style={{fontSize:'2.5rem',opacity:.3}}>📷</div>
                <div style={{fontSize:'0.75rem',color:'#6b7280',fontWeight:600}}>Camera off</div>
              </div>
            )}
            <div style={{position:'absolute',bottom:6,left:'50%',transform:'translateX(-50%)',background:'rgba(0,0,0,.65)',color:'#fff',fontSize:'0.65rem',padding:'2px 10px',borderRadius:12,whiteSpace:'nowrap'}}>
              {store.currentUser ? store.currentUser.name : 'You'}
            </div>
          </div>
          {camState === 'on' && (
            <div style={{display:'flex',gap:8,marginTop:8,justifyContent:'center'}}>
              <button className={'btn btn-sm '+(camOn?'btn-success':'btn-danger')} onClick={toggleCam}>{camOn?'📷 On':'📷 Off'}</button>
              <button className={'btn btn-sm '+(micOn?'btn-success':'btn-danger')} onClick={toggleMic}>{micOn?'🎤 On':'🎤 Off'}</button>
            </div>
          )}
        </div>

        {/* Examiner */}
        <div className="card" style={{padding:12}}>
          <div style={{fontSize:'0.72rem',fontWeight:700,color:'#9ca3af',textAlign:'center',marginBottom:8,letterSpacing:1,fontFamily:'JetBrains Mono,monospace'}}>👨‍🏫 {adminName.toUpperCase()}</div>
          <div style={{position:'relative',borderRadius:8,overflow:'hidden',background:'#111',minHeight:180}}>
            <video ref={remoteVid} autoPlay playsInline style={{width:'100%',display:'block',minHeight:180,objectFit:'cover'}}/>
            <div style={{position:'absolute',top:6,right:8,background:status==='connected'?'rgba(22,163,74,.9)':'rgba(0,0,0,.7)',color:'#fff',fontSize:'0.62rem',padding:'2px 8px',borderRadius:10,fontWeight:700}}>
              {statusText}
            </div>
          </div>
          <div style={{fontSize:'0.75rem',textAlign:'center',marginTop:4,color:statusColor,fontWeight:600}}>{statusText}</div>
        </div>
      </div>

      <div style={{maxWidth:900,margin:'14px auto 0',padding:'10px 16px',background:'rgba(124,58,237,.1)',border:'1px solid rgba(124,58,237,.25)',borderRadius:10,fontSize:'0.82rem',color:'#a78bfa',textAlign:'center'}}>
        🎤 When your camera is active, speak clearly. Your examiner can see and hear you.
      </div>
    </div>
  );
}
