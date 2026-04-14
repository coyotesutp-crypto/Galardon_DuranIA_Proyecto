#!/usr/bin/env python3 ---- Diego
import sys
import json
import joblib
import numpy as np

# Cargar modelo para lo de la ganaderaaa
modelo = joblib.load('modelo_riesgo_barrenador.pkl')

# Leer datos
if len(sys.argv) < 2:
    print(json.dumps({"error": "No se proporcionaron datos"}))
    sys.exit(1)

try:
    datos_json = sys.argv[1]
    features = json.loads(datos_json) 
    X = np.array(features)
    predicciones = modelo.predict_proba(X)[:, 1]  # probabilidad de clase 1 (riesgo alto)
    # Retornar
    print(json.dumps({"probabilidades": predicciones.tolist()}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
