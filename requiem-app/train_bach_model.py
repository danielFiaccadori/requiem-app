import os
import json
import numpy as np
import tensorflow as tf
from tensorflow.keras import layers, Model, Input

# 1. Carregar dataset e construir vocabulario
def load_bach_dataset(filepath="bach_data/dataset.json"):
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return data

def build_vocab(data):
    chords = set()
    for chorale in data:
        for item in chorale["data"]:
            chords.add(item["chord"])
    vocab = ["<PAD>"] + sorted(list(chords))
    return vocab

# 2. Criar os tensores de treinamento
def create_training_data(data, vocab, window_size=4):
    vocab_to_idx = {c: i for i, c in enumerate(vocab)}
    pad_idx = vocab_to_idx["<PAD>"]
    
    X_chords = []
    X_melody = []
    y = []
    
    for chorale in data:
        prog = chorale["data"]
        # Precisamos no minimo 1 acorde para prever
        for i in range(len(prog)):
            # Historico de acordes (tamanho window_size)
            start_idx = i - window_size
            ctx_chords = []
            
            for j in range(start_idx, i):
                if j < 0:
                    ctx_chords.append(pad_idx)
                else:
                    ctx_chords.append(vocab_to_idx[prog[j]["chord"]])
            
            target_chord = vocab_to_idx[prog[i]["chord"]]
            current_melody = prog[i]["melody_chroma"]
            
            X_chords.append(ctx_chords)
            X_melody.append(current_melody)
            y.append(target_chord)
            
    return np.array(X_chords), np.array(X_melody), np.array(y)

# 3. Construir o Modelo com dupla entrada
def build_model(vocab_size, window_size=4, embedding_dim=32, lstm_units=[128, 64]):
    # Entrada 1: Historico de acordes
    input_chords = Input(shape=(window_size,), name="chord_history")
    x_chords = layers.Embedding(input_dim=vocab_size, output_dim=embedding_dim, mask_zero=True, name="chord_embedding")(input_chords)
    
    # LSTM 1 para os acordes
    x_chords = layers.LSTM(lstm_units[0], return_sequences=True, name="lstm_layer_1")(x_chords)
    # Pega apenas o ultimo estado (não retorna sequencias na ultima)
    x_chords = layers.LSTM(lstm_units[1], name="lstm_layer_2")(x_chords)
    
    # Entrada 2: Melodia ativa (vetor de 12 posicoes)
    input_melody = Input(shape=(12,), name="melody_chroma")
    x_melody = layers.Dense(16, activation="relu", name="melody_dense")(input_melody)
    
    # Concatenar o estado da LSTM (que tem contexto do historico) com a melodia ATUAL
    concatenated = layers.Concatenate(name="concat_melody_harmony")([x_chords, x_melody])
    
    # Camadas finais
    dense = layers.Dense(64, activation="relu", name="dense_hidden")(concatenated)
    dense = layers.Dropout(0.2)(dense)
    output = layers.Dense(vocab_size, activation="softmax", name="chord_probabilities")(dense)
    
    model = Model(inputs=[input_chords, input_melody], outputs=output)
    model.compile(optimizer="adam", loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    
    return model

import base64

def export_weights_json(model, vocab, filepath="public/model/weights.json"):
    layers_data = {}
    
    # Precisamos exportar os pesos para o TS usar
    for layer in model.layers:
        weights = layer.get_weights()
        if not weights:
            continue
            
        layer_weights = []
        for w in weights:
            b64 = base64.b64encode(w.astype(np.float32).tobytes()).decode('ascii')
            layer_weights.append({
                "shape": list(w.shape),
                "data_b64": b64
            })
            
        layers_data[layer.name] = {
            "class": layer.__class__.__name__,
            "weights": layer_weights
        }
        
    export_data = {
        "vocab_size": len(vocab),
        "window_size": 4,
        "embedding_dim": 32,
        "lstm_units": [128, 64],
        "dense_units": [64, len(vocab)],
        "layers": layers_data
    }
    
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(export_data, f)
        
    with open("public/model/vocab.json", 'w', encoding='utf-8') as f:
        json.dump({"vocab": vocab}, f)

def main():
    print("Carregando dataset...")
    data = load_bach_dataset()
    vocab = build_vocab(data)
    print(f"Vocabulario criado com {len(vocab)} acordes unicos.")
    
    X_chords, X_melody, y = create_training_data(data, vocab)
    print(f"Dados formatados: {len(y)} amostras de treinamento.")
    
    model = build_model(len(vocab))
    model.summary()
    
    print("Iniciando treinamento (20 epocas limitadas)...")
    model.fit(
        {"chord_history": X_chords, "melody_chroma": X_melody},
        y,
        epochs=20,
        batch_size=32,
        validation_split=0.2
    )
    
    print("Exportando pesos...")
    export_weights_json(model, vocab)
    print("Pesos exportados com sucesso para model/weights.json!")

if __name__ == "__main__":
    main()
