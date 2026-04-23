import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

var SOCKET_URL = 'http://localhost:5000';
var ICE = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80',  username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
]};

// role = 'admin' | 'student'
export default function VivaVideo({ vivaId, role, displayName, onSocketReady }) {
  var localVid  = useRef(null);
  var remoteVid = useRef(null);
  var streamRef = useRef(null);
  var sockRef   = useRef(null);
  var pcRef     = useRef(null);
  var peerIdRef = useRef(null);

  var [camOn,      setCamOn]      = useState(true);
  var [micOn,      setMicOn]      = useState(true);
  var [connected,  setConnected]  = useState(false);
  var [camReady,   setCamReady]   = useState(false);
  var [camError,   setCamError]   = useState('');

  useEffect(function() {
    if (!vivaId) return;
    startCamera();
    return function() { cleanup(); };
  }, [vivaId]); // eslint-disable-line

  function cleanup() {
    if (pcRef.current)    { try { pcRef.current.close(); }    catch(e){} pcRef.current = null; }
    if (sockRef.current)  { try { sockRef.current.disconnect(); } catch(e){} sockRef.current = null; }
    if (streamRef.current){ streamRef.current.getTracks().forEach(function(t){t.stop();}); streamRef.current = null; }
  }

  async function startCamera() {
    try {
      var s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = s;
      setCamReady(true); setCamError('');
      if (localVid.current) { localVid.current.srcObject = s; localVid.current.muted = true; localVid.current.play().catch(function(){}); }
      connectSocket(s);
    } catch(e) {
      setCamError('Camera denied — allow access and refresh');
    }
  }

  function connectSocket(stream) {
    var sock = io(SOCKET_URL);
    sockRef.current = sock;

    sock.on('connect', function() {
      console.log('[VivaVideo] socket connected:', sock.id, 'room:', vivaId, 'role:', role);
      sock.emit('join-viva-room', { vivaId: vivaId, role: role, userName: displayName || role });
      // Give admin the socket so it can emit question-text etc
      if (onSocketReady) onSocketReady(sock);
    });

    // Who's already in room
    sock.on('room-members', function(members) {
      members.forEach(function(m) {
        if ((role === 'admin' && m.role === 'student') || (role === 'student' && m.role === 'admin')) {
          peerIdRef.current = m.socketId;
          setConnected(true);
          if (role === 'admin') makeOffer(sock, stream, m.socketId);
        }
      });
    });

    // Peer joins
    sock.on('peer-joined', function(data) {
      var isPeer = (role === 'admin' && data.role === 'student') || (role === 'student' && data.role === 'admin');
      if (!isPeer) return;
      console.log('[VivaVideo] peer joined:', data.role, data.userName);
      peerIdRef.current = data.socketId;
      setConnected(true);
      // Notify admin UI of student join/leave via custom event
      window.dispatchEvent(new CustomEvent('viva-peer-joined', { detail: data }));
      if (role === 'admin') makeOffer(sock, stream, data.socketId);
    });

    // Student receives offer → answers
    sock.on('webrtc-offer', async function(data) {
      if (role !== 'student') return;
      await handleOffer(sock, stream, data);
    });

    sock.on('webrtc-answer', async function(data) {
      if (pcRef.current && pcRef.current.signalingState !== 'closed') {
        try { await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.answer)); } catch(e){}
      }
    });

    sock.on('webrtc-ice-candidate', async function(data) {
      if (pcRef.current && data.candidate) {
        try { await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch(e){}
      }
    });

    sock.on('peer-left', function(data) {
      var isPeer = (role === 'admin' && data.role === 'student') || (role === 'student' && data.role === 'admin');
      if (isPeer) {
        setConnected(false);
        if (remoteVid.current) remoteVid.current.srcObject = null;
        if (pcRef.current) { try{pcRef.current.close();}catch(e){} pcRef.current = null; }
        window.dispatchEvent(new CustomEvent('viva-peer-left', { detail: data }));
      }
    });

    // Question text from admin to student
    sock.on('question-text', function(data) {
      // Dispatched as custom event so VivaJoin can listen
      window.dispatchEvent(new CustomEvent('viva-question', { detail: data.text }));
    });
  }

  async function makeOffer(sock, stream, targetId) {
    if (pcRef.current) { try{pcRef.current.close();}catch(e){} }
    var pc = new RTCPeerConnection(ICE);
    pcRef.current = pc;
    stream.getTracks().forEach(function(t) { pc.addTrack(t, stream); });
    pc.ontrack = function(e) { attachRemote(e.streams[0]); };
    pc.onicecandidate = function(e) {
      if (e.candidate) sock.emit('webrtc-ice-candidate', { vivaId: vivaId, candidate: e.candidate });
    };
    pc.onconnectionstatechange = function() {
      if (pc.connectionState === 'connected') setConnected(true);
    };
    try {
      var offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await pc.setLocalDescription(offer);
      sock.emit('webrtc-offer', { vivaId: vivaId, offer: pc.localDescription });
    } catch(e) { console.error('[VivaVideo] offer failed:', e); }
  }

  async function handleOffer(sock, stream, data) {
    if (pcRef.current) { try{pcRef.current.close();}catch(e){} }
    var pc = new RTCPeerConnection(ICE);
    pcRef.current = pc;
    stream.getTracks().forEach(function(t) { pc.addTrack(t, stream); });
    pc.ontrack = function(e) { attachRemote(e.streams[0]); };
    pc.onicecandidate = function(e) {
      if (e.candidate) sock.emit('webrtc-ice-candidate', { vivaId: vivaId, candidate: e.candidate });
    };
    pc.onconnectionstatechange = function() {
      if (pc.connectionState === 'connected') setConnected(true);
    };
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      var answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sock.emit('webrtc-answer', { vivaId: vivaId, answer: pc.localDescription });
    } catch(e) { console.error('[VivaVideo] answer failed:', e); }
  }

  function attachRemote(remoteStream) {
    setConnected(true);
    var att = 0;
    var iv = setInterval(function() {
      if (++att > 50) { clearInterval(iv); return; }
      if (!remoteVid.current) return;
      clearInterval(iv);
      remoteVid.current.srcObject = remoteStream;
      remoteVid.current.play().catch(function(){});
    }, 80);
  }

  function toggleCam() {
    if (!streamRef.current) return;
    streamRef.current.getVideoTracks().forEach(function(t){ t.enabled = !camOn; });
    setCamOn(function(v){return !v;});
  }
  function toggleMic() {
    if (!streamRef.current) return;
    streamRef.current.getAudioTracks().forEach(function(t){ t.enabled = !micOn; });
    setMicOn(function(v){return !v;});
  }

  var remoteLabel = role === 'admin' ? '🎓 Student' : '👨‍🏫 Examiner';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {camError && (
        <div style={{ padding: '8px 12px', background: 'rgba(220,38,38,.12)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 8, fontSize: '0.78rem', color: '#f87171', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>⚠ {camError}</span>
          <button onClick={startCamera} style={{ padding: '3px 10px', borderRadius: 6, border: 'none', background: '#7c3aed', color: '#fff', fontSize: '0.72rem', cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {/* Remote video ONLY — admin sees student, student sees admin */}
      <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', background: '#0a0a14', aspectRatio: '4/3' }}>
        <video ref={remoteVid} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}/>

        {/* Picture-in-picture: own camera small in corner */}
        <div style={{ position: 'absolute', bottom: 8, right: 8, width: 90, height: 68, borderRadius: 7, overflow: 'hidden', border: '2px solid rgba(255,255,255,.2)', background: '#000' }}>
          <video ref={localVid} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}/>
        </div>

        {/* Remote label */}
        <div style={{ position: 'absolute', bottom: 8, left: 8, background: connected ? 'rgba(22,163,74,.85)' : 'rgba(0,0,0,.7)', color: '#fff', fontSize: '0.65rem', padding: '3px 10px', borderRadius: 8, fontWeight: 700 }}>
          {connected ? '🟢 ' : '⏳ '}{remoteLabel}
        </div>

        {/* Waiting overlay when not connected */}
        {!connected && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: '2.5rem', opacity: .2 }}>👤</span>
            <span style={{ fontSize: '0.75rem', color: '#4b5563', fontWeight: 600 }}>Waiting for {remoteLabel}…</span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
        <button onClick={toggleCam} style={{ padding: '5px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.72rem', background: camOn ? 'rgba(22,163,74,.2)' : 'rgba(220,38,38,.2)', color: camOn ? '#4ade80' : '#f87171' }}>
          {camOn ? '📷 Cam On' : '📷 Off'}
        </button>
        <button onClick={toggleMic} style={{ padding: '5px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.72rem', background: micOn ? 'rgba(22,163,74,.2)' : 'rgba(220,38,38,.2)', color: micOn ? '#4ade80' : '#f87171' }}>
          {micOn ? '🎤 Mic On' : '🎤 Off'}
        </button>
      </div>
    </div>
  );
}
