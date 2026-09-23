import os
import json

base_path = os.path.dirname(os.path.abspath(__file__))
mapping = {}

for folder in os.listdir(base_path):
    folder_path = os.path.join(base_path, folder)
    if os.path.isdir(folder_path):
        files = [f for f in os.listdir(folder_path) if f.endswith(".wav")]
        if not files:
            continue
            
        # Select up to 6 files distributed across the sorted list to save memory
        files.sort()
        if len(files) > 6:
            step = len(files) / 6
            selected = [files[int(i*step)] for i in range(6)]
        else:
            selected = files
            
        urls = {}
        for f in selected:
            # Try to extract the note from the filename (e.g., A2, C#4)
            # VSCO files often have format like VlnEns_susVib_A2_v1.wav or _A#2_
            import re
            match = re.search(r'([A-G]#?[0-9])', f)
            if match:
                note = match.group(1).replace('#', 's') # sometimes Tone.js expects # or doesn't care if we pass it as key? Tone.js takes keys like 'C4', 'C#4', but in objects we can quote them "C#4" or "A4". Wait, Tone.js allows "C4", "C#4".
                note_key = match.group(1)
                urls[note_key] = f
            else:
                # Fallback mapping if no note found, just map linearly from C3
                idx = selected.index(f)
                fallback_notes = ["C3", "E3", "G3", "C4", "E4", "G4"]
                urls[fallback_notes[idx]] = f
                
        mapping[folder] = urls

with open(os.path.join(base_path, "instrument_map.json"), "w") as f:
    json.dump(mapping, f, indent=2)
