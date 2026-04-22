import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { apiGet, apiPost } from '../../utils/api';
import { io as ioClient } from 'socket.io-client';

var SOCKET_URL = 'http://localhost:5000';

var AWAY_LIMIT_SEC = 600; // 10 minutes

// Session persistence — survives nav clicks but NOT page refresh (camera can't resume)
function saveVJ(data) { try { sessionStorage.setItem('vj_session', JSON.stringify(data)); } catch(e) {} }
function loadVJ() { try { return JSON.parse(sessionStorage.getItem('vj_session') || 'null'); } catch(e) { return null; } }
function clearVJ() { try { sessionStorage.removeItem('vj_session'); } catch(e) {} }

export default function VivaJoin() {
  var store = useStore();
  var _s = loadVJ() || {};

  // phase: join | permission | room | timeout | ended
  // NOTE: 'away' is now an OVERLAY on top of 'room', not a separate phase
  // This means the room never unmounts when student switches tabs
  var [phase,          setPhaseRaw]       = useState(_s.phase || 'join');
  var [isAway,         setIsAway]         = useState(false);
  var [roomId,         setRoomId]         = useState(_s.roomId || '');
  var [invites,        setInvites]        = useState([]);
  var [session,        setSession]        = useState(_s.session || null);
  var [camOn,          setCamOn]          = useState(true);
  var [micOn,          setMicOn]          = useState(true);
  var [awayCountdown,  setAwayCountdown]  = useState(AWAY_LIMIT_SEC);
  var [adminConnected, setAdminConnected] = useState(false);
  var [camOk,          setCamOk]          = useState(false);
  var [micOk,          setMicOk]          = useState(false);
  var [permErr,        setPermErr]        = useState('');
  var [reGranting,     setReGranting]     = useState(false); // true while re-granting after nav-away

  // All refs — never stale inside intervals
  var previewRef      = useRef(null);
  var selfVidRef      = useRef(null);
  var adminVidRef     = useRef(null);
  var streamRef       = useRef(null);
  var peerRef         = useRef(null);
  var socketRef       = useRef(null);   // Socket.IO connection
  var adminSocketId   = useRef(null);   // admin's socket ID for routing
  var pendingIceCandidates = useRef([]); // buffer ICE candidates before remote desc
  var remoteDescSet   = useRef(false);   // has remote description been set
  var masterRef       = useRef(null);     // single 1s interval
  var frameIntervalRef = useRef(null);   // video frame sending interval
  var audioProcessorRef = useRef(null); // audio relay processor
  var awayStartRef    = useRef(null);     // timestamp of when student left
  var roomIdRef       = useRef('');
  var sessionRef      = useRef(null);
  var phaseRef        = useRef('join');
  var isAwayRef       = useRef(false);
  var notifiedRef     = useRef(false);

  // Keep refs in sync with state
  useEffect(function() { phaseRef.current  = phase;  }, [phase]);
  useEffect(function() { isAwayRef.current = isAway; }, [isAway]);
  useEffect(function() { roomIdRef.current = roomId; }, [roomId]);
  useEffect(function() { sessionRef.current = session; }, [session]);

  // Persist navigable state so returning to this component doesn't drop to 'join'
  useEffect(function() {
    if (phase === 'join') { clearVJ(); return; }
    saveVJ({ phase, roomId, session });
  }, [phase, roomId, session]); // eslint-disable-line

  function setPhase(p) {
    setPhaseRaw(p);
    if (p === 'join') clearVJ();
    else saveVJ({ phase: p, roomId: roomIdRef.current, session: sessionRef.current });
  }

  useEffect(function() { loadInvites(); }, []); // eslint-disable-line

  function loadInvites() {
    store.loadNotifications().then(function(n) {
      setInvites((n||[]).filter(function(x){ return x.viva_room_id; }));
    });
  }

  // ── MASTER INTERVAL: handles away countdown + session-end poll ──
  // Runs every 1 second once student enters room. Never stopped on re-render.
  function startMasterInterval() {
    clearInterval(masterRef.current);
    var pollTick = 0;
    masterRef.current = setInterval(function() {
      // Away countdown
      if (isAwayRef.current && awayStartRef.current) {
        var elapsed   = Math.floor((Date.now() - awayStartRef.current) / 1000);
        var remaining = AWAY_LIMIT_SEC - elapsed;
        setAwayCountdown(remaining > 0 ? remaining : 0);
        if (remaining <= 0) {
          // Student timed out — remove from room
          awayStartRef.current = null;
          isAwayRef.current    = false;
          setIsAway(false);
          stopMedia();
          phaseRef.current = 'timeout';
          setPhase('timeout');
          apiPost('/notifications', {
            title:   'Student Removed — Viva Timeout',
            message: (store.currentUser.name||'Student') + ' did not return within 10 minutes and was removed from "' + (sessionRef.current ? sessionRef.current.title : roomIdRef.current) + '".',
            type: 'urgent',
          }).catch(function(){});
        }
      }

      // Poll every 5 ticks for session ended by examiner
      pollTick++;
      if (pollTick >= 5) {
        pollTick = 0;
        var vid = roomIdRef.current;
        if (vid && (phaseRef.current === 'room')) {
          apiGet('/viva/' + vid).then(function(s) {
            if (s && (s.status === 'ended' || s.status === 'locked')) {
              clearInterval(masterRef.current);
              stopMedia();
              phaseRef.current = 'ended';
              setPhase('ended');
            }
          }).catch(function(){});
        }
      }
    }, 1000);
  }

  // ── VISIBILITY CHANGE: only this, never window.blur ──
  // Attached once on mount with empty deps — reads refs, never stale
  useEffect(function() {
    var graceTimer = null;
    function onVis() {
      if (document.hidden) {
        // 2s grace for accidental switches
        graceTimer = setTimeout(function() {
          if (document.hidden && phaseRef.current === 'room' && !isAwayRef.current) {
            startAway();
          }
        }, 2000);
      } else {
        // Came back to tab
        clearTimeout(graceTimer);
        if (isAwayRef.current) {
          returnToRoom();
        }
      }
    }
    document.addEventListener('visibilitychange', onVis);
    return function() {
      document.removeEventListener('visibilitychange', onVis);
      clearTimeout(graceTimer);
    };
  }, []); // EMPTY — runs once, uses refs internally

  // Cleanup
  useEffect(function() { return function() { clearInterval(masterRef.current); stopMedia(); }; }, []); // eslint-disable-line

  function startAway() {
    if (awayStartRef.current) return;
    awayStartRef.current = Date.now();
    isAwayRef.current    = true;
    setIsAway(true);
    setAwayCountdown(AWAY_LIMIT_SEC);
    if (!notifiedRef.current) {
      notifiedRef.current = true;
      apiPost('/notifications', {
        title:   'Student Left Viva Room',
        message: (store.currentUser.name||'Student') + ' left "' + (sessionRef.current ? sessionRef.current.title : roomIdRef.current) + '". They have 10 min to return.',
        type: 'urgent',
      }).catch(function(){});
    }
  }

  function returnToRoom() {
    awayStartRef.current = null;
    isAwayRef.current    = false;
    notifiedRef.current  = false;
    setIsAway(false);
    setAwayCountdown(AWAY_LIMIT_SEC);
    // Re-attach own video
    setTimeout(function() {
      if (selfVidRef.current && streamRef.current) selfVidRef.current.srcObject = streamRef.current;
    }, 100);
    apiPost('/notifications', {
      title:   'Student Returned to Viva Room',
      message: (store.currentUser.name||'Student') + ' returned to "' + (sessionRef.current ? sessionRef.current.title : roomIdRef.current) + '".',
      type: 'success',
    }).catch(function(){});
  }

  function stopMedia() {
    stopFrameRelay();
    if (peerRef.current) { try { peerRef.current.close(); } catch(e){} peerRef.current = null; }
    if (socketRef.current) { try { socketRef.current.disconnect(); } catch(e){} socketRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(function(t){t.stop();}); streamRef.current = null; }
  }

  // ── JOIN ──────────────────────────────────────────────────
  async function handleJoin(id) {
    var vid = (id || roomId || '').trim();
    if (!vid) return;
    try {
      var s = await apiGet('/viva/' + vid);
      if (!s) { alert('Room not found'); return; }
      if (s.status === 'ended' || s.status === 'locked') { alert('This viva session has already ended.'); return; }
      setSession(s); sessionRef.current = s;
      setRoomId(vid); roomIdRef.current  = vid;
      phaseRef.current = 'permission'; setPhase('permission');
    } catch(e) { alert('Room not found: ' + e.message); }
  }

  async function requestPermissions() {
    setPermErr('');
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
      streamRef.current = stream; setCamOk(true); setMicOk(true);
      setReGranting(false); // camera obtained — clear the re-grant flag
      var iv = setInterval(function(){ if (previewRef.current){ previewRef.current.srcObject = stream; clearInterval(iv); } }, 200);
    } catch(e) {
      setPermErr(e.name==='NotAllowedError' ? 'Permission denied. Allow camera & mic in your browser, then try again.' : 'Camera/Mic access denied.');
    }
  }

  function enterRoom() {
    phaseRef.current = 'room'; setPhase('room');
    startMasterInterval();
    // Attach self video, then start relay
    var attempts = 0;
    var iv = setInterval(function() {
      attempts++;
      if (attempts > 50) { clearInterval(iv); setupStudentWebRTC(); return; }
      if (!selfVidRef.current || !streamRef.current) return;
      clearInterval(iv);
      selfVidRef.current.srcObject = streamRef.current;
      selfVidRef.current.muted = true;
      selfVidRef.current.play().catch(function(){});
      // Start relay after brief pause to ensure video is playing
      setTimeout(setupStudentWebRTC, 800);
    }, 200);
  }

  // ── Video relay via Socket.IO (no WebRTC peer connection needed) ──────────
  function setupStudentWebRTC() {
    var vid = roomIdRef.current;
    if (!vid) { console.warn('[Student] No room ID'); return; }

    if (socketRef.current) { try { socketRef.current.disconnect(); } catch(e) {} socketRef.current = null; }

    var sock = ioClient(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = sock;

    sock.on('connect', function() {
      console.log('[Student] Socket connected:', sock.id);
      var name = localStorage.getItem('examai_user_name') || 'Student';
      sock.emit('join-room', { viva_id: vid, role: 'student', name: name });
    });

    // Server confirms we joined — NOW safe to start sending frames
    sock.on('joined-ack', function() {
      console.log('[Student] join-room acknowledged, starting frame relay');
      startSendingFrames(sock);
      startSendingAudio(sock);
    });

    sock.on('peer-joined', function(data) {
      if (data.role === 'admin') {
        console.log('[Student] Admin is in the room');
        setAdminConnected(true);
      }
    });

    sock.on('remote-frame', function(data) {
      if (data.role !== 'admin') return;
      var canvas = adminVidRef.current;
      if (!canvas) return;
      var img = new Image();
      img.onload = function() {
        var ctx = canvas.getContext('2d');
        if (canvas.width !== img.width) canvas.width = img.width;
        if (canvas.height !== img.height) canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
      };
      img.src = data.frame;
    });

    var audioCtx = null;
    sock.on('remote-audio', function(data) {
      if (data.role !== 'admin') return;
      try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        var buf = audioCtx.createBuffer(1, data.chunk.length, 44100);
        buf.getChannelData(0).set(new Float32Array(data.chunk));
        var src = audioCtx.createBufferSource();
        src.buffer = buf; src.connect(audioCtx.destination); src.start();
      } catch(e) {}
    });

    sock.on('peer-left', function(data) { if (data.role === 'admin') setAdminConnected(false); });
    sock.on('session-ended', function() { phaseRef.current = 'ended'; setPhase('ended'); });
  }


  function startSendingFrames(sock) {
    clearInterval(frameIntervalRef.current);
    var cap = document.createElement('canvas');
    cap.width = 320; cap.height = 240;
    var ctx = cap.getContext('2d');
    var track = streamRef.current && streamRef.current.getVideoTracks()[0];

    if (track && window.ImageCapture) {
      var ic = new ImageCapture(track);
      frameIntervalRef.current = setInterval(async function() {
        if (!sock.connected) return;
        try {
          var bmp = await ic.grabFrame();
          ctx.drawImage(bmp, 0, 0, 320, 240);
          sock.volatile.emit('video-frame', cap.toDataURL('image/jpeg', 0.35));
        } catch(e) {}
      }, 200);
    } else {
      var v = selfVidRef.current;
      frameIntervalRef.current = setInterval(function() {
        if (!sock.connected) return;
        if (!v) v = selfVidRef.current;
        if (!v || v.readyState < 2 || v.videoWidth === 0) return;
        try {
          ctx.drawImage(v, 0, 0, 320, 240);
          sock.volatile.emit('video-frame', cap.toDataURL('image/jpeg', 0.35));
        } catch(e) {}
      }, 200);
    }
  }


  function startSendingAudio(sock, vid) {
    if (!streamRef.current) return;
    try {
      var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var src = audioCtx.createMediaStreamSource(streamRef.current);
      var proc = audioCtx.createScriptProcessor(2048, 1, 1);
      proc.onaudioprocess = function(e) {
        if (!sock || !sock.connected) return;
        var data = e.inputBuffer.getChannelData(0);
        sock.emit('audio-chunk', Array.from(data));
      };
      src.connect(proc);
      proc.connect(audioCtx.destination);
      audioProcessorRef.current = { audioCtx, proc, src };
    } catch(e) { console.warn('[Student] Audio relay failed:', e); }
  }

  function stopFrameRelay() {
    clearInterval(frameIntervalRef.current);
    if (audioProcessorRef.current) {
      try {
        audioProcessorRef.current.proc.disconnect();
        audioProcessorRef.current.src.disconnect();
        audioProcessorRef.current.audioCtx.close();
      } catch(e) {}
      audioProcessorRef.current = null;
    }
  }

  
    function toggleCam() {
    if (streamRef.current) { streamRef.current.getVideoTracks().forEach(function(t){t.enabled=!camOn;}); setCamOn(function(v){return !v;}); }
  }
  function toggleMic() {
    if (streamRef.current) { streamRef.current.getAudioTracks().forEach(function(t){t.enabled=!micOn;}); setMicOn(function(v){return !v;}); }
  }

  function leaveRoom() {
    clearInterval(masterRef.current); stopMedia();
    clearVJ();
    phaseRef.current='join'; setPhaseRaw('join');
    setSession(null); sessionRef.current=null;
    setRoomId(''); roomIdRef.current='';
    setCamOk(false); setMicOk(false); setAdminConnected(false);
    awayStartRef.current=null; isAwayRef.current=false; notifiedRef.current=false;
    setIsAway(false); setAwayCountdown(AWAY_LIMIT_SEC);
  }

  // ══════════════════════════════════════════════════════════
  // CAMERA LOST — navigated away during room/permission phase
  // Stream is gone (browser security), must re-grant permissions
  // ══════════════════════════════════════════════════════════
  if ((phase === 'room' || phase === 'permission') && !streamRef.current && !reGranting) return (
    <div style={{minHeight:'calc(100vh - 60px)',display:'flex',alignItems:'center',justifyContent:'center',background:'#0d0d14',padding:24}}>
      <div style={{textAlign:'center',background:'rgba(255,255,255,.05)',border:'1px solid rgba(255,255,255,.12)',borderRadius:20,padding:'44px 52px',maxWidth:480}}>
        <div style={{fontSize:'3.5rem',marginBottom:16}}>📷</div>
        <div style={{fontFamily:'Space Grotesk,sans-serif',fontWeight:800,fontSize:'1.5rem',color:'#fff',marginBottom:10}}>
          {session ? session.title : 'Viva Room'} — Re-connect Camera
        </div>
        <div style={{fontSize:'0.9rem',color:'#9ca3af',lineHeight:1.75,marginBottom:28}}>
          You navigated away from the viva room. Your camera was released by the browser.<br/>
          Click below to re-grant camera &amp; mic access and rejoin.
        </div>
        <div style={{display:'flex',gap:12,justifyContent:'center',flexWrap:'wrap'}}>
          <button className="btn btn-primary btn-lg" onClick={function(){
            setReGranting(true);
            setCamOk(false); setMicOk(false); setPermErr('');
            setPhaseRaw('permission');
          }}>
            🔓 Re-grant Camera &amp; Mic
          </button>
          <button className="btn btn-outline" onClick={function(){ leaveRoom(); }}>
            Leave Session
          </button>
        </div>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // ENDED BY EXAMINER
  // ══════════════════════════════════════════════════════════
  if (phase === 'ended') return (
    <div style={{minHeight:'calc(100vh - 60px)',display:'flex',alignItems:'center',justifyContent:'center',background:'#0d0d14',padding:24}}>
      <div style={{textAlign:'center',background:'rgba(255,255,255,.05)',border:'1px solid rgba(255,255,255,.12)',borderRadius:20,padding:'44px 52px',maxWidth:460}}>
        <div style={{fontSize:'4rem',marginBottom:18}}>🏁</div>
        <div style={{fontFamily:'Space Grotesk,sans-serif',fontWeight:800,fontSize:'1.7rem',color:'#fff',marginBottom:12}}>Viva Session Ended</div>
        <div style={{fontSize:'0.9rem',color:'#9ca3af',lineHeight:1.75,marginBottom:28}}>
          The examiner has ended this viva session.<br/>
          Your results will appear in <strong style={{color:'#a78bfa'}}>My Results</strong> after grading is complete.
        </div>
        <button className="btn btn-primary" onClick={function(){ clearVJ(); setPhaseRaw('join'); setSession(null); setRoomId(''); }}>← Back to Viva Page</button>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // TIMED OUT (didn't return in 10 min)
  // ══════════════════════════════════════════════════════════
  if (phase === 'timeout') return (
    <div style={{minHeight:'calc(100vh - 60px)',display:'flex',alignItems:'center',justifyContent:'center',background:'#0d0d14',padding:24}}>
      <div style={{textAlign:'center',background:'rgba(220,38,38,.06)',border:'1px solid rgba(220,38,38,.2)',borderRadius:20,padding:'44px 52px',maxWidth:460}}>
        <div style={{fontSize:'4rem',marginBottom:18}}>⏰</div>
        <div style={{fontFamily:'Space Grotesk,sans-serif',fontWeight:800,fontSize:'1.7rem',color:'#fff',marginBottom:12}}>Session Expired</div>
        <div style={{fontSize:'0.9rem',color:'#9ca3af',lineHeight:1.75,marginBottom:28}}>
          You did not return within 10 minutes and were automatically removed. Please contact your examiner.
        </div>
        <button className="btn btn-outline" onClick={function(){ leaveRoom(); }}>← Back to Viva Page</button>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // JOIN
  // ══════════════════════════════════════════════════════════
  if (phase === 'join') return (
    <div className="fade-up">
      <div className="page-header">
        <div><div className="page-title">🎙 Viva Voce</div><div className="page-subtitle">Join your oral examination session</div></div>
      </div>
      {invites.length > 0 && (
        <div style={{marginBottom:28}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
            <div style={{fontWeight:700,fontSize:'1rem'}}>📬 Your Viva Invitations</div>
            <button className="btn btn-ghost btn-sm" onClick={loadInvites}>↻ Refresh</button>
          </div>
          <div className="grid-2">
            {invites.map(function(inv){ return (
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
          <input className="form-input" value={roomId} onChange={function(e){setRoomId(e.target.value);roomIdRef.current=e.target.value;}} placeholder="Paste Room ID here…" style={{flex:1}}/>
          <button className="btn btn-primary" onClick={function(){handleJoin();}} disabled={!roomId.trim()}>Join</button>
        </div>
        <div style={{marginTop:12,fontSize:'0.8rem',color:'var(--text3)'}}>Ask your examiner for the Room ID if you don't have an invitation.</div>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // PERMISSION
  // ══════════════════════════════════════════════════════════
  if (phase === 'permission') return (
    <div className="fade-up" style={{maxWidth:520,margin:'40px auto',textAlign:'center'}}>
      <div style={{fontSize:'3rem',marginBottom:12}}>🎥</div>
      <div style={{fontFamily:'Space Grotesk,sans-serif',fontWeight:800,fontSize:'1.4rem',marginBottom:6}}>Camera &amp; Microphone</div>
      <div style={{color:'var(--text3)',marginBottom:24}}>Both are required for your viva session</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:20}}>
        {[{icon:camOk?'✅':'📷',label:'Camera',ok:camOk},{icon:micOk?'✅':'🎤',label:'Microphone',ok:micOk}].map(function(item,i){return(
          <div key={i} className="card" style={{textAlign:'center',padding:20}}>
            <div style={{fontSize:'1.6rem',marginBottom:8}}>{item.icon}</div>
            <div style={{fontWeight:700}}>{item.label}</div>
            <div style={{fontSize:'0.8rem',color:item.ok?'var(--success)':'var(--text3)',marginTop:3}}>{item.ok?'Ready ✓':'Pending'}</div>
          </div>
        );})}
      </div>
      {camOk && <div style={{marginBottom:18}}><video ref={previewRef} autoPlay muted playsInline style={{width:'100%',maxWidth:320,borderRadius:12,background:'#000'}}/></div>}
      {permErr && <div style={{padding:12,background:'rgba(220,38,38,.08)',border:'1px solid rgba(220,38,38,.2)',borderRadius:8,color:'var(--danger)',fontSize:'0.85rem',marginBottom:16}}>{permErr}</div>}
      {!camOk
        ? <button className="btn btn-primary btn-lg" onClick={requestPermissions}>🔓 Grant Camera &amp; Mic Access</button>
        : <button className="btn btn-success btn-lg" onClick={enterRoom}>🚀 Enter Viva Room</button>
      }
    </div>
  );

  // ══════════════════════════════════════════════════════════
  // ROOM — stays mounted even when student switches tabs
  // Away countdown is an OVERLAY, not a phase change
  // ══════════════════════════════════════════════════════════
  var m = Math.floor(awayCountdown / 60);
  var s = awayCountdown % 60;
  var isUrgent = awayCountdown < 120;

  return (
    <div className="viva-dark fade-up" style={{position:'relative'}}>

      {/* ── AWAY OVERLAY — floats on top, room stays mounted beneath ── */}
      {isAway && (
        <div style={{
          position:'fixed', inset:0, zIndex:9999,
          background:'rgba(13,13,20,.96)',
          display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column',
          backdropFilter:'blur(4px)',
        }}>
          <div style={{textAlign:'center',padding:40}}>
            <div style={{fontSize:'4rem',marginBottom:16}}>⏸</div>
            <div style={{fontFamily:'Space Grotesk,sans-serif',fontWeight:800,fontSize:'1.9rem',color:'#fff',marginBottom:8}}>
              You Left the Viva Room
            </div>
            <div style={{fontSize:'0.9rem',color:'#9ca3af',marginBottom:32}}>
              Your examiner has been notified. Return before the timer expires.
            </div>
            {/* Countdown */}
            <div style={{
              fontFamily:'JetBrains Mono,monospace', fontSize:'5.5rem', fontWeight:900,
              color: isUrgent ? '#dc2626' : '#f59e0b', letterSpacing:8, marginBottom:12,
              textShadow: isUrgent ? '0 0 40px rgba(220,38,38,.6)' : '0 0 40px rgba(245,158,11,.4)',
              lineHeight:1,
            }}>
              {String(m).padStart(2,'0')}:{String(s).padStart(2,'0')}
            </div>
            <div style={{fontSize:'0.9rem',color:isUrgent?'#f87171':'#6b7280',marginBottom:36,fontWeight:isUrgent?700:400}}>
              {awayCountdown<=0?'Removing you…':awayCountdown<60?'⚠️ Less than a minute!':'Return within '+m+' min '+s+'s'}
            </div>
            <button className="btn btn-primary btn-lg" onClick={returnToRoom}
              style={{padding:'14px 48px',fontSize:'1.05rem',boxShadow:'0 4px 24px rgba(124,58,237,.5)'}}>
              ▶ Return to Viva Room
            </button>
            <div style={{marginTop:20,padding:'12px 20px',background:'rgba(220,38,38,.1)',border:'1px solid rgba(220,38,38,.25)',borderRadius:10,color:'#f87171',fontSize:'0.8rem',maxWidth:360}}>
              ⚠️ Failing to return will remove you from the session automatically.
            </div>
          </div>
        </div>
      )}

      {/* ── TOP BAR ── */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18,flexWrap:'wrap',gap:10}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <span className="badge badge-success">🟢 Connected</span>
          <span style={{fontWeight:700,color:'#fff',fontSize:'1.05rem'}}>{session ? session.title : 'Viva Session'}</span>
          {session && session.topic && <span className="badge badge-primary" style={{fontSize:'0.68rem'}}>{session.topic}</span>}
        </div>
        <button className="btn btn-sm btn-outline" onClick={function(){if(window.confirm('Leave the viva room?')) leaveRoom();}}>Leave</button>
      </div>

      {/* ── VIDEO PANELS ── */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,maxWidth:860,margin:'0 auto'}}>
        {/* Student's own video */}
        <div className="card" style={{padding:12}}>
          <div style={{position:'relative',borderRadius:8,overflow:'hidden',background:'#000',lineHeight:0}}>
            <video ref={selfVidRef} autoPlay muted playsInline style={{width:'100%',height:220,objectFit:'cover',display:'block'}}/>
            <div style={{position:'absolute',bottom:6,left:'50%',transform:'translateX(-50%)',background:'rgba(0,0,0,.65)',color:'#fff',fontSize:'0.65rem',padding:'3px 12px',borderRadius:12,whiteSpace:'nowrap',fontWeight:600}}>
              You ({store.currentUser.name})
            </div>
          </div>
          <div style={{display:'flex',gap:8,marginTop:10,justifyContent:'center'}}>
            <button className={'btn btn-sm '+(camOn?'btn-success':'btn-danger')} onClick={toggleCam}>{camOn?'📷 Cam On':'📷 Cam Off'}</button>
            <button className={'btn btn-sm '+(micOn?'btn-success':'btn-danger')} onClick={toggleMic}>{micOn?'🎤 Mic On':'🎤 Mic Off'}</button>
          </div>
        </div>

        {/* Examiner's live video via WebRTC */}
        <div className="card" style={{padding:12}}>
          <div style={{position:'relative',borderRadius:8,overflow:'hidden',background:'#111',lineHeight:0}}>
            <canvas ref={adminVidRef} style={{width:'100%',height:220,objectFit:'cover',display:'block',background:'#111'}}/>
            {!adminConnected && (
              <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:8}}>
                <div style={{fontSize:'2.8rem',opacity:.25}}>👨‍🏫</div>
                <div style={{fontSize:'0.75rem',color:'#4b5563',fontWeight:600}}>Waiting for examiner…</div>
                <button onClick={function(){ if(peerRef.current){try{peerRef.current.close();}catch(e){} peerRef.current=null;} setupStudentWebRTC(); }}
                  style={{padding:'4px 12px',borderRadius:6,border:'none',background:'rgba(124,58,237,.4)',color:'#a78bfa',fontSize:'0.65rem',fontWeight:700,cursor:'pointer',marginTop:4}}>
                  🔄 Reconnect
                </button>
              </div>
            )}
            {adminConnected && (
              <div style={{position:'absolute',bottom:6,left:'50%',transform:'translateX(-50%)',background:'rgba(22,163,74,.88)',color:'#fff',fontSize:'0.65rem',padding:'3px 12px',borderRadius:12,whiteSpace:'nowrap',fontWeight:700}}>
                🟢 Examiner Live
              </div>
            )}
          </div>
          <div style={{textAlign:'center',marginTop:10,fontSize:'0.8rem',color:adminConnected?'#4ade80':'#6b7280',fontWeight:600}}>
            {adminConnected ? '🟢 Examiner connected — speak clearly' : '⏳ Connecting to examiner…'}
          </div>
        </div>
      </div>

      {/* ── INFO BANNER ── */}
      <div style={{maxWidth:860,margin:'14px auto 0',padding:'11px 16px',background:'rgba(124,58,237,.1)',border:'1px solid rgba(124,58,237,.25)',borderRadius:10,fontSize:'0.82rem',color:'#a78bfa',textAlign:'center'}}>
        🎤 Speak clearly into your mic. Your examiner can see and hear you live.
        Switching tabs will show a countdown — <strong>you stay in the session</strong> as long as you return within 10 minutes.
      </div>
    </div>
  );
}
