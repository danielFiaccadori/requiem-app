import json
import codecs

def create_notebook():
    cells = []
    
    def add_markdown(text):
        cells.append({
            "cell_type": "markdown",
            "metadata": {},
            "source": [line + '\n' for line in text.split('\n')]
        })
        
    def add_code(text):
        cells.append({
            "cell_type": "code",
            "metadata": {},
            "execution_count": None,
            "outputs": [],
            "source": [line + '\n' for line in text.split('\n')]
        })

    add_markdown("# Requiem — Pipeline Bach (Melody-Conditioned)\nEste notebook extrai o corpus JSB Chorales usando music21 e treina uma LSTM de dupla entrada (Harmonia + Melodia).")
    
    add_markdown("## 1. Instalar dependências")
    add_code("!pip install -q tensorflow numpy music21")
    
    add_markdown("## 2. Extração do Dataset (JSB Chorales)")
    
    # Read the dataset extractor code
    with codecs.open("build_bach_dataset.py", "r", "utf-8") as f:
        bach_extractor = f.read()
    # Remove the generic if __name__ == "__main__": extract_bach_dataset() at the end to just run it
    bach_extractor = bach_extractor.replace('if __name__ == "__main__":\n    extract_bach_dataset()', 'extract_bach_dataset()')
    add_code(bach_extractor)
    
    add_markdown("## 3. Treinamento do Modelo (Keras LSTM Dupla)")
    with codecs.open("train_bach_model.py", "r", "utf-8") as f:
        train_model = f.read()
    train_model = train_model.replace('if __name__ == "__main__":\n    main()', 'main()')
    add_code(train_model)
    
    notebook = {
        "nbformat": 4,
        "nbformat_minor": 4,
        "metadata": {
            "colab": {
                "provenance": []
            },
            "kernelspec": {
                "name": "python3",
                "display_name": "Python 3"
            },
            "language_info": {
                "name": "python"
            }
        },
        "cells": cells
    }
    
    with codecs.open("Requiem_Pipeline_Bach.ipynb", "w", "utf-8") as f:
        json.dump(notebook, f, indent=2)
        
if __name__ == "__main__":
    create_notebook()
