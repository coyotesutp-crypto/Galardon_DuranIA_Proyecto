#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Modelo de predicción de riesgo de gusano barrenador
# Genera datos entrena un clasificador Random Forest

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
import joblib
import random

# Fijar semilla 
np.random.seed(42)
random.seed(42)

# Generar datos 
municipios = ['Poanas', 'Durango', 'Guadalupe Victoria', 'Nombre de Dios', 
              'Pueblo Nuevo', 'Rodeo', 'San Juan del Río', 'Santa Clara',
              'Santiago Papasquiaro', 'Vicente Guerrero', 'Nuevo Ideal', 'Gómez Palacio']

n_muestras = 500  # registros simulados
datos = []

for _ in range(n_muestras):
    municipio = random.choice(municipios)
    
    # Características
    densidad = random.uniform(20, 250)  
    casos_previos = random.randint(0, 15)
    temperatura = random.uniform(18, 35)
    humedad = random.uniform(40, 85)
    
    # resgo alto si se cumplen condiciones
    # Usamos una función lógica para que tenga sentido
    riesgo = 0
    if (densidad > 120 and casos_previos > 3) or (temperatura > 28 and humedad > 65):
        riesgo = 1  #  riesgo alto
    elif (densidad > 80 and casos_previos > 1) or (temperatura > 25 and humedad > 60):
        riesgo = 0.5  # riesgo medio 
    else:
        riesgo = 0  #  riesgo bajo
    
    clase = 1 if riesgo > 0.5 else 0
    
    datos.append([densidad, casos_previos, temperatura, humedad, clase])

df = pd.DataFrame(datos, columns=['densidad', 'casos_previos', 'temperatura', 'humedad', 'riesgo_clase'])

X = df[['densidad', 'casos_previos', 'temperatura', 'humedad']]
y = df['riesgo_clase']

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Entrenar Random Forest
modelo = RandomForestClassifier(n_estimators=100, max_depth=5, random_state=42)
modelo.fit(X_train, y_train)

# Evaluar
y_pred = modelo.predict(X_test)
precision = accuracy_score(y_test, y_pred)
print(f"Precisión del modelo: {precision:.2f}")

# Guardar modelo
joblib.dump(modelo, 'modelo_riesgo_barrenador.pkl')
print("Modelo guardado en modelo_riesgo_barrenador.pkl")
