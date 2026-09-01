// ============================================================
// config/googleSheets.js
// CONEXIÓN GOOGLE SHEETS - MARTIN IA SELLER
// ============================================================

function obtenerBaseUrl() {
    const url = process.env.GOOGLE_SHEETS_URL;

    if (!url) {
        throw new Error('GOOGLE_SHEETS_URL no está configurada');
    }

    return url;
}

async function hacerGet(params = {}) {
    const baseUrl = obtenerBaseUrl();
    const url = new URL(baseUrl);

    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value));
        }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
        const response = await fetch(url.toString(), {
            method: 'GET',
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`Google Sheets respondió HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.ok !== true) {
            throw new Error(data.error || 'Google Sheets devolvió un error');
        }

        return data;
    } finally {
        clearTimeout(timeout);
    }
}

async function hacerPost(body = {}) {
    const baseUrl = obtenerBaseUrl();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`Google Sheets respondió HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.ok !== true) {
            throw new Error(data.error || 'Google Sheets devolvió un error');
        }

        return data;
    } finally {
        clearTimeout(timeout);
    }
}

// ============================================================
// VEHÍCULOS
// ============================================================

export async function listarVehiculosDesdeSheets() {
    const data = await hacerGet({ action: 'vehiculos' });
    return Array.isArray(data.vehiculos) ? data.vehiculos : [];
}

export async function obtenerVehiculoDesdeSheets(modeloKey) {
    if (!modeloKey) {
        return null;
    }

    const data = await hacerGet({
        action: 'vehiculo',
        codigo: String(modeloKey).trim().toLowerCase()
    });

    return data.vehiculo || null;
}

export async function obtenerCuotasDesdeSheets(modeloKey) {
    if (!modeloKey) {
        return [];
    }

    const data = await hacerGet({
        action: 'cuotas',
        codigo: String(modeloKey).trim().toLowerCase()
    });

    return Array.isArray(data.cuotas) ? data.cuotas : [];
}

// ============================================================
// LEADS
// ============================================================

// guardarLead hace UPSERT en Apps Script:
// teléfono nuevo -> crea fila
// teléfono existente -> actualiza la misma fila
export async function guardarLead(datos) {
    const data = await hacerPost({
        action: 'guardarLead',
        lead: datos
    });

    return data.resultado || { guardado: true };
}

export async function buscarLead(telefono) {
    if (!telefono) {
        return null;
    }

    const data = await hacerGet({
        action: 'lead',
        telefono: String(telefono).trim()
    });

    return data.lead || null;
}

export async function actualizarEtapa(telefono, etapa, datos = {}) {
    if (!telefono) {
        return null;
    }

    const data = await hacerPost({
        action: 'actualizarLead',
        lead: {
            ...datos,
            telefono: String(telefono).trim(),
            estado: etapa
        }
    });

    return data.resultado || { actualizado: true };
}
