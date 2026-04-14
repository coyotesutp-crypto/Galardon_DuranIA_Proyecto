require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');   
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend'))); 

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'ganadero',
    password: process.env.DB_PASSWORD || '123',
    database: process.env.DB_NAME || 'ganaderia',
});

pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Error conectando a PostgreSQL:', err.stack);
    } else {
        console.log('✅ Conexión exitosa a PostgreSQL');
        release();
    }
});

// VALIDACIÓN
function validarProductor(productor, gruposGanado) {
    const errores = [];

    // 1. Fecha de alta no futura
    if (productor.fecha_alta) {
        const fechaAlta = new Date(productor.fecha_alta);
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        if (fechaAlta > hoy) {
            errores.push('La fecha de alta no puede ser posterior al día de hoy.');
        }
    }

    // 2. Teléfono válido (10 dígitos numéricos)
    if (productor.telefono) {
        const telefonoLimpio = productor.telefono.replace(/\D/g, '');
        if (telefonoLimpio.length !== 10) {
            errores.push('El teléfono debe contener exactamente 10 dígitos numéricos.');
        }
    }

    if (!gruposGanado || gruposGanado.length === 0) {
        errores.push('Debe registrar al menos un grupo de ganado.');
    } else {
        let totalCabezas = 0;
        gruposGanado.forEach((grupo, idx) => {
            const vientres = parseInt(grupo.vientres) || 0;
            const crias = parseInt(grupo.crias) || 0;
            const sementales = parseInt(grupo.sementales) || 0;
            const vaquillas = parseInt(grupo.vaquillas) || 0;
            const novillos = parseInt(grupo.novillos) || 0;
            const engorda = parseInt(grupo.engorda) || 0;
            const otras = parseInt(grupo.otras_cant) || 0;
            totalCabezas += vientres + crias + sementales + vaquillas + novillos + engorda + otras;

            if (crias > vientres) {
                errores.push(`En el grupo ${idx+1}, las crías (${crias}) no pueden ser mayores que los vientres (${vientres}).`);
            }
        });
        if (totalCabezas === 0) {
            errores.push('El total de cabezas no puede ser cero. Registre al menos un animal.');
        }
    }

    return errores;
}

// ==================== PREDICCIÓN DE RIESGO SANITARIO ====================
async function calcularRiesgoMunicipios() {
    // Obtener datos actuales: productores, ganado, casos históricos
    const productores = await pool.query('SELECT municipio, COUNT(*) as total FROM productores GROUP BY municipio');
    const ganado = await pool.query(`
        SELECT p.municipio, COALESCE(SUM(gg.vientres + gg.crias + gg.sementales + gg.vaquillas + gg.novillos + gg.engorda + gg.otras_cant),0) as total_cabezas
        FROM productores p
        LEFT JOIN grupos_ganado gg ON p.id = gg.productor_id
        GROUP BY p.municipio
    `);
    
    // Obtener casos de gusano barrenador en los últimos 90 días
    const casos = await pool.query(`
        SELECT municipio, COUNT(*) as num_casos, SUM(num_animales_afectados) as animales_afectados
        FROM casos_sanitarios
        WHERE enfermedad = 'barrenador' AND fecha > CURRENT_DATE - INTERVAL '90 days'
        GROUP BY municipio
    `);

    // Mapa de resultados
    const riesgoMap = {};

    // Para cada municipio, calcular factores
    for (const prod of productores.rows) {
        const municipio = prod.municipio;
        const numProductores = parseInt(prod.total);
        const ganadoRow = ganado.rows.find(g => g.municipio === municipio);
        const totalCabezas = ganadoRow ? parseInt(ganadoRow.total_cabezas) : 0;
        
        // Densidad (cabezas por productor)
        const densidad = numProductores > 0 ? totalCabezas / numProductores : 0;
        
        // Historial de casos (0 si no hay)
        const caso = casos.rows.find(c => c.municipio === municipio);
        const numCasos = caso ? parseInt(caso.num_casos) : 0;
        const animalesAfectados = caso ? parseInt(caso.animales_afectados) : 0;
        
        // Factores ambientales simulados (en producción podrían venir de API clima)
        // Simulamos valores según municipio para que haya variedad
        let temperatura = 0, humedad = 0;
        switch(municipio) {
            case 'Poanas': temperatura = 28; humedad = 65; break;
            case 'Durango': temperatura = 22; humedad = 55; break;
            case 'Guadalupe Victoria': temperatura = 30; humedad = 70; break;
            default: temperatura = 25; humedad = 60;
        }
        
        // Riesgo por densidad (normalizado: max 200 cabezas/productor => 1)
        const riesgoDensidad = Math.min(densidad / 200, 1);
        // Riesgo por casos previos (máximo 10 casos => 1)
        const riesgoCasos = Math.min(numCasos / 10, 1);
        // Riesgo por animales afectados (máximo 50 animales => 1)
        const riesgoAnimales = Math.min(animalesAfectados / 50, 1);
        // Riesgo ambiental: temperatura > 25 y humedad > 60 favorecen barrenador
        let riesgoAmbiental = 0;
        if (temperatura > 25 && humedad > 60) riesgoAmbiental = 0.8;
        else if (temperatura > 25 || humedad > 60) riesgoAmbiental = 0.4;
        else riesgoAmbiental = 0.1;
        
        // Ponderaciones (ajustables)
        const riesgoTotal = (riesgoDensidad * 0.3) + (riesgoCasos * 0.4) + (riesgoAnimales * 0.2) + (riesgoAmbiental * 0.1);
        
        // Determinar nivel
        let nivel = 'Bajo';
        if (riesgoTotal > 0.7) nivel = 'Alto';
        else if (riesgoTotal > 0.4) nivel = 'Medio';
        
        riesgoMap[municipio] = {
            riesgo: parseFloat(riesgoTotal.toFixed(2)),
            nivel,
            densidad: parseFloat(densidad.toFixed(1)),
            numCasos,
            animalesAfectados,
            temperatura,
            humedad
        };
    }
    
    // Guardar en tabla riesgo_municipio (upsert)
    for (const [municipio, data] of Object.entries(riesgoMap)) {
        await pool.query(`
            INSERT INTO riesgo_municipio (municipio, fecha_calculo, riesgo_total, nivel, factores)
            VALUES ($1, NOW(), $2, $3, $4)
            ON CONFLICT (municipio) DO UPDATE SET
                fecha_calculo = NOW(),
                riesgo_total = EXCLUDED.riesgo_total,
                nivel = EXCLUDED.nivel,
                factores = EXCLUDED.factores
        `, [municipio, data.riesgo, data.nivel, JSON.stringify(data)]);
    }
    
    return riesgoMap;
}

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/productores', async (req, res) => {
    const { municipio } = req.query;
    console.log('📌 Petición recibida para municipio:', municipio);
    
    
    try {
        let query = 'SELECT * FROM productores';
        const params = [];
        
        if (municipio && municipio !== 'Todos' && municipio !== 'todos') {
            query += ' WHERE municipio ILIKE $1';
            params.push(`%${municipio}%`);
            console.log('Buscando productores en municipio que contenga:', municipio);
        } else {
            console.log('Mostrando todos los productores');
        }
        
        console.log('📝 Query SQL:', query);
        console.log('📦 Parámetros:', params);
        
        const result = await pool.query(query, params);
        console.log(`Encontrados ${result.rows.length} productores`);
        
        const productoresConGanado = [];
        for (const prod of result.rows) {
            const gruposRes = await pool.query('SELECT * FROM grupos_ganado WHERE productor_id = $1', [prod.id]);
            prod.gruposGanado = gruposRes.rows;
            productoresConGanado.push(prod);
        }
        
        res.json(productoresConGanado);
    } catch (err) {
        console.error('❌ ERROR EN CONSULTA:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/productores/buscar-upp', async (req, res) => {
        const { upp } = req.query;
        try {
            const result = await pool.query('SELECT * FROM productores WHERE upp = $1', [upp]);
            res.json(result.rows[0] || null);
        } catch (err) {
            console.error('Error:', err);
            res.status(500).json({ error: err.message });
        }
});

app.get('/api/municipios', async (req, res) => {
    try {
        const result = await pool.query('SELECT DISTINCT municipio FROM productores ORDER BY municipio');
        res.json(result.rows.map(r => r.municipio));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/buscar', async (req, res) => {
    const { q } = req.query;
    try {
        const result = await pool.query(
            'SELECT * FROM productores WHERE folio = $1 OR telefono = $1',
            [q]
        );
        res.json(result.rows[0] || null);
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ error: err.message });
    }
});



app.get('/api/productores/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const productorRes = await pool.query('SELECT * FROM productores WHERE id = $1', [id]);
        if (productorRes.rows.length === 0) {
            return res.status(404).json({ error: 'Productor no encontrado' });
        }
        const gruposRes = await pool.query('SELECT * FROM grupos_ganado WHERE productor_id = $1', [id]);
        const productor = productorRes.rows[0];
        productor.gruposGanado = gruposRes.rows;
        res.json(productor);
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/productores', async (req, res) => {
    const { productor, gruposGanado } = req.body;
        // Validar datos
    const errores = validarProductor(productor, gruposGanado);
    if (errores.length > 0) {
        return res.status(400).json({ error: 'Datos inválidos', detalles: errores });
    }

    // Validar unicidad de UPP (si se proporciona)
    if (productor.upp && productor.upp.trim() !== '') {
        const uppExistente = await pool.query('SELECT id FROM productores WHERE upp = $1', [productor.upp]);
        if (uppExistente.rows.length > 0) {
            return res.status(400).json({ error: 'Ya existe un productor con esa clave UPP.' });
        }
    }

    // Validar unicidad de Folio (si se proporciona)
    if (productor.folio && productor.folio.trim() !== '') {
        const folioExistente = await pool.query('SELECT id FROM productores WHERE folio = $1', [productor.folio]);
        if (folioExistente.rows.length > 0) {
            return res.status(400).json({ error: 'Ya existe un productor con ese folio.' });
        }
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const insertRes = await client.query(
            `INSERT INTO productores 
            (nombre, rancho, municipio, localidad, tenencia, telefono, fecha_alta, patente, uma, colonia, calle, upp, folio, observaciones)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
            [
                productor.nombre, productor.rancho, productor.municipio, productor.localidad,
                productor.tenencia, productor.telefono, productor.fecha_alta, productor.patente,
                productor.uma, productor.colonia, productor.calle, productor.upp, productor.folio,
                productor.observaciones
            ]
        );
        
        const productorId = insertRes.rows[0].id;
        
        for (const grupo of gruposGanado) {
            await client.query(
                `INSERT INTO grupos_ganado
                (productor_id, especie, raza, cruza, vientres, crias, sementales, vaquillas, novillos, engorda, otras_cant, otras_espec)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
                [
                    productorId, grupo.especie, grupo.raza, grupo.cruza,
                    grupo.vientres, grupo.crias, grupo.sementales, grupo.vaquillas,
                    grupo.novillos, grupo.engorda, grupo.otras_cant, grupo.otras_espec
                ]
            );
        }
        
        await client.query('COMMIT');
        res.json({ id: productorId, success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.put('/api/productores/:id', async (req, res) => {
    const { id } = req.params;
    const { productor, gruposGanado } = req.body;
        // Validar datos
    const errores = validarProductor(productor, gruposGanado);
    if (errores.length > 0) {
        return res.status(400).json({ error: 'Datos inválidos', detalles: errores });
    }

    // Validar unicidad de UPP (excluyendo el mismo productor)
    if (productor.upp && productor.upp.trim() !== '') {
        const uppExistente = await pool.query('SELECT id FROM productores WHERE upp = $1 AND id != $2', [productor.upp, id]);
        if (uppExistente.rows.length > 0) {
            return res.status(400).json({ error: 'Ya existe otro productor con esa clave UPP.' });
        }
    }

    // Validar unicidad de Folio (excluyendo el mismo productor)
    if (productor.folio && productor.folio.trim() !== '') {
        const folioExistente = await pool.query('SELECT id FROM productores WHERE folio = $1 AND id != $2', [productor.folio, id]);
        if (folioExistente.rows.length > 0) {
            return res.status(400).json({ error: 'Ya existe otro productor con ese folio.' });
        }
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        await client.query(
            `UPDATE productores SET
            nombre=$1, rancho=$2, municipio=$3, localidad=$4, tenencia=$5, telefono=$6,
            fecha_alta=$7, patente=$8, uma=$9, colonia=$10, calle=$11, upp=$12, folio=$13, observaciones=$14
            WHERE id=$15`,
            [
                productor.nombre, productor.rancho, productor.municipio, productor.localidad,
                productor.tenencia, productor.telefono, productor.fecha_alta, productor.patente,
                productor.uma, productor.colonia, productor.calle, productor.upp, productor.folio,
                productor.observaciones, id
            ]
        );
        
        await client.query('DELETE FROM grupos_ganado WHERE productor_id = $1', [id]);
        
        for (const grupo of gruposGanado) {
            await client.query(
                `INSERT INTO grupos_ganado
                (productor_id, especie, raza, cruza, vientres, crias, sementales, vaquillas, novillos, engorda, otras_cant, otras_espec)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
                [
                    id, grupo.especie, grupo.raza, grupo.cruza,
                    grupo.vientres, grupo.crias, grupo.sementales, grupo.vaquillas,
                    grupo.novillos, grupo.engorda, grupo.otras_cant, grupo.otras_espec
                ]
            );
        }
        
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.delete('/api/productores/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM productores WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ error: err.message });
    }
});


app.get('/api/ventanillas', async (req, res) => {
    try {
        const result = await pool.query('SELECT municipio, usuario FROM ventanillas ORDER BY municipio');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});


app.put('/api/ventanillas/:municipio', async (req, res) => {
    const { municipio } = req.params;
    const { usuario, password } = req.body;
    try {
        await pool.query(
            'UPDATE ventanillas SET usuario = $1, password = $2 WHERE municipio = $3',
            [usuario, password, municipio]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ventanillas/validar', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query(
            'SELECT municipio FROM ventanillas WHERE usuario = $1 AND password = $2',
            [username, password]
        );
        if (result.rows.length > 0) {
            res.json({ success: true, municipio: result.rows[0].municipio });
        } else {
            res.status(401).json({ success: false, error: 'Credenciales inválidas' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});


app.get('/api/estadisticas', async (req, res) => {
    try {
       
        const productoresPorMunicipio = await pool.query(`
            SELECT municipio, COUNT(*) as total_productores
            FROM productores
            GROUP BY municipio
        `);

        
        const cabezasPorMunicipio = await pool.query(`
            SELECT p.municipio, COALESCE(SUM(
                gg.vientres + gg.crias + gg.sementales + gg.vaquillas + 
                gg.novillos + gg.engorda + gg.otras_cant
            ), 0) as total_cabezas
            FROM productores p
            LEFT JOIN grupos_ganado gg ON p.id = gg.productor_id
            GROUP BY p.municipio
        `);

     
        const stats = {};
        productoresPorMunicipio.rows.forEach(row => {
            stats[row.municipio] = { total_productores: parseInt(row.total_productores), total_cabezas: 0 };
        });
        cabezasPorMunicipio.rows.forEach(row => {
            if (stats[row.municipio]) {
                stats[row.municipio].total_cabezas = parseInt(row.total_cabezas);
            } else {
                stats[row.municipio] = { total_productores: 0, total_cabezas: parseInt(row.total_cabezas) };
            }
        });

        res.json(stats);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});


const PORT = process.env.PORT || 3000;
// Este es el Endpoint para obtener el riesgo actual ---- Diego
app.get('/api/riesgo', async (req, res) => {
    try {
        if (req.query.recalcular === 'true') {
            await calcularRiesgoMunicipios();
        }
        const resultados = await pool.query('SELECT * FROM riesgo_municipio ORDER BY riesgo_total DESC');
        res.json(resultados.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Endpoint para agregar un caso ---- Diego
app.post('/api/casos', async (req, res) => {
    const { municipio, enfermedad, num_animales_afectados, fuente } = req.body;
    if (!municipio || !enfermedad) {
        return res.status(400).json({ error: 'Municipio y enfermedad son requeridos' });
    }
    try {
        await pool.query(
            'INSERT INTO casos_sanitarios (municipio, enfermedad, fecha, num_animales_afectados, fuente) VALUES ($1, $2, CURRENT_DATE, $3, $4)',
            [municipio, enfermedad, num_animales_afectados || null, fuente || 'manual']
        );
        await calcularRiesgoMunicipios();
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});
const { exec } = require('child_process');


// Endpoint de predicción ---- Diego
app.get('/api/prediccion-ml', async (req, res) => {
    try {
        // se obtienen datos de cada municipio 
        const productores = await pool.query('SELECT municipio, COUNT(*) as total FROM productores GROUP BY municipio');
        const ganado = await pool.query(`
            SELECT p.municipio, COALESCE(SUM(gg.vientres + gg.crias + gg.sementales + gg.vaquillas + gg.novillos + gg.engorda + gg.otras_cant),0) as total_cabezas
            FROM productores p
            LEFT JOIN grupos_ganado gg ON p.id = gg.productor_id
            GROUP BY p.municipio
        `);
        const casos = await pool.query(`
            SELECT municipio, COUNT(*) as num_casos
            FROM casos_sanitarios
            WHERE enfermedad = 'barrenador' AND fecha > CURRENT_DATE - INTERVAL '90 days'
            GROUP BY municipio
        `);

        // luego lista de caracteristicas
        const municipiosSet = new Set();
        productores.rows.forEach(p => municipiosSet.add(p.municipio));
        ganado.rows.forEach(g => municipiosSet.add(g.municipio));
        const municipios = Array.from(municipiosSet);

        const features = [];
        const nombres = [];

        for (const mun of municipios) {
            const prod = productores.rows.find(p => p.municipio === mun);
            const numProductores = prod ? parseInt(prod.total) : 1;
            const gan = ganado.rows.find(g => g.municipio === mun);
            const totalCabezas = gan ? parseInt(gan.total_cabezas) : 0;
            const densidad = numProductores > 0 ? totalCabezas / numProductores : 0;

            const caso = casos.rows.find(c => c.municipio === mun);
            const numCasos = caso ? parseInt(caso.num_casos) : 0;

            // factores del ambiente
            let temperatura = 25, humedad = 60;
            if (mun === 'Poanas') { temperatura = 28; humedad = 65; }
            else if (mun === 'Durango') { temperatura = 22; humedad = 55; }
            else if (mun === 'Guadalupe Victoria') { temperatura = 30; humedad = 70; }
            else if (mun === 'Gómez Palacio') { temperatura = 32; humedad = 68; }

            features.push([densidad, numCasos, temperatura, humedad]);
            nombres.push(mun);
        }

        // una llamadilla al python
        const scriptPath = path.join(__dirname, 'predecir.py');
        const inputJson = JSON.stringify(features);
        exec(`python3 ${scriptPath} '${inputJson}'`, (error, stdout, stderr) => {
            if (error) {
                console.error('Error ejecutando Python:', error);
                return res.status(500).json({ error: 'Error en el modelo de IA' });
            }
            try {
                const resultado = JSON.parse(stdout);
                if (resultado.error) {
                    return res.status(500).json({ error: resultado.error });
                }
                const probabilidades = resultado.probabilidades;
                const respuesta = nombres.map((nombre, idx) => {
                    const prob = probabilidades[idx];
                    let nivel = 'Bajo';
                    if (prob > 0.7) nivel = 'Alto';
                    else if (prob > 0.4) nivel = 'Medio';
                    return {
                        municipio: nombre,
                        riesgo: parseFloat(prob.toFixed(2)),
                        nivel: nivel
                    };
                });
                res.json(respuesta);
            } catch (err) {
                console.error('Error parseando salida de Python:', stderr);
                res.status(500).json({ error: 'Error procesando predicción' });
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});
// De aqui para abajo es el servidor local -----Diego
app.listen(PORT, () => {
    console.log(`\n🚀 Servidor backend corriendo en http://localhost:${PORT}`);
    console.log('📋 Endpoints disponibles:');
    console.log('   GET    /api/health');
    console.log('   GET    /api/productores?municipio=Chihuahua');
    console.log('   GET    /api/productores/:id');
    console.log('   GET    /api/buscar?q=6141234567');
    console.log('   POST   /api/productores');
    console.log('   PUT    /api/productores/:id');
    console.log('   DELETE /api/productores/:id\n');
});

// para reentrenar directo al python
app.post('/api/reentrenar-ia', async (req, res) => {
    const { exec } = require('child_process');
    const scriptPath = path.join(__dirname, 'entrenar_con_datos_reales.py');
    exec(`python3 ${scriptPath}`, (error, stdout, stderr) => {
        if (error) {
            console.error('Error reentrenando:', error);
            return res.status(500).json({ error: 'Error al reentrenar el modelo' });
        }
        console.log(stdout);
        res.json({ success: true, mensaje: 'Modelo reentrenado correctamente' });
    });
});