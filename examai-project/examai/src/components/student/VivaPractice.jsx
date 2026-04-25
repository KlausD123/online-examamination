import React, { useState, useEffect, useRef } from 'react';
import { groqChat } from '../../utils/aiService';
import { useStore } from '../../store/useStore';
import YouTubeResources from '../YouTubeResources';

var API = 'https://online-examamination-production.up.railway.app/api';

function parseJSON(raw) {
  if (!raw) return null;
  var cleaned = raw.replace(/```json/g,'').replace(/```/g,'').trim();
  try { return JSON.parse(cleaned); } catch(e) {}
  var arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) { try { return JSON.parse(arrMatch[0]); } catch(e2) {} }
  var objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) { try { return JSON.parse(objMatch[0]); } catch(e3) {} }
  return null;
}

function saveVP(data) { try { sessionStorage.setItem('vp_session', JSON.stringify(data)); } catch(e) {} }
function loadVP()     { try { return JSON.parse(sessionStorage.getItem('vp_session') || 'null'); } catch(e) { return null; } }
function clearVP()    { try { sessionStorage.removeItem('vp_session'); } catch(e) {} }

export default function VivaPractice() {
  var store = useStore();
  var _s = loadVP() || {};

  var [phase,      setPhaseRaw]  = useState(_s.phase || 'setup');
  var [topic,      setTopic]     = useState(_s.topic || '');
  var [topicInfo,  setTopicInfo] = useState(_s.topicInfo || '');
  var [numQ,       setNumQ]      = useState(_s.numQ || 5);
  var [loading,    setLoading]   = useState(false);

  var [questions,  setQuestions]  = useState(_s.questions || []);
  var [qIndex,     setQIndex]     = useState(_s.qIndex || 0);
  var [transcript, setTranscript] = useState(_s.transcript || []);
  var [recording,  setRecording]  = useState(false);
  var [liveText,   setLiveText]   = useState('');
  var [verdict,    setVerdict]    = useState(null);
  var [grading,    setGrading]    = useState(false);
  var [speaking,   setSpeaking]   = useState(false);
  var [results,    setResults]    = useState(_s.results || null);
  var [analyzing,  setAnalyzing]  = useState(false);

  // Refs
  var synthRef       = useRef(window.speechSynthesis);
  var mediaRecRef    = useRef(null);
  var audioChunks    = useRef([]);
  var whisperTimer   = useRef(null);
  var whisperRunning = useRef(false);
  var micStream      = useRef(null);
  var silenceTimer   = useRef(null);
  var liveTextRef    = useRef('');
  var recordingRef   = useRef(false);
  var qIndexRef      = useRef(0);
  var transcriptRef  = useRef([]);
  var questionsRef   = useRef([]);
  var flowActive     = useRef(false);

  function setPhase(p) {
    setPhaseRaw(p);
    if (p === 'setup') { clearVP(); return; }
    try { var cur = loadVP() || {}; saveVP(Object.assign({}, cur, { phase: p })); } catch(e) {}
  }

  useEffect(function() {
    if (phase === 'setup') return;
    saveVP({ phase, topic, topicInfo, numQ, questions, qIndex, transcript, results });
  });

  // Stop all on phase change
  useEffect(function() {
    if (phase !== 'practice') {
      flowActive.current = false;
      stopWhisper();
      stopTTS();
    }
  }, [phase]); // eslint-disable-line

  useEffect(function() {
    return function() {
      flowActive.current = false;
      stopWhisper();
      stopTTS();
    };
  }, []); // eslint-disable-line

  // ── TTS helpers ──────────────────────────────────────────────────
  function stopTTS() {
    synthRef.current && synthRef.current.cancel();
    window.speechSynthesis && window.speechSynthesis.cancel();
    setSpeaking(false);
  }

  function speakText(text, onDone) {
    if (!window.speechSynthesis || !text) {
      if (flowActive.current && onDone) setTimeout(onDone, 300);
      return;
    }
    stopTTS();
    setSpeaking(true);
    var done = false;
    function finish() {
      if (done) return; done = true;
      setSpeaking(false);
      if (flowActive.current && onDone) setTimeout(onDone, 500);
    }
    var utt = new SpeechSynthesisUtterance(text);
    utt.rate = 0.9; utt.lang = 'en-US';
    var fallback = setTimeout(finish, (text.length * 80) + 3000);
    utt.onend  = function() { clearTimeout(fallback); finish(); };
    utt.onerror= function() { clearTimeout(fallback); finish(); };
    synthRef.current.speak(utt);
  }

  // ── Groq Whisper recording ───────────────────────────────────────
  async function startRecording() {
    stopWhisper();
    liveTextRef.current = '';
    setLiveText('');
    setRecording(true);
    recordingRef.current = true;
    whisperRunning.current = true;

    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStream.current = stream;
      runWhisperLoop(stream);
    } catch(e) {
      setRecording(false); recordingRef.current = false; whisperRunning.current = false;
      store.addToast('Mic access denied — allow microphone to capture your answer', 'error');
    }
  }

  function runWhisperLoop(stream) {
    if (!whisperRunning.current) return;
    audioChunks.current = [];

    var mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
                 : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
                 : MediaRecorder.isTypeSupported('audio/ogg')  ? 'audio/ogg' : 'audio/mp4';

    var mr = new MediaRecorder(stream, { mimeType: mimeType });
    mediaRecRef.current = mr;

    mr.ondataavailable = function(e) {
      if (e.data && e.data.size > 0) audioChunks.current.push(e.data);
    };

    mr.onstop = async function() {
      if (!whisperRunning.current) return;
      var blob = new Blob(audioChunks.current, { type: mimeType });
      if (blob.size < 3000) { runWhisperLoop(stream); return; } // skip silence

      try {
        var reader = new FileReader();
        reader.onload = async function() {
          var base64 = reader.result.split(',')[1];
          try {
            var token = localStorage.getItem('examai_token') || '';
            var resp = await fetch(API + '/ai/transcribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
              body: JSON.stringify({ audio: base64, mimeType: mimeType })
            });
            var data = await resp.json();
            var text = (data.text || '').trim();
            if (text && recordingRef.current) {
              liveTextRef.current += text + ' ';
              setLiveText(liveTextRef.current.trim());
              clearTimeout(silenceTimer.current);
              // Auto-grade after 5s of silence (no new chunk)
              silenceTimer.current = setTimeout(function() {
                if (recordingRef.current && flowActive.current) stopAndGrade();
              }, 5000);
            }
          } catch(err) { console.warn('[Whisper] error:', err); }
          if (whisperRunning.current) runWhisperLoop(stream);
        };
        reader.readAsDataURL(blob);
      } catch(e) {
        if (whisperRunning.current) runWhisperLoop(stream);
      }
    };

    mr.start();
    // Record in 6-second chunks
    whisperTimer.current = setTimeout(function() {
      if (mr.state === 'recording') mr.stop();
    }, 6000);
  }

  function stopWhisper() {
    whisperRunning.current = false;
    recordingRef.current = false;
    clearTimeout(silenceTimer.current);
    clearTimeout(whisperTimer.current);
    setRecording(false);
    if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') {
      try { mediaRecRef.current.stop(); } catch(e) {}
    }
    mediaRecRef.current = null;
    if (micStream.current) {
      micStream.current.getTracks().forEach(function(t) { t.stop(); });
      micStream.current = null;
    }
  }

  // ── Grade answer ─────────────────────────────────────────────────
  async function stopAndGrade() {
    stopWhisper();
    var answer = liveTextRef.current.trim();
    var qi = qIndexRef.current;
    var qs = questionsRef.current;
    if (!qs[qi]) return;

    setGrading(true); setVerdict(null);
    var q = qs[qi];
    var v = null;
    try {
      var sys = 'You are an experienced oral viva examiner. Grade spoken student answers fairly. Judge whether the student understands the CONCEPT. A short clear answer showing understanding scores well. Return ONLY valid JSON.';
      var usr = 'Question: ' + q.question +
        '\nModel Answer: ' + q.model_answer +
        '\nStudent Answer: ' + (answer || '(no answer)') +
        '\nReturn: {"correct":true/false,"score_pct":0-100,"verdict":"Correct/Partially Correct/Incorrect","feedback":"2-3 sentences explaining what was good and what was missing","missing":"key concept they missed, or None"}';
      var raw = await groqChat(sys, usr, 400, 0.3);
      v = parseJSON(raw);
      setVerdict(v);
    } catch(e) {
      v = { correct: false, score_pct: 0, verdict: 'Error', feedback: 'Grading failed — please try again', missing: '' };
      setVerdict(v);
    }
    setGrading(false);

    var entry = { question: q.question, model_answer: q.model_answer, student_said: answer, verdict: v };
    var newT = transcriptRef.current.concat([entry]);
    transcriptRef.current = newT;
    setTranscript(newT);

    var isLast = qi >= qs.length - 1;
    var feedbackText = (v && v.verdict ? v.verdict + '. ' : '') + (v && v.feedback ? v.feedback : '');

    if (isLast) {
      flowActive.current = false;
      speakText(feedbackText, null);
      endSession(newT);
    } else {
      speakText(feedbackText, function() {
        if (!flowActive.current) return;
        var nextIdx = qi + 1;
        qIndexRef.current = nextIdx;
        setQIndex(nextIdx);
        setLiveText(''); liveTextRef.current = '';
        setVerdict(null);
        speakText(qs[nextIdx].question, function() {
          if (flowActive.current) startRecording();
        });
      });
    }
  }

  function handleNext() {
    stopWhisper();
    stopTTS();
    var qi = qIndexRef.current;
    var qs = questionsRef.current;
    var answer = liveTextRef.current.trim();
    var entry = { question: qs[qi].question, model_answer: qs[qi].model_answer, student_said: answer, verdict: verdict };
    var newT = transcriptRef.current.concat([entry]);
    transcriptRef.current = newT;
    setTranscript(newT);
    var isLast = qi >= qs.length - 1;
    if (isLast) { flowActive.current = false; endSession(newT); return; }
    var nextIdx = qi + 1;
    qIndexRef.current = nextIdx;
    setQIndex(nextIdx);
    setLiveText(''); liveTextRef.current = '';
    setVerdict(null);
    speakText(qs[nextIdx].question, function() {
      if (flowActive.current) startRecording();
    });
  }

  // ── Generate questions ───────────────────────────────────────────
  async function handleStart() {
    if (!topic.trim()) { store.addToast('Enter a topic first', 'error'); return; }
    setLoading(true);
    try {
      var seed = Math.floor(Math.random() * 9999);
      var usedKey = 'dexam_viva_used_' + topic.toLowerCase().replace(/[^a-z0-9]/g,'_').slice(0,30);
      var usedQs = []; try { usedQs = JSON.parse(localStorage.getItem(usedKey) || '[]'); } catch(e) {}
      var excludePart = usedQs.length > 0 ? ' AVOID these used questions: ' + usedQs.slice(-8).join(' | ') : '';
      var contextPart = topicInfo.trim() ? ' Context: ' + topicInfo.slice(0, 600) : '';
      var sys = 'You are a viva examiner. Return ONLY valid JSON array, no extra text.';
      var usr = 'Generate ' + numQ + ' unique oral viva questions on "' + topic + '".' + contextPart + excludePart +
        ' Mix conceptual, applied, and analytical. Seed: ' + seed +
        '. Return: [{"question":"?","model_answer":"2-4 sentence answer","hint":"1 key point"}]';
      var raw = await groqChat(sys, usr, 2000, 0.75);
      var qs = parseJSON(raw);
      if (!Array.isArray(qs) || qs.length === 0) throw new Error('No questions returned');
      qs = qs.map(function(q) { return {
        question:     q.question || q.question_text || q.q || 'Question unavailable',
        model_answer: q.model_answer || q.answer || '',
        hint:         q.hint || q.tip || ''
      }; });
      // Save used
      try {
        var prev = JSON.parse(localStorage.getItem(usedKey) || '[]');
        localStorage.setItem(usedKey, JSON.stringify(prev.concat(qs.map(function(q){ return q.question.slice(0,80); })).slice(-50)));
      } catch(e) {}

      setQuestions(qs); setQIndex(0); setTranscript([]); setVerdict(null); setLiveText('');
      questionsRef.current = qs; qIndexRef.current = 0; transcriptRef.current = []; liveTextRef.current = '';
      flowActive.current = true;
      setPhase('practice');
      saveVP({ phase: 'practice', topic, topicInfo, numQ, questions: qs, qIndex: 0, transcript: [], results: null });
      // Speak first question then start recording
      speakText(qs[0].question, function() {
        if (flowActive.current) startRecording();
      });
    } catch(e) { store.addToast('Failed to generate: ' + e.message, 'error'); }
    setLoading(false);
  }

  // ── End session & analyze ────────────────────────────────────────
  async function endSession(finalTranscript) {
    flowActive.current = false;
    recordingRef.current = false;
    stopWhisper();
    stopTTS();
    setPhase('results');
    setAnalyzing(true);

    var tData = finalTranscript || transcript;
    var answered = tData.filter(function(e){ return e.student_said && e.student_said.trim(); }).length;
    var correct  = tData.filter(function(e){ return e.verdict && e.verdict.correct; }).length;
    var total    = tData.length;
    var avgPct   = total > 0 ? Math.round(tData.reduce(function(a,e){ return a + (e.verdict ? (e.verdict.score_pct||0) : 0); }, 0) / total) : 0;
    var grade    = avgPct>=90?'A+':avgPct>=80?'A':avgPct>=70?'B':avgPct>=60?'C':avgPct>=50?'D':'F';

    if (answered === 0 || total === 0) {
      var noAns = {
        overall_feedback: 'No answers were recorded. Check microphone permissions and try again.',
        strong_topics: [], weak_topics: [],
        improvement_tips: ['Allow microphone access in browser settings', 'Use Chrome or Edge for best results', 'Speak clearly after each question finishes'],
        predicted_exam_readiness: 'Not Ready'
      };
      setResults({ grade: 'F', avgPct: 0, correct: 0, total: total, analysis: noAns, transcript: tData });
      saveLocal(topic, total, 0, 0, 'F', noAns);
      setAnalyzing(false); return;
    }

    try {
      var sys2 = 'You are a strict viva examiner. Analyze only what student actually said. Return ONLY valid JSON.';
      var log = tData.map(function(e, i) {
        return 'Q'+(i+1)+': '+e.question+' | Answer: '+(e.student_said && e.student_said.trim() ? e.student_said : 'NO ANSWER')+' | Verdict: '+(e.verdict ? e.verdict.verdict : 'Ungraded');
      }).join('\n');
      var usr2 = 'Topic: "' + topic + '". ' + answered + '/' + total + ' answered.\n\n' + log +
        '\n\nBe strictly honest. Return: {"overall_feedback":"3-4 sentence assessment","strong_topics":["topic where correct — empty if none"],"weak_topics":["topics with wrong/no answers"],"improvement_tips":["tip1","tip2","tip3"],"predicted_exam_readiness":"Not Ready|Almost Ready|Ready"}';
      var raw2 = await groqChat(sys2, usr2, 600, 0.2);
      var analysis = parseJSON(raw2);
      if (correct === 0 && analysis && analysis.strong_topics) analysis.strong_topics = [];
      var r = { grade, avgPct, correct, total, analysis, transcript: tData };
      setResults(r);
      saveLocal(topic, total, correct, avgPct, grade, analysis);
    } catch(e) {
      var wrong = tData.filter(function(e){ return e.verdict && !e.verdict.correct; });
      var right  = tData.filter(function(e){ return e.verdict && e.verdict.correct; });
      var fb = {
        overall_feedback: 'Session done — ' + correct + '/' + total + ' correct (' + avgPct + '%)',
        strong_topics: right.slice(0,3).map(function(e){ return e.question.slice(0,50); }),
        weak_topics:   wrong.slice(0,3).map(function(e){ return e.question.slice(0,50); }),
        improvement_tips: ['Review incorrect answers', 'Practice weak topics', 'Focus on clear concept explanation'],
        predicted_exam_readiness: avgPct >= 70 ? 'Almost Ready' : 'Not Ready'
      };
      setResults({ grade, avgPct, correct, total, analysis: fb, transcript: tData });
      saveLocal(topic, total, correct, avgPct, grade, fb);
    }
    setAnalyzing(false);
  }

  function saveLocal(subj, total, correct, avgPct, grade, analysis) {
    try {
      var prev = JSON.parse(localStorage.getItem('practice_results') || '[]');
      prev.unshift({ id: Date.now(), mode: 'viva', subject: subj, total_questions: total, correct, score_pct: avgPct, grade, date: new Date().toISOString(), analysis });
      localStorage.setItem('practice_results', JSON.stringify(prev.slice(0, 50)));
    } catch(e) {}
  }

  function resetAll() {
    flowActive.current = false;
    stopWhisper(); stopTTS(); clearVP();
    setPhaseRaw('setup'); setTopic(''); setTopicInfo(''); setQuestions([]); setQIndex(0);
    setTranscript([]); setVerdict(null); setLiveText(''); setResults(null);
    liveTextRef.current = ''; qIndexRef.current = 0; transcriptRef.current = []; questionsRef.current = [];
  }

  var gc = function(g) { return g==='A+'||g==='A'?'#16a34a':g==='F'?'#dc2626':g==='B'?'#2563eb':'#d97706'; };
  var gb = function(g) { return g==='A+'||g==='A'?'#dcfce7':g==='F'?'#fee2e2':g==='B'?'#dbeafe':'#fef3c7'; };

  // ── SETUP ────────────────────────────────────────────────────────
  if (phase === 'setup') return (
    <div className="fade-up">
      <div className="page-header">
        <div><div className="page-title">🎙 Viva Practice</div></div>
      </div>
      <div style={{ maxWidth: 600 }}>
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 16 }}>Session Setup</div>

          <div className="form-group">
            <label className="form-label">Topic *</label>
            <input className="form-input" value={topic} onChange={function(e){ setTopic(e.target.value); }}
              placeholder="e.g. Database Normalization, Binary Trees, OS Scheduling…"/>
          </div>

          <div className="form-group">
            <label className="form-label">Topic Notes / Syllabus (optional)</label>
            <textarea className="form-textarea" value={topicInfo} onChange={function(e){ setTopicInfo(e.target.value); }} rows={4}
              placeholder="Paste your notes, syllabus, or key concepts here…"/>
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text2)' }}>
                📄 Upload PDF/Text
                <input type="file" accept=".pdf,.txt" style={{ display: 'none' }} onChange={function(e) {
                  var file = e.target.files[0]; if (!file) return;
                  var reader = new FileReader();
                  reader.onload = function(ev) { setTopicInfo(function(prev) { return (prev ? prev + '\n' : '') + ev.target.result.slice(0, 3000); }); };
                  reader.readAsText(file); e.target.value = '';
                }}/>
              </label>
              <span style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>or paste text above</span>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Number of Questions</label>
            <div style={{ display: 'flex', gap: 10 }}>
              {[3, 5, 7, 10].map(function(n) {
                return (
                  <button key={n} onClick={function(){ setNumQ(n); }}
                    style={{ flex: 1, padding: '10px', borderRadius: 9, border: '1.5px solid ' + (numQ===n?'var(--accent)':'var(--border)'), background: numQ===n?'var(--accent-glow)':'var(--surface)', color: numQ===n?'var(--accent)':'var(--text2)', fontWeight: 700, cursor: 'pointer' }}>
                    {n}
                  </button>
                );
              })}
            </div>
          </div>

          <button className="btn btn-primary btn-lg" onClick={handleStart} disabled={loading || !topic.trim()}
            style={{ width: '100%', justifyContent: 'center', marginBottom: 8 }}>
            {loading ? <><div className="spinner" style={{width:18,height:18}}></div> Generating Questions…</> : '🚀 Start Viva Practice'}
          </button>
          <div style={{ fontSize: '0.75rem', color: 'var(--text3)', textAlign: 'center' }}>
            🎤 Powered by Groq Whisper — questions read aloud, your voice captured and graded by AI
          </div>
        </div>
      </div>
    </div>
  );

  // ── PRACTICE ─────────────────────────────────────────────────────
  if (phase === 'practice') {
    var q = questions[qIndex];
    var answered = transcript.length;
    return (
      <div className="fade-up">
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, padding: '14px 18px', background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontWeight: 700 }}>🎙 {topic}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>Q{qIndex+1} of {questions.length} · {answered} answered</div>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 5 }}>
              {questions.map(function(_, i) {
                var t = transcript[i];
                var bg = t ? (t.verdict && t.verdict.correct ? '#16a34a' : '#dc2626') : i === qIndex ? 'var(--accent)' : 'var(--border)';
                return <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: bg }}/>;
              })}
            </div>
            <button className="btn btn-danger btn-sm" onClick={function(){ if(window.confirm('End session?')) endSession(transcript); }}>⏹ End</button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Question */}
          <div className="card" style={{ borderLeft: '4px solid var(--accent)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <span className="badge badge-primary">Question {qIndex+1}</span>
              <button className="btn btn-ghost btn-sm" onClick={function(){ speakText(q.question); }} disabled={speaking}>
                {speaking ? '🔊 Speaking…' : '🔊 Read Aloud'}
              </button>
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, lineHeight: 1.55 }}>{q.question}</div>
            {q.hint && (
              <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--accent-glow)', borderRadius: 7, fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 500 }}>
                💡 Hint: {q.hint}
              </div>
            )}
          </div>

          {/* Answer area */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                {speaking  && <><span style={{ width:8,height:8,borderRadius:'50%',background:'#7c3aed',display:'inline-block',animation:'pulse 1s infinite' }}/> 🔊 AI Speaking…</>}
                {recording && !grading && <><span style={{ width:8,height:8,borderRadius:'50%',background:'#dc2626',display:'inline-block',animation:'pulse 1s infinite' }}/> 🎤 Recording via Whisper…</>}
                {grading   && <><div className="spinner" style={{width:12,height:12,display:'inline-block'}}/> ⚡ Grading…</>}
                {!speaking && !recording && !grading && verdict && <>✅ Graded</>}
                {!speaking && !recording && !grading && !verdict && <>📝 Your Answer</>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {!recording && !speaking && !grading && !verdict && (
                  <button className="btn btn-primary btn-sm" onClick={function(){ flowActive.current = true; startRecording(); }}>🎤 Start</button>
                )}
                {recording && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-warning btn-sm" onClick={function(){ stopAndGrade(); }}>✋ Grade Now</button>
                    <button className="btn btn-outline btn-sm" onClick={function(){
                      flowActive.current = false;
                      stopWhisper(); stopTTS();
                    }}>⏸ Pause</button>
                  </div>
                )}
                {verdict && !grading && !speaking && (
                  <button className="btn btn-success btn-sm" onClick={handleNext}>Next →</button>
                )}
              </div>
            </div>

            <div style={{ minHeight: 100, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8, border: '1.5px solid ' + (recording ? '#dc2626' : speaking ? '#7c3aed' : 'var(--border)'), fontSize: '0.95rem', lineHeight: 1.65, transition: 'border-color .2s' }}>
              {liveText || <span style={{ color: 'var(--text3)', fontStyle: 'italic' }}>
                {speaking ? 'Listen to the question…' : recording ? 'Speak now — Groq Whisper is capturing your voice…' : 'Your answer appears here'}
              </span>}
            </div>

            {/* Manual type fallback */}
            {!recording && !speaking && !grading && !flowActive.current && (
              <div style={{ marginTop: 8 }}>
                <textarea className="form-textarea" rows={2} value={liveText}
                  onChange={function(e){ setLiveText(e.target.value); liveTextRef.current = e.target.value; }}
                  placeholder="Or type your answer here…" style={{ fontSize: '0.88rem' }}/>
                {liveText.trim() && !verdict && (
                  <button className="btn btn-warning btn-sm" style={{ marginTop: 6 }}
                    onClick={function(){ stopAndGrade(); }} disabled={grading}>⚡ Submit Answer</button>
                )}
              </div>
            )}
          </div>

          {/* Verdict */}
          {verdict && (
            <div className="card" style={{ borderLeft: '4px solid ' + (verdict.correct ? '#16a34a' : verdict.verdict === 'Partially Correct' ? '#d97706' : '#dc2626') }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: '1.3rem' }}>{verdict.correct ? '✅' : verdict.verdict === 'Partially Correct' ? '⚠️' : '❌'}</span>
                <span style={{ fontWeight: 700, color: verdict.correct ? '#16a34a' : verdict.verdict === 'Partially Correct' ? '#d97706' : '#dc2626' }}>{verdict.verdict}</span>
                <span className="badge badge-info" style={{ marginLeft: 'auto' }}>{verdict.score_pct}%</span>
              </div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text2)', lineHeight: 1.6, marginBottom: 8 }}>{verdict.feedback}</div>
              {verdict.missing && verdict.missing !== 'None' && (
                <div style={{ fontSize: '0.82rem', color: 'var(--warning)', padding: '6px 10px', background: 'rgba(217,119,6,0.08)', borderRadius: 6, marginBottom: 8 }}>
                  ⚠️ Missing: {verdict.missing}
                </div>
              )}
              <div style={{ padding: '10px 12px', background: 'var(--surface2)', borderRadius: 7 }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text3)', fontWeight: 600, marginBottom: 5 }}>MODEL ANSWER</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text2)', lineHeight: 1.6 }}>{q.model_answer}</div>
              </div>
              <button className="btn btn-success" style={{ marginTop: 12, width: '100%', justifyContent: 'center' }} onClick={handleNext}>
                {qIndex < questions.length - 1 ? 'Next Question →' : '🏁 Finish & See Results'}
              </button>
            </div>
          )}

          {/* Sidebar */}
          <div className="card">
            <div style={{ fontWeight: 600, marginBottom: 12, fontSize: '0.9rem' }}>📋 Progress ({answered}/{questions.length})</div>
            {transcript.length === 0
              ? <div style={{ fontSize: '0.85rem', color: 'var(--text3)', textAlign: 'center', padding: '20px 0' }}>Answer each question to see progress</div>
              : transcript.map(function(t, i) {
                var v = t.verdict;
                return (
                  <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text3)' }}>Q{i+1}</span>
                      {v && <span style={{ fontSize: '0.78rem', fontWeight: 700, color: v.correct ? '#16a34a' : v.verdict === 'Partially Correct' ? '#d97706' : '#dc2626' }}>{v.score_pct}%</span>}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text2)', marginBottom: 3 }}>{t.question.slice(0, 50)}…</div>
                    {v && <span className={'badge badge-' + (v.correct ? 'success' : v.verdict === 'Partially Correct' ? 'warning' : 'danger')} style={{ fontSize: '0.65rem' }}>{v.verdict}</span>}
                  </div>
                );
              })
            }
            {transcript.length > 0 && (
              <button className="btn btn-outline btn-sm" style={{ width: '100%', marginTop: 12, justifyContent: 'center' }}
                onClick={function(){ endSession(transcript); }}>
                ⏹ End & Get Results
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── RESULTS ──────────────────────────────────────────────────────
  var finalCorrect = (results && results.correct) || 0;
  var finalTotal   = (results && results.total)   || 0;
  var finalGrade   = (results && results.grade)   || 'F';
  var finalPct     = (results && results.avgPct)  || 0;
  var analysis     = results && results.analysis;

  return (
    <div className="fade-up">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button className="btn btn-ghost" onClick={resetAll}>← New Session</button>
        <div className="page-title">🎙 Viva Results</div>
        <div style={{ marginLeft: 'auto', fontSize: '0.85rem', color: 'var(--text3)', background: 'var(--accent-glow)', padding: '4px 12px', borderRadius: 20 }}>Topic: {topic}</div>
      </div>

      <div className="card" style={{ marginBottom: 20, background: gb(finalGrade), borderLeft: '4px solid ' + gc(finalGrade) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', fontWeight: 900, color: gc(finalGrade), lineHeight: 1 }}>{finalGrade}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>GRADE</div>
          </div>
          <div>
            <div style={{ fontSize: '2.5rem', fontWeight: 800, color: gc(finalGrade), lineHeight: 1 }}>{finalPct}%</div>
            <div style={{ fontSize: '0.9rem', color: 'var(--text2)', marginTop: 4 }}>{finalCorrect}/{finalTotal} correct</div>
          </div>
          <div style={{ flex: 1, maxWidth: 300 }}>
            <div className="progress-bar"><div className="progress-fill" style={{ width: finalPct + '%', background: gc(finalGrade) }}></div></div>
          </div>
        </div>
      </div>

      {analyzing ? (
        <div className="loading-center"><div className="spinner"></div><span>Generating analysis…</span></div>
      ) : analysis && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title" style={{ marginBottom: 14 }}>📊 AI Analysis</div>
          {analysis.overall_feedback && (
            <div style={{ padding: '12px 14px', background: 'var(--surface2)', borderRadius: 8, marginBottom: 16, fontSize: '0.9rem', color: 'var(--text2)', lineHeight: 1.7 }}>
              {analysis.overall_feedback}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div style={{ background: 'rgba(22,163,74,.06)', borderRadius: 10, padding: '12px 14px', border: '1px solid rgba(22,163,74,.2)' }}>
              <div style={{ fontWeight: 700, color: '#16a34a', marginBottom: 10, fontSize: '0.85rem' }}>💪 Strengths</div>
              {(analysis.strong_topics || []).length === 0
                ? <div style={{ color: 'var(--text3)', fontSize: '0.82rem' }}>Keep practicing to build strengths</div>
                : (analysis.strong_topics || []).map(function(t, i) { return (
                  <div key={i} style={{ fontSize: '0.85rem', padding: '4px 0', color: 'var(--text)' }}>✅ {t}</div>
                ); })
              }
            </div>
            <div style={{ background: 'rgba(220,38,38,.06)', borderRadius: 10, padding: '12px 14px', border: '1px solid rgba(220,38,38,.2)' }}>
              <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: 10, fontSize: '0.85rem' }}>📌 Needs Work</div>
              {(analysis.weak_topics || []).length === 0
                ? <div style={{ color: 'var(--text3)', fontSize: '0.82rem' }}>No major gaps — great job!</div>
                : (analysis.weak_topics || []).map(function(t, i) { return (
                  <div key={i} style={{ fontSize: '0.85rem', padding: '4px 0', color: 'var(--text)' }}>⚠️ {t}</div>
                ); })
              }
            </div>
          </div>
          {(analysis.improvement_tips || []).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 8, fontSize: '0.85rem' }}>📈 Tips</div>
              {analysis.improvement_tips.map(function(t, i) { return <div key={i} style={{ fontSize: '0.85rem', padding: '4px 0', color: 'var(--text2)' }}>{i+1}. {t}</div>; })}
            </div>
          )}
          {analysis.predicted_exam_readiness && (
            <div style={{ padding: '10px 14px', background: 'var(--accent-glow)', borderRadius: 8, fontWeight: 700, color: 'var(--accent)' }}>
              🎯 Exam Readiness: {analysis.predicted_exam_readiness}
            </div>
          )}
          <YouTubeResources weaknesses={analysis.weak_topics} subject={topic} />
        </div>
      )}

      <div className="card">
        <div className="card-title" style={{ marginBottom: 16 }}>📋 Answer Breakdown</div>
        {(results && results.transcript || []).map(function(t, i) {
          var v = t.verdict;
          var col = v ? (v.correct ? '#16a34a' : v.verdict === 'Partially Correct' ? '#d97706' : '#dc2626') : '#9ca3af';
          return (
            <div key={i} style={{ padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', gap: 10, marginBottom: 6, alignItems: 'flex-start' }}>
                <span style={{ fontWeight: 700, color: 'var(--text3)', fontSize: '0.82rem', flexShrink: 0 }}>Q{i+1}</span>
                <div style={{ fontWeight: 600, fontSize: '0.92rem', flex: 1 }}>{t.question}</div>
                {v && <span style={{ fontWeight: 700, color: col, fontSize: '0.85rem', flexShrink: 0 }}>{v.score_pct}%</span>}
              </div>
              {t.student_said && (
                <div style={{ marginLeft: 28, fontSize: '0.85rem', color: 'var(--text2)', marginBottom: 6, padding: '6px 10px', background: 'var(--surface2)', borderRadius: 6 }}>
                  <strong>You said:</strong> {t.student_said}
                </div>
              )}
              {v && v.feedback && (
                <div style={{ marginLeft: 28, fontSize: '0.82rem', color: col, fontWeight: 500 }}>{v.feedback}</div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button className="btn btn-primary btn-lg" onClick={resetAll}>🔄 Practice Again</button>
      </div>
    </div>
  );
}
