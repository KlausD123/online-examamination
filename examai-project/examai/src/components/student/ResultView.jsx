import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { analyzeExamResult } from '../../utils/aiService';
import { getGradeColor } from '../../utils/helpers';

export default function ResultView({ submission, onBack }) {
  var store = useStore();
  var [questions, setQuestions] = useState([]);
  var [answers, setAnswers] = useState([]);
  var [result, setResult] = useState(null);
  var [loading, setLoading] = useState(true);
  var [tab, setTab] = useState('analytics');
  var [analysis, setAnalysis] = useState(null);
  var [analyzing, setAnalyzing] = useState(false);

  useEffect(function() {
    Promise.all([
      store.loadQuestions(submission.exam_id),
      store.loadAnswers(submission.submission_id)
    ]).then(function(r) {
      setQuestions(r[0]); setAnswers(r[1]); setLoading(false);
      // Auto-generate AI analytics immediately after data loads
      autoAnalyze(r[0], r[1]);
    }).catch(function() { setLoading(false); });
    setResult({ total_score: submission.total_score, grade: submission.grade, cheating_detected: submission.cheating_detected, total_marks: submission.total_marks });
  }, []); // eslint-disable-line

  async function autoAnalyze(qs, ans) {
    if (!qs || qs.length === 0) return;
    setAnalyzing(true);
    try {
      var a = await analyzeExamResult(qs, ans);
      setAnalysis(a);
    } catch (e) { /* silent fail — user can retry */ }
    setAnalyzing(false);
  }

  async function runAnalysis() {
    setAnalyzing(true);
    try {
      var a = await analyzeExamResult(questions, answers);
      setAnalysis(a);
    } catch (e) { alert('Analysis failed: ' + e.message); }
    setAnalyzing(false);
  }

  if (loading) return <div className="loading-center"><div className="spinner"></div></div>;

  var scorePct = result ? Math.round((result.total_score / result.total_marks) * 100) : 0;
  var correctCount = 0;
  questions.forEach(function(q) {
    var a = answers.find(function(ans) { return ans.question_id === q.question_id; });
    if (a && a.answer_text === q.correct_answer) correctCount++;
  });

  var circumference = 2 * Math.PI * 65;
  var offset = circumference - (scorePct / 100) * circumference;

  return (
    <div className="fade-up">
      <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 16 }}>← Back to Exams</button>

      {result && result.cheating_detected === 1 && (
        <div style={{ padding: 16, background: 'rgba(220,38,38,0.08)', border: '2px solid rgba(220,38,38,0.2)', borderRadius: 12, marginBottom: 20, textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: 4 }}>🚫</div>
          <div style={{ fontWeight: 700, color: 'var(--danger)', fontSize: '1.1rem' }}>Academic Integrity Violation</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text3)', marginTop: 4 }}>Exam terminated due to tab switching</div>
        </div>
      )}

      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div className="score-ring-container">
          <div className="score-ring">
            <svg width="160" height="160">
              <circle cx="80" cy="80" r="65" fill="none" stroke="var(--border)" strokeWidth="10" />
              <circle cx="80" cy="80" r="65" fill="none" stroke={getGradeColor(result ? result.grade : 'F')} strokeWidth="10" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1s ease' }} />
            </svg>
            <div className="score-ring-text">
              <div className="score-ring-value">{scorePct}%</div>
              <div className="score-ring-label">Score</div>
            </div>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: getGradeColor(result ? result.grade : 'F') }}>Grade {result ? result.grade : '-'}</div>
        </div>
        <div style={{ display: 'flex', gap: 32, justifyContent: 'center', marginTop: 20 }}>
          <div><div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{result ? result.total_score : 0}/{result ? result.total_marks : 0}</div><div style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>Marks</div></div>
          <div><div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{correctCount}/{questions.length}</div><div style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>Correct</div></div>
          <div><div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{questions.length}</div><div style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>Questions</div></div>
        </div>
      </div>

      <div className="tabs">
        <button className={'tab-btn' + (tab === 'review' ? ' active' : '')} onClick={function() { setTab('review'); }}>📝 Detailed Review</button>
        <button className={'tab-btn' + (tab === 'analytics' ? ' active' : '')} onClick={function() { setTab('analytics'); }}>📊 AI Analytics</button>
      </div>

      {tab === 'review' && (
        <div>
          {questions.map(function(q, i) {
            var a = answers.find(function(ans) { return ans.question_id === q.question_id; });
            var studentAns = a ? a.answer_text : '';
            var isCorrect = studentAns === q.correct_answer;
            return (
              <div key={q.question_id} className="card" style={{ marginBottom: 12, borderLeft: '4px solid ' + (isCorrect ? 'var(--success)' : 'var(--danger)') }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <span className={'badge badge-' + (isCorrect ? 'success' : 'danger')}>{isCorrect ? '✓ Correct' : '✗ Wrong'}</span>
                  <span className="badge badge-info">{q.marks} marks</span>
                  <span className="badge badge-primary">{q.question_type}</span>
                </div>
                <div style={{ fontWeight: 600, marginBottom: 10 }}>Q{i + 1}. {q.question_text}</div>
                {q.options && q.options.length > 0 && (
                  <div style={{ marginLeft: 8 }}>
                    {q.options.map(function(opt, j) {
                      var t = opt.text || opt;
                      var isCor = t === q.correct_answer;
                      var isStu = t === studentAns;
                      var bg = isCor ? 'rgba(22,163,74,0.08)' : isStu && !isCor ? 'rgba(220,38,38,0.08)' : 'transparent';
                      var color = isCor ? 'var(--success)' : isStu && !isCor ? 'var(--danger)' : 'var(--text2)';
                      return <div key={j} style={{ padding: '6px 10px', borderRadius: 6, background: bg, color: color, fontWeight: isCor || isStu ? 600 : 400, marginBottom: 4, fontSize: '0.9rem' }}>
                        {String.fromCharCode(65 + j)}) {t} {isCor ? ' ✓' : ''} {isStu && !isCor ? ' ← your answer' : ''}
                      </div>;
                    })}
                  </div>
                )}
                {!q.options && <div style={{ fontSize: '0.85rem', marginTop: 6 }}><span style={{ color: 'var(--text3)' }}>Your answer:</span> {studentAns || <em style={{ color: 'var(--text4)' }}>No answer</em>}</div>}
                {!q.options && q.correct_answer && <div style={{ fontSize: '0.85rem', color: 'var(--success)', marginTop: 4 }}>Correct: {q.correct_answer}</div>}
                {q.explanation && <div style={{ marginTop: 8, padding: 10, background: 'var(--surface3)', borderRadius: 8, fontSize: '0.85rem', color: 'var(--text2)' }}>💡 {q.explanation}</div>}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'analytics' && (
        <div className="card">
          {!analysis ? (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: '2rem', marginBottom: 12 }}>🤖</div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>AI-Powered Analysis</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text3)', marginBottom: 16 }}>Get personalized insights about your performance</div>
              <button className="btn btn-primary" onClick={runAnalysis} disabled={analyzing}>{analyzing ? '🔄 Analyzing...' : '⚡ Generate Analysis'}</button>
            </div>
          ) : (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                <div style={{ padding: 16, background: 'var(--accent-glow)', borderRadius: 10 }}><div style={{ fontSize: '0.75rem', color: 'var(--text3)', marginBottom: 4 }}>SKILL LEVEL</div><div style={{ fontWeight: 700, color: 'var(--accent)' }}>{analysis.level}</div></div>
                <div style={{ padding: 16, background: 'rgba(22,163,74,0.08)', borderRadius: 10 }}><div style={{ fontSize: '0.75rem', color: 'var(--text3)', marginBottom: 4 }}>EXAM READINESS</div><div style={{ fontWeight: 700, color: 'var(--success)' }}>{analysis.readiness}</div></div>
              </div>
              {analysis.summary && <div style={{ padding: 14, background: 'var(--surface3)', borderRadius: 10, marginBottom: 16, fontSize: '0.9rem' }}>{analysis.summary}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div><div style={{ fontWeight: 700, color: 'var(--success)', marginBottom: 8 }}>💪 Strengths</div>{analysis.strengths && analysis.strengths.map(function(s, i) { return <div key={i} style={{ fontSize: '0.85rem', padding: '4px 0' }}>✅ {s}</div>; })}</div>
                <div><div style={{ fontWeight: 700, color: 'var(--danger)', marginBottom: 8 }}>📌 Areas to Improve</div>{analysis.weaknesses && analysis.weaknesses.map(function(s, i) { return <div key={i} style={{ fontSize: '0.85rem', padding: '4px 0' }}>⚠️ {s}</div>; })}</div>
              </div>
              {analysis.improvements && <div style={{ marginTop: 16 }}><div style={{ fontWeight: 700, marginBottom: 8 }}>📈 Improvement Steps</div>{analysis.improvements.map(function(s, i) { return <div key={i} style={{ fontSize: '0.85rem', padding: '4px 0' }}>{i + 1}. {s}</div>; })}</div>}
              {analysis.focus_topics && <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}><span style={{ fontWeight: 600, fontSize: '0.85rem' }}>🎯 Focus Topics:</span>{analysis.focus_topics.map(function(t, i) { return <span key={i} className="badge badge-warning">{t}</span>; })}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
