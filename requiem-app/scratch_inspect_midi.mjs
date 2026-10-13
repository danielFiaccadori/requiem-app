import fs from 'fs';
import pkg from '@tonejs/midi';
const { Midi } = pkg;

const data = fs.readFileSync('./public/music/Elvis.mid');
const midi = new Midi(data);
const ppq = midi.header.ppq;
const BAR_Q = 4.5;
const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const nm = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
const all = midi.tracks.flatMap((t, ti) => t.notes.map(n => ({ ...n, q: n.ticks / ppq, dq: n.durationTicks / ppq, ti, midi: n.midi, vel: n.velocity })));
const totalBars = Math.ceil(Math.max(...all.map(n => n.q + n.dq)) / BAR_Q);
for (let b = 0; b < totalBars; b++) {
  const s = b * BAR_Q, e = s + BAR_Q;
  const inBar = all.filter(n => n.q >= s - 0.1 && n.q < e - 0.1);
  const t0 = inBar.filter(n => n.ti === 0).sort((a, b) => a.q - b.q);
  const t1 = inBar.filter(n => n.ti === 1).sort((a, b) => a.q - b.q);
  const low = inBar.length ? nm(Math.min(...inBar.map(n => n.midi))) : '-';
  console.log(`bar ${String(b).padStart(3)} | low ${low.padEnd(4)} | T0: ${t0.map(n => nm(n.midi) + '@' + (n.q - s).toFixed(1)).join(' ')} | T1: ${t1.map(n => nm(n.midi) + '@' + (n.q - s).toFixed(1)).join(' ')}`);
}
