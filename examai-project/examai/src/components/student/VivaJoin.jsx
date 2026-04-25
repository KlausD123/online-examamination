import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { apiGet } from '../../utils/api';
import JitsiMeet from '../JitsiMeet';
import { io } from 'socket.io-client';

var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
var SOCKET_URL = 'http://localhost:5000';

export default function VivaJoin() {
  var store = useStore();
  var [phase,          setPhase]       = useState('join');
  var [roomId,         setRoomId]      = useState('');
  var [session,        setSession]     = useState(null);
  var [invites,        setInvites]     = useState([]);
  var [currentQ,       setCurrentQ]    = useState('');
  var [qFlash,         setQFlash]      = useState(false);
  var [liveText,       setLiveText]    = useState('');
  var [interimText,    setInterimText] = useState('');
  var [isListening,    setIsListening] = useState(false);
  var [transcript,     setTranscript]  = useState([]);
  var [showTranscript, setShowTranscript] = useState(true);
  var [socketStatus,   setSocketStatus] = useState('disconnected');

  var synthRef     = useRef(window.speechSynthesis);
  var sockRef      = useRef(null);
  var recRef       = useRef(null);
  var liveTextRef  = useRef('');
  var currentQRef  = useRef('');
  var silenceTimer = useRef(null);
  var roomIdRef    = useRef('');

  useEffect(function() {
    apiGet('/notifications').then(function(n) {
      setInvites((n || []).filter(function(x) {
        return x.viva_room_id && x.type !== 'expired' && !x.title.startsWith('[Ended]');
      }));
    }).catch(function() {});
  }, []); // eslint-disable-line

  // Cleanup on unmount
  useEffect(function() {
    return function() {
      stopListening();
      synthRef.current && synthRef.current.cancel();
      if (sockRef.current) { try { sockRef.current.disconnect(); } catch(e) {} sockRef.current = null; }
    };
  }, []); // eslint-disable-line

  // Connect socket when entering room
  function connectSocket(vid, studentName) {
    if (sockRef.current) { try { sockRef.current.disconnect(); } catch(e) {} }
    var sock = io(SOCKET_URL);
    sockRef.current = sock;
    roomIdRef.current = vid;

    sock.on('connect', function() {
      setSocketStatus('connected');
      sock.emit('join-viva-room', { vivaId: vid, role: 'student', userName: studentName });
    });

    sock.on('disconnect', function() { setSocketStatus('disconnected'); });
    sock.on('connect_error', function() { setSocketStatus('error'); });

    // Admin sends question → student receives, TTS reads it, mic starts
    sock.on('question-text', function(data) {
      var text = data.text;
      currentQRef.current = text;
      setCurrentQ(text);
      setQFlash(true);
      setTimeout(function() { setQFlash(false); }, 800);

      // Reset answer for new question
      liveTextRef.current = '';
      setLiveText('');
      setInterimText('');
      stopListening();

      // Student's browser reads question aloud via TTS
      if (synthRef.current) {
        synthRef.current.cancel();
        var utt = new SpeechSynthesisUtterance(text);
        utt.rate = 0.88; utt.pitch = 1.0; utt.lang = 'en-US';
        utt.onend  = function() { setTimeout(startListening, 700); };
        utt.onerror = function() { setTimeout(startListening, 400); };
        synthRef.current.speak(utt);
      } else {
        setTimeout(startListening, 500);
      }
    });
  }

  // ── Speech Recognition ──────────────────────────────────────────
  function startListening() {
    if (!SR) return;
    stopListening();
    liveTextRef.current = '';
    setLiveText('');
    setInterimText('');
    setIsListening(true);

    var r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    r.maxAlternatives = 1;

    r.onresult = function(e) {
      if (!recRef.current) return;
      clearTimeout(silenceTimer.current);
      var newFinal = '', interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) newFinal += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      if (newFinal) {
        liveTextRef.current += newFinal;
        setLiveText(liveTextRef.current.trim());
        // Send live words to admin
        if (sockRef.current && sockRef.current.connected) {
          sockRef.current.emit('student-answer-live', {
            vivaId: roomIdRef.current,
            text:    liveTextRef.current.trim(),
            interim: interim
          });
        }
      }
      setInterimText(interim);
      // Auto-finalize after 4s silence
      silenceTimer.current = setTimeout(function() {
        if (recRef.current) finalizeAnswer();
      }, 4000);
    };

    r.onerror = function(ev) {
      if (ev.error === 'not-allowed') {
        setIsListening(false);
        store.addToast('Mic denied — allow microphone in browser settings', 'error');
      }
    };

    r.onend = function() {
      if (recRef.current) { try { r.start(); } catch(e) { setIsListening(false); } }
    };

    try { r.start(); recRef.current = r; } catch(e) { setIsListening(false); }
  }

  function stopListening() {
    clearTimeout(silenceTimer.current);
    setIsListening(false);
    setInterimText('');
    if (recRef.current) { try { recRef.current.stop(); } catch(e) {} recRef.current = null; }
  }

  function finalizeAnswer() {
    var answer = liveTextRef.current.trim();
    var question = currentQRef.current;
    stopListening();
    if (!answer) return;

    // Send final answer to admin for grading
    if (sockRef.current && sockRef.current.connected) {
      sockRef.current.emit('student-answer-final', {
        vivaId: roomIdRef.current,
        text:   answer
      });
    }

    // Save locally too
    if (question) {
      setTranscript(function(prev) {
        return prev.concat([{ q: question, answer: answer, time: new Date().toLocaleTimeString() }]);
      });
    }
    liveTextRef.current = '';
    setLiveText('');
  }

  // ── Join handlers ────────────────────────────────────────────────
  async function handleJoin(id) {
    var vid = (id || roomId || '').trim();
    if (!vid) return;
    try {
      var s = await apiGet('/viva/' + vid);
      if (!s) { alert('Room not found'); return; }
      setSession(s);
      setRoomId(vid);
      var name = store.currentUser ? (store.currentUser.name || 'Student') : 'Student';
      connectSocket(vid, name);
      setPhase('room');
    } catch(e) { alert('Room not found: ' + e.message); }
  }

  function leave() {
    stopListening();
    synthRef.current && synthRef.current.cancel();
    if (sockRef.current) { try { sockRef.current.disconnect(); } catch(e) {} sockRef.current = null; }
    setPhase('join'); setSession(null); setRoomId('');
    setCurrentQ(''); setTranscript([]); setLiveText('');
    currentQRef.current = ''; roomIdRef.current = '';
  }

  // ── JOIN PHASE ───────────────────────────────────────────────────
  if (phase === 'join') return (
    <div className="fade-up">
      <div className="page-header">
        <div>
          <div className="page-title">🎙 Viva Voce</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text3)' }}>Live oral examination room</div>
        </div>
      </div>

      {invites.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>📬 Your Invitations</div>
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

      <div className="card" style={{ maxWidth: 480 }}>
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

  // ── ROOM PHASE ───────────────────────────────────────────────────
  var studentName = store.currentUser ? (store.currentUser.name || 'Student') : 'Student';

  return (
    <div className="viva-dark fade-up">
      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="badge badge-success">🟢 In Room</span>
          <span style={{ fontWeight: 700, color: '#fff' }}>{session ? session.title : 'Viva Session'}</span>
          {session && session.topic && (
            <span style={{ fontSize: '0.72rem', color: '#9ca3af', background: 'rgba(255,255,255,.06)', padding: '2px 10px', borderRadius: 12 }}>{session.topic}</span>
          )}
          <span style={{ fontSize: '0.65rem', color: socketStatus === 'connected' ? '#4ade80' : '#ef4444', fontWeight: 700 }}>
            {socketStatus === 'connected' ? '● Live' : '● Connecting…'}
          </span>
        </div>
        <button className="btn btn-sm btn-outline" onClick={function() { if (window.confirm('Leave the viva room?')) leave(); }}>Leave</button>
      </div>

      {/* Question Banner */}
      {currentQ ? (
        <div style={{
          padding: '14px 18px', marginBottom: 14,
          background: qFlash ? 'rgba(124,58,237,.4)' : 'rgba(124,58,237,.15)',
          border: '2px solid rgba(124,58,237,.5)', borderRadius: 12, transition: 'background .3s'
        }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#a78bfa', letterSpacing: 1, marginBottom: 6, fontFamily: 'JetBrains Mono,monospace' }}>
            🔊 QUESTION FROM EXAMINER
          </div>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#fff', lineHeight: 1.55 }}>{currentQ}</div>
          <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 8 }}>
            {isListening ? '🎤 Listening… speak your answer clearly' : 'Reading question aloud… your mic will start automatically'}
          </div>
        </div>
      ) : (
        <div style={{ padding: '10px 14px', marginBottom: 14, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, textAlign: 'center', color: '#6b7280', fontSize: '0.8rem' }}>
          ⏳ Waiting for examiner to ask a question…
        </div>
      )}

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>

        {/* LEFT: Jitsi + answer box */}
        <div>
          <div className="card" style={{ padding: 10 }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9ca3af', letterSpacing: 1, marginBottom: 8, textAlign: 'center', fontFamily: 'JetBrains Mono,monospace' }}>
              📹 LIVE SESSION
            </div>
            <JitsiMeet roomName={roomId} displayName={studentName} height={300} role="student" />
          </div>

          {/* Live answer capture box */}
          <div className="card" style={{ padding: 12, marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9ca3af', letterSpacing: 1, fontFamily: 'JetBrains Mono,monospace' }}>
                🎤 YOUR ANSWER
              </div>
              {isListening && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', display: 'inline-block', animation: 'pulse 1s infinite' }}/>
                  <span style={{ fontSize: '0.68rem', color: '#ef4444', fontWeight: 700 }}>LIVE TO EXAMINER</span>
                </div>
              )}
            </div>

            <div style={{
              minHeight: 90, padding: '10px 14px',
              background: 'rgba(255,255,255,.04)',
              border: '1.5px solid ' + (isListening ? '#ef4444' : 'rgba(255,255,255,.1)'),
              borderRadius: 8, fontSize: '0.88rem', color: '#e5e5e5',
              lineHeight: 1.65, marginBottom: 10, transition: 'border-color .2s', wordBreak: 'break-word'
            }}>
              {liveText
                ? <span>{liveText}{interimText && <span style={{ color: '#6b7280', fontStyle: 'italic' }}> {interimText}</span>}</span>
                : <span style={{ color: '#4b5563', fontStyle: 'italic' }}>
                    {isListening ? '🎤 Speak now — sending to examiner…' : 'Your words appear here automatically after the question'}
                  </span>
              }
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {!isListening ? (
                <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={startListening} disabled={!SR}>
                  🎤 {SR ? 'Start Speaking' : 'Use Chrome/Edge'}
                </button>
              ) : (
                <>
                  <button className="btn btn-success btn-sm" style={{ flex: 1 }} onClick={finalizeAnswer}>
                    ✅ Done — Send Answer
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={stopListening}>Pause</button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT: Transcript */}
        <div>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9ca3af', letterSpacing: 1, fontFamily: 'JetBrains Mono,monospace' }}>
                📋 SESSION TRANSCRIPT ({transcript.length})
              </div>
              <button onClick={function() { setShowTranscript(function(v) { return !v; }); }}
                style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '0.72rem' }}>
                {showTranscript ? '▲ Hide' : '▼ Show'}
              </button>
            </div>
            {showTranscript && (
              <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                {transcript.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px 0', color: '#4b5563', fontSize: '0.82rem' }}>
                    <div style={{ fontSize: '2rem', marginBottom: 8 }}>📝</div>
                    Your answers appear here as you speak
                  </div>
                ) : (
                  transcript.map(function(t, i) {
                    return (
                      <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, gap: 8 }}>
                          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#a78bfa', flex: 1, lineHeight: 1.45 }}>Q{i + 1}: {t.q}</div>
                          <div style={{ fontSize: '0.62rem', color: '#4b5563', flexShrink: 0 }}>{t.time}</div>
                        </div>
                        <div style={{ fontSize: '0.82rem', color: '#d1d5db', padding: '6px 10px', background: 'rgba(255,255,255,.04)', borderRadius: 6, lineHeight: 1.6, borderLeft: '2px solid rgba(124,58,237,.4)' }}>
                          🎤 {t.answer}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <div style={{ marginTop: 10, padding: '12px 16px', background: 'rgba(124,58,237,.1)', border: '1px solid rgba(124,58,237,.25)', borderRadius: 10, fontSize: '0.78rem' }}>
            <div style={{ fontWeight: 700, color: '#a78bfa', marginBottom: 8 }}>💡 How it works</div>
            <div style={{ color: '#9ca3af', lineHeight: 1.8 }}>
              <div>1️⃣ Examiner asks → question appears above</div>
              <div>2️⃣ Question is read aloud to you automatically</div>
              <div>3️⃣ Your mic starts → speak your answer</div>
              <div>4️⃣ Answer is sent live to examiner</div>
              <div>5️⃣ Click <strong style={{ color: '#4ade80' }}>Done</strong> when finished answering</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
