import React, { useState } from 'react';

var GROQ_KEY = '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';

// Generate YouTube search links based on weakness topics using Groq
async function getYouTubeLinks(weaknesses, subject) {
  if (!weaknesses || weaknesses.length === 0) return [];
  var prompt = 'Given these weak topics a student needs to improve in ' + (subject||'the subject') + ':\n' +
    weaknesses.map(function(w,i){ return (i+1)+'. '+w; }).join('\n') +
    '\n\nGenerate the best YouTube search queries (one per topic, max 5 words each) to find tutorial videos. Return ONLY valid JSON array:\n[{"topic":"topic name","query":"short youtube search query","why":"one sentence why this helps"}]';

  var resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_KEY },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile', max_tokens: 400, temperature: 0.3,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  var data = await resp.json();
  var raw = (data.choices[0].message.content || '').trim().replace(/```json|```/g, '').trim();
  return JSON.parse(raw);
}

export default function YouTubeResources({ weaknesses, subject }) {
  var [links, setLinks]     = useState(null);
  var [loading, setLoading] = useState(false);
  var [error, setError]     = useState('');

  async function load() {
    setLoading(true); setError(''); setLinks(null);
    try {
      var results = await getYouTubeLinks(weaknesses, subject);
      setLinks(results);
    } catch(e) { setError('Could not load resources'); }
    setLoading(false);
  }

  if (!weaknesses || weaknesses.length === 0) return null;

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize:'0.95rem', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:'1.2rem' }}>▶️</span> Study Resources
        </div>
        {!links && !loading && (
          <button className="btn btn-outline btn-sm" onClick={load}>
            Find Videos for Weak Topics
          </button>
        )}
        {loading && <div style={{ fontSize:'0.8rem', color:'var(--text3)' }}>Finding resources…</div>}
      </div>

      {error && <div style={{ color:'var(--danger)', fontSize:'0.82rem' }}>{error}</div>}

      {links && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {links.map(function(item, i) {
            var ytUrl = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(item.query);
            return (
              <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:12, padding:'12px 14px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, borderLeft:'3px solid #ff0000' }}>
                <div style={{ fontSize:'1.5rem', flexShrink:0 }}>▶️</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:'0.88rem', marginBottom:3 }}>{item.topic}</div>
                  <div style={{ fontSize:'0.78rem', color:'var(--text3)', marginBottom:8 }}>{item.why}</div>
                  <a href={ytUrl} target="_blank" rel="noopener noreferrer"
                    style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'5px 12px', background:'#ff0000', color:'#fff', borderRadius:20, fontSize:'0.78rem', fontWeight:700, textDecoration:'none' }}>
                    <span>▶</span> Watch on YouTube
                  </a>
                </div>
              </div>
            );
          })}
          <div style={{ fontSize:'0.72rem', color:'var(--text3)', textAlign:'center', marginTop:4 }}>
            Links open YouTube search results for each weak topic
          </div>
        </div>
      )}
    </div>
  );
}
