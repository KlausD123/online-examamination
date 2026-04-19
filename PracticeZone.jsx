import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_KEY   = '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';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

async function groqChat(sys, usr, max, temp) {
  const r = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + GROQ_KEY },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: max || 1000,
      temperature: temp || 0.7,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error((d.error && d.error.message) || ('Groq error ' + r.status));
  return (d.choices[0].message.content || '').trim();
}

async function groqJson(sys, usr, max) {
  const raw = await groqChat(sys, usr, max || 800, 0.75);
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

const SUBJECTS = [
  'Data Structures & Algorithms', 'Operating Systems', 'Database Management (DBMS)',
  'Computer Networks', 'Object-Oriented Programming', 'Software Engineering',
  'Machine Learning', 'Web Development', 'Python Programming', 'C++ Programming',
  'Mathematics', 'Physics', 'Chemistry', 'Biology', 'English Grammar',
  'History', 'Economics', 'Accounting', 'Statistics', 'Digital Electronics',
];
const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

function gradeFrom(pct) {
  if (pct >= 90) return 'A+';
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B';
  if (pct >= 60) return 'C';
  if (pct >= 50) return 'D';
  return 'F';
}

function levelFrom(elo) {
  if (elo >= 2000) return { label: 'Expert',       color: '#dc2626', bg: '#fee2e2' };
  if (elo >= 1600) return { label: 'Advanced',     color: '#d97706', bg: '#fef3c7' };
  if (elo >= 1200) return { label: 'Intermediate', color: '#2563eb', bg: '#dbeafe' };
  if (elo >= 800)  return { label: 'Beginner',     color: '#16a34a', bg: '#dcfce7' };
  return               { label: 'Novice',      color: '#6b7280', bg: '#f3f4f6' };
}

async function genQuestion(subject, difficulty, usedQs) {
  usedQs = usedQs || [];
  const exclude = usedQs.length > 0
    ? ('Do NOT repeat: ' + usedQs.slice(-6).join(' | '))
    : '';
  const sys = 'You are an exam question generator. Return ONLY valid JSON. No markdown, no extra text.';
  const prompt = [
    'Generate 1 unique ' + difficulty + ' MCQ on "' + subject + '".',
    exclude,
    'Return ONLY this exact JSON structure:',
    '{"question":"Question text here?","options":{"A":"option text","B":"option text","C":"option text","D":"option text"},"correct":"A","explanation":"Why A is correct."}',
  ].filter(Boolean).join(' ');
  return groqJson(sys, prompt, 500);
}

async function genBatch(subject, difficulty, count) {
  const sys = 'You are an exam question generator. Return ONLY a valid JSON array. No markdown.';
  const prompt = [
    'Generate ' + count + ' unique ' + difficulty + ' MCQs on "' + subject + '".',
    'Return ONLY a JSON array:',
    '[{"question":"?","options":{"A":"...","B":"...","C":"...","D":"..."},"correct":"A","explanation":"2-3 sentences."}]',
  ].join(' ');
  return groqJson(sys, prompt, 1800);
}

async function genAnalysis(subject, mode, answers, finalElo) {
  const correct = answers.filter(a => a.isCorrect).length;
  const total   = answers.length;
  const pct     = Math.round(correct / total * 100);
  const log = answers.map((a, i) =>
    'Q' + (i+1) + '[' + a.difficulty + ']: ' + a.question.slice(0,60) + ' | Student:' + a.chosen + ' | ' + (a.isCorrect ? 'Correct' : 'Wrong')
  ).join('; ');
  const sys = 'You are an expert academic tutor. Return ONLY valid JSON. No markdown.';
  const prompt = [
    'Analyze MCQ practice. Subject:' + subject + '. Score:' + correct + '/' + total + '(' + pct + '%).',
    'Questions: ' + log,
    'Return: {"grade":"' + gradeFrom(pct) + '","level":"Intermediate","overall_feedback":"3 sentences","strong_topics":["t1"],"weak_topics":["t2"],"improvement_tips":["tip1","tip2","tip3"],"next_steps":"1-2 sentences","predicted_exam_readiness":"Not Ready|Almost Ready|Ready|Exam Ready"}',
  ].join(' ');
  return groqJson(sys, prompt, 700);
}

const gcol = g => g==='A+'||g==='A'?'#16a34a':g==='F'?'#dc2626':g==='B'?'#2563eb':g==='C'?'#d97706':'#6b7280';
const gbg  = g => g==='A+'||g==='A'?'#dcfce7':g==='F'?'#fee2e2':g==='B'?'#dbeafe':g==='C'?'#fef3c7':'#f3f4f6';
const dCol = d => d==='Easy'?'#16a34a':d==='Hard'?'#dc2626':'#d97706';
const dBg  = d => d==='Easy'?'#dcfce7':d==='Hard'?'#fee2e2':'#fef3c7';

export default function PracticeZone() {
  var store = useStore();
  const [screen,      setScreen]      = useState('hub');
  const [subject,     setSubject]     = useState('');
  const [subSearch,   setSubSearch]   = useState('');
  const [difficulty,  setDifficulty]  = useState('Medium');
  const [stdCount,    setStdCount]    = useState(10);
  const [adaptiveMax, setAdaptiveMax] = useState(15);
  const [adaptiveQ,   setAdaptiveQ]   = useState(null);
  const [adaptiveQNum,setAdaptiveQNum]= useState(1);
  const [adaptiveDiff,setAdaptiveDiff]= useState('Medium');
  const [elo,         setElo]         = useState(1000);
  const [adaptiveLog, setAdaptiveLog] = useState([]);
  const [loadingQ,    setLoadingQ]    = useState(false);
  const [selected,    setSelected]    = useState(null);
  const [revealed,    setRevealed]    = useState(false);
  const usedQsRef = useRef([]);
  const [stdQuestions,setStdQuestions]= useState([]);
  const [stdIndex,    setStdIndex]    = useState(0);
  const [stdAnswers,  setStdAnswers]  = useState([]);
  const [stdSelected, setStdSelected] = useState(null);
  const [stdRevealed, setStdRevealed] = useState(false);
  const [loadingBatch,setLoadingBatch]= useState(false);
  const [analysis,    setAnalysis]    = useState(null);
  const [analyzing,   setAnalyzing]   = useState(false);
  const [finalMode,   setFinalMode]   = useState('');
  const [finalAnswers,setFinalAnswers]= useState([]);
  const [finalElo,    setFinalElo]    = useState(1000);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const filteredSubjects = SUBJECTS.filter(s => s.toLowerCase().includes(subSearch.toLowerCase()));

  const updateElo = (correct, diff) => {
    const K = 32;
    const expected = diff === 'Easy' ? 0.7 : diff === 'Medium' ? 0.5 : 0.3;
    return Math.max(400, Math.min(2500, Math.round(elo + K * ((correct ? 1 : 0) - expected))));
  };

  const nextDiff = (currentElo) =>
    currentElo >= 1700 ? 'Hard' : currentElo >= 1100 ? 'Medium' : 'Easy';

  const loadAdaptiveQ = async (diff) => {
    setLoadingQ(true); setSelected(null); setRevealed(false); setAdaptiveQ(null);
    try {
      const q = await genQuestion(subject, diff, usedQsRef.current);
      usedQsRef.current.push(q.question);
      setAdaptiveQ(q); setAdaptiveDiff(diff);
    } catch (e) { store.addToast('Failed to load question: ' + e.message, 'error'); }
    setLoadingQ(false);
  };

  const startAdaptive = async () => {
    if (!subject) { store.addToast('Select a subject first', 'error'); return; }
    setScreen('adaptive');
    setAdaptiveLog([]); setAdaptiveQNum(1); setElo(1000);
    setAdaptiveDiff('Medium'); setSelected(null); setRevealed(false);
    usedQsRef.current = [];
    await loadAdaptiveQ('Medium');
  };

  const submitAdaptive = async () => {
    if (!selected || !adaptiveQ) return;
    const isCorrect = selected === adaptiveQ.correct;
    setRevealed(true);
    const newElo = updateElo(isCorrect, adaptiveDiff);
    const entry = {
      question: adaptiveQ.question, options: adaptiveQ.options,
      correct: adaptiveQ.correct, chosen: selected, isCorrect,
      explanation: adaptiveQ.explanation, difficulty: adaptiveDiff,
      eloAtTime: newElo, qNum: adaptiveQNum,
    };
    const newLog = [...adaptiveLog, entry];
    setAdaptiveLog(newLog); setElo(newElo);
    const isDone = adaptiveQNum >= adaptiveMax;
    timer.current = setTimeout(async () => {
      if (isDone) { endPractice('adaptive', newLog, newElo); }
      else { setAdaptiveQNum(n => n + 1); await loadAdaptiveQ(nextDiff(newElo)); }
    }, 1800);
  };

  const startStandard = async () => {
    if (!subject) { store.addToast('Select a subject first', 'error'); return; }
    setLoadingBatch(true); setScreen('standard');
    setStdIndex(0); setStdAnswers([]); setStdSelected(null); setStdRevealed(false);
    try {
      const qs = await genBatch(subject, difficulty, stdCount);
      setStdQuestions(Array.isArray(qs) ? qs : []);
    } catch (e) { store.addToast('Failed to generate: ' + e.message, 'error'); setScreen('standard-setup'); }
    setLoadingBatch(false);
  };

  const submitStandard = () => {
    if (!stdSelected || !stdQuestions[stdIndex]) return;
    const q = stdQuestions[stdIndex];
    const isCorrect = stdSelected === q.correct;
    setStdRevealed(true);
    const entry = { question:q.question, options:q.options, correct:q.correct, chosen:stdSelected, isCorrect, explanation:q.explanation, difficulty };
    const newAnswers = [...stdAnswers, entry];
    setStdAnswers(newAnswers);
    const isLast = stdIndex >= stdQuestions.length - 1;
    timer.current = setTimeout(() => {
      if (isLast) endPractice('standard', newAnswers, 1000);
      else { setStdIndex(i => i + 1); setStdSelected(null); setStdRevealed(false); }
    }, 1800);
  };

  const endPractice = async (mode, answers, finalEloVal) => {
    setFinalMode(mode); setFinalAnswers(answers); setFinalElo(finalEloVal);
    setScreen('results'); setAnalyzing(true); setAnalysis(null);
    try {
      const a = await genAnalysis(subject, mode, answers, finalEloVal);
      setAnalysis(a);
      const correct = answers.filter(x => x.isCorrect).length;
      const pct     = Math.round(correct / answers.length * 100);
      const record  = {
        id: Date.now(), mode, subject, difficulty: mode === 'adaptive' ? 'Adaptive' : difficulty,
        total_questions: answers.length, correct, score_pct: pct,
        grade: a.grade || gradeFrom(pct), level: a.level || levelFrom(finalEloVal).label,
        elo: finalEloVal, date: new Date().toISOString(), analysis: a,
      };
      const prev = JSON.parse(localStorage.getItem('practice_results') || '[]');
      prev.unshift(record);
      localStorage.setItem('practice_results', JSON.stringify(prev.slice(0, 50)));
    } catch (e) { store.addToast('Analysis failed: ' + e.message, 'error'); }
    setAnalyzing(false);
  };

  // ── Subject Picker (shared) ───────────────────────────────
  const SubjectPicker = ({ color, selBg }) => (
    <div style={{ background:'#fff', border:'1px solid #e8e8f0', borderRadius:14, padding:22, boxShadow:'0 1px 3px rgba(0,0,0,.05)', marginBottom:14 }}>
      <label style={{ display:'block', fontSize:10, fontWeight:700, color, marginBottom:8, textTransform:'uppercase', letterSpacing:1.5, fontFamily:'JetBrains Mono,monospace' }}>SELECT SUBJECT</label>
      <input className="form-input" value={subSearch} onChange={e => setSubSearch(e.target.value)} placeholder="Type to search..." style={{ marginBottom:10 }}/>
      <div style={{ display:'flex', flexWrap:'wrap', gap:7, maxHeight:180, overflowY:'auto' }}>
        {filteredSubjects.map(s => (
          <button key={s} onClick={() => { setSubject(s); setSubSearch(s); }}
            style={{ padding:'6px 14px', borderRadius:20, border:'1.5px solid ' + (subject===s?color:'#e5e7eb'), background:subject===s?selBg:'#fff', color:subject===s?color:'#374151', fontSize:12, fontWeight:subject===s?700:500, cursor:'pointer' }}>
            {s}
          </button>
        ))}
      </div>
      {subject && <div style={{ marginTop:10, padding:'7px 12px', background:selBg, borderRadius:7, fontSize:12, fontWeight:700, color }}>Selected: {subject}</div>}
    </div>
  );

  // ── HUB ──────────────────────────────────────────────────
  if (screen === 'hub') return (
    <div className="fade-up">
      <h1 style={{ fontFamily:'Space Grotesk,sans-serif', fontWeight:800, fontSize:26, color:'#0f0f1a', marginBottom:4 }}>Practice Zone</h1>
      <p style={{ fontSize:13, color:'#6b7280', marginBottom:28, fontFamily:'JetBrains Mono,monospace' }}>Build your skills with AI-generated questions</p>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
        {[
          { icon:'🎯', title:'Adaptive Testing', desc:'Questions adapt to your skill level in real-time using ELO scoring. Gets harder when you are right, easier when you are wrong.', color:'#6d28d9', bg:'#f5f3ff', border:'#ddd6fe', tags:['ELO System','Real-time Adaptation','Skill Detection'], action:() => setScreen('adaptive-setup') },
          { icon:'📝', title:'Standard Practice', desc:'Classic MCQ practice at a fixed difficulty. You choose the subject, difficulty level, and how many questions.', color:'#16a34a', bg:'#f0fdf4', border:'#bbf7d0', tags:['Fixed Difficulty','Your Choice','Full Review'], action:() => setScreen('standard-setup') },
        ].map(card => (
          <div key={card.title} onClick={card.action}
            style={{ background:card.bg, border:'1.5px solid ' + card.border, borderRadius:16, padding:28, cursor:'pointer', transition:'all .2s' }}
            onMouseEnter={e => { e.currentTarget.style.transform='translateY(-3px)'; e.currentTarget.style.boxShadow='0 12px 36px ' + card.color + '22'; }}
            onMouseLeave={e => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=''; }}>
            <div style={{ fontSize:36, marginBottom:14 }}>{card.icon}</div>
            <div style={{ fontFamily:'Space Grotesk,sans-serif', fontWeight:800, fontSize:20, color:card.color, marginBottom:10 }}>{card.title}</div>
            <div style={{ fontSize:13, color:'#374151', lineHeight:1.75, marginBottom:16 }}>{card.desc}</div>
            <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>
              {card.tags.map(t => <span key={t} style={{ padding:'3px 10px', background:card.color + '18', color:card.color, borderRadius:20, fontSize:11, fontWeight:600 }}>{t}</span>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // ── ADAPTIVE SETUP ───────────────────────────────────────
  if (screen === 'adaptive-setup') return (
    <div className="fade-up" style={{ maxWidth:560 }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:22 }}>
        <button onClick={() => setScreen('hub')} style={{ padding:'5px 12px', background:'#fff', border:'1px solid #e5e7eb', borderRadius:7, fontSize:12, fontWeight:600, color:'#374151', cursor:'pointer' }}>Back</button>
        <h2 style={{ fontFamily:'Space Grotesk,sans-serif', fontWeight:800, fontSize:20, color:'#0f0f1a' }}>Adaptive Test Setup</h2>
      </div>
      <SubjectPicker color="#7c3aed" selBg="#ede9fe"/>
      <div style={{ background:'#fff', border:'1px solid #e8e8f0', borderRadius:14, padding:20, marginBottom:16, boxShadow:'0 1px 3px rgba(0,0,0,.05)' }}>
        <label style={{ display:'block', fontSize:10, fontWeight:700, color:'#7c3aed', marginBottom:10, textTransform:'uppercase', letterSpacing:1.5, fontFamily:'JetBrains Mono,monospace' }}>MAX QUESTIONS</label>
        <div style={{ display:'flex', gap:8 }}>
          {[5,10,15,20].map(n => (
            <button key={n} onClick={() => setAdaptiveMax(n)}
              style={{ flex:1, padding:'9px', borderRadius:9, border:'1.5px solid ' + (adaptiveMax===n?'#7c3aed':'#e5e7eb'), background:adaptiveMax===n?'#ede9fe':'#fff', color:adaptiveMax===n?'#6d28d9':'#374151', fontSize:14, fontWeight:700, cursor:'pointer' }}>
              {n}
            </button>
          ))}
        </div>
        <div style={{ marginTop:8, fontSize:11, color:'#9ca3af' }}>Starts at Medium difficulty. ELO begins at 1000 and adjusts per answer.</div>
      </div>
      <button onClick={startAdaptive} disabled={!subject}
        style={{ width:'100%', padding:'13px', background:subject?'linear-gradient(135deg,#6d28d9,#7c3aed)':'#d1d5db', color:'#fff', border:'none', borderRadius:12, fontWeight:800, fontSize:15, cursor:subject?'pointer':'not-allowed', boxShadow:subject?'0 4px 16px rgba(109,40,217,.3)':'' }}>
        Start Adaptive Test
      </button>
    </div>
  );

  // ── STANDARD SETUP ───────────────────────────────────────
  if (screen === 'standard-setup') return (
    <div className="fade-up" style={{ maxWidth:560 }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:22 }}>
        <button onClick={() => setScreen('hub')} style={{ padding:'5px 12px', background:'#fff', border:'1px solid #e5e7eb', borderRadius:7, fontSize:12, fontWeight:600, color:'#374151', cursor:'pointer' }}>Back</button>
        <h2 style={{ fontFamily:'Space Grotesk,sans-serif', fontWeight:800, fontSize:20, color:'#0f0f1a' }}>Standard Practice Setup</h2>
      </div>
      <SubjectPicker color="#16a34a" selBg="#dcfce7"/>
      <div style={{ background:'#fff', border:'1px solid #e8e8f0', borderRadius:14, padding:20, marginBottom:14, boxShadow:'0 1px 3px rgba(0,0,0,.05)' }}>
        <label style={{ display:'block', fontSize:10, fontWeight:700, color:'#16a34a', marginBottom:10, textTransform:'uppercase', letterSpacing:1.5, fontFamily:'JetBrains Mono,monospace' }}>DIFFICULTY</label>
        <div style={{ display:'flex', gap:8 }}>
          {DIFFICULTIES.map(d => (
            <button key={d} onClick={() => setDifficulty(d)}
              style={{ flex:1, padding:'10px', borderRadius:9, border:'1.5px solid ' + (difficulty===d?dCol(d):'#e5e7eb'), background:difficulty===d?dBg(d):'#fff', color:difficulty===d?dCol(d):'#374151', fontSize:13, fontWeight:700, cursor:'pointer' }}>
              {d}
            </button>
          ))}
        </div>
      </div>
      <div style={{ background:'#fff', border:'1px solid #e8e8f0', borderRadius:14, padding:20, marginBottom:16, boxShadow:'0 1px 3px rgba(0,0,0,.05)' }}>
        <label style={{ display:'block', fontSize:10, fontWeight:700, color:'#16a34a', marginBottom:10, textTransform:'uppercase', letterSpacing:1.5, fontFamily:'JetBrains Mono,monospace' }}>NUMBER OF QUESTIONS</label>
        <div style={{ display:'flex', gap:8 }}>
          {[5,10,15,20].map(n => (
            <button key={n} onClick={() => setStdCount(n)}
              style={{ flex:1, padding:'9px', borderRadius:9, border:'1.5px solid ' + (stdCount===n?'#16a34a':'#e5e7eb'), background:stdCount===n?'#dcfce7':'#fff', color:stdCount===n?'#15803d':'#374151', fontSize:14, fontWeight:700, cursor:'pointer' }}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <button onClick={startStandard} disabled={!subject}
        style={{ width:'100%', padding:'13px', background:subject?'linear-gradient(135deg,#16a34a,#15803d)':'#d1d5db', color:'#fff', border:'none', borderRadius:12, fontWeight:800, fontSize:15, cursor:subject?'pointer':'not-allowed', boxShadow:subject?'0 4px 16px rgba(22,163,74,.3)':'' }}>
        Start Standard Practice
      </button>
    </div>
  );

  // ── ADAPTIVE QUESTION ────────────────────────────────────
  if (screen === 'adaptive') {
    const level   = levelFrom(elo);
    const correct = adaptiveLog.filter(a => a.isCorrect).length;
    const eloPct  = Math.min(100, Math.max(0, ((elo - 400) / 2100) * 100));
    const MCQOptions = ({ q, sel, rev, onSelect }) => (
      <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
        {Object.entries(q.options || {}).map(([k, v]) => {
          let bg='#f8f8fc', border='1px solid #e8e8f0', color='#374151', fw=500;
          if (rev) {
            if (k===q.correct) { bg='#dcfce7'; border='1.5px solid #bbf7d0'; color='#16a34a'; fw=700; }
            else if (k===sel && k!==q.correct) { bg='#fee2e2'; border='1.5px solid #fecaca'; color='#dc2626'; fw=700; }
          } else if (k===sel) { bg='#ede9fe'; border='1.5px solid #c4b5fd'; color='#6d28d9'; fw=600; }
          return (
            <button key={k} onClick={() => !rev && onSelect(k)} disabled={rev}
              style={{ display:'flex', alignItems:'center', gap:14, padding:'13px 16px', borderRadius:10, border, background:bg, color, fontWeight:fw, fontSize:14, cursor:rev?'default':'pointer', textAlign:'left', transition:'all .15s' }}>
              <span style={{ width:26, height:26, borderRadius:6, background:rev&&k===q.correct?'#16a34a':rev&&k===sel&&k!==q.correct?'#dc2626':k===sel?'#7c3aed':'#e8e8f0', color:(rev||k===sel)?'#fff':color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800, flexShrink:0 }}>{k}</span>
              <span style={{ flex:1 }}>{v}</span>
              {rev&&k===q.correct&&<span>✅</span>}
              {rev&&k===sel&&k!==q.correct&&<span>❌</span>}
            </button>
          );
        })}
      </div>
    );
    return (
      <div className="fade-up" style={{ maxWidth:720, margin:'0 auto' }}>
        <div style={{ background:'#fff', border:'1px solid #e8e8f0', borderRadius:12, padding:'12px 18px', marginBottom:14, display:'flex', alignItems:'center', gap:14, boxShadow:'0 1px 3px rgba(0,0,0,.05)' }}>
          <div style={{ padding:'4px 12px', borderRadius:20, background:level.bg, color:level.color, fontSize:12, fontWeight:700 }}>{level.label}</div>
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'#9ca3af', marginBottom:3, fontFamily:'JetBrains Mono,monospace' }}>
              <span>ELO {elo}</span><span>Q {adaptiveQNum}/{adaptiveMax}</span>
            </div>
            <div style={{ height:5, background:'#f3f4f6', borderRadius:3, overflow:'hidden' }}>
              <div style={{ height:'100%', width:eloPct+'%', background:'linear-gradient(90deg,#a78bfa,#7c3aed)', borderRadius:3, transition:'width .5s' }}/>
            </div>
          </div>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:16, fontWeight:800, color:'#16a34a' }}>{correct}</div>
            <div style={{ fontSize:9, color:'#9ca3af', fontFamily:'JetBrains Mono,monospace' }}>CORRECT</div>
          </div>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:16, fontWeight:800, color:'#dc2626' }}>{adaptiveLog.length-correct}</div>
            <div style={{ fontSize:9, color:'#9ca3af', fontFamily:'JetBrains Mono,monospace' }}>WRONG</div>
          </div>
          <div style={{ padding:'3px 10px', borderRadius:6, background:dBg(adaptiveDiff), color:dCol(adaptiveDiff), fontSize:11, fontWeight:700, fontFamily:'JetBrains Mono,monospace' }}>{adaptiveDiff}</div>
        </div>
        <div style={{ display:'flex', gap:4, marginBottom:14, flexWrap:'wrap' }}>
          {Array.from({ length: adaptiveMax }, (_, i) => {
            const entry = adaptiveLog[i];
            return <div key={i} style={{ width:22, height:22, borderRadius:5, fontSize:10, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', background:entry?(entry.isCorrect?'#dcfce7':'#fee2e2'):i===adaptiveQNum-1?'#ede9fe':'#f3f4f6', color:entry?(entry.isCorrect?'#16a34a':'#dc2626'):i===adaptiveQNum-1?'#7c3aed':'#9ca3af', border:i===adaptiveQNum-1?'2px solid #7c3aed':'1px solid transparent' }}>{entry?(entry.isCorrect?'✓':'✗'):i+1}</div>;
          })}
        </div>
        <div style={{ background:'#fff', border:'1px solid #e8e8f0', borderRadius:16, padding:28, boxShadow:'0 2px 8px rgba(0,0,0,.06)', minHeight:340 }}>
          {loadingQ ? (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:280, gap:14 }}>
              <div style={{ width:44, height:44, borderRadius:'50%', border:'4px solid #e8e8f0', borderTop:'4px solid #7c3aed', animation:'spin .7s linear infinite' }}/>
              <div style={{ fontFamily:'Space Grotesk,sans-serif', fontWeight:700, fontSize:15, color:'#374151' }}>Generating {adaptiveDiff} question...</div>
            </div>
          ) : adaptiveQ ? (
            <>
              <div style={{ fontFamily:'Space Grotesk,sans-serif', fontWeight:700, fontSize:18, color:'#0f0f1a', lineHeight:1.5, marginBottom:22 }}>{adaptiveQ.question}</div>
              <MCQOptions q={adaptiveQ} sel={selected} rev={revealed} onSelect={setSelected}/>
              {!revealed && (
                <button onClick={submitAdaptive} disabled={!selected}
                  style={{ marginTop:20, width:'100%', padding:'12px', background:selected?'linear-gradient(135deg,#6d28d9,#7c3aed)':'#e8e8f0', color:selected?'#fff':'#9ca3af', border:'none', borderRadius:10, fontWeight:800, fontSize:14, cursor:selected?'pointer':'not-allowed' }}>
                  Submit Answer
                </button>
              )}
              {revealed && (
                <div style={{ marginTop:16, background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:10, padding:'12px 16px' }}>
                  <div style={{ fontSize:11, fontWeight:700, color:'#16a34a', fontFamily:'JetBrains Mono,monospace', marginBottom:5, letterSpacing:1 }}>EXPLANATION</div>
                  <div style={{ fontSize:13, color:'#166534', lineHeight:1.65 }}>{adaptiveQ.explanation}</div>
                  <div style={{ marginTop:10, fontSize:11, color:'#9ca3af', textAlign:'center', fontFamily:'JetBrains Mono,monospace' }}>{adaptiveQNum < adaptiveMax ? 'Next question loading...' : 'Generating your report...'}</div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    );
  }

  // ── STANDARD QUESTION ────────────────────────────────────
  if (screen === 'standard') {
    const q    = stdQuestions[stdIndex];
    const corr = stdAnswers.filter(a => a.isCorrect).length;
    const MCQOptions2 = ({ qu, sel, rev, onSelect }) => (
      <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
        {Object.entries(qu.options || {}).map(([k, v]) => {
          let bg='#f8f8fc', border='1px solid #e8e8f0', color='#374151', fw=500;
          if (rev) {
            if (k===qu.correct) { bg='#dcfce7'; border='1.5px solid #bbf7d0'; color='#16a34a'; fw=700; }
            else if (k===sel && k!==qu.correct) { bg='#fee2e2'; border='1.5px solid #fecaca'; color='#dc2626'; fw=700; }
          } else if (k===sel) { bg='#ede9fe'; border='1.5px solid #c4b5fd'; color='#6d28d9'; fw=600; }
          return (
            <button key={k} onClick={() => !rev && onSelect(k)} disabled={rev}
              style={{ display:'flex', alignItems:'center', gap:14, padding:'13px 16px', borderRadius:10, border, background:bg, color, fontWeight:fw, fontSize:14, cursor:rev?'default':'pointer', textAlign:'left', transition:'all .15s' }}>
              <span style={{ width:26, height:26, borderRadius:6, background:rev&&k===qu.correct?'#16a34a':rev&&k===sel&&k!==qu.correct?'#dc2626':k===sel?'#7c3aed':'#e8e8f0', color:(rev||k===sel)?'#fff':color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800, flexShrink:0 }}>{k}</span>
              <span style={{ flex:1 }}>{v}</span>
              {rev&&k===qu.correct&&<span>✅</span>}
              {rev&&k===sel&&k!==qu.correct&&<span>❌</span>}
            </button>
          );
        })}
      </div>
    );
    return (
      <div className="fade-up" style={{ maxWidth:720, margin:'0 auto' }}>
        <div style={{ background:'#fff', border:'1px solid #e8e8f0', borderRadius:12, padding:'12px 18px', marginBottom:14, display:'flex', alignItems:'center', gap:14, boxShadow:'0 1px 3px rgba(0,0,0,.05)' }}>
          <span style={{ padding:'4px 12px', borderRadius:20, background:dBg(difficulty), color:dCol(difficulty), fontSize:12, fontWeight:700 }}>{difficulty}</span>
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'#9ca3af', marginBottom:3, fontFamily:'JetBrains Mono,monospace' }}>
              <span>Q {stdIndex+1}/{stdQuestions.length}</span><span>{corr} correct</span>
            </div>
            <div style={{ height:5, background:'#f3f4f6', borderRadius:3, overflow:'hidden' }}>
              <div style={{ height:'100%', width:(stdQuestions.length ? (stdIndex/stdQuestions.length*100) : 0)+'%', background:'linear-gradient(90deg,#86efac,#16a34a)', borderRadius:3, transition:'width .5s' }}/>
            </div>
          </div>
          <div style={{ fontSize:13, fontWeight:700, color:'#374151' }}>{subject}</div>
        </div>
        {loadingBatch ? (
          <div style={{ background:'#fff', border:'1px solid #e8e8f0', borderRadius:16, padding:60, textAlign:'center', boxShadow:'0 1px 3px rgba(0,0,0,.05)' }}>
            <div style={{ width:44, height:44, borderRadius:'50%', border:'4px solid #e8e8f0', borderTop:'4px solid #16a34a', animation:'spin .7s linear infinite', margin:'0 auto 14px' }}/>
            <div style={{ fontFamily:'Space Grotesk,sans-serif', fontWeight:700, fontSize:15, color:'#374151', marginBottom:6 }}>Generating {stdCount} questions...</div>
            <div style={{ fontSize:12, color:'#9ca3af' }}>This may take a few seconds</div>
          </div>
        ) : q ? (
          <div style={{ background:'#fff', border:'1px solid #e8e8f0', borderRadius:16, padding:28, boxShadow:'0 2px 8px rgba(0,0,0,.06)' }}>
            <div style={{ fontFamily:'Space Grotesk,sans-serif', fontWeight:700, fontSize:18, color:'#0f0f1a', lineHeight:1.5, marginBottom:22 }}>{q.question}</div>
            <MCQOptions2 qu={q} sel={stdSelected} rev={stdRevealed} onSelect={setStdSelected}/>
            {!stdRevealed && (
              <button onClick={submitStandard} disabled={!stdSelected}
                style={{ marginTop:20, width:'100%', padding:'12px', background:stdSelected?'linear-gradient(135deg,#16a34a,#15803d)':'#e8e8f0', color:stdSelected?'#fff':'#9ca3af', border:'none', borderRadius:10, fontWeight:800, fontSize:14, cursor:stdSelected?'pointer':'not-allowed' }}>
                Submit Answer
              </button>
            )}
            {stdRevealed && (
              <div style={{ marginTop:16, background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:10, padding:'12px 16px' }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#16a34a', fontFamily:'JetBrains Mono,monospace', marginBottom:5, letterSpacing:1 }}>EXPLANATION</div>
                <div style={{ fontSize:13, color:'#166534', lineHeight:1.65 }}>{q.explanation}</div>
                <div style={{ marginTop:10, fontSize:11, color:'#9ca3af', textAlign:'center', fontFamily:'JetBrains Mono,monospace' }}>{stdIndex < stdQuestions.length-1 ? 'Next question...' : 'Generating your report...'}</div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  // ── RESULTS ──────────────────────────────────────────────
  const correctCount = finalAnswers.filter(a => a.isCorrect).length;
  const scorePct     = finalAnswers.length ? Math.round(correctCount / finalAnswers.length * 100) : 0;
  const grade        = gradeFrom(scorePct);
  const level        = levelFrom(finalElo);

  return (
    <div className="fade-up">
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:22 }}>
        <button onClick={() => { setScreen('hub'); setAnalysis(null); setFinalAnswers([]); }}
          style={{ padding:'6px 14px', background:'#fff', border:'1px solid #e5e7eb', borderRadius:8, fontSize:12, fontWeight:600, color:'#374151', cursor:'pointer' }}>Practice Hub</button>
        <h1 style={{ fontFamily:'Space Grotesk,sans-serif', fontWeight:800, fontSize:22, color:'#0f0f1a' }}>
          {finalMode === 'adaptive' ? 'Adaptive' : 'Standard'} Practice Results
        </h1>
      </div>
      <div style={{ background:gbg(grade), border:'1px solid ' + gcol(grade) + '33', borderRadius:16, padding:'22px 26px', marginBottom:18, display:'flex', alignItems:'center', gap:22 }}>
        <div style={{ width:80, height:80, borderRadius:'50%', background:gcol(grade), display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:'0 0 28px ' + gcol(grade) + '44' }}>
          <div style={{ fontFamily:'Space Grotesk,sans-serif', fontWeight:900, fontSize:26, color:'#fff', lineHeight:1 }}>{grade}</div>
          <div style={{ fontSize:9, color:'rgba(255,255,255,.75)', fontFamily:'JetBrains Mono,monospace' }}>GRADE</div>
        </div>
        <div style={{ flex:1 }}>
          <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom:4 }}>
            <span style={{ fontFamily:'Space Grotesk,sans-serif', fontWeight:900, fontSize:40, color:gcol(grade), lineHeight:1 }}>{scorePct}%</span>
            <span style={{ fontSize:16, color:'#9ca3af' }}>{correctCount}/{finalAnswers.length} correct</span>
            {finalMode === 'adaptive' && (
              <span style={{ padding:'4px 12px', borderRadius:20, background:level.bg, color:level.color, fontSize:13, fontWeight:700 }}>{level.label} · ELO {finalElo}</span>
            )}
          </div>
          <div style={{ height:8, background:'#e8e8f0', borderRadius:4, overflow:'hidden', maxWidth:440, marginBottom:8 }}>
            <div style={{ height:'100%', width:scorePct+'%', background:'linear-gradient(90deg,' + gcol(grade) + '88,' + gcol(grade) + ')', borderRadius:4 }}/>
          </div>
          <div style={{ fontSize:12, color:'#6b7280', fontFamily:'JetBrains Mono,monospace' }}>Subject: {subject} · {finalMode==='adaptive'?'Adaptive':'Difficulty: '+difficulty}</div>
        </div>
      </div>

      {analyzing ? (
        <div style={{ background:'#fff', border:'1px solid #e8e8f0', borderRadius:14, padding:40, textAlign:'center', marginBottom:16, boxShadow:'0 1px 3px rgba(0,0,0,.05)' }}>
          <div style={{ width:44, height:44, borderRadius:'50%', border:'4px solid #e8e8f0', borderTop:'4px solid #7c3aed', animation:'spin .8s linear infinite', margin:'0 auto 14px' }}/>
          <div style={{ fontFamily:'Space Grotesk,sans-serif', fontWeight:700, fontSize:15, color:'#374151' }}>Analyzing your performance...</div>
        </div>
      ) : analysis && (
        <div style={{ background:'#fff', border:'1px solid #e8e8f0', borderRadius:14, padding:24, marginBottom:16, boxShadow:'0 1px 3px rgba(0,0,0,.05)' }}>
          <div style={{ fontFamily:'Space Grotesk,sans-serif', fontWeight:700, fontSize:15, color:'#0f0f1a', marginBottom:14 }}>Performance Analysis</div>
          <div style={{ fontSize:14, color:'#374151', lineHeight:1.7, marginBottom:16, padding:'12px 16px', background:'#f8f8fc', borderRadius:9, border:'1px solid #e8e8f0' }}>{analysis.overall_feedback}</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16 }}>
            <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#16a34a', marginBottom:8, fontFamily:'JetBrains Mono,monospace', letterSpacing:1 }}>STRENGTHS</div>
              {(analysis.strong_topics||[]).map((t,i) => <div key={i} style={{ fontSize:13, color:'#166534', marginBottom:5 }}>{t}</div>)}
            </div>
            <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#dc2626', marginBottom:8, fontFamily:'JetBrains Mono,monospace', letterSpacing:1 }}>NEEDS WORK</div>
              {(analysis.weak_topics||[]).map((t,i) => <div key={i} style={{ fontSize:13, color:'#991b1b', marginBottom:5 }}>{t}</div>)}
            </div>
          </div>
          <div style={{ background:'#fef9c3', border:'1px solid #fde68a', borderRadius:10, padding:'14px 16px', marginBottom:14 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#713f12', marginBottom:8, fontFamily:'JetBrains Mono,monospace', letterSpacing:1 }}>IMPROVEMENT TIPS</div>
            {(analysis.improvement_tips||[]).map((t,i) => <div key={i} style={{ fontSize:13, color:'#78350f', marginBottom:5 }}>{(i+1) + '. ' + t}</div>)}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div style={{ background:'#ede9fe', border:'1px solid #ddd6fe', borderRadius:9, padding:'12px 14px' }}>
              <div style={{ fontSize:10, color:'#7c3aed', fontFamily:'JetBrains Mono,monospace', fontWeight:700, marginBottom:5, letterSpacing:1 }}>NEXT STEPS</div>
              <div style={{ fontSize:12, color:'#3730a3', lineHeight:1.6 }}>{analysis.next_steps}</div>
            </div>
            <div style={{ background:'#f0f9ff', border:'1px solid #bae6fd', borderRadius:9, padding:'12px 14px' }}>
              <div style={{ fontSize:10, color:'#0284c7', fontFamily:'JetBrains Mono,monospace', fontWeight:700, marginBottom:5, letterSpacing:1 }}>EXAM READINESS</div>
              <div style={{ fontFamily:'Space Grotesk,sans-serif', fontWeight:800, fontSize:15, color:'#0369a1' }}>{analysis.predicted_exam_readiness}</div>
            </div>
          </div>
        </div>
      )}

      <div style={{ background:'#fff', border:'1px solid #e8e8f0', borderRadius:14, overflow:'hidden', boxShadow:'0 1px 3px rgba(0,0,0,.06)', marginBottom:16 }}>
        <div style={{ padding:'14px 20px', borderBottom:'1px solid #f3f4f6', fontFamily:'Space Grotesk,sans-serif', fontWeight:700, fontSize:15, color:'#0f0f1a' }}>Answer Review ({finalAnswers.length} questions)</div>
        {finalAnswers.map((a, i) => {
          const color = a.isCorrect ? '#16a34a' : '#dc2626';
          return (
            <div key={i} style={{ padding:'14px 20px', borderBottom:'1px solid #f3f4f6', borderLeft:'4px solid ' + color }}>
              <div style={{ display:'flex', gap:12 }}>
                <div style={{ width:26, height:26, borderRadius:7, background:a.isCorrect?'#dcfce7':'#fee2e2', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, color, flexShrink:0 }}>{a.isCorrect?'✓':'✗'}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:9, color:'#9ca3af', fontFamily:'JetBrains Mono,monospace', marginBottom:4 }}>Q{i+1} · {a.difficulty}</div>
                  <div style={{ fontSize:13, fontWeight:600, color:'#0f0f1a', marginBottom:8, lineHeight:1.5 }}>{a.question}</div>
                  <div style={{ display:'grid', gridTemplateColumns:a.isCorrect?'1fr':'1fr 1fr', gap:8, marginBottom:8 }}>
                    <div style={{ padding:'7px 10px', borderRadius:7, background:a.isCorrect?'#dcfce7':'#fee2e2', border:'1px solid ' + (a.isCorrect?'#bbf7d0':'#fecaca') }}>
                      <div style={{ fontSize:9, color:a.isCorrect?'#16a34a':'#dc2626', fontFamily:'JetBrains Mono,monospace', fontWeight:700, marginBottom:3 }}>YOUR ANSWER</div>
                      <div style={{ fontSize:12, fontWeight:600 }}>{a.chosen}: {a.options && a.options[a.chosen]}</div>
                    </div>
                    {!a.isCorrect && (
                      <div style={{ padding:'7px 10px', borderRadius:7, background:'#dcfce7', border:'1px solid #bbf7d0' }}>
                        <div style={{ fontSize:9, color:'#16a34a', fontFamily:'JetBrains Mono,monospace', fontWeight:700, marginBottom:3 }}>CORRECT ANSWER</div>
                        <div style={{ fontSize:12, fontWeight:600, color:'#166534' }}>{a.correct}: {a.options && a.options[a.correct]}</div>
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize:12, color:'#374151', lineHeight:1.6, background:'#f8f8fc', padding:'7px 10px', borderRadius:7, border:'1px solid #e8e8f0' }}>{a.explanation}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display:'flex', gap:12 }}>
        <button onClick={() => setScreen(finalMode==='adaptive'?'adaptive-setup':'standard-setup')}
          style={{ flex:1, padding:'11px', background:'#fff', border:'1px solid #e5e7eb', borderRadius:10, fontWeight:700, fontSize:13, color:'#374151', cursor:'pointer' }}>
          Practice Again
        </button>
        <button onClick={() => { setScreen('hub'); setAnalysis(null); setFinalAnswers([]); }}
          style={{ flex:1, padding:'11px', background:'linear-gradient(135deg,#6d28d9,#7c3aed)', color:'#fff', border:'none', borderRadius:10, fontWeight:700, fontSize:13, cursor:'pointer' }}>
          Back to Hub
        </button>
      </div>
    </div>
  );
}
