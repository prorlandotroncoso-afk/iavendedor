// ============================================================
// config/googleSheets.js
// CONEXIÓN GOOGLE SHEETS - MARTIN IA SELLER
// ============================================================
//
// Google Sheets se comunica con Martin mediante
// una Web App de Google Apps Script.
//
// La URL se guarda en Render como:
// GOOGLE_SHEETS_URL
//
// ============================================================


// ============================================================
// CONFIGURACIÓN
// ============================================================

function obtenerBaseUrl() {

    const url =
        process.env.GOOGLE_SHEETS_URL;

    if (!url) {

        throw new Error(
            'GOOGLE_SHEETS_URL no está configurada'
        );
    }

    return url;
}


// ============================================================
// REQUEST GET
// ============================================================

async function hacerGet(params = {}) {

    const baseUrl =
        obtenerBaseUrl();


    const url =
        new URL(baseUrl);


    for (
        const [key, value]
        of Object.entries(params)
    ) {

        if (
            value !== undefined &&
            value !== null
        ) {

            url.searchParams.set(
                key,
                String(value)
            );
        }
    }


    const controller =
        new AbortController();


    const timeout =
        setTimeout(
            () => controller.abort(),
            8000
        );


    try {

        const response =
            await fetch(
                url.toString(),
                {
                    method: 'GET',
                    signal: controller.signal
                }
            );


        if (!response.ok) {

            throw new Error(
                `Google Sheets respondió HTTP ${response.status}`
            );
        }


        const data =
            await response.json();


        if (data.ok !== true) {

            throw new Error(
                data.error ||
                'Google Sheets devolvió un error'
            );
        }


        return data;


    } finally {

        clearTimeout(timeout);
    }
}


// ============================================================
// REQUEST POST
// ============================================================

async function hacerPost(body = {}) {

    const baseUrl =
        obtenerBaseUrl();


    const controller =
        new AbortController();


    const timeout =
        setTimeout(
            () => controller.abort(),
            8000
        );


    try {

        const response =
            await fetch(
                baseUrl,
                {
                    method: 'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify(body),

                    signal:
                        controller.signal
                }
            );


        if (!response.ok) {

            throw new Error(
                `Google Sheets respondió HTTP ${response.status}`
            );
        }


        const data =
            await response.json();


        if (data.ok !== true) {

            throw new Error(
                data.error ||
                'Google Sheets devolvió un error'
            );
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

    const data =
        await hacerGet({
            action: 'vehiculos'
        });


    if (
        !Array.isArray(
            data.vehiculos
        )
    ) {

        return [];
    }


    return data.vehiculos;
}


// ============================================================
// VEHÍCULO INDIVIDUAL
// ============================================================

export async function obtenerVehiculoDesdeSheets(
    modeloKey
) {

    if (!modeloKey) {

        return null;
    }


    const data =
        await hacerGet({

            action: 'vehiculo',

            codigo:
                String(modeloKey)
                    .trim()
                    .toLowerCase()
        });


    return (
        data.vehiculo ||
        null
    );
}


// ============================================================
// CUOTAS
// ============================================================

export async function obtenerCuotasDesdeSheets(
    modeloKey
) {

    if (!modeloKey) {

        return [];
    }


    const data =
        await hacerGet({

            action: 'cuotas',

            codigo:
                String(modeloKey)
                    .trim()
                    .toLowerCase()
        });


    return Array.isArray(
        data.cuotas
    )
        ? data.cuotas
        : [];
}


// ============================================================
// GUARDAR LEAD
// ============================================================
//
// Ya queda preparado.
//
// Lo conectaremos desde index.js cuando terminemos
// la parte de leads y derivaciones.
// ============================================================

export async function guardarLead(
    datos
) {

    const data =
        await hacerPost({

            action:
                'guardarLead',

            lead:
                datos
        });


    return (
        data.resultado ||
        {
            guardado: true
        }
    );
}


// ============================================================
// BUSCAR LEAD
// ============================================================
//
// Todavía no está implementado en Apps Script.
// Lo dejamos preparado para la siguiente etapa.
// ============================================================

export async function buscarLead(
    telefono
) {

    console.log(
        '📊 buscarLead pendiente:',
        telefono
    );

    return null;
}


// ============================================================
// ACTUALIZAR LEAD
// ============================================================
//
// También queda reservado para memoria persistente
// y seguimientos.
// ============================================================

export async function actualizarEtapa(
    telefono,
    etapa,
    datos = {}
) {

    console.log(
        '📊 actualizarEtapa pendiente:',
        telefono,
        etapa,
        datos
    );

    return true;
}