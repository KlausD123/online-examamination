// ── DExam AI Service — Groq direct calls ─────────────────────
var GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
var GROQ_KEY   = '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';
var GROQ_MODEL = 'llama-3.3-70b-versatile';

// ── Core Groq call (exported so components can use directly) ──
export async function groqChat(sys, usr, max, temp) {
  var r = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_KEY },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: max || 1000,
      temperature: temp || 0.7,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }]
    })
  });
  var d = await r.json();
  if (!r.ok) throw new Error((d.error && d.error.message) || ('Groq error ' + r.status));
  return ((d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '').trim();
}

// ── JSON parser ───────────────────────────────────────────────
function parseJSON(text) {
  try {
    var cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    var match = text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    var objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) return JSON.parse(objMatch[0]);
    throw new Error('Could not parse AI response');
  }
}

// ── Exam question generation (used by CreateExam) ─────────────
export async function generateQuestions(config, onProgress) {
  var topic      = config.topic;
  var difficulty = config.difficulty || 'Medium';
  var count      = config.count || 5;
  var type       = config.type || 'MCQ';
  var marks      = difficulty === 'Easy' ? 5 : difficulty === 'Hard' ? 15 : 10;

  if (onProgress) onProgress(0, count);

  var optionsStr = type === 'MCQ'
    ? ',"options":[{"text":"correct answer","is_correct":true},{"text":"wrong 1","is_correct":false},{"text":"wrong 2","is_correct":false},{"text":"wrong 3","is_correct":false}]'
    : '';
  var correctEx = type === 'MCQ' ? '"A"' : type === 'TRUE_FALSE' ? '"True"' : '"model answer here"';

  var sys = 'You are an expert exam question generator. Return ONLY a valid JSON array. No markdown. No extra text.';
  var usr = 'Generate ' + count + ' unique ' + difficulty + ' ' + type + ' exam questions about "' + topic + '". ' +
    'Return a JSON array with exactly ' + count + ' objects: ' +
    '[{"question_text":"?","question_type":"' + type + '","difficulty":"' + difficulty + '",' +
    '"correct_answer":' + correctEx + ',"marks":' + marks + ',"explanation":"why"' + optionsStr + '},...]';

  try {
    var raw = await groqChat(sys, usr, Math.min(count * 300 + 200, 4000), 0.8);
    var arr = parseJSON(raw);
    var qs = (Array.isArray(arr) ? arr : [arr]).map(function(q) {
      return Object.assign({}, q, {
        marks: Number(q.marks) || marks,
        question_id: Math.random().toString(36).substr(2, 9),
        options: q.options ? q.options.slice(0, 4).map(function(o) {
          return { option_id: Math.random().toString(36).substr(2, 9), text: o.text || '', is_correct: Boolean(o.is_correct) };
        }) : undefined
      });
    });
    if (onProgress) onProgress(count, count);
    return qs.slice(0, count);
  } catch (e) {
    throw new Error('Generation failed: ' + e.message);
  }
}

// ── generateExamQuestions (used by reference CreateExam) ──────
export async function generateExamQuestions(topic, type, difficulty, count, marksEach) {
  var sys = 'You are an exam question generator. Return ONLY a JSON array. No markdown.';
  var typeDesc = type === 'MCQ' ? 'multiple choice with 4 options' :
    type === 'TRUE_FALSE' ? 'true/false' :
    type === 'SHORT_ANSWER' ? 'short answer' : 'descriptive';

  var usr = 'Generate ' + count + ' ' + difficulty + ' ' + typeDesc + ' questions on: ' + topic + '. ' +
    'Each question has ' + marksEach + ' marks. ' +
    'Return JSON array. Each object: question_text (string), question_type ("' + type + '"), ' +
    'difficulty ("' + difficulty + '"), marks (' + marksEach + '), correct_answer (string), explanation (string)' +
    (type === 'MCQ' ? ', options (array of 4 strings). correct_answer must exactly match one option.' : '') +
    (type === 'TRUE_FALSE' ? '. correct_answer must be "True" or "False".' : '');

  var raw = await groqChat(sys, usr, 3000, 0.7);
  return parseJSON(raw);
}

// ── Viva question generation ──────────────────────────────────
export async function generateVivaQuestions(topic, count) {
  var sys = 'You are a viva voce examiner. Return ONLY a JSON array.';
  var usr = 'Generate ' + count + ' viva questions on: ' + topic +
    '. Return JSON array: [{"question":"?","model_answer":"2-4 sentence answer"}]';
  var raw = await groqChat(sys, usr, 2000, 0.7);
  return parseJSON(raw);
}

// ── Grade single viva answer ──────────────────────────────────
export async function gradeVivaAnswer(question, modelAnswer, studentAnswer) {
  var sys = 'You are an examiner. Return ONLY valid JSON.';
  var usr = 'Question: ' + question +
    '\nModel Answer: ' + modelAnswer +
    '\nStudent Answer: ' + studentAnswer +
    '\nReturn: {"correct":true/false,"score_pct":0-100,"verdict":"Correct/Partially Correct/Incorrect","feedback":"1-2 sentences","missing":"key point or None"}';
  var raw = await groqChat(sys, usr, 400, 0.3);
  return parseJSON(raw);
}

// ── Grade full viva session ───────────────────────────────────
export async function gradeVivaSession(transcript) {
  var sys = 'You are an examiner grading a full viva. Return ONLY valid JSON.';
  var usr = 'Grade this viva transcript:\n' + transcript +
    '\nReturn: {"total_score":0-100,"grade":"A/B/C/D/F","correct_count":n,"incorrect_count":n,' +
    '"overall_feedback":"3-4 sentences","strengths":["s1"],"improvements":["i1"],' +
    '"answers":[{"question":"q","student_said":"summary","score":n,"max_score":n,"correct":bool,"verdict":"v","feedback":"f"}]}';
  var raw = await groqChat(sys, usr, 2000, 0.2);
  return parseJSON(raw);
}

// ── Practice: single adaptive question ───────────────────────
export async function genPracticeQuestion(subject, difficulty, usedQs) {
  usedQs = usedQs || [];
  var exclude = usedQs.length > 0 ? ' Do NOT repeat: ' + usedQs.slice(-6).join(' | ') : '';
  var sys = 'You are an exam generator. Return ONLY valid JSON.';
  var usr = 'Generate 1 unique ' + difficulty + ' MCQ on "' + subject + '".' + exclude +
    ' Return: {"question_text":"?","options":[{"text":"correct","is_correct":true},{"text":"w","is_correct":false},{"text":"w","is_correct":false},{"text":"w","is_correct":false}],"correct_answer":"A","explanation":"why"}';
  var raw = await groqChat(sys, usr, 600, 0.8);
  return parseJSON(raw);
}

// ── Practice: batch standard questions ───────────────────────
export async function genPracticeBatch(subject, difficulty, count) {
  var sys = 'You are an exam generator. Return ONLY a valid JSON array.';
  var usr = 'Generate ' + count + ' unique ' + difficulty + ' MCQs on "' + subject + '". ' +
    'Return array: [{"question_text":"?","options":[{"text":"correct","is_correct":true},{"text":"w","is_correct":false},{"text":"w","is_correct":false},{"text":"w","is_correct":false}],"correct_answer":"A","explanation":"why"}]';
  var raw = await groqChat(sys, usr, 1800, 0.75);
  return parseJSON(raw);
}

// ── Analyze practice session ──────────────────────────────────
export async function analyzePractice(history, elo) {
  try {
    var correct = history.filter(function(h) { return h.isCorrect; }).length;
    var pct = history.length > 0 ? Math.round(correct / history.length * 100) : 0;
    var sys = 'You are an academic tutor. Return ONLY valid JSON.';
    var usr = 'Analyze practice: ' + correct + '/' + history.length + ' correct (' + pct + '%), ELO: ' + elo +
      '. Return: {"overall":"feedback","strengths":["s"],"weaknesses":["w"],"next_steps":"advice"}';
    var raw = await groqChat(sys, usr, 500, 0.5);
    return parseJSON(raw);
  } catch (e) {
    return { overall: 'Good effort! Keep practicing.', strengths: [], weaknesses: [], next_steps: 'Review incorrect answers.' };
  }
}

// ── Analyze exam result (AI analytics tab) ───────────────────
export async function analyzeExamResult(questions, answers) {
  try {
    var log = questions.map(function(q, i) {
      var a = answers.find(function(x) { return x.question_id === q.question_id; });
      var correct = a && a.answer_text === q.correct_answer;
      return 'Q' + (i + 1) + ' [' + (q.difficulty || 'Medium') + ']: ' + q.question_text.slice(0, 60) + ' | ' + (correct ? 'Correct' : 'Wrong');
    }).join('; ');
    var sys = 'You are an academic tutor. Return ONLY valid JSON.';
    var usr = 'Analyze exam performance: ' + log +
      '. Return: {"level":"Beginner/Intermediate/Advanced","readiness":"Not Ready/Almost Ready/Ready",' +
      '"summary":"2-3 sentences","strengths":["s1","s2"],"weaknesses":["w1","w2"],' +
      '"improvements":["tip1","tip2","tip3"],"focus_topics":["topic1","topic2"]}';
    var raw = await groqChat(sys, usr, 600, 0.5);
    return parseJSON(raw);
  } catch (e) {
    return { level: 'Intermediate', readiness: 'Almost Ready', summary: 'Review your incorrect answers carefully.', strengths: [], weaknesses: [], improvements: [], focus_topics: [] };
  }
}

// ── Evaluate short/descriptive answers ───────────────────────
export async function evaluateShortAnswer(opts) {
  try {
    var sys = 'You are a strict examiner. Return ONLY valid JSON.';
    var usr = 'Question: ' + opts.questionText + '\nModel: ' + opts.referenceAnswer + '\nStudent: ' + opts.studentAnswer +
      '\nMax: ' + opts.maxMarks + '\nReturn: {"score":0-' + opts.maxMarks + ',"feedback":"2 sentences","percentage":0-100}';
    var raw = await groqChat(sys, usr, 200, 0.2);
    return parseJSON(raw);
  } catch (e) { return { score: Math.floor(opts.maxMarks * 0.5), feedback: 'Auto-graded.', percentage: 50 }; }
}

export async function evaluateDescriptive(opts) {
  try {
    var sys = 'You are an academic evaluator. Return ONLY valid JSON.';
    var usr = 'Question: ' + opts.questionText + '\nModel: ' + opts.referenceAnswer + '\nStudent: ' + opts.studentAnswer +
      '\nMax: ' + opts.maxMarks + '\nReturn: {"score":0-' + opts.maxMarks + ',"feedback":"3 sentences","percentage":0-100}';
    var raw = await groqChat(sys, usr, 300, 0.2);
    return parseJSON(raw);
  } catch (e) { return { score: Math.floor(opts.maxMarks * 0.5), feedback: 'AI evaluation unavailable.', percentage: 50 }; }
}
