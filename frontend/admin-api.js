// admin-api.js
const API_BASE = ''; // relativo

export async function obtenerVentanillas() {
    const response = await fetch('/api/ventanillas');
    if (!response.ok) throw new Error('Error al obtener ventanillas');
    return response.json();
}

export async function actualizarVentanilla(municipio, usuario, password) {
    const response = await fetch(`/api/ventanillas/${encodeURIComponent(municipio)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, password })
    });
    if (!response.ok) throw new Error('Error al actualizar');
    return response.json();
}

export async function obtenerEstadisticas() {
    const response = await fetch('/api/estadisticas');
    if (!response.ok) throw new Error('Error al obtener estadísticas');
    return response.json();
}