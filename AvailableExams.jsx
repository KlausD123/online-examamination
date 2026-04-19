import React, { useState, useEffect } from 'react';
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

  useEffect(function() { loadData(); }, []); // eslint-disable-line

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

  async function handleStartExam(exam) {
    setError('');
    if (exam.question_count === 0) { setError('This exam has no questions yet'); return; }
    var now = new Date();
    if (exam.scheduled_at && new Date(exam.scheduled_at) > now) { setError('Exam has not started yet'); return; }
    if (exam.end_at && new Date(exam.end_at) < now) { setError('Exam has expired'); return; }
    try {
      var r = await store.startExam(exam.exam_id);
      setActiveExam(exam);
      setActiveSubmission(r.submission_id);
      store.setExamLocked(true);
    } catch (e) { setError(e.message); }
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

  if (loading) return <div className="loading-center"><div className="spinner"></div></div>;

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
