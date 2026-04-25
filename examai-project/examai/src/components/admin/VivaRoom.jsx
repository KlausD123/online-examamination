import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { groqChat } from '../../utils/aiService';
import { apiPost, apiGet } from '../../utils/api';
import { io as ioClient } from 'socket.io-client';
import VivaVideo from '../VivaVideo';

var SOCKET_URL = 'http://localhost:5000';

var ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

var API = 'http://localhost:5000/api';
var SESSION_KEY = 'dexam_viva_session';
var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function getToken() { return localStorage.getItem('examai_token'); }
function restoreSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch(e) { return null; } }

async function gradeSpokenAnswer(question, modelAnswer, studentSaid) {
  if (!studentSaid || !studentSaid.trim())
    return { correct: false, score_pct: 0, verdict: 'No Answer', feedback: 'Student did not respond.', missing: modelAnswer };
  try {
    var raw = await groqChat(
      'You are an experienced oral viva examiner. Students speak conversationally — judge whether they understand the CONCEPT, not whether they match exact words. A short clear answer showing understanding scores well. Return ONLY valid JSON.',
      'Question: ' + question +
      '\nModel Answer (reference only — student need not match this exactly): ' + modelAnswer +
      '\nStudent Spoken Answer: ' + studentSaid +
      '\nEvaluate: Does the student grasp the core concept? Did they cover the key idea(s) even if briefly or in their own words?' +
      '\nReturn: {"correct":bool,"score_pct":0-100,"verdict":"Correct|Partially Correct|Incorrect","feedback":"2-3 sentences on what was good and what was missing","missing":"key concept missed or None"}',
      400, 0.2
    );
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch(e) {
    return { correct: false, score_pct: 0, verdict: 'Error', feedback: 'Grading error: ' + e.message, missing: '' };
  }
}

async function generateSessionReport(topic, transcript) {
  var log = transcript.map(function(t, i) {
    return 'Q' + (i + 1) + ': ' + t.question + '\nStudent said: ' + (t.student_said || '(silent)') + '\nScore: ' + (t.score_pct || 0) + '%';
  }).join('\n\n');
  try {
    var raw = await groqChat(
      'You are an expert oral examiner. Return ONLY valid JSON.',
      'Analyze oral viva on "' + topic + '":\n\n' + log +
      '\n\nReturn: {"overall_feedback":"3-4 sentences","strong_areas":["area1"],"weak_areas":["area2"],"communication_score":0-100,"knowledge_score":0-100,"readiness":"Not Ready|Almost Ready|Ready|Exam Ready"}',
      700, 0.3
    );
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch(e) {
    return { overall_feedback: 'Session completed.', strong_areas: [], weak_areas: [], communication_score: 70, knowledge_score: 70, readiness: 'Almost Ready' };
  }
}

var FACE_LOADED = false, FACE_LOADING = false, FACE_CBS = [];
var MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
function loadFaceAPI() {
  return new Promise(function(resolve, reject) {
    if (FACE_LOADED) { resolve(); return; }
    FACE_CBS.push({ resolve, reject });
    if (FACE_LOADING) return;
    FACE_LOADING = true;
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.js';
    s.onload = function() {
      Promise.all([
        window.faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        window.faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      ]).then(function() { FACE_LOADED = true; FACE_CBS.forEach(function(c) { c.resolve(); }); FACE_CBS = []; })
        .catch(function(e) { FACE_CBS.forEach(function(c) { c.reject(e); }); FACE_CBS = []; });
    };
    s.onerror = function(e) { FACE_CBS.forEach(function(c) { c.reject(e); }); FACE_CBS = []; };
    document.head.appendChild(s);
  });
}

export default function VivaRoom() {
  var store = useStore();
  var _restore = restoreSession();

  var [phase,       setPhase]       = useState('setup');
  var [title,       setTitle]       = useState('');
  var [vivaCourseId, setVivaCourseId] = useState('');
  var [vivaCourses,  setVivaCourses]  = useState([]);
  var [topic,       setTopic]       = useState('');
  var savedVivaRef  = useRef(null);

  // ====================================================
  var _didRestore = useRef(false);
  useEffect(function() {
    if (_didRestore.current) return;
    _didRestore.current = true;
    var s = restoreSession();
    if (!s || !s.viva_id) return;
    savedVivaRef.current = { viva_id: s.viva_id, title: s.title, topic: s.topic };
    setTitle(s.title || '');
    setTopic(s.topic || '');
    if (s.questions)   { setQuestions(s.questions);   questionsRef.current = s.questions; }
    if (s.transcript)  { setTranscript(s.transcript); }
    if (s.currentQ != null) { setCurrentQ(s.currentQ); currentQRef.current = s.currentQ; askedQIdxRef.current = s.currentQ; }
    if (s.selStudentId) setSelStudentId(s.selStudentId);
    if (s.selStudentName) setSelStudentName(s.selStudentName);
    setPhase('room');
    setTimeout(setupWebRTC, 300);
    startPolling();
  }, []); // eslint-disable-line

  var [questions,   setQuestions]   = useState([]);
  var [currentQ,    setCurrentQ]    = useState(0);
  var [transcript,  setTranscript]  = useState([]);
  var [loading,     setLoading]     = useState(false);

  // ====================================================
  useEffect(function() {
    if (phase !== 'room' || !savedVivaRef.current) return;
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        viva_id: savedVivaRef.current.viva_id,
        title, topic,
        questions: questions,
        transcript,
        currentQ,
        selStudentId,
        selStudentName,
      }));
    } catch(e) {}
  }, [phase, questions, transcript, currentQ, selStudentId, selStudentName, title, topic]); // eslint-disable-line


  // Oral flow: idle | speaking | listening | grading | done
  var [flow,        setFlow]        = useState('idle');
  var [liveWords,   setLiveWords]   = useState('');
  var [capturedText,setCapturedText]= useState('');
  var [statusMsg,   setStatusMsg]   = useState('');
  var [verdict,     setVerdict]     = useState(null);
  var [followUpQ,   setFollowUpQ]   = useState('');
  var [followUpLoading, setFollowUpLoading] = useState(false);
  var [manualText,  setManualText]  = useState('');
  var [examNotes,   setExamNotes]   = useState('');

  var [genTopic,       setGenTopic]       = useState('');
  var [genCount,       setGenCount]       = useState(5);
  var [genLoading,     setGenLoading]     = useState(false);
  var [showCustomQ,    setShowCustomQ]    = useState(false);
  var [customQ,        setCustomQ]        = useState('');
  var [customAns,      setCustomAns]      = useState('');
  var [genModelLoading,setGenModelLoading]= useState(false);

  var [showInvite, setShowInvite]  = useState(false);
  var [students,   setStudents]    = useState([]);
  var [selStu,     setSelStu]      = useState([]);
  var [inviteMode, setInviteMode]  = useState('account');
  var [inviteEmail,setInviteEmail] = useState('');
  var [inviteMsg,  setInviteMsg]   = useState('');
  var [inviting,   setInviting]    = useState(false);

  // Which student is currently being examined
  var [selStudentId,   setSelStudentId]   = useState(null);
  var [selStudentName, setSelStudentName] = useState('');

  var [alerts,    setAlerts]    = useState([]);
  var [unread,    setUnread]    = useState(0);
  var [showAlerts,setShowAlerts]= useState(false);
  var alertLastRef = useRef(Date.now());
  var pollRef = useRef(null);

  // Away detection
  var [examinerAway,   setExaminerAway]   = useState(false);
  var [awayCountdown,  setAwayCountdown]  = useState(600);
  var [sessionExpired, setSessionExpired] = useState(false);
  var awayTimerRef = useRef(null);
  var awayStartRef = useRef(null);
  var graceRef     = useRef(null);

  // Camera / WebRTC
  var [camReady,         setCamReady]         = useState(false);
  var [studentConnected, setStudentConnected] = useState(false);
  var [faceStatus,       setFaceStatus]       = useState('loading');
  var [permBlocked,      setPermBlocked]      = useState(false); // camera/mic blocked by browser
  var videoRef      = useRef(null);
  var studentVidRef = useRef(null);
  var studentRemoteVid = useRef(null); // WebRTC remote video from student
  var canvasRef     = useRef(null);
  var streamRef     = useRef(null);
  var peerRef       = useRef(null);
  var socketRef     = useRef(null);     // Socket.IO
  var sigPollRef    = useRef(null);
  var faceIntRef    = useRef(null);

  // STT / TTS
  var recRef       = useRef(null);
  var synthRef     = useRef(window.speechSynthesis);
  var capturedRef  = useRef('');
  var silenceTimer = useRef(null);
  var flowRef      = useRef('idle');
  var currentQRef  = useRef(0);
  var questionsRef = useRef([]);

  // Results
  var [results,        setResults]        = useState(null);
  var [editableAns,    setEditableAns]    = useState([]);
  var [finalizing,     setFinalizing]     = useState(false);
  var [sessionReport,  setSessionReport]  = useState(null);

  useEffect(function() { flowRef.current     = flow; },      [flow]);
  useEffect(function() { currentQRef.current = currentQ; },  [currentQ]);
  useEffect(function() { questionsRef.current= questions; }, [questions]);

  useEffect(function() {
    if (_restore && _restore.viva_id) { setTimeout(setupWebRTC, 300); startPolling(); }
    return function() { stopAll(); };
  }, []); // eslint-disable-line

  // ====================================================
  useEffect(function() {
    function onJoined(e) {
      var d = e.detail;
      if (d.role === 'student') {
        setStudentConnected(true);
        store.addToast((d.userName||'Student') + ' joined the room', 'success');
        setAlerts(function(a) { return [{ title: '🟢 ' + (d.userName||'Student') + ' joined', type: 'success', time: new Date().toLocaleTimeString() }].concat(a).slice(0,20); });
      }
    }
    function onLeft(e) {
      var d = e.detail;
      if (d.role === 'student') {
        setStudentConnected(false);
        setAlerts(function(a) { return [{ title: '🔴 ' + (d.userName||'Student') + ' left', type: 'urgent', time: new Date().toLocaleTimeString() }].concat(a).slice(0,20); });
      }
    }
    window.addEventListener('viva-peer-joined', onJoined);
    window.addEventListener('viva-peer-left',   onLeft);
    return function() {
      window.removeEventListener('viva-peer-joined', onJoined);
      window.removeEventListener('viva-peer-left',   onLeft);
    };
  }, []); // eslint-disable-line

  // ====================================================
  useEffect(function() {
    if (phase !== 'room') return;
    function onVis() {
      if (document.hidden && !examinerAway) {
        graceRef.current = setTimeout(function() {
          if (document.hidden) { setExaminerAway(true); awayStartRef.current = Date.now(); setAwayCountdown(600); }
        }, 4000);
      } else if (!document.hidden) { clearTimeout(graceRef.current); }
    }
    document.addEventListener('visibilitychange', onVis);
    return function() { document.removeEventListener('visibilitychange', onVis); clearTimeout(graceRef.current); };
  }, [phase, examinerAway]); // eslint-disable-line

  useEffect(function() {
    if (!examinerAway) { clearInterval(awayTimerRef.current); return; }
    awayTimerRef.current = setInterval(function() {
      var rem = 600 - Math.floor((Date.now() - awayStartRef.current) / 1000);
      if (rem <= 0) {
        clearInterval(awayTimerRef.current);
        setExaminerAway(false); setSessionExpired(true);
        stopAll(); sessionStorage.removeItem(SESSION_KEY);
        var vid = savedVivaRef.current ? savedVivaRef.current.viva_id : null;
        if (vid) {
          fetch(API + '/viva/' + vid + '/end', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
            body: JSON.stringify({ ended: true })
          }).catch(function() {});
          fetch(API + '/viva/' + vid + '/cancel-invites', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
            body: JSON.stringify({})
          }).catch(function() {});
        }
      } else { setAwayCountdown(rem); }
    }, 1000);
    return function() { clearInterval(awayTimerRef.current); };
  }, [examinerAway]); // eslint-disable-line

  function examinerReturn() {
    clearInterval(awayTimerRef.current); clearTimeout(graceRef.current);
    setExaminerAway(false); setAwayCountdown(600); awayStartRef.current = null;
  }

  // ====================================================
  function startPolling() {
    alertLastRef.current = Date.now(); clearInterval(pollRef.current);
    pollRef.current = setInterval(async function() {
      try {
        var notifs = await apiGet('/notifications');
        var fresh = (notifs || []).filter(function(n) {
          return new Date(n.created_at || 0).getTime() > alertLastRef.current &&
            n.title && (n.title.includes('Left Viva') || n.title.includes('Returned') || n.title.includes('Removed'));
        });
        if (fresh.length) { alertLastRef.current = Date.now(); setAlerts(function(p) { return fresh.concat(p).slice(0, 40); }); setUnread(function(u) { return u + fresh.length; }); }
      } catch(e) {}
    }, 6000);
  }

  // ====================================================
  async function startCamera() {
    var stream = null;
    var constraints = [
      { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: true },
      { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
      { video: true, audio: true },
      { video: true, audio: false },
    ];

    for (var i = 0; i < constraints.length; i++) {
      try { stream = await navigator.mediaDevices.getUserMedia(constraints[i]); break; }
      catch(e) { console.warn('Camera attempt', i, 'failed:', e.name); }
    }

    if (!stream) {
      setFaceStatus('unavailable');
      setPermBlocked(true);
      return;
    }

    streamRef.current = stream;

    // Attach to video element
    var attempts = 0;
    var iv = setInterval(function() {
      attempts++;
      if (attempts > 50) { clearInterval(iv); return; }
      if (!videoRef.current) return;
      clearInterval(iv);
      videoRef.current.srcObject = stream;
      videoRef.current.muted = true;
      var started = false;
      function onReady() {
        if (started) return; started = true;
        setCamReady(true); setFaceStatus('loading');
        startFaceDetection();
      }
      videoRef.current.onloadedmetadata = onReady;
      videoRef.current.oncanplay = onReady;
      setTimeout(onReady, 2000);
      videoRef.current.play().catch(function() {});
    }, 200);
  }

  // ====================================================
  var pcRef             = useRef(null);
  var sockVivaRef       = useRef(null); // the vivaId used for socket
  var frameIntervalRef  = useRef(null);
  var audioProcessorRef = useRef(null);

  function setupWebRTC() {
    // VivaVideo component handles camera + socket + WebRTC
    // This function now only sets up face detection camera for the admin panel
    setCamReady(false); setFaceStatus('loading');
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      .then(function(stream) {
        // Separate camera stream just for face detection display
        var a=0, iv=setInterval(function(){
          if(++a>50){clearInterval(iv);return;}
          if(!videoRef.current)return;
          clearInterval(iv);
          videoRef.current.srcObject=stream;
          videoRef.current.muted=true;
          videoRef.current.play().catch(function(){});
          setCamReady(true); setFaceStatus('loading'); startFaceDetection();
        },100);
      })
      .catch(function(e) {
        console.warn('[Admin] face cam failed:', e.name);
        setFaceStatus('unavailable'); setPermBlocked(true);
      });
  }

  function doConnectSocket(vivaId, stream) {
    var sock = ioClient(SOCKET_URL);
    socketRef.current = sock;

    sock.on('connect', function() {
      console.log('[Admin] socket OK:', sock.id, 'room:', vivaId);
      sock.emit('join-viva-room', { vivaId: vivaId, role: 'admin', userName: 'Examiner' });
    });
    sock.on('connect_error', function(e) { console.error('[Admin] socket error:', e.message); });

    sock.on('room-members', function(members) {
      console.log('[Admin] room-members:', JSON.stringify(members));
      members.forEach(function(m) {
        if (m.role === 'student') {
          setStudentConnected(true);
          store.addToast((m.userName||'Student') + ' in room — click 📷 Start Cam', 'success');
        }
      });
    });

    sock.on('peer-joined', function(data) {
      console.log('[Admin] peer-joined:', data.role, data.userName);
      if (data.role === 'student') {
        setStudentConnected(true);
        store.addToast((data.userName||'Student') + ' joined the room', 'success');
        setAlerts(function(a) { return [{ title: '🟢 ' + (data.userName||'Student') + ' joined the room', type: 'success', time: new Date().toLocaleTimeString() }].concat(a).slice(0,20); });
      }
    });

    // ★ KEY: only create WebRTC peer AFTER student has camera
    sock.on('student-camera-ready', function(data) {
      console.log('[Admin] student-camera-ready! stream:', !!stream);
      store.addToast('Student camera ON — connecting video…', 'success');
      if (!stream) { console.error('[Admin] no admin stream!'); return; }
      doMakeOffer(sock, vivaId, stream);
    });

    sock.on('webrtc-answer', function(data) {
      console.log('[Admin] got answer, sigState:', pcRef.current && pcRef.current.signalingState);
      if (pcRef.current && pcRef.current.signalingState !== 'closed') {
        pcRef.current.setRemoteDescription(new RTCSessionDescription(data.answer))
          .then(function(){ console.log('[Admin] remote desc set OK'); })
          .catch(function(e){ console.error('[Admin] setRemote failed:', e); });
      }
    });

    sock.on('webrtc-ice-candidate', function(data) {
      if (pcRef.current && data.candidate) {
        pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(function(){});
      }
    });

    sock.on('peer-left', function(data) {
      if (data.role === 'student') {
        setStudentConnected(false);
        if (studentVidRef.current) studentVidRef.current.srcObject = null;
        if (pcRef.current) { try{pcRef.current.close();}catch(e){} pcRef.current = null; }
        setAlerts(function(a) { return [{ title: '🔴 ' + (data.userName||'Student') + ' left the room', type: 'urgent', time: new Date().toLocaleTimeString() }].concat(a).slice(0,20); });
      }
    });
  }

  function doMakeOffer(sock, vivaId, stream) {
    if (pcRef.current) { try{pcRef.current.close();}catch(e){} pcRef.current = null; }
    var pc = new RTCPeerConnection({ iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]});
    pcRef.current = pc;

    stream.getTracks().forEach(function(t) {
      pc.addTrack(t, stream);
      console.log('[Admin] addTrack:', t.kind, t.readyState, t.enabled);
    });

    pc.ontrack = function(ev) {
      console.log('[Admin] ontrack:', ev.track.kind, 'streams:', ev.streams.length);
      if (!ev.streams || !ev.streams[0]) { console.warn('[Admin] no stream in ontrack!'); return; }
      var rs = ev.streams[0];
      setStudentConnected(true);
      var tries=0, iv=setInterval(function(){
        if(++tries>100){clearInterval(iv);console.warn('[Admin] studentVidRef never appeared');return;}
        if(!studentVidRef.current)return;
        clearInterval(iv);
        studentVidRef.current.srcObject = rs;
        studentVidRef.current.play().catch(function(){});
        console.log('[Admin] ✅ student video live!');
      }, 50);
    };

    pc.onicecandidate = function(ev) {
      if (ev.candidate) sock.emit('webrtc-ice-candidate', { vivaId: vivaId, candidate: ev.candidate });
    };
    pc.onconnectionstatechange = function() {
      console.log('[Admin] connState:', pc.connectionState);
      if (pc.connectionState === 'connected') setStudentConnected(true);
    };
    pc.oniceconnectionstatechange = function() { console.log('[Admin] ICE:', pc.iceConnectionState); };

    pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
      .then(function(o) { return pc.setLocalDescription(o); })
      .then(function() {
        sock.emit('webrtc-offer', { vivaId: vivaId, offer: pc.localDescription });
        console.log('[Admin] ✅ offer sent!');
      })
      .catch(function(e) { console.error('[Admin] createOffer failed:', e); });
  }

  function stopFrameRelay() {
    if (pcRef.current) { try{pcRef.current.close();}catch(e){} pcRef.current = null; }
  }
  async function createOfferForStudent() {}

  async function startFaceDetection() {
    try {
      await loadFaceAPI();
      var opts = new window.faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 });
      faceIntRef.current = setInterval(async function() {
        if (!videoRef.current || videoRef.current.readyState < 2) return;
        try {
          var dets = await window.faceapi.detectAllFaces(videoRef.current, opts);
          var count = dets ? dets.length : 0;
          if (count === 0) setFaceStatus('no_face'); else if (count > 1) setFaceStatus('multiple'); else setFaceStatus('ok');
          if (canvasRef.current && dets && dets.length) {
            var cv = canvasRef.current, vid = videoRef.current;
            var dW = vid.clientWidth || 200, dH = vid.clientHeight || 140;
            cv.width = dW; cv.height = dH;
            var sc = Math.max(dW / (vid.videoWidth || dW), dH / (vid.videoHeight || dH));
            var oX = (dW - (vid.videoWidth || dW) * sc) / 2, oY = (dH - (vid.videoHeight || dH) * sc) / 2;
            var ctx = cv.getContext('2d'); ctx.clearRect(0, 0, dW, dH);
            dets.forEach(function(d) {
              var b = d.box || (d.detection && d.detection.box); if (!b) return;
              var col = count > 1 ? '#ef4444' : '#22c55e';
              ctx.strokeStyle = col; ctx.lineWidth = 2;
              ctx.strokeRect(b.x * sc + oX, b.y * sc + oY, b.width * sc, b.height * sc);
            });
          }
        } catch(e2) {}
      }, 500);
    } catch(e) { setFaceStatus('fallback'); }
  }

  function stopAll() {
    stopFrameRelay();
    clearInterval(pollRef.current); clearInterval(awayTimerRef.current);
    clearInterval(faceIntRef.current); clearInterval(sigPollRef.current);
    clearTimeout(graceRef.current); clearTimeout(silenceTimer.current);
    stopSTT(); synthRef.current && synthRef.current.cancel();
    if (socketRef.current) {
      var vivaId = savedVivaRef.current ? savedVivaRef.current.viva_id : null;
      if (vivaId) socketRef.current.emit('end-viva', { viva_id: vivaId });
      try { socketRef.current.disconnect(); } catch(e) {}
      socketRef.current = null;
    }
    if (streamRef.current) { streamRef.current.getTracks().forEach(function(t) { t.stop(); }); streamRef.current = null; }
  }


  // ====================================================
  function speakAndListen(text) {
    // Send question to student so they can read it on their screen
    var vivaId = savedVivaRef.current ? savedVivaRef.current.viva_id : null;
    if (socketRef.current && socketRef.current.connected && vivaId) {
      socketRef.current.emit('question-text', { vivaId: vivaId, text: text });
    }

    if (!window.speechSynthesis || !text) {
      setFlow('listening'); flowRef.current = 'listening';
      capturedRef.current = ''; setCapturedText(''); setLiveWords('');
      startSTT(); return;
    }
    synthRef.current.cancel();
    setFlow('speaking'); flowRef.current = 'speaking'; setStatusMsg('');
    var utt = new SpeechSynthesisUtterance(text);
    utt.rate = 0.88; utt.pitch = 1.0;
    utt.onend = function() {
      setTimeout(function() {
        setFlow('listening'); flowRef.current = 'listening';
        capturedRef.current = ''; setCapturedText(''); setLiveWords('');
        startSTT();
      }, 600);
    };
    utt.onerror = function() {
      setFlow('listening'); flowRef.current = 'listening';
      capturedRef.current = ''; setCapturedText('');
      startSTT();
    };
    synthRef.current.speak(utt);
  }

  // ====================================================
  function startSTT() {
    if (!SR) { setStatusMsg('Speech recognition not available — use manual input'); return; }
    stopSTT();
    var FINAL_PHRASES = ['final answer', "that's my answer", 'that is my answer', 'my final answer', "i'm done", 'i am done', 'done', 'submit', 'that is all', "that's all"];
    var rec = new SR();
    rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US';
    rec.maxAlternatives = 1;
    rec.onresult = function(e) {
      var confirmed = '', interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) confirmed += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      if (confirmed) {
        // Check for "final answer" trigger
        var lower = confirmed.toLowerCase().trim();
        var saidFinal = FINAL_PHRASES.some(function(p) { return lower.includes(p); });
        if (saidFinal) {
          // Remove trigger phrase from captured text
          FINAL_PHRASES.forEach(function(p) { capturedRef.current = capturedRef.current.replace(new RegExp(p, 'gi'), '').trim(); });
          setCapturedText(capturedRef.current);
          clearTimeout(silenceTimer.current);
          if (flowRef.current === 'listening') setTimeout(doGradeAndWait, 300);
          return;
        }
        capturedRef.current += confirmed; setCapturedText(capturedRef.current);
      }
      setLiveWords(interim);
      clearTimeout(silenceTimer.current);
      silenceTimer.current = setTimeout(function() {
        if (flowRef.current === 'listening' && capturedRef.current.trim().length > 0) doGradeAndWait();
      }, 4000);
    };
    rec.onerror = function(e) { if (e.error !== 'no-speech' && e.error !== 'aborted') setStatusMsg('Mic: ' + e.error); };
    rec.onend = function() { if (recRef.current && flowRef.current === 'listening') { try { rec.start(); } catch(ex) {} } };
    rec.start(); recRef.current = rec;
  }

  function stopSTT() {
    clearTimeout(silenceTimer.current); setLiveWords('');
    if (recRef.current) { try { recRef.current.stop(); } catch(e) {} recRef.current = null; }
  }

  // ====================================================
  var askedQIdxRef = useRef(0);   // the index of the question currently being listened to

  async function doGradeAndWait(overrideText) {
    stopSTT();
    setFlow('grading'); flowRef.current = 'grading'; setLiveWords('');

    // Use askedQIdxRef — guaranteed to match what was spoken aloud
    var qs  = questionsRef.current;
    var idx = askedQIdxRef.current;
    if (!qs[idx] && !manualQMode) return;

    var questionText = manualQMode ? manualQText.trim() : qs[idx].question;
    var modelAns     = manualQMode ? '' : qs[idx].model_answer;
    var studentSaid  = overrideText || manualText.trim() || capturedRef.current.trim() || '(no answer)';

    setStatusMsg('Grading answer…');
    var v = await gradeSpokenAnswer(questionText, modelAns, studentSaid);
    setVerdict(v);

    var entry = {
      q_num:        idx + 1,
      question:     questionText,
      model_answer: modelAns,
      student_said: studentSaid,
      score_pct:    v.score_pct,
      correct:      v.correct,
      verdict:      v.verdict,
      feedback:     v.feedback,
      missing:      v.missing,
      notes:        examNotes,
      timestamp:    new Date().toISOString(),
      _asked_idx:   idx,
      _custom:      (qs[idx] && qs[idx]._custom) || manualQMode || false,
      _manual_q:    manualQMode || false,
    };
    setTranscript(function(t) { return t.concat([entry]); });
    capturedRef.current = ''; setCapturedText('');
    setManualText(''); setExamNotes(''); setManualQText('');

    // Stop — wait for admin to decide next action
    setFlow('waiting'); flowRef.current = 'waiting';
    var isLast = idx + 1 >= qs.length;
    setStatusMsg(isLast ? '✅ Last question done — click End & Grade when ready' : '✓ Q' + (idx + 1) + ' graded — choose next action');
  }

  // Admin clicks "Next Question" in sequence
  function handleNextQuestion() {
    setFollowUpQ('');
    var nextIdx = askedQIdxRef.current + 1;
    if (nextIdx >= questionsRef.current.length) {
      setFlow('done'); flowRef.current = 'done';
      setStatusMsg('✅ All questions done — click End & Grade');
      return;
    }
    askedQIdxRef.current = nextIdx;
    setCurrentQ(nextIdx); currentQRef.current = nextIdx;
    setVerdict(null); setStatusMsg(''); setManualQMode(false);
    speakAndListen(questionsRef.current[nextIdx].question);
  }

  // Admin clicks "Ask" for a specific question — can ask any question at any time
  function handleAskQuestion(idx) {
    // Stop whatever is currently happening
    stopSTT();
    if (synthRef.current) synthRef.current.cancel();
    setFlow('idle'); flowRef.current = 'idle';
    capturedRef.current = ''; setCapturedText(''); setLiveWords('');
    setVerdict(null); setStatusMsg(''); setManualQMode(false);
    setManualText && setManualText('');

    // Small delay so state updates propagate
    setTimeout(function() {
      askedQIdxRef.current = idx;
      setCurrentQ(idx); currentQRef.current = idx;
      speakAndListen(questionsRef.current[idx].question);
    }, 200);
  }

  function startVivaFlow() {
    if (questions.length === 0) { store.addToast('Add questions first', 'error'); return; }
    askedQIdxRef.current = 0;
    setCurrentQ(0); currentQRef.current = 0;
    setTranscript([]); setVerdict(null); capturedRef.current = '';
    setCapturedText(''); setManualText(''); setStatusMsg(''); setManualQMode(false);
    speakAndListen(questions[0].question);
  }

  async function generateFollowUp() {
    var lastT = transcript[transcript.length - 1];
    if (!lastT) return;
    setFollowUpLoading(true); setFollowUpQ('');
    try {
      var prompt = 'Original question: ' + lastT.question + '\nStudent answered: ' + (lastT.student_said || 'no answer') + '\nMissing points: ' + (lastT.missing || 'none') + '\n\nGenerate ONE concise follow-up question (max 20 words) to probe deeper or clarify what was missing. Return only the question text, no quotes.';
      var resp = await groqChat([{ role: 'user', content: prompt }], 80, 0.7);
      var fq = (resp || '').trim().replace(/^["']|["']$/g, '');
      setFollowUpQ(fq);
    } catch(e) { setFollowUpQ('Could not generate follow-up: ' + e.message); }
    setFollowUpLoading(false);
  }

  async function handleManualGrade() {
    var ans = manualText.trim() || capturedRef.current.trim();
    if (!ans) return;
    if (!manualQMode && !questionsRef.current[askedQIdxRef.current]) return;
    await doGradeAndWait(ans);
  }

  // ====================================================
  // Phase: 'idle_mq' → admin clicks Record → 'recording_q' (STT captures admin's question)
  //      → admin clicks Done → 'listening' (student answers) → 3s silence → grade
  var [manualQMode,  setManualQMode]  = useState(false);
  var [manualQText,  setManualQText]  = useState('');   // admin's spoken question
  var [mqPhase,      setMQPhase]      = useState('idle'); // idle | recording_q | recorded | listening
  var manualQRef     = useRef('');

  function startRecordAdminQ() {
    if (!SR) { setStatusMsg('No speech recognition available'); return; }
    stopSTT();
    manualQRef.current = '';
    setManualQText(''); setMQPhase('recording_q');
    var rec = new SR();
    rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US';
    rec.maxAlternatives = 1;
    rec.onresult = function(e) {
      var fin = '', inter = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript + ' ';
        else inter += e.results[i][0].transcript;
      }
      if (fin) { manualQRef.current += fin; setManualQText(manualQRef.current); }
      setLiveWords(inter);
    };
    rec.onerror = function(e) { if (e.error !== 'no-speech' && e.error !== 'aborted') setStatusMsg('Mic: ' + e.error); };
    rec.onend = function() { if (recRef.current && mqPhaseRef.current === 'recording_q') { try { rec.start(); } catch(ex) {} } };
    rec.start(); recRef.current = rec;
  }

  var mqPhaseRef = useRef('idle');
  useEffect(function() { mqPhaseRef.current = mqPhase; }, [mqPhase]);

  function stopRecordAdminQ() {
    stopSTT(); setLiveWords('');
    setMQPhase('recorded');
  }

  function startListenStudentForManualQ() {
    if (!manualQRef.current.trim() && !manualQText.trim()) { setStatusMsg('Record your question first'); return; }
    // Read the question back to student via TTS then listen
    setMQPhase('listening');
    var questionToSpeak = manualQRef.current.trim() || manualQText.trim();
    speakAndListen(questionToSpeak);
    setFlow('speaking'); flowRef.current = 'speaking';
  }

  // ====================================================
  async function handleGenerateQ() {
    if (!genTopic.trim()) return;
    setGenLoading(true);
    try {
      var existing = questions.map(function(q) { return q.question || ''; });
      var exc = existing.length > 0 ? ' Do NOT repeat: [' + existing.slice(-15).map(function(q) { return q.slice(0, 55); }).join(' | ') + '].' : '';
      var vrRnd = Math.floor(Math.random() * 9999);
      var raw = await groqChat(
        'You are a viva examiner. Return ONLY a JSON array. Always generate COMPLETELY DIFFERENT questions each call.',
        'Generate ' + genCount + ' UNIQUE oral viva questions on "' + genTopic + '".' + exc +
        ' Each question must cover a different sub-topic or angle. Mix conceptual, applied and analytical. Seed: ' + vrRnd + '.' +
        ' Return: [{"question":"?","model_answer":"2-4 sentence answer"}]',
        2000, 0.9
      );
      var qs = JSON.parse(raw.replace(/```json|```/g, '').trim());
      if (!Array.isArray(qs)) throw new Error('Invalid response');
      setQuestions(function(prev) { var next = prev.concat(qs); questionsRef.current = next; return next; });
      store.addToast('Added ' + qs.length + ' questions', 'success');
    } catch(e) { store.addToast('Generation failed: ' + e.message, 'error'); }
    setGenLoading(false);
  }

  async function handleAddCustomQ() {
    if (!customQ.trim()) return;
    var ma = customAns.trim();
    if (!ma) {
      setGenModelLoading(true);
      try { ma = await groqChat('You are a subject expert.', '3-5 sentence model answer for viva question: ' + customQ, 300, 0.5); } catch(e) { ma = '(unavailable)'; }
      setGenModelLoading(false);
    }
    var q = { question: customQ, model_answer: ma, _custom: true };
    setQuestions(function(prev) { var next = prev.concat([q]); questionsRef.current = next; return next; });
    setCustomQ(''); setCustomAns(''); setShowCustomQ(false);
    store.addToast('Custom question added', 'success');
  }

  function removeQuestion(idx) {
    setQuestions(function(prev) { var next = prev.filter(function(_, i) { return i !== idx; }); questionsRef.current = next; return next; });
    if (currentQ >= idx && currentQ > 0) setCurrentQ(function(c) { var n = c - 1; currentQRef.current = n; return n; });
  }

  async function handleStartRoom() {
    if (!title.trim()) return;
    setLoading(true);
    try {
      var r = await apiPost('/viva', { title, topic, questions: [], course_id: vivaCourseId || null });
      var vivaData = { viva_id: r.viva_id, title, topic };
      savedVivaRef.current = vivaData;
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(vivaData));
      setPhase('room');
      setTimeout(setupWebRTC, 300);
      startPolling();
    } catch(e) { store.addToast(e.message, 'error'); }
    setLoading(false);
  }

  async function handleEndAndGrade() {
    stopAll(); sessionStorage.removeItem(SESSION_KEY);
    setLoading(true); setPhase('grading');
    try {
      var vivaId = savedVivaRef.current ? savedVivaRef.current.viva_id : null;
      if (vivaId) {
        // End session + cancel all pending invitations for this room
        await apiPost('/viva/' + vivaId + '/end', { ended: true });
        await apiPost('/viva/' + vivaId + '/cancel-invites', {}).catch(function() {});
      }
      var graded = transcript.map(function(t) {
        return { question: t.question, model_answer: t.model_answer, student_said: t.student_said, score_pct: t.score_pct || 0, correct: t.correct || false, verdict: t.verdict || 'Not graded', feedback: t.feedback || '', missing: t.missing || '', notes: t.notes || '', timestamp: t.timestamp || '', _custom: t._custom || false };
      });
      var report = await generateSessionReport(topic || title, graded);
      setEditableAns(graded); setSessionReport(report);
      var total = graded.length > 0 ? Math.round(graded.reduce(function(a, e) { return a + (e.score_pct || 0); }, 0) / graded.length) : 0;
      var grade = total >= 90 ? 'A+' : total >= 80 ? 'A' : total >= 70 ? 'B' : total >= 60 ? 'C' : total >= 50 ? 'D' : 'F';
      setResults({ total_score: total, grade, correct_count: graded.filter(function(e) { return e.correct; }).length, overall_feedback: report.overall_feedback });
      setPhase('results');
    } catch(e) { store.addToast('Error: ' + e.message, 'error'); setPhase('room'); }
    setLoading(false);
  }

  function updateAnswer(idx, field, val) {
    setEditableAns(function(prev) {
      var arr = prev.slice(); arr[idx] = Object.assign({}, arr[idx]); arr[idx][field] = val;
      if (field === 'verdict') { arr[idx].correct = val === 'Correct'; arr[idx].score_pct = val === 'Correct' ? 100 : val === 'Partially Correct' ? 50 : 0; }
      return arr;
    });
  }

  async function handleFinalize() {
    setFinalizing(true);
    var ts = editableAns.length > 0 ? Math.round(editableAns.reduce(function(a, e) { return a + (e.score_pct || 0); }, 0) / editableAns.length) : 0;
    var grade = ts >= 90 ? 'A+' : ts >= 80 ? 'A' : ts >= 70 ? 'B' : ts >= 60 ? 'C' : ts >= 50 ? 'D' : 'F';
    var cc = editableAns.filter(function(e) { return e.correct; }).length;
    var ft = editableAns.map(function(e, i) {
      return ['━━━ Q' + (i + 1) + (e._custom ? ' [Examiner]' : '') + (e._manual_q ? ' [Spoken]' : ''),
        'Question: ' + e.question,
        'Expected: ' + (e.model_answer || 'N/A'),
        'Student Said: ' + (e.student_said || '(no answer)'),
        'Verdict: ' + e.verdict + ' (' + e.score_pct + '%)',
        'AI Feedback: ' + e.feedback,
        e.missing && e.missing !== 'None' ? 'Missing: ' + e.missing : '',
        e.notes ? 'Examiner Notes: ' + e.notes : '',
        e.timestamp ? 'Time: ' + new Date(e.timestamp).toLocaleTimeString() : '',
      ].filter(Boolean).join('\n');
    }).join('\n\n');

    try {
      var vivaId = savedVivaRef.current ? savedVivaRef.current.viva_id : null;
      if (vivaId) {
        await apiPost('/viva/' + vivaId + '/result', {
          student_id:      selStudentId || null,
          student_name:    selStudentName || 'Unknown Student',
          total_score:     ts,
          grade,
          correct_count:   cc,
          total_questions: editableAns.length,
          full_transcript: ft,
          ai_report: Object.assign({}, sessionReport, {
            answers:         editableAns,
            total_score:     ts,
            grade,
            correct_count:   cc,
            total_questions: editableAns.length,
            student_name:    selStudentName || 'Unknown Student',
          }),
        });
      }
      setResults(function(r) { return Object.assign({}, r, { total_score: ts, grade, correct_count: cc }); });
      setPhase('final');
    } catch(e) { store.addToast('Save failed: ' + e.message, 'error'); }
    setFinalizing(false);
  }

  // Reset for next student — keeps the room open and questions intact
  function resetForNextStudent() {
    setTranscript([]); setVerdict(null); setEditableAns([]); setSessionReport(null);
    capturedRef.current = ''; setCapturedText(''); setManualText(''); setExamNotes('');
    setCurrentQ(0); currentQRef.current = 0; askedQIdxRef.current = 0;
    setFlow('idle'); flowRef.current = 'idle'; setStatusMsg('');
    setSelStudentId(null); setSelStudentName('');
    setResults(null); setPhase('room');
    synthRef.current && synthRef.current.cancel();
    stopSTT();
  }

  async function loadStudents() { try { setStudents((await apiGet('/students')) || []); } catch(e) {} }
  function toggleStu(id) { setSelStu(function(p) { return p.includes(id) ? p.filter(function(x) { return x !== id; }) : p.concat([id]); }); }
  async function sendInvites() {
    var vivaId = savedVivaRef.current ? savedVivaRef.current.viva_id : null; if (!vivaId) return;
    setInviting(true); setInviteMsg('');
    try {
      if (inviteMode === 'account' && selStu.length > 0) {
        var n = 0;
        for (var i = 0; i < selStu.length; i++) { var s = students.find(function(x) { return x.user_id === selStu[i]; }); if (s) { await apiPost('/notifications', { title: 'Viva Invitation — ' + title, message: 'Invited to join viva "' + title + '". Room: ' + vivaId, type: 'info', recipient_id: s.user_id, viva_room_id: vivaId }); n++; } }
        setInviteMsg('Sent to ' + n + ' student(s).'); setSelStu([]);
      } else if (inviteMode === 'email' && inviteEmail.trim()) {
        await apiPost('/viva/invite', { emails: inviteEmail.split(',').map(function(e) { return e.trim(); }), title, topic, vivaId }); setInviteMsg('Sent!'); setInviteEmail('');
      }
    } catch(e) { setInviteMsg('Error: ' + e.message); }
    setInviting(false);
  }

  function copyRoomId() { navigator.clipboard.writeText(savedVivaRef.current ? savedVivaRef.current.viva_id : '').then(function() { store.addToast('Copied!', 'success'); }); }
  function resetAll() {
    sessionStorage.removeItem(SESSION_KEY); stopAll();
    setPhase('setup'); setTitle(''); setTopic(''); setQuestions([]); setCurrentQ(0); setTranscript([]);
    setFlow('idle'); setCapturedText(''); setManualText(''); setVerdict(null); setStatusMsg('');
    setResults(null); setEditableAns([]); setSessionReport(null);
    setCamReady(false); setStudentConnected(false); setSessionExpired(false); setExaminerAway(false);
    savedVivaRef.current = null; capturedRef.current = ''; questionsRef.current = [];
  }

  var flowColors = { idle: '#9ca3af', speaking: '#a78bfa', listening: '#ef4444', grading: '#f59e0b', done: '#22c55e', waiting: '#3b82f6' };
  var flowLabels = { idle: '⬤ Ready', speaking: '🔊 Speaking…', listening: '🎤 Listening…', grading: '⚡ Grading…', done: '✅ Done', waiting: '⏳ Waiting — Admin\'s Turn' };
  var fsColors   = { ok: '#22c55e', no_face: '#f59e0b', multiple: '#ef4444', loading: '#9ca3af', fallback: '#9ca3af', unavailable: '#ef4444' };
  var fsLabels   = { ok: '✅ Face OK', no_face: '⚠ No Face', multiple: '🚫 Multiple!', loading: 'Loading…', fallback: 'Basic', unavailable: 'Cam Off' };
  var gcol = function(g) { return g === 'A+' || g === 'A' ? '#22c55e' : g === 'F' ? '#ef4444' : g === 'B' ? '#3b82f6' : '#f59e0b'; };
  var gbg  = function(g) { return g === 'A+' || g === 'A' ? '#dcfce7' : g === 'F' ? '#fee2e2' : g === 'B' ? '#dbeafe' : '#fef3c7'; };

  // ====================================================
  if (phase === 'setup') return (
    <div className="viva-dark fade-up">
      <div style={{ maxWidth: 540, margin: '60px auto', textAlign: 'center' }}>
        <div style={{ fontSize: '3.5rem', marginBottom: 14 }}>🎙</div>
        <div style={{ fontFamily: 'Space Grotesk,sans-serif', fontWeight: 800, fontSize: '1.7rem', color: '#fff', marginBottom: 6 }}>Start Oral Viva Room</div>
        <div style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: 28 }}>Oral examination session</div>
        <div className="card" style={{ textAlign: 'left' }}>
          <div className="form-group"><label className="form-label">Session Title *</label><input className="form-input" value={title} onChange={function(e) { setTitle(e.target.value); }} placeholder="e.g. CS Final Oral Viva"/></div>
          <div className="form-group"><label className="form-label">Topic / Subject</label><input className="form-input" value={topic} onChange={function(e) { setTopic(e.target.value); }} placeholder="e.g. Data Structures"/></div>
          <div className="form-group">
            <label className="form-label">Visibility</label>
            <select className="form-select" value={vivaCourseId} onChange={function(e){ setVivaCourseId(e.target.value); }}>
              <option value="">🌐 Global — all students can join</option>
              {vivaCourses.map(function(c){ return <option key={c.course_id} value={c.course_id}>🏫 {c.name} — course only</option>; })}
            </select>
            <div style={{ fontSize:'0.75rem', color:'var(--text3)', marginTop:4 }}>
              {vivaCourseId ? 'Only enrolled students in this course will be invited' : 'Any student can be invited'}
            </div>
          </div>
          <button className="btn btn-primary btn-lg" style={{ width: '100%', justifyContent: 'center' }} onClick={handleStartRoom} disabled={loading || !title.trim()}>
            {loading ? 'Creating Room…' : '🚀 Create Viva Room'}
          </button>
        </div>
      </div>
    </div>
  );

  // ====================================================
  if (examinerAway && phase === 'room') {
    var am = Math.floor(awayCountdown / 60), as2 = awayCountdown % 60, urgent = awayCountdown < 120;
    return (
      <div style={{ minHeight: 'calc(100vh - 60px)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', background: '#0d0d14' }}>
        <div style={{ textAlign: 'center', padding: '44px 52px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 20, maxWidth: 460 }}>
          <div style={{ fontSize: '3.5rem', marginBottom: 14 }}>⏸</div>
          <div style={{ fontFamily: 'Space Grotesk,sans-serif', fontWeight: 800, fontSize: '1.5rem', color: '#fff', marginBottom: 8 }}>You Left the Viva Room</div>
          <div style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: 24, lineHeight: 1.6 }}>Session is paused. Student is waiting. Return within 10 minutes or the session ends automatically.</div>
          <div style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: '5rem', fontWeight: 900, color: urgent ? '#ef4444' : '#f59e0b', letterSpacing: 6, lineHeight: 1, marginBottom: 8, textShadow: urgent ? '0 0 40px rgba(239,68,68,.5)' : '0 0 40px rgba(245,158,11,.4)' }}>
            {String(am).padStart(2, '0')}:{String(as2).padStart(2, '0')}
          </div>
          <div style={{ fontSize: '0.82rem', color: urgent ? '#f87171' : '#6b7280', marginBottom: 32, fontWeight: urgent ? 700 : 400 }}>
            {urgent ? '⚠️ Session will end soon!' : 'Return to continue'}
          </div>
          <button className="btn btn-primary btn-lg" onClick={examinerReturn} style={{ padding: '13px 48px' }}>▶ Return to Viva Room</button>
        </div>
      </div>
    );
  }

  // ====================================================
  if (sessionExpired) return (
    <div style={{ minHeight: 'calc(100vh - 60px)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d0d14', padding: 24 }}>
      <div style={{ textAlign: 'center', background: 'rgba(220,38,38,.06)', border: '1px solid rgba(220,38,38,.2)', borderRadius: 20, padding: '44px 52px', maxWidth: 460 }}>
        <div style={{ fontSize: '3.5rem', marginBottom: 14 }}>🔒</div>
        <div style={{ fontFamily: 'Space Grotesk,sans-serif', fontWeight: 800, fontSize: '1.5rem', color: '#fff', marginBottom: 10 }}>Session Expired</div>
        <div style={{ fontSize: '0.9rem', color: '#9ca3af', lineHeight: 1.75, marginBottom: 28 }}>You were away for over 10 minutes. The session ended automatically.</div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          {transcript.length > 0 && <button className="btn btn-warning" onClick={function() { setSessionExpired(false); handleEndAndGrade(); }}>📊 Grade What We Have</button>}
          <button className="btn btn-outline" onClick={resetAll}>Start New Session</button>
        </div>
      </div>
    </div>
  );

  // ====================================================
  if (phase === 'grading') return (
    <div className="viva-dark" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 60px)', flexDirection: 'column', gap: 16 }}>
      <div className="spinner" style={{ width: 52, height: 52, borderWidth: 4 }}/>
      <div style={{ color: '#a78bfa', fontWeight: 700, fontSize: '1.15rem' }}>Generating AI session report…</div>
      <div style={{ color: '#6b7280', fontSize: '0.85rem' }}>Analyzing {transcript.length} oral answers</div>
    </div>
  );

  // ====================================================
  if (phase === 'results' && results) {
    var totalNow = editableAns.length > 0 ? Math.round(editableAns.reduce(function(a, e) { return a + (e.score_pct || 0); }, 0) / editableAns.length) : 0;
    var gradeNow = totalNow >= 90 ? 'A+' : totalNow >= 80 ? 'A' : totalNow >= 70 ? 'B' : totalNow >= 60 ? 'C' : totalNow >= 50 ? 'D' : 'F';
    var gc2 = gcol(gradeNow);
    return (
      <div className="fade-up">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="page-title">📊 Oral Viva Results</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text3)', marginTop: 3 }}>AI-graded live. Review &amp; edit below, then Finalize to save.</div>
          </div>
          <button className="btn btn-success" onClick={handleFinalize} disabled={finalizing}>{finalizing ? 'Saving…' : '✅ Finalize & Save'}</button>
        </div>

        {/* Score card */}
        <div className="card" style={{ marginBottom: 20, background: gbg(gradeNow), borderLeft: '4px solid ' + gc2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'center' }}><div style={{ fontFamily: 'Space Grotesk,sans-serif', fontWeight: 900, fontSize: '3.5rem', color: gc2, lineHeight: 1 }}>{totalNow}%</div><div style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>SCORE</div></div>
            <div style={{ textAlign: 'center' }}><div style={{ fontFamily: 'Space Grotesk,sans-serif', fontWeight: 900, fontSize: '2.5rem', color: gc2 }}>{gradeNow}</div><div style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>GRADE</div></div>
            <div style={{ textAlign: 'center' }}><div style={{ fontWeight: 700, fontSize: '1.5rem', color: '#16a34a' }}>{editableAns.filter(function(e) { return e.correct; }).length}</div><div style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>CORRECT</div></div>
            <div style={{ textAlign: 'center' }}><div style={{ fontWeight: 700, fontSize: '1.5rem', color: '#dc2626' }}>{editableAns.filter(function(e) { return !e.correct; }).length}</div><div style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>INCORRECT</div></div>
            <div style={{ flex: 1, minWidth: 200 }}><div style={{ height: 10, background: 'var(--surface3)', borderRadius: 5, overflow: 'hidden' }}><div style={{ height: '100%', width: totalNow + '%', background: gc2, borderRadius: 5, transition: 'width .5s' }}/></div></div>
          </div>
        </div>

        {/* AI Session Report */}
        {sessionReport && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent)', letterSpacing: 1, marginBottom: 10, fontFamily: 'JetBrains Mono,monospace' }}>AI SESSION ANALYSIS</div>
            <div style={{ fontSize: '0.9rem', lineHeight: 1.75, color: 'var(--text2)', marginBottom: 14, padding: '10px 14px', background: 'var(--accent-glow)', borderRadius: 8 }}>{sessionReport.overall_feedback}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div style={{ padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#16a34a', marginBottom: 6, fontFamily: 'JetBrains Mono,monospace', letterSpacing: 1 }}>STRONG AREAS</div>
                {(sessionReport.strong_areas || []).map(function(s, i) { return <div key={i} style={{ fontSize: '0.82rem', color: '#166534' }}>✅ {s}</div>; })}
              </div>
              <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8 }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#dc2626', marginBottom: 6, fontFamily: 'JetBrains Mono,monospace', letterSpacing: 1 }}>WEAK AREAS</div>
                {(sessionReport.weak_areas || []).map(function(s, i) { return <div key={i} style={{ fontSize: '0.82rem', color: '#991b1b' }}>⚠️ {s}</div>; })}
              </div>
              <div style={{ padding: '10px 14px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8 }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#0369a1', marginBottom: 6, fontFamily: 'JetBrains Mono,monospace', letterSpacing: 1 }}>ORAL SCORES</div>
                <div style={{ fontSize: '0.82rem', color: '#0c4a6e' }}>📢 Communication: <strong>{sessionReport.communication_score}%</strong></div>
                <div style={{ fontSize: '0.82rem', color: '#0c4a6e', marginTop: 4 }}>🧠 Knowledge: <strong>{sessionReport.knowledge_score}%</strong></div>
                <div style={{ fontSize: '0.82rem', color: '#0c4a6e', marginTop: 4 }}>🎯 <strong>{sessionReport.readiness}</strong></div>
              </div>
            </div>
          </div>
        )}

        {/* Per-answer review with full transcript */}
        {editableAns.map(function(entry, i) {
          var col = entry.correct ? '#16a34a' : entry.verdict === 'Partially Correct' ? '#d97706' : '#dc2626';
          return (
            <div key={i} className="card" style={{ marginBottom: 14, borderLeft: '4px solid ' + col }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <span className="badge badge-primary" style={{ fontSize: '0.7rem' }}>Q{i + 1}</span>
                {entry._custom && <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>✏ Examiner Q</span>}
                <span style={{ fontWeight: 700, fontSize: '0.95rem', flex: 1 }}>{entry.question}</span>
                <span style={{ fontWeight: 900, fontSize: '1.3rem', color: col, flexShrink: 0 }}>{entry.score_pct}%</span>
              </div>
              <div style={{ padding: '7px 12px', background: 'rgba(124,58,237,.06)', borderRadius: 7, fontSize: '0.82rem', color: 'var(--text3)', marginBottom: 6 }}>
                <strong>📚 Expected:</strong> {entry.model_answer}
              </div>
              {/* Full verbatim transcript of what student said */}
              <div style={{ padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, fontSize: '0.88rem', marginBottom: 10, lineHeight: 1.65 }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text3)', fontFamily: 'JetBrains Mono,monospace', marginBottom: 4, letterSpacing: 1 }}>🎤 VERBATIM TRANSCRIPT{entry.timestamp ? ' · ' + new Date(entry.timestamp).toLocaleTimeString() : ''}</div>
                <em style={{ color: entry.student_said === '(no answer)' ? '#9ca3af' : 'var(--text)' }}>{entry.student_said || '(no answer)'}</em>
              </div>
              {entry.missing && entry.missing !== 'None' && <div style={{ padding: '5px 10px', background: 'rgba(217,119,6,.08)', border: '1px solid rgba(217,119,6,.2)', borderRadius: 6, fontSize: '0.8rem', color: '#d97706', marginBottom: 8 }}>⚠️ Missing: {entry.missing}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text3)', marginBottom: 4, textTransform: 'uppercase', fontFamily: 'JetBrains Mono,monospace' }}>VERDICT</label>
                  <select className="form-select" value={entry.verdict} onChange={function(e) { updateAnswer(i, 'verdict', e.target.value); }}>
                    <option value="Correct">✅ Correct</option><option value="Partially Correct">⚠️ Partially Correct</option>
                    <option value="Incorrect">❌ Incorrect</option><option value="No Answer">— No Answer</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text3)', marginBottom: 4, textTransform: 'uppercase', fontFamily: 'JetBrains Mono,monospace' }}>SCORE %</label>
                  <input type="number" className="form-input" min={0} max={100} value={entry.score_pct} onChange={function(e) { updateAnswer(i, 'score_pct', Math.max(0, Math.min(100, Number(e.target.value)))); }}/>
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text3)', marginBottom: 4, textTransform: 'uppercase', fontFamily: 'JetBrains Mono,monospace' }}>AI FEEDBACK</label>
                <textarea className="form-textarea" rows={2} value={entry.feedback} onChange={function(e) { updateAnswer(i, 'feedback', e.target.value); }}/>
              </div>
              {entry.notes && <div style={{ padding: '6px 10px', background: 'var(--accent-glow)', borderRadius: 6, fontSize: '0.8rem', color: 'var(--accent)' }}>📝 <strong>Notes:</strong> {entry.notes}</div>}
            </div>
          );
        })}
        <div style={{ position: 'sticky', bottom: 20, textAlign: 'center', marginTop: 20 }}>
          <button className="btn btn-success btn-lg" onClick={handleFinalize} disabled={finalizing}>{finalizing ? 'Saving…' : '✅ Finalize & Save Results'}</button>
        </div>
      </div>
    );
  }

  // ====================================================
  if (phase === 'final' && results) {
    var fg = gcol(results.grade || 'F');
    return (
      <div className="fade-up">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div className="page-title">✅ Result Saved — {selStudentName || 'Student'}</div>
          <span className="badge badge-success" style={{ marginLeft: 'auto' }}>Finalized</span>
        </div>
        <div className="card" style={{ marginBottom: 20, textAlign: 'center', padding: 36, borderLeft: '4px solid ' + fg }}>
          <div style={{ fontFamily: 'Space Grotesk,sans-serif', fontWeight: 900, fontSize: '4.5rem', color: fg, lineHeight: 1 }}>{results.total_score || 0}%</div>
          <div style={{ fontFamily: 'Space Grotesk,sans-serif', fontWeight: 800, fontSize: '2rem', color: fg, marginTop: 6 }}>Grade {results.grade}</div>
          <div style={{ color: 'var(--text3)', marginTop: 6 }}>{results.correct_count || 0} correct · {editableAns.length} questions · Full transcript saved to student's account</div>
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-outline" onClick={function() { setPhase('results'); }}>← Review</button>
          <button className="btn btn-primary" onClick={resetForNextStudent}>👤 Next Student (Keep Room)</button>
          <a className="btn btn-outline" href={(process.env.REACT_APP_API_URL||'http://localhost:5000') + '/api/viva/' + (savedVivaRef.current && savedVivaRef.current.viva_id) + '/export-csv'}
            target="_blank" rel="noopener noreferrer">📥 Export CSV</a>
          <button className="btn btn-outline btn-sm" onClick={function(){
            var vivaId = savedVivaRef.current && savedVivaRef.current.viva_id;
            var resultId = results && results.result_id;
            if (!vivaId || !resultId) return;
            var nowVisible = results.result_visible === 1;
            apiPost('/viva/' + vivaId + '/result/' + resultId + '/visibility', { visible: !nowVisible })
              .then(function(){ store.addToast('Result ' + (!nowVisible ? 'visible' : 'hidden') + ' for student', 'success'); })
              .catch(function(){});
          }}>
            {results && results.result_visible === 1 ? '🙈 Hide from Student' : '👁 Show to Student'}
          </button>
          <button className="btn btn-danger btn-sm" onClick={resetAll}>🔒 End Session</button>
        </div>
      </div>
    );
  }

  // ====================================================
  var vivaId = savedVivaRef.current ? savedVivaRef.current.viva_id : '';
  var q = questions[currentQ];
  var displayAnswer = capturedText + (liveWords ? ' ' + liveWords : '');

  return (
    <div className="viva-dark fade-up">

      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="badge badge-danger">🔴 ORAL VIVA</span>
          <span style={{ fontWeight: 700, color: '#fff' }}>{title}</span>
          <span style={{ padding: '3px 10px', borderRadius: 20, background: 'rgba(255,255,255,.07)', fontSize: '0.72rem', fontWeight: 700, color: flowColors[flow] || '#9ca3af' }}>{flowLabels[flow] || flow}</span>
          <span style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: '0.7rem', color: '#9ca3af' }}>{transcript.length}/{questions.length} done</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,.07)', color: '#e5e5e5', fontFamily: 'JetBrains Mono,monospace', fontSize: '0.72rem' }} onClick={copyRoomId}>🔑 {vivaId.slice(0, 8)}…</button>
          <button className="btn btn-sm" style={{ background: unread > 0 ? 'rgba(220,38,38,.2)' : 'rgba(255,255,255,.07)', color: unread > 0 ? '#f87171' : '#e5e5e5', position: 'relative' }}
            onClick={function() { setShowAlerts(!showAlerts); setUnread(0); }}>
            🔔{unread > 0 && <span style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%', background: '#dc2626', color: '#fff', fontSize: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{unread}</span>}
          </button>
          <button className="btn btn-sm btn-outline" onClick={function() { setShowInvite(!showInvite); if (!showInvite) loadStudents(); }}>✉ Invite</button>
          <button className="btn btn-danger btn-sm" onClick={handleEndAndGrade} disabled={loading || transcript.length === 0}>⏹ End &amp; Grade</button>
          {transcript.length === 0 && (
            <button className="btn btn-warning btn-sm" onClick={function(){
              if(window.confirm('End viva without grading? No score will be saved.')) {
                var vivaId = savedVivaRef.current && savedVivaRef.current.viva_id;
                if(vivaId) apiPost('/viva/' + vivaId + '/end', {}).then(function(){ setPhase('setup'); store.addToast('Viva ended', 'info'); }).catch(function(){});
              }
            }}>✕ End Without Grade</button>
          )}
        </div>
      </div>

      {/* Camera permission blocked banner */}
      {permBlocked && (
        <div style={{ padding: '12px 16px', background: 'rgba(220,38,38,.12)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 10, marginBottom: 10 }}>
          <div style={{ fontWeight: 700, color: '#f87171', marginBottom: 6 }}>📷 Camera & Microphone Blocked</div>
          <div style={{ fontSize: '0.82rem', color: '#fca5a5', lineHeight: 1.7 }}>
            Your browser is blocking camera access.<br/>
            <strong>Fix:</strong> Click the 🔒 lock icon in your address bar → set Camera & Microphone to <strong>Allow</strong> → then click Try Again below.
          </div>
          <button className="btn btn-sm" style={{ marginTop: 8, background: 'rgba(220,38,38,.2)', color: '#f87171', border: '1px solid rgba(220,38,38,.4)' }}
            onClick={function() { setPermBlocked(false); startCamera(); }}>
            🔄 Try Again
          </button>
        </div>
      )}

      {/* Student being examined selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '7px 12px', background: 'rgba(255,255,255,.04)', borderRadius: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', color: '#9ca3af', fontFamily: 'JetBrains Mono,monospace', whiteSpace: 'nowrap' }}>👤 EXAMINING:</span>
        {students.length > 0
          ? <select style={{ flex: 1, minWidth: 160, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.07)', color: '#e5e5e5', fontSize: '0.82rem' }}
              value={selStudentId || ''}
              onChange={function(e) {
                var sid = e.target.value;
                var s = students.find(function(x) { return String(x.user_id) === String(sid); });
                setSelStudentId(sid ? Number(sid) : null);
                setSelStudentName(s ? s.name : '');
              }}>
              <option value="">— Select student —</option>
              {students.map(function(s) { return <option key={s.user_id} value={s.user_id}>{s.name} ({s.email})</option>; })}
            </select>
          : <button className="btn btn-sm btn-outline" style={{ fontSize: '0.72rem' }} onClick={function() { loadStudents(); }}>Load Students</button>}
        {selStudentName && <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#a78bfa' }}>{selStudentName}</span>}
      </div>

      {/* Student Activity — join/left only */}
      <div className="card" style={{ marginBottom: 10, maxHeight: 140, overflowY: 'auto' }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9ca3af', letterSpacing: 1, marginBottom: 6, fontFamily: 'JetBrains Mono,monospace' }}>STUDENT ACTIVITY</div>
        {alerts.length === 0
          ? <div style={{ fontSize: '0.78rem', color: '#6b7280', textAlign: 'center', padding: '4px 0' }}>Waiting for student…</div>
          : alerts.map(function(a, idx2) {
              var col = a.type === 'urgent' ? '#dc2626' : '#16a34a';
              return (
                <div key={idx2} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', borderLeft: '3px solid ' + col, marginBottom: 3, fontSize: '0.74rem', background: 'rgba(255,255,255,.03)', borderRadius: '0 4px 4px 0' }}>
                  <span style={{ fontWeight: 700, color: col }}>{a.title}</span>
                  {a.time && <span style={{ fontSize: '0.65rem', color: '#6b7280' }}>{a.time}</span>}
                </div>
              );
            })
        }
      </div>

      {showInvite && (
        <div className="card" style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {['account', 'email'].map(function(m) { return <button key={m} onClick={function() { setInviteMode(m); }} className={'btn btn-sm ' + (inviteMode === m ? 'btn-primary' : 'btn-outline')}>{m === 'account' ? 'By Account' : 'By Email'}</button>; })}
          </div>
          {inviteMode === 'account' ? (
            <div>
              <div style={{ maxHeight: 85, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                {students.map(function(s) {
                  var sel = selStu.includes(s.user_id);
                  return <div key={s.user_id} onClick={function() { toggleStu(s.user_id); }} style={{ padding: '3px 10px', borderRadius: 20, border: '1px solid ' + (sel ? 'var(--accent)' : 'rgba(255,255,255,.12)'), background: sel ? 'rgba(124,58,237,.2)' : 'transparent', color: sel ? '#a78bfa' : '#9ca3af', fontSize: '0.74rem', cursor: 'pointer' }}>{s.name}</div>;
                })}
              </div>
              {selStu.length > 0 && <button className="btn btn-primary btn-sm" onClick={sendInvites} disabled={inviting}>{inviting ? '…' : 'Send to ' + selStu.length}</button>}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="form-input" value={inviteEmail} onChange={function(e) { setInviteEmail(e.target.value); }} placeholder="email1, email2…" style={{ flex: 1 }}/>
              <button className="btn btn-primary btn-sm" onClick={sendInvites} disabled={inviting || !inviteEmail.trim()}>{inviting ? '…' : 'Send'}</button>
            </div>
          )}
          {inviteMsg && <div style={{ marginTop: 5, fontSize: '0.74rem', color: inviteMsg.startsWith('Error') ? '#f87171' : '#4ade80' }}>{inviteMsg}</div>}
        </div>
      )}

      {/* 3-column layout */}
      <div className="viva-3col">

        {/* LEFT: Jitsi video + question tools */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto' }}>

          {/* WebRTC video — admin sees student, student sees admin */}
          {savedVivaRef.current && (
            <div className="card" style={{ padding: 8 }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9ca3af', letterSpacing: 1, marginBottom: 8, textAlign: 'center', fontFamily: 'JetBrains Mono,monospace' }}>📹 LIVE VIDEO</div>
              <VivaVideo
                vivaId={savedVivaRef.current.viva_id}
                role="admin"
                displayName="Examiner"
                onSocketReady={function(sock) { socketRef.current = sock; }}
              />
            </div>
          )}

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9ca3af', letterSpacing: 1, marginBottom: 7, fontFamily: 'JetBrains Mono,monospace' }}>⚡ GENERATE QUESTIONS</div>
            <input className="form-input" value={genTopic} onChange={function(e) { setGenTopic(e.target.value); }} placeholder="Topic or paste notes…" style={{ marginBottom: 5 }}/>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.04)', cursor: 'pointer', fontSize: '0.72rem', color: '#9ca3af', marginBottom: 5 }}>
              📄 Upload PDF/Text
              <input type="file" accept=".pdf,.txt" style={{ display: 'none' }} onChange={function(e) {
                var file = e.target.files[0]; if (!file) return;
                var reader = new FileReader();
                reader.onload = function(ev) { setGenTopic(function(prev) { return (prev ? prev + '\n' : '') + ev.target.result.slice(0, 2000); }); };
                reader.readAsText(file); e.target.value = '';
              }}/>
            </label>
            <div style={{ display: 'flex', gap: 4, marginBottom: 5 }}>
              {[3, 5, 7, 10].map(function(n) { return <button key={n} onClick={function() { setGenCount(n); }} style={{ flex: 1, padding: '4px 0', borderRadius: 5, border: '1px solid ' + (genCount === n ? 'var(--accent)' : 'rgba(255,255,255,.1)'), background: genCount === n ? 'rgba(124,58,237,.25)' : 'transparent', color: genCount === n ? '#a78bfa' : '#9ca3af', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}>{n}</button>; })}
            </div>
            <button className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={handleGenerateQ} disabled={genLoading || !genTopic.trim()}>{genLoading ? '⚡ Generating…' : '⚡ Add Questions'}</button>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9ca3af', letterSpacing: 1, marginBottom: 7, fontFamily: 'JetBrains Mono,monospace' }}>✏ YOUR QUESTION</div>
            {!showCustomQ ? <button className="btn btn-outline btn-sm" style={{ width: '100%' }} onClick={function() { setShowCustomQ(true); }}>+ Add Custom Q</button> : (
              <div>
                <textarea className="form-textarea" rows={2} value={customQ} onChange={function(e) { setCustomQ(e.target.value); }} placeholder="Your question…" style={{ marginBottom: 4 }}/>
                <textarea className="form-textarea" rows={2} value={customAns} onChange={function(e) { setCustomAns(e.target.value); }} placeholder="Model answer (blank = AI)" style={{ marginBottom: 5 }}/>
                <div style={{ display: 'flex', gap: 5 }}>
                  <button className="btn btn-success btn-sm" style={{ flex: 1 }} onClick={handleAddCustomQ} disabled={!customQ.trim() || genModelLoading}>{genModelLoading ? '…' : customAns.trim() ? 'Add' : 'Add + AI'}</button>
                  <button className="btn btn-ghost btn-sm" onClick={function() { setShowCustomQ(false); setCustomQ(''); setCustomAns(''); }}>✕</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* MIDDLE: live oral flow */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto' }}>

          {/* No start button needed — examiner clicks Ask directly */}
          {flow === 'idle' && questions.length > 0 && transcript.length === 0 && (
            <div style={{ padding: '10px 14px', background: 'rgba(124,58,237,.08)', border: '1px solid rgba(124,58,237,.2)', borderRadius: 8, fontSize: '0.8rem', color: '#a78bfa', textAlign: 'center' }}>
              👆 Click <strong>Ask</strong> next to any question on the right to begin
            </div>
          )}

          {questions.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>🎤</div>
              <div style={{ color: '#9ca3af', fontWeight: 600 }}>No questions yet</div>
              <div style={{ fontSize: '0.8rem', color: '#4b5563', marginTop: 4 }}>Generate or add a custom question using the left panel</div>
            </div>
          )}

          {/* ── Manual Question Mode toggle ── */}
          {(flow === 'idle' || flow === 'waiting' || flow === 'done') && transcript.length >= 0 && questions.length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={function() { setManualQMode(!manualQMode); setMQPhase('idle'); manualQRef.current = ''; setManualQText(''); stopSTT(); setLiveWords(''); }}
                style={{ padding: '6px 14px', borderRadius: 7, border: '1.5px solid ' + (manualQMode ? '#f59e0b' : 'rgba(255,255,255,.15)'), background: manualQMode ? 'rgba(245,158,11,.15)' : 'transparent', color: manualQMode ? '#fbbf24' : '#9ca3af', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}>
                🎙 Manual Question Mode {manualQMode ? '(ON)' : '(OFF)'}
              </button>
              <span style={{ fontSize: '0.72rem', color: '#6b7280' }}>Speak your own question — AI grades against student's reply</span>
            </div>
          )}

          {/* ── Manual Question Mode card ── */}
          {manualQMode && (flow === 'idle' || flow === 'waiting') && (
            <div className="card" style={{ borderLeft: '3px solid #f59e0b' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#fbbf24', letterSpacing: 1, marginBottom: 10, fontFamily: 'JetBrains Mono,monospace' }}>🎙 TEACHER SPEAKS THE QUESTION</div>

              {/* Step 1: Record teacher's question */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: '0.74rem', color: '#9ca3af', marginBottom: 6 }}>Step 1 — Speak your question (or type it below)</div>
                <div style={{ minHeight: 52, padding: '9px 12px', background: 'rgba(245,158,11,.07)', border: '1.5px solid ' + (mqPhase === 'recording_q' ? '#f59e0b' : 'rgba(245,158,11,.2)'), borderRadius: 8, fontSize: '0.9rem', color: '#e5e5e5', lineHeight: 1.6, marginBottom: 6, wordBreak: 'break-word' }}>
                  {manualQText
                    ? <span>{manualQText}{mqPhase === 'recording_q' && liveWords && <span style={{ color: '#9ca3af', fontStyle: 'italic' }}> {liveWords}</span>}</span>
                    : <span style={{ color: '#4b5563', fontStyle: 'italic' }}>{mqPhase === 'recording_q' ? '🎤 Listening for your question…' : 'Your question will appear here'}</span>}
                </div>
                <input className="form-input" value={manualQText} onChange={function(e) { setManualQText(e.target.value); manualQRef.current = e.target.value; }}
                  placeholder="Or type your question here…" style={{ marginBottom: 6, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', color: '#e5e5e5' }}/>
                <div style={{ display: 'flex', gap: 6 }}>
                  {mqPhase !== 'recording_q'
                    ? <button className="btn btn-warning btn-sm" onClick={startRecordAdminQ} style={{ flex: 1 }}>🎤 Record My Question</button>
                    : <button className="btn btn-danger btn-sm" onClick={stopRecordAdminQ} style={{ flex: 1 }}>⏹ Done Speaking</button>}
                  {(mqPhase === 'recorded' || manualQText.trim()) && (
                    <button className="btn btn-success btn-sm" onClick={startListenStudentForManualQ} style={{ flex: 1 }}>
                      🔊 Ask Student
                    </button>
                  )}
                </div>
              </div>

              {/* Step 2: shows automatically after speakAndListen starts */}
              {(mqPhase === 'listening' || flow === 'listening' || flow === 'grading') && (
                <div>
                  <div style={{ fontSize: '0.74rem', color: '#9ca3af', marginBottom: 6 }}>Step 2 — Student answers (captured automatically)</div>
                  <div style={{ minHeight: 52, padding: '9px 12px', background: 'rgba(255,255,255,.04)', border: '1.5px solid ' + (flow === 'listening' ? '#ef4444' : 'rgba(255,255,255,.08)'), borderRadius: 8, fontSize: '0.9rem', color: '#e5e5e5', lineHeight: 1.6, wordBreak: 'break-word' }}>
                    {capturedText
                      ? <span>{capturedText}{liveWords && <span style={{ color: '#9ca3af', fontStyle: 'italic' }}> {liveWords}</span>}</span>
                      : <span style={{ color: '#374151', fontStyle: 'italic' }}>{flow === 'listening' ? '🎤 Listening for student…' : flow === 'grading' ? '⚡ Grading…' : 'Waiting…'}</span>}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Active question card (normal mode) ── */}
          {q && !manualQMode && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 6 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className="badge badge-primary">Q{currentQ + 1} / {questions.length}</span>
                  {q._custom && <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>✏ Custom</span>}
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: flowColors[flow] || '#9ca3af' }}>{flowLabels[flow]}</span>
                </div>
                <button onClick={function() { speakAndListen(q.question); }} disabled={flow === 'speaking' || flow === 'grading'}
                  style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: 'rgba(124,58,237,.25)', color: '#a78bfa', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer' }}>
                  🔊 Re-read
                </button>
              </div>

              <div style={{ padding: '10px 14px', background: 'rgba(124,58,237,.12)', border: '1px solid rgba(124,58,237,.25)', borderRadius: 9, marginBottom: 10, fontWeight: 700, fontSize: '1rem', color: '#e5e5e5', lineHeight: 1.6 }}>{q.question}</div>

              <div style={{ padding: '7px 12px', background: 'rgba(22,163,74,.07)', border: '1px solid rgba(22,163,74,.15)', borderRadius: 7, fontSize: '0.8rem', color: '#4ade80', marginBottom: 12 }}>
                <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: 1, marginBottom: 3, fontFamily: 'JetBrains Mono,monospace', color: '#6b7280' }}>EXPECTED ANSWER (Examiner Only)</div>
                {q.model_answer}
              </div>

              {/* Student answer capture */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'JetBrains Mono,monospace', display: 'flex', alignItems: 'center', gap: 6 }}>
                    🎤 Student's Spoken Answer
                    {flow === 'listening' && <span style={{ color: '#ef4444', fontWeight: 700 }}>● Recording</span>}
                  </label>
                  {(capturedText || liveWords) && (
                    <button onClick={function() { capturedRef.current = ''; setCapturedText(''); setLiveWords(''); setManualText(''); setVerdict(null); }}
                      style={{ fontSize: '0.7rem', color: '#9ca3af', background: 'transparent', border: 'none', cursor: 'pointer' }}>🗑 Clear</button>
                  )}
                </div>
                <div style={{ minHeight: 80, padding: '10px 13px', background: 'rgba(255,255,255,.04)', border: '1.5px solid ' + (flow === 'listening' ? '#ef4444' : 'rgba(255,255,255,.08)'), borderRadius: 8, fontSize: '0.9rem', color: '#e5e5e5', lineHeight: 1.65, transition: 'border-color .2s', marginBottom: 6, wordBreak: 'break-word' }}>
                  {capturedText
                    ? <span>{capturedText}{liveWords && <span style={{ color: '#9ca3af', fontStyle: 'italic' }}> {liveWords}</span>}</span>
                    : <span style={{ color: '#374151', fontStyle: 'italic' }}>{flow === 'listening' ? '🎤 Listening — student should speak now…' : 'Waiting…'}</span>}
                </div>
                <textarea className="form-textarea" rows={2} value={manualText} onChange={function(e) { setManualText(e.target.value); }}
                  placeholder="Or type / correct the captured transcript…"
                  style={{ fontSize: '0.84rem', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.07)', color: '#e5e5e5' }}/>
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: '#9ca3af', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'JetBrains Mono,monospace' }}>Examiner Notes (confidence, hesitation…)</label>
                <textarea className="form-textarea" rows={2} value={examNotes} onChange={function(e) { setExamNotes(e.target.value); }} style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', color: '#d1d5db' }}/>
              </div>

              {/* Verdict after grading */}
              {verdict && (
                <div style={{ padding: 12, background: verdict.correct ? 'rgba(22,163,74,.12)' : 'rgba(220,38,38,.12)', borderRadius: 9, marginBottom: 12, border: '1px solid ' + (verdict.correct ? 'rgba(22,163,74,.3)' : 'rgba(220,38,38,.3)') }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, color: verdict.correct ? '#4ade80' : verdict.verdict === 'Partially Correct' ? '#fbbf24' : '#f87171' }}>{verdict.verdict}</span>
                    <span style={{ fontWeight: 900, fontSize: '1.1rem', color: '#a78bfa' }}>{verdict.score_pct}%</span>
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#d1d5db', lineHeight: 1.6, marginBottom: 6 }}>{verdict.feedback}</div>
                  {verdict.missing && verdict.missing !== 'None' && <div style={{ fontSize: '0.72rem', color: '#fbbf24', marginBottom: 8 }}>⚠️ Missing: {verdict.missing}</div>}
                  {/* ── Admin decision buttons ── */}
                  {flow === 'waiting' && (
                    <div style={{ display: 'flex', gap: 7, marginTop: 4 }}>
                      {currentQ + 1 < questions.length && (
                        <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={handleNextQuestion}>
                          ▶ Next Question (Q{currentQ + 2})
                        </button>
                      )}
                      <button className="btn btn-outline btn-sm" onClick={function() {
                        // Remove the last-added transcript entry for this question
                        var idx = askedQIdxRef.current;
                        setTranscript(function(t) { return t.filter(function(e) { return e._asked_idx !== idx; }); });
                        setVerdict(null); capturedRef.current = ''; setCapturedText(''); setManualText('');
                        setFlow('idle'); flowRef.current = 'idle'; setStatusMsg('Re-ask when ready');
                      }}>↩ Re-ask</button>
                      {currentQ + 1 >= questions.length && (
                        <button className="btn btn-success btn-sm" style={{ flex: 1 }} onClick={handleEndAndGrade}>
                          📊 End & Grade
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 7 }}>
                {(flow === 'idle' || flow === 'waiting') && !verdict && (
                  <button className="btn btn-success btn-sm" style={{ flex: 1 }} onClick={function() { setVerdict(null); speakAndListen(q.question); }}>
                    🎙 Ask This Question
                  </button>
                )}
                {flow === 'listening' && (
                  <>
                    <button className="btn btn-warning btn-sm" style={{ flex: 1 }} onClick={function() { doGradeAndWait(); }}>
                      ⚡ Done — Grade Answer
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={function() { stopSTT(); setFlow('idle'); flowRef.current = 'idle'; }}>⏸ Pause</button>
                  </>
                )}
                {flow === 'grading' && (
                  <button className="btn btn-sm btn-outline" style={{ flex: 1 }} disabled>⚡ Grading…</button>
                )}
                {(flow === 'idle' || flow === 'waiting') && capturedText.trim() && !verdict && (
                  <button className="btn btn-warning btn-sm" onClick={function() { doGradeAndWait(); }}>⚡ Grade</button>
                )}
                {(flow === 'idle' || flow === 'waiting') && manualText.trim() && !verdict && (
                  <button className="btn btn-warning btn-sm" onClick={handleManualGrade}>⚡ Grade (typed)</button>
                )}
              </div>
              {statusMsg && <div style={{ marginTop: 7, fontSize: '0.75rem', color: statusMsg.startsWith('✓') || statusMsg.startsWith('✅') ? '#4ade80' : '#9ca3af', textAlign: 'center' }}>{statusMsg}</div>}
            </div>
          )}

          {/* ── Follow-Up Question Section (shown after grading) ── */}
          {verdict && flow === 'waiting' && transcript.length > 0 && (
            <div className="card" style={{ borderLeft: '3px solid #f59e0b' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#fbbf24', letterSpacing: 1, marginBottom: 10, fontFamily: 'JetBrains Mono,monospace' }}>
                💬 FOLLOW-UP QUESTION
              </div>
              {!followUpQ ? (
                <button className="btn btn-warning btn-sm" style={{ width: '100%' }}
                  onClick={generateFollowUp} disabled={followUpLoading}>
                  {followUpLoading ? '⚡ Generating…' : '✨ Generate Follow-Up Based on Student Answer'}
                </button>
              ) : (
                <div>
                  <div style={{ padding: '10px 14px', background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.3)', borderRadius: 8, fontWeight: 700, fontSize: '0.95rem', color: '#fef3c7', lineHeight: 1.5, marginBottom: 10 }}>
                    {followUpQ}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-success btn-sm" style={{ flex: 1 }} onClick={function() {
                      // Ask follow-up as manual question — add to questions list and ask it
                      var fq = { question: followUpQ, model_answer: '', _custom: true, _followup: true };
                      var newQs = questions.concat([fq]);
                      setQuestions(newQs); questionsRef.current = newQs;
                      var newIdx = newQs.length - 1;
                      setFollowUpQ('');
                      setTimeout(function() { handleAskQuestion(newIdx); }, 100);
                    }}>🎙 Ask This Follow-Up</button>
                    <button className="btn btn-ghost btn-sm" onClick={generateFollowUp} disabled={followUpLoading}>↻ Regenerate</button>
                    <button className="btn btn-ghost btn-sm" onClick={function() { setFollowUpQ(''); }}>✕</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Manual Q mode: show answer capture after teacher asked */}
          {manualQMode && (flow === 'listening' || flow === 'grading' || flow === 'waiting') && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: flowColors[flow] }}>{flowLabels[flow]}</span>
                {flow === 'waiting' && verdict && <span style={{ fontWeight: 900, color: verdict.correct ? '#4ade80' : '#f87171' }}>{verdict.score_pct}%</span>}
              </div>

              {/* Student answer live box */}
              {(flow === 'listening' || flow === 'grading') && (
                <div style={{ minHeight: 70, padding: '10px 13px', background: 'rgba(255,255,255,.04)', border: '1.5px solid ' + (flow === 'listening' ? '#ef4444' : 'rgba(255,255,255,.08)'), borderRadius: 8, fontSize: '0.9rem', color: '#e5e5e5', lineHeight: 1.65, marginBottom: 8, wordBreak: 'break-word' }}>
                  {capturedText
                    ? <span>{capturedText}{liveWords && <span style={{ color: '#9ca3af', fontStyle: 'italic' }}> {liveWords}</span>}</span>
                    : <span style={{ color: '#374151', fontStyle: 'italic' }}>{flow === 'listening' ? '🎤 Student speaking…' : '⚡ Grading…'}</span>}
                </div>
              )}

              {flow === 'listening' && (
                <button className="btn btn-warning btn-sm" style={{ width: '100%' }} onClick={function() { doGradeAndWait(); }}>⚡ Done — Grade Answer</button>
              )}

              {/* Verdict for manual Q */}
              {verdict && flow === 'waiting' && (
                <div style={{ padding: 12, background: verdict.correct ? 'rgba(22,163,74,.12)' : 'rgba(220,38,38,.12)', borderRadius: 9, border: '1px solid ' + (verdict.correct ? 'rgba(22,163,74,.3)' : 'rgba(220,38,38,.3)') }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, color: verdict.correct ? '#4ade80' : verdict.verdict === 'Partially Correct' ? '#fbbf24' : '#f87171' }}>{verdict.verdict}</span>
                    <span style={{ fontWeight: 900, fontSize: '1.1rem', color: '#a78bfa' }}>{verdict.score_pct}%</span>
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#d1d5db', lineHeight: 1.6 }}>{verdict.feedback}</div>
                  <div style={{ display: 'flex', gap: 7, marginTop: 10 }}>
                    <button className="btn btn-warning btn-sm" style={{ flex: 1 }} onClick={function() {
                      setVerdict(null); setMQPhase('idle'); manualQRef.current = ''; setManualQText('');
                      setCapturedText(''); capturedRef.current = ''; setManualText('');
                      setFlow('waiting'); flowRef.current = 'waiting';
                    }}>🎙 Ask Another Manual Q</button>
                    {questions.length > 0 && currentQ + 1 < questions.length && (
                      <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={function() { setManualQMode(false); handleNextQuestion(); }}>▶ Back to List Q{currentQ + 2}</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: question list + rolling transcript */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto' }}>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9ca3af', letterSpacing: 1, marginBottom: 7, fontFamily: 'JetBrains Mono,monospace' }}>QUESTIONS ({questions.length})</div>
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {questions.length === 0 ? <div style={{ fontSize: '0.74rem', color: '#4b5563', textAlign: 'center', padding: '10px 0' }}>None yet</div>
                : questions.map(function(q2, i) {
                  // A question is "done" if there's a transcript entry that was asked at this index
                  var tEntry = transcript.find(function(t) { return t._asked_idx === i; });
                  var done = !!tEntry;
                  var isCur = i === currentQ;
                  var dotCol = done ? (tEntry.correct ? '#4ade80' : tEntry.verdict === 'Partially Correct' ? '#fbbf24' : '#f87171') : isCur ? '#a78bfa' : '#374151';
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '6px 7px', borderRadius: 5, marginBottom: 3, background: isCur ? 'rgba(124,58,237,.18)' : 'transparent', borderLeft: isCur ? '2px solid var(--accent)' : '2px solid transparent' }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotCol, flexShrink: 0, marginTop: 5 }}/>
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{ fontSize: '0.72rem', color: isCur ? '#e5e5e5' : done ? '#6b7280' : '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i + 1}. {(q2.question || '').slice(0, 38)}{(q2.question || '').length > 38 ? '…' : ''}</div>
                        {done && tEntry && <div style={{ fontSize: '0.63rem', color: dotCol, fontFamily: 'JetBrains Mono,monospace' }}>{tEntry.score_pct}% · {tEntry.verdict}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        {!done && (
                          <button onClick={function() { handleAskQuestion(i); }}
                            style={{ padding: '2px 8px', borderRadius: 5, border: '1px solid rgba(124,58,237,.4)', background: isCur ? 'rgba(124,58,237,.25)' : 'transparent', color: '#a78bfa', fontSize: '0.65rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            Ask
                          </button>
                        )}
                        {done && (
                          <button onClick={function() { handleAskQuestion(i); }}
                            style={{ padding: '2px 8px', borderRadius: 5, border: '1px solid rgba(255,255,255,.12)', background: 'transparent', color: '#6b7280', fontSize: '0.65rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            Re-ask
                          </button>
                        )}
                        {!done && (flow === 'idle') && (
                          <button onClick={function() { removeQuestion(i); }} style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', fontSize: '0.7rem' }}>✕</button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Rolling transcript - shows verbatim student speech */}
          <div className="card" style={{ padding: 12, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9ca3af', letterSpacing: 1, marginBottom: 7, fontFamily: 'JetBrains Mono,monospace' }}>📝 LIVE TRANSCRIPT ({transcript.length})</div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {transcript.length === 0 ? <div style={{ fontSize: '0.74rem', color: '#4b5563', textAlign: 'center', padding: '12px 0' }}>Transcript builds as student answers</div>
                : transcript.map(function(t, i) {
                  var col = t.correct ? '#4ade80' : t.verdict === 'Partially Correct' ? '#fbbf24' : '#f87171';
                  var qNum = t._asked_idx !== undefined ? t._asked_idx + 1 : t.q_num || (i + 1);
                  return (
                    <div key={i} style={{ padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                        <span style={{ fontWeight: 700, fontSize: '0.73rem', color: '#e5e5e5' }}>Q{qNum}{t._custom ? ' ✏' : ''}{t._manual_q ? ' 🎙' : ''}</span>
                        <span style={{ fontWeight: 700, fontSize: '0.68rem', color: col }}>{t.score_pct}%</span>
                      </div>
                      <div style={{ fontSize: '0.68rem', color: '#9ca3af', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Q: {(t.question || '').slice(0, 42)}{(t.question || '').length > 42 ? '…' : ''}</div>
                      <div style={{ fontSize: '0.68rem', color: '#a78bfa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🎤 "{(t.student_said || 'no answer').slice(0, 48)}{(t.student_said || '').length > 48 ? '…' : ''}"</div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
