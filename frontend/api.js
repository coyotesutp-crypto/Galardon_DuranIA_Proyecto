// api.js
const API_BASE = '';  // vacío para usar rutas relativas

export async function obtenerProductores(municipio) {
    const url = `/api/productores?municipio=${municipio}`;
    console.log('📡 Llamando a API:', url);
    const response = await fetch(url);
    if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Error HTTP:', response.status, errorText);
        throw new Error(`Error HTTP ${response.status}`);
    }
    return await response.json();
}

export async function obtenerProductor(id) {
    const response = await fetch(`/api/productores/${id}`);
    if (!response.ok) throw new Error(`Error HTTP ${response.status}`);
    return response.json();
}

export async function buscarProductorPorUPP(upp) {
    const response = await fetch(`/api/productores/buscar-upp?upp=${encodeURIComponent(upp)}`);
    if (!response.ok) throw new Error(`Error HTTP ${response.status}`);
    return await response.json();
}

export async function crearProductor(productor, gruposGanado) {
    const response = await fetch(`/api/productores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productor, gruposGanado })
    });
    if (!response.ok) throw new Error(`Error HTTP ${response.status}`);
    return response.json();
}

export async function actualizarProductor(id, productor, gruposGanado) {
    const response = await fetch(`/api/productores/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productor, gruposGanado })
    });
    if (!response.ok) throw new Error(`Error HTTP ${response.status}`);
    return response.json();
}