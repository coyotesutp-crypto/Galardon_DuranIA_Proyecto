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
