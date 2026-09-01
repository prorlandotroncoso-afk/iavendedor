// ============================================================
// utils/dataSource.js
// FUENTE DE DATOS DE MARTIN
// ============================================================
//
// FUENTE PRINCIPAL: Google Sheets
// RESPALDO: sellers/martin-autos/campaigns.json
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
    listarVehiculosDesdeSheets,
    obtenerVehiculoDesdeSheets
} from '../config/googleSheets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CAMPAIGNS_PATH = path.join(
    __dirname,
    '..',
    'sellers',
    'martin-autos',
    'campaigns.json'
);

function usarGoogleSheets() {
    return String(process.env.USE_GOOGLE_SHEETS || '')
        .toLowerCase()
        .trim() === 'true';
}

function vehiculoTieneDatos(vehiculo) {
    if (!vehiculo || typeof vehiculo !== 'object') {
        return false;
    }

    return Object.keys(vehiculo).length > 0;
}

function cargarCampaignsLocal() {
    try {
        if (!fs.existsSync(CAMPAIGNS_PATH)) {
            console.error('❌ No existe campaigns.json:', CAMPAIGNS_PATH);
            return {};
        }

        const contenido = fs.readFileSync(CAMPAIGNS_PATH, 'utf-8');
        return JSON.parse(contenido);
    } catch (error) {
        console.error('❌ Error leyendo campaigns.json:', error.message);
        return {};
    }
}

function normalizarKey(valor) {
    return String(valor || '').trim().toLowerCase();
}

export async function listarModelosDisponibles() {
    if (usarGoogleSheets()) {
        try {
            const vehiculosSheets = await listarVehiculosDesdeSheets();

            if (Array.isArray(vehiculosSheets) && vehiculosSheets.length > 0) {
                const vehiculosValidos = vehiculosSheets
                    .filter(vehiculo => vehiculoTieneDatos(vehiculo))
                    .filter(vehiculo => vehiculo.activo !== false)
                    .map(vehiculo => {
                        const key = normalizarKey(vehiculo.key || vehiculo.codigo);
                        return { ...vehiculo, key };
                    })
                    .filter(vehiculo => vehiculo.key);

                if (vehiculosValidos.length > 0) {
                    return vehiculosValidos;
                }
            }

            console.warn('⚠️ Sheets no devolvió vehículos. Uso campaigns.json.');
        } catch (error) {
            console.error('⚠️ No se pudo leer Google Sheets:', error.message);
            console.log('📂 Usando campaigns.json como respaldo.');
        }
    }

    const campaigns = cargarCampaignsLocal();

    return Object.entries(campaigns)
        .filter(([_, data]) => vehiculoTieneDatos(data))
        .filter(([_, data]) => data.activo !== false)
        .map(([key, data]) => ({
            ...data,
            key: normalizarKey(key)
        }));
}

export async function obtenerVehiculo(modeloKey) {
    if (!modeloKey) {
        return null;
    }

    const key = normalizarKey(modeloKey);

    if (usarGoogleSheets()) {
        try {
            const vehiculoSheets = await obtenerVehiculoDesdeSheets(key);

            if (vehiculoTieneDatos(vehiculoSheets)) {
                return { ...vehiculoSheets, key };
            }

            console.warn(`⚠️ ${key} no apareció en Sheets. Buscando respaldo local.`);
        } catch (error) {
            console.error(`⚠️ Error consultando ${key} en Google Sheets:`, error.message);
            console.log('📂 Intentando campaigns.json.');
        }
    }

    const campaigns = cargarCampaignsLocal();
    const vehiculo = campaigns[key];

    if (!vehiculoTieneDatos(vehiculo)) {
        return null;
    }

    return { ...vehiculo, key };
}
