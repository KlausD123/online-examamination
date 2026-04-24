import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { apiPost } from '../../utils/api';

// ── Load face-api.js from CDN once ──────────────────────────────────────────
var FACE_API_LOADED  = false;
var FACE_API_LOADING = false;
var FACE_API_CBS     = [];
var MODEL_BASE_URL   = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';

function loadFaceAPI() {
  return new Promise(function(resolve, reject) {
    if (FACE_API_LOADED) { resolve(); return; }
    FACE_API_CBS.push({ resolve: resolve, reject: reject });
    if (FACE_API_LOADING) return;
    FACE_API_LOADING = true;
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.js';
    script.onload = function() {
      // Load only the tiny model — fast, runs in browser, detects face count
      var fapi = window.faceapi;
      Promise.all([
        fapi.nets.tinyFaceDetector.loadFromUri(MODEL_BASE_URL),
        fapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_BASE_URL),
      ]).then(function() {
        FACE_API_LOADED = true;
        FACE_API_CBS.forEach(function(cb) { cb.resolve(); });
        FACE_API_CBS = [];
      }).catch(function(e) {
        FACE_API_CBS.forEach(function(cb) { cb.reject(e); });
        FACE_API_CBS = [];
      });
    };
    script.onerror = function(e) {
      FACE_API_CBS.forEach(function(cb) { cb.reject(new Error('Failed to load face-api.js')); });
      FACE_API_CBS = [];
    };
    document.head.appendChild(script);
  });
}

export default function ExamInterface({ exam, submissionId, onComplete }) {
  var store = useStore();
  var [questions,   setQuestions]   = useState([]);
  var [answers,     setAnswers]     = useState({});
  var [currentQ,    setCurrentQ]    = useState(0);
  var [timeLeft,    setTimeLeft]    = useState(exam.duration_minutes * 60);
  var [loading,     setLoading]     = useState(true);
  var [submitting,  setSubmitting]  = useState(false);
  var [showWarning, setShowWarning] = useState(false);
  var [showConfirm, setShowConfirm] = useState(false);
  var [violations,  setViolations]  = useState(0);
  var [violReason,  setViolReason]  = useState('');

  // Camera / mic state
  var [camOn,       setCamOn]       = useState(false);
  var [micOn,       setMicOn]       = useState(false);
  var [camError,    setCamError]    = useState('');

  // Face-detection state (shown in sidebar)
  var [faceStatus,  setFaceStatus]  = useState('loading'); // loading | ok | no_face | multiple | looking_away
  var [faceCount,   setFaceCount]   = useState(0);
  var [voiceAlert,  setVoiceAlert]  = useState(false);
  var [faceApiReady,setFaceApiReady]= useState(false);

  var cheatedRef      = useRef(false);
  var violRef         = useRef(0);
  var submittingRef   = useRef(false);
  var videoRef        = useRef(null);
  var canvasRef       = useRef(null);
  var streamRef       = useRef(null);
  var audioCtxRef     = useRef(null);
  var voiceIntervalRef= useRef(null);
  var faceIntervalRef = useRef(null);
  var loudFramesRef   = useRef(0);
  var noFaceFramesRef = useRef(0);   // consecutive frames without a face
  var multiFaceFramesRef = useRef(0);// consecutive frames with >1 face

  // ── Load questions ─────────────────────────────────────────
  useEffect(function () {
    store.loadQuestions(exam.exam_id).then(function (qs) {
      setQuestions(qs);
      setLoading(false);
    });
  }, []); // eslint-disable-line

  // ── Start monitoring on mount ──────────────────────────────
  useEffect(function () {
    startMonitoring();
    return function () { stopMonitoring(); };
  }, []); // eslint-disable-line

  async function startMonitoring() {
    try {
      var stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: true,
      });
      streamRef.current = stream;
      setCamOn(true);
      setMicOn(true);

      // Monitor if student turns off camera/mic — auto recover
      stream.getVideoTracks().forEach(function(track) {
        track.onended = function() {
          setCamOn(false);
          triggerViolation('Camera was turned off during the exam');
          // Auto-recover after 3s
          setTimeout(function() {
            navigator.mediaDevices.getUserMedia({ video: true, audio: false })
              .then(function(newStream) {
                newStream.getVideoTracks().forEach(function(t) { streamRef.current.addTrack(t); });
                if (videoRef.current) videoRef.current.srcObject = streamRef.current;
                setCamOn(true);
              }).catch(function(){});
          }, 3000);
        };
      });
      stream.getAudioTracks().forEach(function(track) {
        track.onended = function() {
          setMicOn(false);
          triggerViolation('Microphone was turned off during the exam');
          setTimeout(function() {
            navigator.mediaDevices.getUserMedia({ video: false, audio: true })
              .then(function(newStream) {
                newStream.getAudioTracks().forEach(function(t) { streamRef.current.addTrack(t); });
                setMicOn(true);
              }).catch(function(){});
          }, 3000);
        };
      });

      // Attach video element
      var iv = setInterval(function () {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          clearInterval(iv);
          // Start face detection once video is playing
          videoRef.current.onloadedmetadata = function () {
            startFaceDetection();
          };
        }
      }, 200);

      // Start audio monitoring
      startAudioMonitor(stream);

    } catch (e) {
      setCamError('Camera / mic unavailable. ' + (e.message || ''));
      setFaceStatus('unavailable');
    }
  }

  function stopMonitoring() {
    clearInterval(faceIntervalRef.current);
    clearInterval(voiceIntervalRef.current);
    if (audioCtxRef.current) { try { if (audioCtxRef.current.state !== 'closed') audioCtxRef.current.close(); } catch (e) {} audioCtxRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(function (t) { t.stop(); }); }
  }

  // ── Violation handler ─────────────────────────────────────
  function triggerViolation(reason) {
    if (cheatedRef.current || submittingRef.current) return;
    violRef.current += 1;
    setViolations(violRef.current);
    if (violRef.current === 1) {
      setViolReason(reason);
      setShowWarning(true);
    } else {
      cheatedRef.current = true;
      doCheatSubmit(reason);
    }
  }

  // ── Face detection (face-api.js) ───────────────────────────
  async function startFaceDetection() {
    try {
      await loadFaceAPI();
      setFaceApiReady(true);
      setFaceStatus('ok');

      var fapi = window.faceapi;
      var options = new fapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.25 }); // larger input = better detection, lower threshold = fewer false 'no face'

      faceIntervalRef.current = setInterval(async function () {
        if (!videoRef.current || videoRef.current.readyState < 2) return;
        if (cheatedRef.current || submittingRef.current) return;

        try {
          // Detect all faces with landmarks (landmark model is tiny/fast)
          // SSD MobileNet v1 is much more accurate than TinyFaceDetector for face counting
          var ssdOptions = new fapi.SsdMobilenetv1Options({ minConfidence: 0.4, maxResults: 10 });
          var detections = await fapi.detectAllFaces(videoRef.current, ssdOptions);
          var count = detections ? detections.length : 0;
          setFaceCount(count);

          // ── No face detected ─────────────────────────────
          if (count === 0) {
            noFaceFramesRef.current++;
            multiFaceFramesRef.current = 0;
            setFaceStatus('no_face');
            if (noFaceFramesRef.current >= 30) {   // ~15s of no face before violation
              noFaceFramesRef.current = 0;
              triggerViolation('No face detected in camera for extended period — student may have left');
            }
          }
          // ── Multiple faces detected ───────────────────────
          else if (count > 1) {
            multiFaceFramesRef.current++;
            noFaceFramesRef.current = 0;
            setFaceStatus('multiple');
            if (multiFaceFramesRef.current >= 12) {  // ~6s continuous multiple faces
              multiFaceFramesRef.current = 0;
              triggerViolation('Multiple people detected in camera — only the student should be present');
            }
          }
          // ── One face — check if looking at screen ─────────
          else {
            noFaceFramesRef.current   = 0;
            multiFaceFramesRef.current= 0;
            setFaceStatus('ok');

            // Face detected and present — mark as OK
            setFaceStatus('ok');
          }

          // Draw detection overlay on canvas
          drawOverlay(detections, count);

        } catch (detErr) {
          // Ignore per-frame errors
        }
      }, 500); // Check every 500ms

    } catch (loadErr) {
      // face-api.js failed to load (network issue etc.) — fall back to basic mode
      setFaceStatus('fallback');
      setFaceApiReady(false);
      console.warn('Face detection unavailable:', loadErr.message);
    }
  }

  function drawOverlay(detections, count) {
    if (!canvasRef.current || !videoRef.current) return;
    var vid   = videoRef.current;
    var cv    = canvasRef.current;
    var dispW = vid.clientWidth  || 200;
    var dispH = vid.clientHeight || 148;
    cv.width  = dispW;
    cv.height = dispH;
    // Compute objectFit:cover scale + offset
    var natW  = vid.videoWidth  || dispW;
    var natH  = vid.videoHeight || dispH;
    var scale = Math.max(dispW / natW, dispH / natH);
    var offX  = (dispW - natW * scale) / 2;
    var offY  = (dispH - natH * scale) / 2;
    var ctx   = cv.getContext('2d');
    ctx.clearRect(0, 0, dispW, dispH);
    if (!detections || detections.length === 0) return;
    detections.forEach(function(d) {
      // ssdMobilenetv1 returns detection directly; tinyFaceDetector also same
      var box = d.box || (d.detection && d.detection.box);
      if (!box) return;
      var x = box.x * scale + offX;
      var y = box.y * scale + offY;
      var w = box.width  * scale;
      var h = box.height * scale;
      var color = count > 1 ? '#ef4444' : '#22c55e';
      // Glowing border
      ctx.shadowColor = color; ctx.shadowBlur = 8;
      ctx.strokeStyle = color; ctx.lineWidth  = 2.5;
      ctx.strokeRect(x, y, w, h);
      ctx.shadowBlur = 0;
      // Corner accents
      var cLen = Math.min(w, h) * 0.2;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ['tl','tr','bl','br'].forEach(function(c) {
        ctx.beginPath();
        if (c==='tl'){ ctx.moveTo(x+cLen,y); ctx.lineTo(x,y); ctx.lineTo(x,y+cLen); }
        if (c==='tr'){ ctx.moveTo(x+w-cLen,y); ctx.lineTo(x+w,y); ctx.lineTo(x+w,y+cLen); }
        if (c==='bl'){ ctx.moveTo(x+cLen,y+h); ctx.lineTo(x,y+h); ctx.lineTo(x,y+h-cLen); }
        if (c==='br'){ ctx.moveTo(x+w-cLen,y+h); ctx.lineTo(x+w,y+h); ctx.lineTo(x+w,y+h-cLen); }
        ctx.stroke();
      });
      // Label
      var label = count > 1 ? '⚠ EXTRA PERSON' : 'Student ✓';
      ctx.font = 'bold 11px monospace';
      var tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = color + 'dd';
      ctx.fillRect(x, y > 18 ? y - 18 : y + h, tw, 18);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px monospace';
      ctx.fillText(label, x + 4, y > 18 ? y - 5 : y + h + 13);
    });
  }

  // ── Audio monitor (loud sustained noise) ──────────────────
  function startAudioMonitor(stream) {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx      = new AC();
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;
      ctx.createMediaStreamSource(stream).connect(analyser);
      audioCtxRef.current = ctx;
      var freqData = new Uint8Array(analyser.frequencyBinCount);
      var timeData = new Uint8Array(analyser.fftSize);
      voiceIntervalRef.current = setInterval(function () {
        analyser.getByteFrequencyData(freqData);
        analyser.getByteTimeDomainData(timeData);
        // Voice-frequency band (approx 85-8000 Hz)
        var voiceSum = 0;
        for (var j = 1; j < Math.min(93, freqData.length); j++) voiceSum += freqData[j];
        var voiceAvg = voiceSum / Math.min(92, freqData.length);
        // RMS loudness
        var rmsSum = 0;
        for (var k = 0; k < timeData.length; k++) { var s=(timeData[k]/128.0)-1.0; rmsSum+=s*s; }
        var rms = Math.sqrt(rmsSum / timeData.length);
        // Multiple voices detection: look for complex frequency pattern
        // Multiple people = multiple fundamental frequencies simultaneously
        var voiceBands = [0, 0, 0, 0]; // 85-250Hz, 250-500Hz, 500-2000Hz, 2000-4000Hz
        var binHz = ctx.sampleRate / analyser.fftSize;
        for (var b = 0; b < freqData.length; b++) {
          var hz = b * binHz;
          if (hz >= 85  && hz < 250)  voiceBands[0] += freqData[b];
          if (hz >= 250 && hz < 500)  voiceBands[1] += freqData[b];
          if (hz >= 500 && hz < 2000) voiceBands[2] += freqData[b];
          if (hz >= 2000 && hz < 4000) voiceBands[3] += freqData[b];
        }
        // Normalize bands
        var activeBands = voiceBands.filter(function(v) { return v > 3000; }).length;
        // Multiple active voice bands + high overall level = multiple voices
        var multipleVoices = (activeBands >= 3 && voiceAvg > 60) || rms > 0.45;
        if (multipleVoices) {
          loudFramesRef.current++;
          if (loudFramesRef.current >= 15) { // ~3s sustained
            loudFramesRef.current = 0;
            setVoiceAlert(true);
            setTimeout(function () { setVoiceAlert(false); }, 4000);
            triggerViolation('Multiple voices detected in the environment');
          }
        } else {
          loudFramesRef.current = Math.max(0, loudFramesRef.current - 1);
        }
      }, 200);
    } catch (e) { /* unavailable */ }
  }

  // ── Tab-switch anti-cheat ─────────────────────────────────
  // Block tab switching: first switch = warning + force focus back; second = cheat submit
  var handleVisibility = useCallback(function () {
    if (document.hidden && !cheatedRef.current && !submittingRef.current) {
      triggerViolation('Tab switch / window change detected');
      // Try to focus back to this window after a short delay
      setTimeout(function() {
        try { window.focus(); } catch(e) {}
      }, 100);
    }
  }, []); // eslint-disable-line

  useEffect(function () {
    document.addEventListener('visibilitychange', handleVisibility);
    // Block right-click during exam
    function blockContext(e) { e.preventDefault(); return false; }
    document.addEventListener('contextmenu', blockContext);
    // Warn before page close/refresh (browser shows its own dialog)
    function blockUnload(e) {
      if (!submittingRef.current && !cheatedRef.current) {
        e.preventDefault(); e.returnValue = 'Exam in progress — leaving will count as a violation!';
        return e.returnValue;
      }
    }
    window.addEventListener('beforeunload', blockUnload);
    return function () {
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('contextmenu', blockContext);
      window.removeEventListener('beforeunload', blockUnload);
    };
  }, [handleVisibility]); // eslint-disable-line

  // ── Timer ──────────────────────────────────────────────────
  useEffect(function () {
    if (loading) return;
    var timer = setInterval(function () {
      setTimeLeft(function (prev) {
        if (prev <= 1) { clearInterval(timer); doFinalSubmit(true); return 0; }
        return prev - 1;
      });
    }, 1000);
    return function () { clearInterval(timer); };
  }, [loading]); // eslint-disable-line

  // ── Cheat submit ───────────────────────────────────────────
  async function doCheatSubmit(reason) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    stopMonitoring();
    try {
      await store.submitExam(submissionId, [], exam.exam_id, true);
      await apiPost('/notifications', {
        title:   'INTEGRITY VIOLATION: ' + (store.currentUser.name || 'Student'),
        message: (store.currentUser.name || 'Student') + ' violated exam rules in "' + exam.title + '". Reason: ' + reason + '. Score automatically set to ZERO.',
        type:    'urgent',
      });
    } catch (e) { /* silent */ }
    onComplete();
  }

  // ── Normal submit ─────────────────────────────────────────
  async function doFinalSubmit(autoTime) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setShowConfirm(false);
    stopMonitoring();

    var ansArr = questions.map(function (q) {
      return { question_id: q.question_id, answer_text: answers[q.question_id] || '' };
    });
    var answeredCount2 = ansArr.filter(function (a) { return a.answer_text; }).length;
    var correctCount = 0;
    questions.forEach(function (q) {
      var ans = answers[q.question_id] || '';
      if (q.correct_answer && ans.trim().toLowerCase() === String(q.correct_answer).trim().toLowerCase()) correctCount++;
    });

    var result = null;
    try { result = await store.submitExam(submissionId, ansArr, exam.exam_id, false); } catch (e) {}

    try {
      var score    = (result && result.total_score != null) ? result.total_score : '?';
      var grade    = (result && result.grade) ? result.grade : '-';
      var scorePct = exam.total_marks > 0 && typeof score === 'number' ? Math.round((score / exam.total_marks) * 100) : '?';
      await apiPost('/notifications', {
        title:   'Exam Submitted: ' + (store.currentUser.name || 'Student'),
        message: (store.currentUser.name || 'Student') + ' submitted "' + exam.title + '".' +
          (autoTime ? ' [AUTO-SUBMITTED — time expired]' : '') +
          ' Score: ' + score + ' / ' + exam.total_marks + ' (' + scorePct + '%)' +
          '  Grade: ' + grade +
          '  Correct: ' + correctCount + ' / ' + questions.length +
          '  Answered: ' + answeredCount2 + ' / ' + questions.length,
        type: (typeof scorePct === 'number' && scorePct >= 50) ? 'success' : 'warning',
      });
    } catch (e) {}
    onComplete();
  }

  function handleSubmitClick() { setShowConfirm(true); }
  function setAnswer(qid, val) {
    setAnswers(function (prev) { var a = Object.assign({}, prev); a[qid] = val; return a; });
  }

  var mins         = Math.floor(timeLeft / 60);
  var secs         = timeLeft % 60;
  var timeStr      = String(mins).padStart(2,'0') + ':' + String(secs).padStart(2,'0');
  var isUrgent     = timeLeft < 300;
  var answeredCount= Object.keys(answers).filter(function (k) { return answers[k]; }).length;

  // Face status display config
  var faceInfo = {
    loading:     { label:'Loading AI…',       color:'#9ca3af', bg:'#f3f4f6',  icon:'🔄' },
    ok:          { label:'Face Detected ✓',   color:'#16a34a', bg:'#dcfce7',  icon:'✅' },
    no_face:     { label:'No Face Detected!', color:'#dc2626', bg:'#fee2e2',  icon:'👤' },
    multiple:    { label:'Multiple People!',   color:'#dc2626', bg:'#fee2e2',  icon:'👥' },
    looking_away:{ label:'Looking Away',       color:'#d97706', bg:'#fef3c7',  icon:'👁' },
    fallback:    { label:'Basic Monitor',      color:'#6b7280', bg:'#f3f4f6',  icon:'📹' },
    unavailable: { label:'Camera Off',         color:'#dc2626', bg:'#fee2e2',  icon:'🚫' },
  };
  var fi = faceInfo[faceStatus] || faceInfo.loading;

  if (loading) return <div className="loading-center"><div className="spinner"></div><span>Loading exam...</span></div>;

  var q = questions[currentQ];

  return (
    <div className="fade-up" style={{ maxWidth:1060, margin:'0 auto' }}>

      {/* Camera/Mic off warning — cannot be dismissed */}
      {(!camOn || !micOn) && (
        <div style={{ position:'fixed', top:0, left:0, right:0, zIndex:9999, background:'#dc2626', color:'#fff', textAlign:'center', padding:'8px 16px', fontWeight:700, fontSize:'0.85rem', display:'flex', alignItems:'center', justifyContent:'center', gap:10 }}>
          ⚠️ {!camOn && !micOn ? 'Camera and microphone are off' : !camOn ? 'Camera is off' : 'Microphone is off'} — this is a violation. Restoring automatically…
        </div>
      )}

      {/* Voice alert flash */}
      {voiceAlert && (
        <div style={{ position:'fixed', top:72, left:'50%', transform:'translateX(-50%)', zIndex:3000, background:'#dc2626', color:'#fff', padding:'11px 28px', borderRadius:30, fontWeight:700, fontSize:'0.9rem', boxShadow:'0 8px 32px rgba(220,38,38,.5)', whiteSpace:'nowrap', animation:'fadeUp .3s ease-out' }}>
          🔊 Loud noise detected — stay silent!
        </div>
      )}

      {/* Multiple-face flash */}
      {faceStatus === 'multiple' && (
        <div style={{ position:'fixed', top:72, left:'50%', transform:'translateX(-50%)', zIndex:3000, background:'#dc2626', color:'#fff', padding:'11px 28px', borderRadius:30, fontWeight:700, fontSize:'0.9rem', boxShadow:'0 8px 32px rgba(220,38,38,.5)', whiteSpace:'nowrap' }}>
          👥 Multiple people detected in camera!
        </div>
      )}

      {/* No-face flash */}
      {faceStatus === 'no_face' && (
        <div style={{ position:'fixed', top:72, left:'50%', transform:'translateX(-50%)', zIndex:3000, background:'#d97706', color:'#fff', padding:'11px 28px', borderRadius:30, fontWeight:700, fontSize:'0.9rem', boxShadow:'0 8px 32px rgba(217,119,6,.5)', whiteSpace:'nowrap' }}>
          👤 Face not visible — please look at the camera
        </div>
      )}

      {/* ── Header bar ── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, padding:'12px 18px', background:'var(--surface)', borderRadius:12, border:'1px solid var(--border)', boxShadow:'var(--shadow-sm)', flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:'1.05rem' }}>{exam.title}</div>
          <div style={{ fontSize:'0.77rem', color:'var(--text3)' }}>{answeredCount}/{questions.length} answered · {exam.total_marks} marks</div>
        </div>
        <div className={'exam-timer'+(isUrgent?' urgent':'')}>{timeStr}</div>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          {/* Face status pill */}
          <div style={{ padding:'4px 10px', borderRadius:20, background:fi.bg, color:fi.color, fontSize:'0.73rem', fontWeight:700, display:'flex', alignItems:'center', gap:4, border:'1px solid '+fi.color+'44' }}>
            {fi.icon} {fi.label}
          </div>
          {/* Face count pill */}
          {faceApiReady && (
            <div style={{ padding:'4px 10px', borderRadius:20, background: faceCount===1?'rgba(22,163,74,.1)':'rgba(220,38,38,.1)', color: faceCount===1?'#16a34a':'#dc2626', fontSize:'0.73rem', fontWeight:700 }}>
              👤 {faceCount} face{faceCount!==1?'s':''}
            </div>
          )}
          {/* Mic pill */}
          <div style={{ padding:'4px 10px', borderRadius:20, background: micOn?'rgba(22,163,74,.12)':'rgba(220,38,38,.1)', color:micOn?'#16a34a':'#dc2626', fontSize:'0.73rem', fontWeight:700 }}>
            🎤 {micOn?'Monitored':'Off'}
          </div>
          {/* Violation dots */}
          <div style={{ display:'flex', alignItems:'center', gap:5, fontSize:'0.73rem', color:violations>0?'var(--danger)':'var(--text3)', fontWeight:600 }}>
            Violations:
            {[0,1].map(function(i){ return <span key={i} style={{ width:11, height:11, borderRadius:'50%', background:i<violations?'var(--danger)':'var(--border)', display:'inline-block', marginLeft:3 }}/>; })}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 248px', gap:18 }}>

        {/* Question card */}
        <div className="card">
          {q && (
            <div>
              <div style={{ display:'flex', gap:8, marginBottom:14 }}>
                <span className="badge badge-primary">Q{currentQ+1}/{questions.length}</span>
                <span className="badge badge-info">{q.marks} marks</span>
                <span className={'badge badge-'+(q.difficulty==='Easy'?'success':q.difficulty==='Hard'?'danger':'warning')}>{q.difficulty||'Medium'}</span>
              </div>
              <div style={{ fontSize:'1.05rem', fontWeight:500, marginBottom:22, lineHeight:1.65 }}>{q.question_text}</div>

              {q.question_type==='MCQ' && q.options && q.options.map(function(opt, i){
                var t=opt.text||opt; var sel=answers[q.question_id]===t;
                return (
                  <div key={i} onClick={function(){setAnswer(q.question_id,t);}}
                    style={{ padding:'12px 16px', border:'2px solid '+(sel?'var(--accent)':'var(--border)'), borderRadius:10, marginBottom:10, cursor:'pointer', background:sel?'var(--accent-glow)':'var(--surface)', display:'flex', alignItems:'center', gap:12, transition:'var(--transition)' }}>
                    <span style={{ width:28, height:28, borderRadius:'50%', border:'2px solid '+(sel?'var(--accent)':'var(--border)'), display:'flex', alignItems:'center', justifyContent:'center', fontWeight:600, fontSize:'0.78rem', background:sel?'var(--accent)':'transparent', color:sel?'#fff':'var(--text3)', flexShrink:0 }}>
                      {String.fromCharCode(65+i)}
                    </span>
                    <span style={{ fontWeight:sel?600:400 }}>{t}</span>
                  </div>
                );
              })}

              {q.question_type==='TRUE_FALSE' && (
                <div style={{ display:'flex', gap:12 }}>
                  {['True','False'].map(function(v){
                    var sel=answers[q.question_id]===v;
                    return <button key={v} className={'btn '+(sel?'btn-primary':'btn-outline')} style={{ flex:1, justifyContent:'center' }} onClick={function(){setAnswer(q.question_id,v);}}>{v}</button>;
                  })}
                </div>
              )}

              {(q.question_type==='SHORT_ANSWER'||q.question_type==='DESCRIPTIVE') && (
                <textarea className="form-textarea" value={answers[q.question_id]||''} onChange={function(e){setAnswer(q.question_id,e.target.value);}} rows={q.question_type==='DESCRIPTIVE'?6:3} placeholder="Type your answer..."/>
              )}
            </div>
          )}
          <div style={{ display:'flex', justifyContent:'space-between', marginTop:22 }}>
            <button className="btn btn-outline" disabled={currentQ===0} onClick={function(){setCurrentQ(function(p){return p-1;});}}>← Previous</button>
            {currentQ<questions.length-1
              ? <button className="btn btn-primary" onClick={function(){setCurrentQ(function(p){return p+1;});}}>Next →</button>
              : <button className="btn btn-success" onClick={handleSubmitClick} disabled={submitting}>📤 Submit Exam</button>
            }
          </div>
        </div>

        {/* ── Sidebar ── */}
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>

          {/* Camera + face detection overlay */}
          <div className="card" style={{ padding:10 }}>
            <div style={{ fontSize:'0.68rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:1, marginBottom:7, fontFamily:'JetBrains Mono,monospace', textAlign:'center' }}>
              📹 AI Proctoring
            </div>
            <div style={{ position:'relative', borderRadius:8, overflow:'hidden', background:'#000', lineHeight:0 }}>
              {camOn ? (
                <>
                  <video ref={videoRef} autoPlay muted playsInline
                    style={{ width:'100%', height:148, objectFit:'cover', display:'block' }}/>
                  {/* Face detection overlay canvas — must match exact display dimensions */}
                  <canvas ref={canvasRef}
                    style={{ position:'absolute', top:0, left:0, width:'100%', height:'100%', borderRadius:8, pointerEvents:'none' }}/>
                </>
              ) : (
                <div style={{ width:'100%', height:110, borderRadius:8, background:'#1a1a2e', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:6 }}>
                  <span style={{ fontSize:'1.5rem', opacity:.4 }}>📷</span>
                  <span style={{ fontSize:'0.68rem', color:'#6b7280', textAlign:'center', padding:'0 8px' }}>{camError||'No camera'}</span>
                </div>
              )}
            </div>

            {/* Face status badge */}
            <div style={{ marginTop:8, padding:'6px 10px', background:fi.bg, borderRadius:7, textAlign:'center', border:'1px solid '+fi.color+'33' }}>
              <div style={{ fontSize:'0.72rem', fontWeight:700, color:fi.color }}>
                {fi.icon} {fi.label}
              </div>
              {faceApiReady && faceCount > 0 && (
                <div style={{ fontSize:'0.65rem', color:faceCount===1?'#16a34a':'#dc2626', marginTop:2 }}>
                  {faceCount} person{faceCount!==1?'s':''} detected
                </div>
              )}
            </div>

            {micOn && (
              <div style={{ marginTop:6, display:'flex', alignItems:'center', justifyContent:'center', gap:5, fontSize:'0.68rem', color:'#16a34a', fontWeight:700 }}>
                <span style={{ width:6, height:6, borderRadius:'50%', background:'#16a34a', display:'inline-block', animation:'pulse 1.2s ease-in-out infinite' }}/>
                Voice Monitored
              </div>
            )}
          </div>

          {/* Question navigator */}
          <div className="card" style={{ flex:1 }}>
            <div style={{ fontWeight:600, marginBottom:10, fontSize:'0.85rem' }}>Questions</div>
            <div className="question-nav">
              {questions.map(function(q, i){
                var cls=i===currentQ?'current':(answers[q.question_id]?'answered':'');
                return <button key={i} className={cls} onClick={function(){setCurrentQ(i);}}>{i+1}</button>;
              })}
            </div>
            <button className="btn btn-success btn-sm" style={{ width:'100%', marginTop:14, justifyContent:'center' }} onClick={handleSubmitClick} disabled={submitting}>
              📤 Submit
            </button>
          </div>

          {/* Monitoring status */}
          <div className="card" style={{ padding:'12px 14px' }}>
            <div style={{ fontSize:'0.68rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:1, marginBottom:10, fontFamily:'JetBrains Mono,monospace' }}>Monitoring</div>
            {[
              { icon:'🤖', label:'Face AI',     status: faceApiReady?'Active':'Loading', color: faceApiReady?'var(--success)':'var(--text3)' },
              { icon:'👤', label:'Faces',        status: !faceApiReady?'—':faceCount===1?'1 (OK)':faceCount===0?'None!':faceCount+' (!)', color: faceCount===1?'var(--success)':faceCount===0?'var(--warning)':'var(--danger)' },
              { icon:'🖥', label:'Tab Switch',  status: violations===0?'OK':violations===1?'WARNING':'VIOLATED', color: violations===0?'var(--success)':violations===1?'var(--warning)':'var(--danger)' },
              { icon:'🎤', label:'Microphone',  status: micOn?'Active':'Off', color: micOn?'var(--success)':'var(--text3)' },
            ].map(function(m, i){
              return (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 0', borderBottom:i<3?'1px solid var(--border)':'none', fontSize:'0.78rem' }}>
                  <span style={{ color:'var(--text2)' }}>{m.icon} {m.label}</span>
                  <span style={{ fontWeight:700, color:m.color, fontSize:'0.72rem' }}>{m.status}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Warning modal */}
      {showWarning && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ textAlign:'center' }}>
            <div style={{ fontSize:'3rem', marginBottom:12 }}>⚠️</div>
            <div className="modal-title">Violation Detected!</div>
            <div className="modal-body">
              <strong>Reason:</strong> {violReason}<br/><br/>
              This is your <strong>first and only warning</strong>. A second violation will immediately submit your exam with a <strong>score of zero</strong>.
            </div>
            <button className="btn btn-primary" onClick={function(){setShowWarning(false);}}>I Understand — Continue Exam</button>
          </div>
        </div>
      )}

      {/* Submit confirm */}
      {showConfirm && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-title">📤 Submit Exam?</div>
            <div className="modal-body">You have answered <strong>{answeredCount} of {questions.length}</strong> questions. This cannot be undone.</div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={function(){setShowConfirm(false);}}>Cancel</button>
              <button className="btn btn-success" onClick={function(){doFinalSubmit(false);}} disabled={submitting}>{submitting?'Submitting…':'✅ Confirm Submit'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
