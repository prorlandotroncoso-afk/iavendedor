// ============================================================
// config/googleSheets.js
// ADAPTADOR GOOGLE SHEETS - MARTIN IA SELLER
// ============================================================
//
// IMPORTANTE:
// Google Sheets todavía NO está conectado.
//
// Martin puede funcionar igualmente porque utils/dataSource.js
// utiliza campaigns.json como respaldo.
//
// Cuando conectemos Sheets, solamente tendremos que completar
// las funciones de este archivo.
// ============================================================


// ============================================================
// VEHÍCULOS / CAMPAÑAS
// ============================================================

export async function listarVehiculosDesdeSheets() {

    // FUTURO:
    // Leer pestaña VEHICULOS de Google Sheets.
    //
    // Debe devolver algo así:
    //
    // [
    //   {
    //      key: "2008",
    //      modelo: "Peugeot 2008 Allure",
    //      plan: "70/30",
    //      cuota_1: "$250.000",
    //      activo: true
    //   }
    // ]

    return [];
}


export async function obtenerVehiculoDesdeSheets(modeloKey) {

    // FUTURO:
    // Buscar en Google Sheets el vehículo correspondiente.
    //
    // Ejemplo:
    //
    // modeloKey = "2008"
    //
    // devolver:
    //
    // {
    //   modelo: "Peugeot 2008 Allure",
    //   plan: "70/30",
    //   cuota_1: "$250.000",
    //   ...
    // }

    return null;
}


// ============================================================
// LEADS
// ============================================================

export async function guardarLead(datos) {

    // FUTURO:
    // Guardar el lead en una pestaña LEADS.

    console.log('📊 [SHEETS PENDIENTE] Lead:', datos);

    return true;
}


export async function buscarLead(telefono) {

    // FUTURO:
    // Buscar lead por teléfono.

    return null;
}


export async function actualizarEtapa(telefono, etapa, datos = {}) {

    // FUTURO:
    // Actualizar el lead dentro de Google Sheets.

    console.log(
        '📊 [SHEETS PENDIENTE] Actualización:',
        telefono,
        etapa,
        datos
    );

    return true;
}