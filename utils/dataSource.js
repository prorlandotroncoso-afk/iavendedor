// ============================================================
// utils/dataSource.js
// FUENTE DE DATOS DE MARTIN
// ============================================================
//
// Actualmente:
//     Google Sheets (si está habilitado)
//              ↓
//     campaigns.json como respaldo
//
// Más adelante Google Sheets será la fuente principal.
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


// ============================================================
// CONFIGURACIÓN
// ============================================================

const CAMPAIGNS_PATH = path.join(
    __dirname,
    '..',
    'sellers',
    'martin-autos',
    'campaigns.json'
);


function usarGoogleSheets() {
    return process.env.USE_GOOGLE_SHEETS === 'true';
}


// ============================================================
// JSON LOCAL
// ============================================================

function cargarCampaignsLocal() {

    try {

        if (!fs.existsSync(CAMPAIGNS_PATH)) {

            console.error(
                '❌ No existe campaigns.json:',
                CAMPAIGNS_PATH
            );

            return {};
        }

        const contenido = fs.readFileSync(
            CAMPAIGNS_PATH,
            'utf-8'
        );

        return JSON.parse(contenido);

    } catch (error) {

        console.error(
            '❌ Error leyendo campaigns.json:',
            error
        );

        return {};
    }
}


// ============================================================
// VALIDAR VEHÍCULO
// ============================================================

function vehiculoTieneDatos(vehiculo) {

    if (!vehiculo) return false;

    if (typeof vehiculo !== 'object') return false;

    return Object.keys(vehiculo).length > 0;
}


// ============================================================
// LISTAR VEHÍCULOS
// ============================================================

export async function listarModelosDisponibles() {

    // --------------------------------------------------------
    // 1. GOOGLE SHEETS
    // --------------------------------------------------------

    if (usarGoogleSheets()) {

        try {

            const vehiculosSheets =
                await listarVehiculosDesdeSheets();

            if (
                Array.isArray(vehiculosSheets) &&
                vehiculosSheets.length > 0
            ) {

                return vehiculosSheets
                    .filter(v => v && v.activo !== false)
                    .map(v => ({
                        key: String(v.key || v.codigo || '').toLowerCase(),
                        ...v
                    }))
                    .filter(v => v.key);
            }

        } catch (error) {

            console.error(
                '⚠️ Error leyendo Google Sheets. Uso JSON local.',
                error
            );
        }
    }


    // --------------------------------------------------------
    // 2. RESPALDO LOCAL
    // --------------------------------------------------------

    const campaigns = cargarCampaignsLocal();

    return Object.entries(campaigns)
        .filter(([_, data]) => {

            if (!vehiculoTieneDatos(data)) {
                return false;
            }

            if (data.activo === false) {
                return false;
            }

            return true;
        })
        .map(([key, data]) => ({
            key: key.toLowerCase(),
            ...data
        }));
}


// ============================================================
// OBTENER VEHÍCULO
// ============================================================

export async function obtenerVehiculo(modeloKey) {

    if (!modeloKey) {
        return null;
    }

    const key = String(modeloKey).toLowerCase();


    // --------------------------------------------------------
    // 1. GOOGLE SHEETS
    // --------------------------------------------------------

    if (usarGoogleSheets()) {

        try {

            const vehiculoSheets =
                await obtenerVehiculoDesdeSheets(key);

            if (vehiculoTieneDatos(vehiculoSheets)) {

                return {
                    key,
                    ...vehiculoSheets
                };
            }

        } catch (error) {

            console.error(
                `⚠️ Error buscando ${key} en Sheets. Uso JSON local.`,
                error
            );
        }
    }


    // --------------------------------------------------------
    // 2. RESPALDO LOCAL
    // --------------------------------------------------------

    const campaigns = cargarCampaignsLocal();

    const vehiculo = campaigns[key];

    if (!vehiculoTieneDatos(vehiculo)) {
        return null;
    }

    return {
        key,
        ...vehiculo
    };
}