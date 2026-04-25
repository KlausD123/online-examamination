import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { apiGet } from '../../utils/api';
import JitsiMeet from '../JitsiMeet';
import { io } from 'socket.io-client';

var SOCKET_URL = 'https://online-examamination-production.up.railway.app';

export default function VivaJoin() {
  var store = useStore();
  var [phase,       setPhase]    = useState('join');
  var [roomId,      setRoomId]   = useState('');
  var [session,     setSession]  = useState(null);
  var [invites,     setInvites]  = useState([]);
  var [currentQ,    setCurrentQ] = useState('');
  var [qFlash,      setQFlash]   = useState(false);
  var [sockStatus,  setSockStatus] = useState('connecting');

  var synthRef = useRef(window.speechSynthesis);
  var sockRef  = useRef(null);
  var roomIdRef= useRef('');

  useEffect(function() {
    apiGet('/notifications').then(function(n) {
      setInvites((n||[]).filter(function(x){
        return x.viva_room_id && x.type !== 'expired' && !x.title.startsWith('[Ended]');
      }));
    }).catch(function(){});
  }, []); // eslint-disable-line

  useEffect(function() {
    return function() {
      synthRef.current && synthRef.current.cancel();
      if (sockRef.current) { try { sockRef.current.disconnect(); } catch(e){} }
    };
  }, []); // eslint-disable-line

  function connectSocket(vid, name) {
    if (sockRef.current) { try { sockRef.current.disconnect(); } catch(e){} }
    var sock = io(SOCKET_URL);
    sockRef.current = sock;
    roomIdRef.current = vid;

    sock.on('connect', function() {
      setSockStatus('connected');
      sock.emit('join-viva-room', { vivaId: vid, role: 'student', userName: name });
    });
    sock.on('disconnect',    function() { setSockStatus('disconnected'); });
    sock.on('connect_error', function() { setSockStatus('error'); });

    // Admin sends question → TTS reads it on student device
    sock.on('question-text', function(data) {
      var text  = data.text;
      var noTTS = data.noTTS;

      setCurrentQ(text);
      setQFlash(true);
      setTimeout(function() { setQFlash(false); }, 600);

      if (noTTS) {
        // Manual mode: student heard admin live via Jitsi — just show text
        return;
      }

      // Generated mode: read question aloud via TTS
      function signalTTSDone() {
        if (sock.connected) sock.emit('tts-done', { vivaId: vid });
      }

      function speakQuestion() {
        if (!window.speechSynthesis) { signalTTSDone(); return; }
        window.speechSynthesis.cancel();
        // Wait for voices to load
        function doSpeak() {
          var utt = new SpeechSynthesisUtterance(text);
          utt.rate = 0.88; utt.lang = 'en-US'; utt.volume = 1;
          // Pick a clear voice if available
          var voices = window.speechSynthesis.getVoices();
          var preferred = voices.find(function(v){ return v.lang.startsWith('en') && !v.name.includes('compact'); });
          if (preferred) utt.voice = preferred;
          utt.onend  = function() { signalTTSDone(); };
          utt.onerror= function() { signalTTSDone(); };
          window.speechSynthesis.speak(utt);
        }
        if (window.speechSynthesis.getVoices().length > 0) {
          doSpeak();
        } else {
          window.speechSynthesis.onvoiceschanged = function() { doSpeak(); };
          // Fallback if voices never load
          setTimeout(doSpeak, 800);
        }
      }

      speakQuestion();
    });
  }

  async function handleJoin(id) {
    var vid = (id || roomId || '').trim();
    if (!vid) return;
    try {
      var s = await apiGet('/viva/' + vid);
      if (!s) { alert('Room not found'); return; }
      setSession(s); setRoomId(vid);
      var name = store.currentUser ? (store.currentUser.name || 'Student') : 'Student';
      connectSocket(vid, name);
      setPhase('room');
    } catch(e) { alert('Room not found: ' + e.message); }
  }

  function leave() {
    synthRef.current && synthRef.current.cancel();
    if (sockRef.current) { try { sockRef.current.disconnect(); } catch(e){} sockRef.current = null; }
    setPhase('join'); setSession(null); setRoomId('');
    setCurrentQ(''); roomIdRef.current = '';
  }

  // ── JOIN PHASE ────────────────────────────────────────────────────
  if (phase === 'join') return (
    <div className="fade-up">
      <div className="page-header">
        <div>
          <div className="page-title">🎙 Viva Voce</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text3)' }}>Live oral examination</div>
        </div>
      </div>

      {invites.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>📬 Invitations</div>
          <div className="grid-2">
            {invites.map(function(inv) {
              return (
                <div key={inv.notification_id} className="card" style={{ borderLeft: '4px solid var(--accent)' }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{inv.title}</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text3)', marginBottom: 14 }}>{inv.message}</div>
                  <button className="btn btn-primary btn-sm" onClick={function() { handleJoin(inv.viva_room_id); }}>🚀 Join Now</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card" style={{ maxWidth: 420 }}>
        <div className="card-title">Join by Room ID</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input className="form-input" value={roomId}
            onChange={function(e) { setRoomId(e.target.value); }}
            placeholder="Paste Room ID…" style={{ flex: 1 }}/>
          <button className="btn btn-primary" onClick={function() { handleJoin(); }} disabled={!roomId.trim()}>Join</button>
        </div>
      </div>
    </div>
  );

  // ── ROOM PHASE — camera only ──────────────────────────────────────
  var studentName = store.currentUser ? (store.currentUser.name || 'Student') : 'Student';

  return (
    <div className="viva-dark fade-up" style={{ maxWidth: 680, margin: '0 auto' }}>

      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="badge badge-success">🟢 Live</span>
          <span style={{ fontWeight: 700, color: '#fff' }}>{session ? session.title : 'Viva'}</span>
          <span style={{ fontSize: '0.65rem', fontWeight: 700,
            color: sockStatus === 'connected' ? '#4ade80' : '#f59e0b' }}>
            {sockStatus === 'connected' ? '● Connected' : '● ' + sockStatus}
          </span>
        </div>
        <button className="btn btn-sm btn-outline"
          onClick={function() { if (window.confirm('Leave the room?')) leave(); }}>
          Leave
        </button>
      </div>

      {/* Question banner — shown when examiner asks */}
      {currentQ ? (
        <div style={{
          padding: '12px 16px', marginBottom: 12,
          background: qFlash ? 'rgba(124,58,237,.45)' : 'rgba(124,58,237,.15)',
          border: '2px solid rgba(124,58,237,.5)', borderRadius: 10, transition: 'background .3s'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#a78bfa', letterSpacing: 1, fontFamily: 'JetBrains Mono,monospace' }}>
              🔊 QUESTION
            </div>
            <button onClick={function() {
              if (!window.speechSynthesis) return;
              window.speechSynthesis.cancel();
              var utt = new SpeechSynthesisUtterance(currentQ);
              utt.rate = 0.88; utt.lang = 'en-US';
              var voices = window.speechSynthesis.getVoices();
              var pref = voices.find(function(v){ return v.lang.startsWith('en'); });
              if (pref) utt.voice = pref;
              window.speechSynthesis.speak(utt);
            }} style={{ background: 'rgba(124,58,237,.3)', border: 'none', borderRadius: 6, padding: '3px 10px', color: '#a78bfa', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}>
              🔁 Replay
            </button>
          </div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', lineHeight: 1.5 }}>{currentQ}</div>
          <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: 5 }}>Speak your answer clearly</div>
        </div>
      ) : (
        <div style={{ padding: '10px 14px', marginBottom: 12, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 8, textAlign: 'center', color: '#4b5563', fontSize: '0.8rem' }}>
          ⏳ Waiting for examiner to ask a question…
        </div>
      )}

      {/* Camera — full width, no controls */}
      <div className="card" style={{ padding: 8 }}>
        <JitsiMeet roomName={roomId} displayName={studentName} height={420} role="student" />
      </div>

    </div>
  );
}
