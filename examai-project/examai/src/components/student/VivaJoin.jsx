import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { apiGet } from '../../utils/api';
import JitsiMeet from '../JitsiMeet';
import { io } from 'socket.io-client';

var SOCKET_URL = 'https://online-examamination-production.up.railway.app';
var API        = 'https://online-examamination-production.up.railway.app/api';

var SPEECH_THRESHOLD = 18;
var MIN_SPEECH_MS    = 500;
var MIN_BLOB_BYTES   = 15000;

function getMimeType() {
  return MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
       : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
       : MediaRecorder.isTypeSupported('audio/ogg')  ? 'audio/ogg' : 'audio/mp4';
}

export default function VivaJoin() {
  var store = useStore();
  var [phase,       setPhase]      = useState('join');
  var [roomId,      setRoomId]     = useState('');
  var [session,     setSession]    = useState(null);
  var [invites,     setInvites]    = useState([]);
  var [currentQ,    setCurrentQ]   = useState('');
  var [qFlash,      setQFlash]     = useState(false);
  var [sockStatus,  setSockStatus] = useState('connecting');
  var [liveAnswer,  setLiveAnswer] = useState('');   // student's live transcription
  var [capturing,   setCapturing]  = useState(false);

  var synthRef     = useRef(window.speechSynthesis);
  var sockRef      = useRef(null);
  var roomIdRef    = useRef('');
  var currentQRef  = useRef('');

  // Groq Whisper VAD refs
  var vadIvRef     = useRef(null);
  var audioCtxRef  = useRef(null);
  var micStreamRef = useRef(null);
  var captureRef   = useRef(false);
  var liveAnsRef   = useRef('');

  useEffect(function() {
    apiGet('/notifications').then(function(n) {
      setInvites((n||[]).filter(function(x){
        return x.viva_room_id && x.type !== 'expired' && !x.title.startsWith('[Ended]');
      }));
    }).catch(function(){});
  }, []); // eslint-disable-line

  useEffect(function() {
    return function() {
      stopCapture();
      synthRef.current && synthRef.current.cancel();
      if (sockRef.current) { try { sockRef.current.disconnect(); } catch(e){} }
    };
  }, []); // eslint-disable-line

  // ── Groq Whisper VAD capture (student side) ───────────────────────
  async function startCapture() {
    stopCapture();
    captureRef.current = true;
    liveAnsRef.current = '';
    setLiveAnswer('');
    setCapturing(true);

    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStreamRef.current = stream;

      var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = audioCtx;
      var analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      var dataArr  = new Uint8Array(analyser.frequencyBinCount);
      audioCtx.createMediaStreamSource(stream).connect(analyser);

      var mimeType    = getMimeType();
      var mr          = null;
      var chunks      = [];
      var isRec       = false;
      var speechStart = null;
      var lastSpeech  = null;
      var silChk      = null;

      function getRMS() {
        analyser.getByteTimeDomainData(dataArr);
        var sum = 0;
        for (var i = 0; i < dataArr.length; i++) { var v = (dataArr[i]-128)/128; sum += v*v; }
        return Math.sqrt(sum/dataArr.length)*100;
      }

      function sendChunkToGroq(blob) {
        var dur = (lastSpeech || Date.now()) - speechStart;
        if (blob.size < MIN_BLOB_BYTES || dur < MIN_SPEECH_MS) return;
        var reader = new FileReader();
        reader.onload = async function() {
          try {
            var base64 = reader.result.split(',')[1];
            var token  = localStorage.getItem('examai_token') || '';
            var resp   = await fetch(API + '/ai/transcribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
              body: JSON.stringify({ audio: base64, mimeType: mimeType })
            });
            var data = await resp.json();
            var text = (data.text || '').trim();
            if (text && captureRef.current) {
              liveAnsRef.current += text + ' ';
              var full = liveAnsRef.current.trim();
              setLiveAnswer(full);
              // Send live words to admin
              if (sockRef.current && sockRef.current.connected) {
                sockRef.current.emit('student-answer-live', {
                  vivaId: roomIdRef.current,
                  text:   full,
                  interim: ''
                });
              }
            }
          } catch(e) { console.warn('[StudentWhisper]', e); }
        };
        reader.readAsDataURL(blob);
      }

      function startRec() {
        if (isRec) return;
        isRec = true; speechStart = Date.now(); chunks = [];
        mr = new MediaRecorder(stream, { mimeType: mimeType });
        mr.ondataavailable = function(e) { if (e.data && e.data.size > 0) chunks.push(e.data); };
        mr.onstop = function() {
          if (!captureRef.current) return;
          sendChunkToGroq(new Blob(chunks, { type: mimeType }));
        };
        mr.start();
      }

      function stopRec() {
        if (!isRec) return; isRec = false;
        if (mr && mr.state === 'recording') { try { mr.stop(); } catch(e) {} }
      }

      clearInterval(vadIvRef.current);
      vadIvRef.current = setInterval(function() {
        if (!captureRef.current) { clearInterval(vadIvRef.current); stopRec(); return; }
        var rms = getRMS();
        if (rms > SPEECH_THRESHOLD) {
          lastSpeech = Date.now();
          if (!isRec) startRec();
          clearTimeout(silChk); silChk = null;
        } else if (isRec && !silChk) {
          silChk = setTimeout(function() { stopRec(); silChk = null; }, 1800);
        }
      }, 80);

    } catch(e) {
      setCapturing(false);
      captureRef.current = false;
      store.addToast('Mic access denied — cannot capture answer', 'error');
    }
  }

  function stopCapture() {
    captureRef.current = false;
    setCapturing(false);
    clearInterval(vadIvRef.current); vadIvRef.current = null;
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(function(t){ t.stop(); });
      micStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch(e) {}
      audioCtxRef.current = null;
    }
  }

  function finalizeAnswer() {
    var full = liveAnsRef.current.trim();
    stopCapture();
    if (!full) return;
    // Send final answer to admin for grading
    if (sockRef.current && sockRef.current.connected) {
      sockRef.current.emit('student-answer-final', {
        vivaId: roomIdRef.current,
        text:   full
      });
    }
    liveAnsRef.current = '';
    setLiveAnswer('');
  }

  // ── Socket ────────────────────────────────────────────────────────
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

    sock.on('question-text', function(data) {
      var text  = data.text;
      var noTTS = data.noTTS;

      currentQRef.current = text;
      setCurrentQ(text);
      setQFlash(true);
      setTimeout(function() { setQFlash(false); }, 600);

      // Reset previous answer
      liveAnsRef.current = '';
      setLiveAnswer('');
      stopCapture();

      function afterTTS() {
        // Start capturing student's answer via Groq Whisper
        startCapture();
      }

      if (noTTS) {
        // Manual: student already heard admin via Jitsi — start capturing
        setTimeout(afterTTS, 500);
        return;
      }

      function signalTTSDone() {
        if (sock.connected) sock.emit('tts-done', { vivaId: vid });
        afterTTS();
      }

      if (!window.speechSynthesis) { signalTTSDone(); return; }
      window.speechSynthesis.cancel();
      function doSpeak() {
        var utt = new SpeechSynthesisUtterance(text);
        utt.rate = 0.88; utt.lang = 'en-US'; utt.volume = 1;
        var voices = window.speechSynthesis.getVoices();
        var pref = voices.find(function(v){ return v.lang.startsWith('en') && !v.name.includes('compact'); });
        if (pref) utt.voice = pref;
        utt.onend  = function() { signalTTSDone(); };
        utt.onerror= function() { signalTTSDone(); };
        window.speechSynthesis.speak(utt);
      }
      if (window.speechSynthesis.getVoices().length > 0) {
        doSpeak();
      } else {
        window.speechSynthesis.onvoiceschanged = function() { doSpeak(); };
        setTimeout(doSpeak, 800);
      }
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
    stopCapture();
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
            onChange={function(e){ setRoomId(e.target.value); }}
            placeholder="Paste Room ID…" style={{ flex: 1 }}/>
          <button className="btn btn-primary" onClick={function(){ handleJoin(); }} disabled={!roomId.trim()}>Join</button>
        </div>
      </div>
    </div>
  );

  // ── ROOM PHASE ────────────────────────────────────────────────────
  var studentName = store.currentUser ? (store.currentUser.name || 'Student') : 'Student';

  return (
    <div className="viva-dark fade-up" style={{ maxWidth: 680, margin: '0 auto' }}>

      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="badge badge-success">🟢 Live</span>
          <span style={{ fontWeight: 700, color: '#fff' }}>{session ? session.title : 'Viva'}</span>
          <span style={{ fontSize: '0.65rem', fontWeight: 700, color: sockStatus === 'connected' ? '#4ade80' : '#f59e0b' }}>
            {sockStatus === 'connected' ? '● Connected' : '● ' + sockStatus}
          </span>
        </div>
        <button className="btn btn-sm btn-outline" onClick={function(){ if(window.confirm('Leave?')) leave(); }}>Leave</button>
      </div>

      {/* Question banner */}
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
            <button onClick={function(){
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
        </div>
      ) : (
        <div style={{ padding: '10px 14px', marginBottom: 12, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 8, textAlign: 'center', color: '#4b5563', fontSize: '0.8rem' }}>
          ⏳ Waiting for examiner to ask a question…
        </div>
      )}

      {/* Live answer transcript — shown while capturing */}
      {currentQ && (
        <div style={{ marginBottom: 12, padding: '10px 14px', background: 'rgba(255,255,255,.04)', border: '1.5px solid ' + (capturing ? '#ef4444' : 'rgba(255,255,255,.08)'), borderRadius: 8, transition: 'border-color .2s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {capturing && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', display: 'inline-block', animation: 'pulse 1s infinite' }}/>}
              <span style={{ fontSize: '0.65rem', fontWeight: 700, color: capturing ? '#ef4444' : '#9ca3af', letterSpacing: 1, fontFamily: 'JetBrains Mono,monospace' }}>
                {capturing ? '🎤 CAPTURING YOUR ANSWER' : '📝 YOUR ANSWER'}
              </span>
            </div>
            {liveAnswer && (
              <button onClick={finalizeAnswer}
                style={{ background: 'rgba(22,163,74,.2)', border: '1px solid rgba(22,163,74,.4)', borderRadius: 6, padding: '3px 10px', color: '#4ade80', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}>
                ✅ Done Speaking
              </button>
            )}
          </div>
          <div style={{ fontSize: '0.9rem', color: liveAnswer ? '#e5e5e5' : '#4b5563', fontStyle: liveAnswer ? 'normal' : 'italic', lineHeight: 1.65, minHeight: 40 }}>
            {liveAnswer || (capturing ? 'Speak your answer — Groq Whisper is listening…' : 'Your answer will appear here as you speak')}
          </div>
        </div>
      )}

      {/* Camera */}
      <div className="card" style={{ padding: 8 }}>
        <JitsiMeet roomName={roomId} displayName={studentName} height={380} role="student" />
      </div>

    </div>
  );
}
