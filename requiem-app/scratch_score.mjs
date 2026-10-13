import fs from 'fs';
import pkg from '@tonejs/midi';
import { buildSongScore } from './src/engine/ScoreBuilder.ts';
import { SHOWCASE_SONGS } from './src/songs/catalog.ts';
const { Midi } = pkg;

const midi = new Midi(fs.readFileSync('./public/music/Elvis.mid'));
const score = buildSongScore(midi, SHOWCASE_SONGS[0]);
const N = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
console.log('chords', score.chords.length, 'melody events', score.melody.length, 'totalBeats', score.totalBeats);
const bpb = score.beatsPerBar;
const maxBar = Math.ceil(score.totalBeats / bpb);
for (let b = 0; b < maxBar; b++) {
  const ch = score.chords.filter(c => c.start < (b + 1) * bpb && c.end > b * bpb).map(c => `${c.symbol}${c.start > b * bpb ? '@' + (c.start - b * bpb) : ''}`).join(' ');
  const mel = score.melody.filter(m => m.start >= b * bpb && m.start < (b + 1) * bpb).map(m => `${N[m.pc]}${Math.floor(m.midi / 12) - 1}@${(m.start - b * bpb).toFixed(1)}${m.onsets.length > 1 ? 'x' + m.onsets.length : ''}`).join(' ');
  console.log(`bar ${String(b).padStart(3)} | ${ch.padEnd(22)} | ${mel}`);
}
