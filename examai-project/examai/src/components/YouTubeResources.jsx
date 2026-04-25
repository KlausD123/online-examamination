import React, { useState, useEffect } from 'react';
import { apiPost } from '../utils/api';

async function getYouTubeResources(weaknesses, subject) {
  if (!weaknesses || weaknesses.length === 0) return [];
  var prompt = 'You are an educational resource expert. For each weak topic, provide the BEST YouTube video to watch.\n\nSubject: ' + (subject||'general') + '\nWeak topics:\n' +
    weaknesses.slice(0,5).map(function(w,i){ return (i+1)+'. '+w; }).join('\n') +
    '\n\nFor each topic, provide a real YouTube video. Return ONLY valid JSON array:\n[{"topic":"topic name","video_id":"EXACT_11_CHAR_YOUTUBE_VIDEO_ID","title":"video title","channel":"channel name","why":"one sentence"}]\n\nIMPORTANT: Use real, well-known educational YouTube video IDs. Examples of real IDs: dQw4w9WgXcQ, jNQXAC9IVRw. Only return videos that actually exist on YouTube about the topic.';

  var data = await apiPost('/ai/chat', {
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 600, temperature: 0.2
  });
  var raw = (data.choices[0].message.content || '').trim().replace(/```json|```/g, '').trim();
  return JSON.parse(raw);
}

export default function YouTubeResources({ weaknesses, subject }) {
  var [links,   setLinks]   = useState(null);
  var [loading, setLoading] = useState(false);
  var [error,   setError]   = useState('');

  // Auto-load when weaknesses are available
  useEffect(function() {
    if (weaknesses && weaknesses.length > 0 && !links && !loading) {
      load();
    }
  }, [weaknesses]); // eslint-disable-line

  async function load() {
    setLoading(true); setError(''); setLinks(null);
    try {
      var results = await getYouTubeResources(weaknesses, subject);
      setLinks(results);
    } catch(e) { setError('Could not load resources'); }
    setLoading(false);
  }

  if (!weaknesses || weaknesses.length === 0) return null;

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontWeight: 700, fontSize:'0.95rem', marginBottom: 12, display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:'1.2rem' }}>▶️</span> Study Resources
        {!loading && links && <button className="btn btn-outline btn-sm" onClick={load} style={{ marginLeft:'auto', fontSize:'0.72rem' }}>↻ Refresh</button>}
      </div>

      {loading && (
        <div style={{ display:'flex', alignItems:'center', gap:10, color:'var(--text3)', fontSize:'0.85rem', padding:'12px 0' }}>
          <div className="spinner" style={{ width:16, height:16 }}/> Finding best videos for your weak topics…
        </div>
      )}

      {error && <div style={{ color:'var(--danger)', fontSize:'0.82rem' }}>{error} <button className="btn btn-outline btn-sm" onClick={load}>Retry</button></div>}

      {links && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {links.map(function(item, i) {
            var ytUrl = 'https://www.youtube.com/watch?v=' + item.video_id;
            var thumbUrl = 'https://img.youtube.com/vi/' + item.video_id + '/mqdefault.jpg';
            return (
              <a key={i} href={ytUrl} target="_blank" rel="noopener noreferrer"
                style={{ display:'flex', gap:12, padding:'12px 14px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, borderLeft:'3px solid #ff0000', textDecoration:'none', color:'inherit', transition:'var(--transition)' }}
                onMouseOver={function(e){e.currentTarget.style.borderColor='#ff0000'; e.currentTarget.style.background='var(--surface2)';}}
                onMouseOut={function(e){e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--surface)';}}>
                {/* Thumbnail */}
                <div style={{ flexShrink:0, width:120, height:68, borderRadius:6, overflow:'hidden', background:'#000', position:'relative' }}>
                  <img src={thumbUrl} alt={item.title} style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}
                    onError={function(e){ e.target.style.display='none'; }}/>
                  <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,.3)' }}>
                    <div style={{ width:28, height:28, borderRadius:'50%', background:'#ff0000', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <span style={{ color:'#fff', fontSize:'0.7rem', marginLeft:2 }}>▶</span>
                    </div>
                  </div>
                </div>
                {/* Info */}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:'0.88rem', marginBottom:3, color:'var(--text)' }}>{item.title || item.topic}</div>
                  {item.channel && <div style={{ fontSize:'0.75rem', color:'#ff0000', fontWeight:600, marginBottom:4 }}>{item.channel}</div>}
                  <div style={{ fontSize:'0.75rem', color:'var(--text3)', marginBottom:6 }}>{item.why}</div>
                  <div style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'3px 10px', background:'#ff0000', color:'#fff', borderRadius:12, fontSize:'0.72rem', fontWeight:700 }}>
                    ▶ Watch on YouTube
                  </div>
                </div>
              </a>
            );
          })}
          <div style={{ fontSize:'0.72rem', color:'var(--text3)', textAlign:'center' }}>
            Videos open directly on YouTube
          </div>
        </div>
      )}
    </div>
  );
}
