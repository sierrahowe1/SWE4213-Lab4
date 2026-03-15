import { useState, useEffect } from 'react';

// The API is exposed via a NodePort. This default matches the nodePort
// value the lab specifies for api-service.yaml. If you used a different
// port, update this value and rebuild the image.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:30000';

export default function App() {
  const [notes, setNotes] = useState([]);
  const [stats, setStats] = useState(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { fetchNotes(); }, []);

  async function fetchNotes() {
    const res = await fetch(`${API_URL}/notes`);
    setNotes(await res.json());
  }

  async function fetchStats() {
    const res = await fetch(`${API_URL}/stats`);
    setStats(await res.json());
  }

  async function createNote(e) {
    e.preventDefault();
    setError('');
    const res = await fetch(`${API_URL}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error);
      return;
    }
    setTitle('');
    setContent('');
    fetchNotes();
  }

  async function deleteNote(id) {
    await fetch(`${API_URL}/notes/${id}`, { method: 'DELETE' });
    fetchNotes();
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Notes App</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>

        {/* Create note */}
        <div style={card}>
          <h2 style={h2}>New Note</h2>
          <form onSubmit={createNote}>
            <input
              style={input}
              placeholder="Title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
            />
            <textarea
              style={{ ...input, height: 80, resize: 'vertical' }}
              placeholder="Content"
              value={content}
              onChange={e => setContent(e.target.value)}
              required
            />
            <button style={btn} type="submit">Add Note</button>
            {error && <p style={{ color: '#dc2626', fontSize: '0.85rem', marginTop: '0.5rem' }}>{error}</p>}
          </form>
        </div>

        {/* Stats */}
        <div style={card}>
          <h2 style={h2}>Stats</h2>
          {stats ? (
            <table style={{ width: '100%', fontSize: '0.88rem', borderCollapse: 'collapse' }}>
              <tbody>
                {[
                  ['Total notes', stats.totalNotes],
                  ['Avg content length', `${stats.avgContentLength} chars`],
                  ['Oldest note', stats.oldestNote ? new Date(stats.oldestNote).toLocaleDateString() : '—'],
                  ['Newest note', stats.newestNote ? new Date(stats.newestNote).toLocaleDateString() : '—'],
                ].map(([label, value]) => (
                  <tr key={label} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '0.4rem 0', color: '#666' }}>{label}</td>
                    <td style={{ padding: '0.4rem 0', fontWeight: 600, textAlign: 'right' }}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ color: '#999', fontSize: '0.85rem', marginBottom: '0.75rem' }}>Click below to load stats.</p>
          )}
          <button style={{ ...btn, background: '#6b7280', marginTop: '0.75rem' }} onClick={fetchStats}>
            Refresh Stats
          </button>
        </div>

        {/* Notes list */}
        <div style={{ ...card, gridColumn: 'span 2' }}>
          <h2 style={h2}>All Notes</h2>
          {notes.length === 0 ? (
            <p style={{ color: '#999', fontSize: '0.85rem' }}>No notes yet.</p>
          ) : (
            notes.map(note => (
              <div key={note.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '0.6rem 0', borderBottom: '1px solid #f0f0f0' }}>
                <div>
                  <strong style={{ fontSize: '0.9rem' }}>{note.title}</strong>
                  <p style={{ fontSize: '0.82rem', color: '#666', marginTop: '0.2rem' }}>{note.content}</p>
                  <small style={{ fontSize: '0.75rem', color: '#999' }}>{new Date(note.created_at).toLocaleString()}</small>
                </div>
                <button style={{ ...btn, background: '#dc2626', padding: '0.3rem 0.75rem', fontSize: '0.82rem' }} onClick={() => deleteNote(note.id)}>
                  Delete
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const card = { background: 'white', borderRadius: 8, padding: '1.25rem', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' };
const h2 = { fontSize: '1.1rem', marginBottom: '0.75rem', color: '#444' };
const input = { width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: 4, fontSize: '0.9rem', marginBottom: '0.5rem', display: 'block' };
const btn = { padding: '0.5rem 1rem', background: '#2563eb', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.9rem' };
