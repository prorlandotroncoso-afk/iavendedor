// ============================================================
// config/googleSheets.js - Gestión de leads en Google Sheets
// ============================================================

// Este archivo es opcional. Por ahora solo exporta funciones vacías.
export async function guardarLead(datos) {
    console.log('📊 Guardando lead:', datos);
    return true;
}

export async function buscarLead(telefono) {
    return null;
}

export async function actualizarEtapa(telefono, etapa, datos) {
    console.log('📊 Actualizando etapa:', telefono, etapa);
    return true;
}