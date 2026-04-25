// ── DExam AI Service — Groq direct calls ─────────────────────

// ── Core Groq call (exported so components can use directly) ──
import { apiPost } from './api';

export async function groqChat(sys, usr, max, temp) {
  // Route through backend — API key stays on server
  var data = await apiPost('/ai/chat', {
    messages: sys
      ? [{ role: 'system', content: sys }, { role: 'user', content: usr }]
      : [{ role: 'user', content: usr }],
    max_tokens: max || 1000,
    temperature: temp || 0.7,
  });
  if (data.error) throw new Error(data.error.message || 'AI error');
  return data.choices[0].message.content;
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
  var topic        = config.topic;
  var difficulty   = config.difficulty || 'Medium';
  var count        = config.count || 5;
  var type         = config.type || 'MCQ';
  var marks        = difficulty === 'Easy' ? 5 : difficulty === 'Hard' ? 15 : 10;
  var existingTexts = config.existingQuestions || []; // array of question_text strings already saved

  if (onProgress) onProgress(0, count);

  var optionsStr = type === 'MCQ'
    ? ',"options":[{"text":"correct answer","is_correct":true},{"text":"wrong 1","is_correct":false},{"text":"wrong 2","is_correct":false},{"text":"wrong 3","is_correct":false}]'
    : '';
  var correctEx = type === 'MCQ' ? '"A"' : type === 'TRUE_FALSE' ? '"True"' : '"model answer here"';

  // Build exclusion list from previously saved/generated questions
  var excludeStr = existingTexts.length > 0
    ? ' IMPORTANT: Do NOT generate any of these already-used questions or similar variations: [' +
      existingTexts.slice(-20).map(function(t) { return t.slice(0, 80); }).join(' | ') + '].'
    : '';

  var sys = 'You are an expert exam question generator. Return ONLY a valid JSON array. No markdown. No extra text. Always generate questions that are DIFFERENT from any previously used questions.';
  var usr = 'Generate ' + count + ' UNIQUE ' + difficulty + ' ' + type + ' exam questions about "' + topic + '".' + excludeStr + ' ' +
    'Each question must test a DIFFERENT concept or aspect. ' +
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
export async function generateExamQuestions(topic, type, difficulty, count, marksEach, existingQuestions) {
  existingQuestions = existingQuestions || [];
  var excludeStr = existingQuestions.length > 0
    ? ' IMPORTANT: Do NOT generate questions similar to these already-used ones: [' +
      existingQuestions.slice(-20).map(function(t){ return t.slice(0,70); }).join(' | ') + '].'
    : '';

  var randomSeed = Math.floor(Math.random() * 10000);
  var sys = 'You are an expert exam question generator. Return ONLY a valid JSON array. No markdown. Every generation must produce COMPLETELY DIFFERENT questions even on the same topic — vary the concept, angle, scenario, and phrasing each time.';
  var typeDesc = type === 'MCQ' ? 'multiple choice with 4 options' :
    type === 'TRUE_FALSE' ? 'true/false' :
    type === 'SHORT_ANSWER' ? 'short answer' : 'descriptive';

  var usr = 'Generate ' + count + ' UNIQUE ' + difficulty + ' ' + typeDesc + ' questions on: ' + topic + '.' + excludeStr +
    ' Each question must cover a DIFFERENT sub-topic, scenario or angle. Vary difficulty within the level. Seed variation: ' + randomSeed + '.' +
    ' Each question has ' + marksEach + ' marks.' +
    ' Return JSON array. Each object: question_text (string), question_type ("' + type + '"), ' +
    'difficulty ("' + difficulty + '"), marks (' + marksEach + '), correct_answer (string), explanation (string)' +
    (type === 'MCQ' ? ', options (array of 4 strings). correct_answer must exactly match one option.' : '') +
    (type === 'TRUE_FALSE' ? '. correct_answer must be "True" or "False".' : '');

  var raw = await groqChat(sys, usr, 3000, 0.9);
  return parseJSON(raw);
}

// ── Viva question generation ──────────────────────────────────
export async function generateVivaQuestions(topic, count, existingQuestions) {
  existingQuestions = existingQuestions || [];
  var excludeStr = existingQuestions.length > 0
    ? ' Do NOT repeat or closely paraphrase these existing questions: [' +
      existingQuestions.slice(-15).map(function(q){ return q.slice(0,70); }).join(' | ') + '].'
    : '';
  var rnd = Math.floor(Math.random() * 9999);
  var sys = 'You are a viva voce examiner. Return ONLY a JSON array. Every call must produce COMPLETELY DIFFERENT questions — vary concepts, angles, depth, and phrasing.';
  var usr = 'Generate ' + count + ' unique oral viva questions on: ' + topic + '.' + excludeStr +
    ' Each question must cover a different sub-topic or approach. Vary between conceptual, applied, and analytical questions. Seed: ' + rnd + '.' +
    ' Return JSON array: [{"question":"?","model_answer":"2-4 sentence answer"}]';
  var raw = await groqChat(sys, usr, 2000, 0.9);
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
      return 'Q' + (i + 1) + ' [' + (q.difficulty || 'Medium') + ']: ' + q.question_text.slice(0, 80) + ' | ' + (correct ? 'Correct' : 'Wrong');
    }).join('; ');
    var sys = 'You are an academic tutor. Return ONLY valid JSON.';
    var usr = 'Analyze exam performance: ' + log +
      '. Return: {"level":"Beginner/Intermediate/Advanced","readiness":"Not Ready/Almost Ready/Ready",' +
      '"summary":"2-3 sentences","strengths":["s1","s2"],"weaknesses":["w1","w2"],' +
      '"improvements":["tip1","tip2","tip3"],"focus_topics":["topic1","topic2"],' +
      '"youtube_topics":["specific youtube search for weak area 1","specific youtube search for weak area 2","specific youtube search for weak area 3"]}';
    var raw = await groqChat(sys, usr, 700, 0.5);
    return parseJSON(raw);
  } catch (e) {
    return { level: 'Intermediate', readiness: 'Almost Ready', summary: 'Review your incorrect answers carefully.', strengths: [], weaknesses: [], improvements: [], focus_topics: [], youtube_topics: [] };
  }
}

// ── YouTube resource recommendations based on weaknesses ──────
export async function getYouTubeResources(weakTopics, subject) {
  try {
    var sys = 'You are a study advisor. Return ONLY a valid JSON array, no markdown.';
    var usr = 'A student is weak in: ' + weakTopics.join(', ') +
      (subject ? ' (subject: ' + subject + ')' : '') +
      '. Give 4 specific YouTube search queries to find the best educational videos.' +
      ' Each query should be specific (e.g. "binary search tree insertion tutorial" not "trees").' +
      ' Return: [{"title":"friendly label","query":"exact search query","topic":"which weakness this fixes"}]';
    var raw = await groqChat(sys, usr, 400, 0.6);
    var arr = parseJSON(raw);
    return Array.isArray(arr) ? arr : [];
  } catch(e) { return []; }
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
