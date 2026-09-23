import os
import json
import time
import music21
from music21 import corpus, chord, note, pitch

def extract_bach_dataset():
    print("Iniciando extração do corpus de Bach do music21...")
    iterator = corpus.chorales.Iterator()
    
    dataset = []
    count = 0
    
    for score in iterator:
        count += 1
        if count > 50: # Limitando a 50 para extração mais rápida como prova de conceito
            break
            
        print(f"Processando coral {count}: {score.metadata.title if score.metadata else 'Sem titulo'}")
        
        # Transpor para Dó Maior / Lá Menor para normalizar
        key = score.analyze('key')
        if key.mode == 'major':
            interval = music21.interval.Interval(key.tonic, pitch.Pitch('C'))
        else:
            interval = music21.interval.Interval(key.tonic, pitch.Pitch('A'))
            
        transposed_score = score.transpose(interval)
        
        # Obter os acordes reduzidos (chordify) e a melodia
        chordified = transposed_score.chordify()
        
        # A voz principal (Soprano) costuma ser a partitura 0
        try:
            soprano_part = transposed_score.parts[0]
        except IndexError:
            continue
            
        melody_notes = soprano_part.flatten().getElementsByClass(note.Note)
        melody_dict = {n.offset: n.pitch.pitchClass for n in melody_notes}
        
        progression = []
        
        for c in chordified.flatten().getElementsByClass(chord.Chord):
            offset = c.offset
            # Qual nota da melodia está tocando neste offset?
            # Busca a nota mais recente cujo offset seja <= ao offset do acorde
            active_melody_pc = None
            valid_offsets = [o for o in melody_dict.keys() if o <= offset]
            if valid_offsets:
                active_melody_pc = melody_dict[max(valid_offsets)]
            else:
                active_melody_pc = c.root().pitchClass # Fallback
                
            # Vetor Chroma da melodia (1 no pitch class, 0 no resto)
            chroma = [0] * 12
            chroma[active_melody_pc] = 1
            
            # Acorde simplificado (raiz + modo)
            root = c.root().name
            quality = c.quality
            suffix = ""
            if quality == 'minor': suffix = "m"
            elif quality == 'diminished': suffix = "dim"
            elif quality == 'augmented': suffix = "aug"
            
            # Se for sétima
            if c.containsSeventh():
                if suffix == "m": suffix = "m7"
                elif suffix == "dim": suffix = "dim7" # ou m7b5 dependendo, simplificado aqui
                else: suffix = "7"
                
            chord_name = f"{root}{suffix}"
            
            progression.append({
                "chord": chord_name,
                "melody_chroma": chroma
            })
            
        if progression:
            dataset.append({
                "title": score.metadata.title if score.metadata else f"Chorale {count}",
                "data": progression
            })
            
    # Salvar em json
    os.makedirs('bach_data', exist_ok=True)
    with open('bach_data/dataset.json', 'w', encoding='utf-8') as f:
        json.dump(dataset, f, indent=2)
        
    print(f"Extração concluída! {len(dataset)} corais salvos.")

if __name__ == "__main__":
    extract_bach_dataset()
