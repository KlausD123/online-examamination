import React from 'react';

export default function JitsiMeet({ roomName, displayName, height }) {
  if (!roomName) return null;
  var room = 'DExamViva' + String(roomName).replace(/[^a-zA-Z0-9]/g, '');
  var h = height || 380;
  var url = 'https://meet.jit.si/' + room;

  return (
    <iframe
      key={room}
      src={url}
      allow="camera; microphone; fullscreen; display-capture; autoplay"
      allowFullScreen
      style={{ width:'100%', height:h, border:'none', display:'block', borderRadius:8 }}
      title="Viva Meeting"
    />
  );
}
