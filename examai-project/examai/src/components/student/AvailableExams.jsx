import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { getExamStatus, formatDateTime } from '../../utils/helpers';
import ExamInterface from './ExamInterface';
import ResultView from './ResultView';

export default function AvailableExams({ navigate }) {
  var store = useStore();
  var [exams, setExams] = useState([]);
  var [subs, setSubs] = useState([]);
  var [loading, setLoading] = useState(true);
  var [filter, setFilter] = useState('All');
  var [activeExam, setActiveExam] = useState(null);
  var [activeSubmission, setActiveSubmission] = useState(null);
  var [viewResult, setViewResult] = useState(null);
  var [error, setError] = useState('');

  // Camera/Mic pre-check
  var [checkingExam, setCheckingExam] = useState(null);
  var [permState, setPermState]       = useState('idle'); // idle|checking|granted|denied|no_device
  var [permError, setPermError]       = useState('');
  var previewRef = useRef(null);
  var streamRef  = useRef(null);

  useEffect(function() { loadData(); }, []); // eslint-disable-line

  // Stop preview when leaving check screen
  useEffect(function() {
    if (!checkingExam && streamRef.current) {
      streamRef.current.getTracks().forEach(function(t) { t.stop(); });
      streamRef.current = null;
    }
  }, [checkingExam]);

  function loadData() {
    setLoading(true);
    Promise.all([
      store.loadExams(),
      store.loadSubmissions(store.currentUser.user_id)
    ]).then(function(r) { setExams(r[0]); setSubs(r[1]); setLoading(false); });
  }

  function getStudentStatus(exam) {
    var sub = subs.find(function(s) { return s.exam_id === exam.exam_id; });
    if (!sub) return null;
    if (sub.status === 'cheated') return { label: 'CHEATED', color: 'danger' };
    if (sub.status === 'submitted') return { label: 'COMPLETED', color: 'success' };
    return { label: 'IN PROGRESS', color: 'warning' };
  }

  // Step 1: validate then show camera check
  function handleStartExam(exam) {
    setError('');
    if (exam.question_count === 0) { setError('This exam has no questions yet'); return; }
    var now = new Date();
    if (exam.scheduled_at && new Date(exam.scheduled_at) > now) { setError('Exam has not started yet'); return; }
    if (exam.end_at && new Date(exam.end_at) < now) { setError('Exam has expired'); return; }
    setCheckingExam(exam);
    setPermState('idle');
    setPermError('');
  }

  // Step 2: request camera + mic
  async function requestPermissions() {
    setPermState('checking');
    setPermError('');
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      setPermState('granted');
      var iv = setInterval(function() {
        if (previewRef.current) { previewRef.current.srcObject = stream; clearInterval(iv); }
      }, 100);
    } catch(e) {
      streamRef.current = null;
      if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
        setPermState('no_device');
        setPermError('No camera or microphone found on this device. A working camera and microphone are required to take this exam.');
      } else if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        setPermState('denied');
        setPermError('Camera and microphone access was denied. Please allow access in your browser settings and try again.');
      } else {
        setPermState('denied');
        setPermError('Could not access camera/microphone: ' + e.message);
      }
    }
  }

  // Step 3: confirmed — actually start
  async function confirmAndStartExam() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(function(t) { t.stop(); });
      streamRef.current = null;
    }
    var exam = checkingExam;
    setCheckingExam(null);
    setPermState('idle');
    try {
      var r = await store.startExam(exam.exam_id);
      setActiveExam(exam);
      setActiveSubmission(r.submission_id);
      store.setExamLocked(true);
    } catch(e) { setError(e.message); }
  }

  function handleExamComplete() {
    setActiveExam(null);
    setActiveSubmission(null);
    store.setExamLocked(false);
    loadData();
  }

  if (activeExam && activeSubmission) {
    return React.createElement(ExamInterface, { exam: activeExam, submissionId: activeSubmission, onComplete: handleExamComplete });
  }

  if (viewResult) {
    return React.createElement(ResultView, { submission: viewResult, onBack: function() { setViewResult(null); } });
  }

  // ── Camera/Mic Pre-Check Screen — compact ──────────────────
  if (checkingExam) {
    var granted  = permState === 'granted';
    var checking = permState === 'checking';
    var blocked  = permState === 'denied' || permState === 'no_device';
    return (
      <div className="fade-up" style={{ maxWidth: 480, margin: '32px auto' }}>
        <div className="card" style={{ padding: 24 }}>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 4 }}>
            📷 Camera &amp; Microphone Required
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text3)', marginBottom: 16 }}>
            You cannot start <strong>{checkingExam.title}</strong> without camera and microphone access. Both must stay active throughout the exam.
          </div>

          {/* Compact status row */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {[{ icon: '📷', label: 'Camera' }, { icon: '🎤', label: 'Mic' }].map(function(item) {
              return (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid ' + (granted ? 'var(--success)' : blocked ? 'var(--danger)' : 'var(--border)'), fontSize: '0.82rem', fontWeight: 600, color: granted ? 'var(--success)' : blocked ? 'var(--danger)' : 'var(--text3)' }}>
                  {granted ? '✅' : blocked ? '❌' : item.icon} {item.label} {granted ? 'OK' : blocked ? 'Denied' : ''}
                </div>
              );
            })}
          </div>

          {/* Small live preview once granted */}
          {granted && (
            <div style={{ marginBottom: 14, borderRadius: 8, overflow: 'hidden', background: '#000', lineHeight: 0, border: '1px solid var(--success)' }}>
              <video ref={previewRef} autoPlay muted playsInline style={{ width: '100%', maxHeight: 120, objectFit: 'cover', display: 'block' }}/>
            </div>
          )}

          {/* Error */}
          {permError && (
            <div style={{ padding: '8px 12px', background: 'rgba(220,38,38,0.08)', borderRadius: 8, color: 'var(--danger)', fontSize: '0.8rem', marginBottom: 12 }}>
              {permState === 'no_device' ? '⚠️ No camera/mic detected — connect a device and retry.' : '🚫 ' + permError}
            </div>
          )}

        <div style={{ display: 'flex', gap: 8 }}>
          {!granted && (
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={requestPermissions} disabled={checking}>
              {checking ? <><div className="spinner" style={{ width: 14, height: 14 }}/>&nbsp;Checking…</> : '🔓 Allow Camera & Mic'}
            </button>
          )}
          {granted && (
            <button className="btn btn-success" style={{ flex: 1, justifyContent: 'center' }} onClick={confirmAndStartExam}>
              🚀 Start Exam
            </button>
          )}
          <button className="btn btn-outline" onClick={function() { setCheckingExam(null); setPermState('idle'); setPermError(''); }}>
            Cancel
          </button>
        </div>
        </div>
      </div>
    );
  }

  if (loading) return <div className="loading-center"><div className="spinner"></div></div>;

  var filtered = exams.filter(function(e) {
    if (filter === 'All') return true;
    var st = getExamStatus(e);
    var studentSt = getStudentStatus(e);
    if (filter === 'Open') return st.label === 'LIVE NOW' && !studentSt;
    if (filter === 'Upcoming') return st.label === 'UPCOMING';
    if (filter === 'Expired') return st.label === 'EXPIRED';
    if (filter === 'Completed') return studentSt && (studentSt.label === 'COMPLETED' || studentSt.label === 'CHEATED');
    return true;
  });

  return (
    <div className="fade-up">
      <div className="page-title" style={{ marginBottom: 16 }}>📝 Available Exams</div>
      {error && <div style={{ padding: 12, background: 'rgba(220,38,38,0.08)', borderRadius: 8, color: 'var(--danger)', marginBottom: 16, fontSize: '0.85rem' }}>{error}</div>}
      <div className="filter-pills">
        {['All', 'Open', 'Upcoming', 'Expired', 'Completed'].map(function(f) {
          return <button key={f} className={'pill' + (filter === f ? ' active' : '')} onClick={function() { setFilter(f); }}>{f}</button>;
        })}
      </div>
      {filtered.length === 0 ? <div className="empty-state"><div className="empty-state-icon">📋</div><div className="empty-state-title">No exams found</div></div> : (
        <div className="grid-2">
          {filtered.map(function(exam) {
            var st = getExamStatus(exam);
            var studentSt = getStudentStatus(exam);
            var isCompleted = studentSt && (studentSt.label === 'COMPLETED' || studentSt.label === 'CHEATED');
            var sub = subs.find(function(s) { return s.exam_id === exam.exam_id; });
            return (
              <div key={exam.exam_id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span className={'badge badge-' + st.color}>{st.label}</span>
                  {studentSt && <span className={'badge badge-' + studentSt.color}>{studentSt.label}</span>}
                </div>
                <div className="card-title">{exam.title}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text3)', marginBottom: 12 }}>{exam.description}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  <span className="badge badge-info">⏱ {exam.duration_minutes} min</span>
                  <span className="badge badge-primary">{exam.total_marks} marks</span>
                  <span className="badge badge-info">{exam.question_count} questions</span>
                </div>
                {exam.scheduled_at && <div style={{ fontSize: '0.78rem', color: 'var(--text3)', marginBottom: 8 }}>📅 {formatDateTime(exam.scheduled_at)}</div>}
                {isCompleted ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>Score: {sub.total_score}/{exam.total_marks}</span>
                    <span className={'badge badge-' + (sub.grade === 'A' ? 'success' : sub.grade === 'F' ? 'danger' : 'warning')}>{sub.grade}</span>
                    <button className="btn btn-outline btn-sm" onClick={function() { setViewResult(sub); }}>View Details</button>
                  </div>
                ) : (
                  <button className="btn btn-primary" onClick={function() { handleStartExam(exam); }} disabled={st.label === 'UPCOMING' || st.label === 'EXPIRED'}>
                    {st.label === 'LIVE NOW' ? '🚀 Start Exam' : st.label === 'UPCOMING' ? '⏳ Not Yet' : '🔒 Expired'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
