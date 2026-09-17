// ============================================================
// index.js
// MARTIN IA SELLER
// VERSIÓN HÍBRIDA + CONTEXTO + HORARIOS CONTROLADOS
// ============================================================

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Groq from 'groq-sdk';

import { loadSeller } from './utils/loader.js';

import {
    listarModelosDisponibles,
    obtenerVehiculo
} from './utils/dataSource.js';

import {
    guardarLead as guardarLeadEnSheets
} from './config/googleSheets.js';


dotenv.config();


// ============================================================
// 1. APP
// ============================================================

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));


// ============================================================
// 2. CONFIGURACIÓN SELLER
// ============================================================

const seller = await loadSeller();

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const GROQ_MODEL =
    process.env.GROQ_MODEL ||
    'qwen/qwen3.8-27b';


// ============================================================
// WHATSAPP CLOUD API - CONFIGURACIÓN
// ============================================================
//
// Estas variables se configuran en Render.
// No escribir tokens ni secretos directamente en este archivo.
//
// ============================================================

const WHATSAPP_TOKEN =
    process.env.WHATSAPP_TOKEN;

const WHATSAPP_PHONE_NUMBER_ID =
    process.env.WHATSAPP_PHONE_NUMBER_ID;

const WHATSAPP_VERIFY_TOKEN =
    process.env.WHATSAPP_VERIFY_TOKEN;

const WHATSAPP_API_VERSION =
    process.env.WHATSAPP_API_VERSION || 'v25.0';

const MARTIN_SHEETS_WEBAPP_URL =
    process.env.MARTIN_SHEETS_WEBAPP_URL ||
    'https://script.google.com/macros/s/AKfycbw6jYaY3JU5I79i5BoUX9jP_hcOljlwuASSZhZ-RE7wkTVb-yExuVA9Nfv1UhgB9w3o/exec';



// ============================================================
// 3. MEMORIA TEMPORAL
// ============================================================
//
// Por ahora vive en RAM.
//
// Leads de WhatsApp → Google Sheets (activo).
// Memoria conversacional → RAM por ahora.
// Seguimientos automáticos → próxima etapa.
//
// ============================================================

const clientes = {};


const modosAtencion = new Map();

const MINUTOS_REACTIVACION = 30;
const FRASE_CIERRE_HUMANO =
    'perfecto cualquier otra consulta podes escribirnos por aca';

function normalizarTelefono(valor = '') {
    return String(valor || '')
        .replace(/\D/g, '')
        .trim();
}

function normalizarComandoHumano(texto = '') {
    return normalizar(texto)
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function getEstadoAtencion(telefono) {
    const clave = normalizarTelefono(telefono);

    if (!clave) {
        return {
            modo: 'IA',
            reactivarDespuesDe: null,
            historialHumano: []
        };
    }

    if (!modosAtencion.has(clave)) {
        modosAtencion.set(clave, {
            modo: 'IA',
            reactivarDespuesDe: null,
            historialHumano: []
        });
    }

    return modosAtencion.get(clave);
}

function getModoAtencion(telefono) {
    const estado = getEstadoAtencion(telefono);

    if (
        estado.modo === 'ESPERA' &&
        estado.reactivarDespuesDe &&
        Date.now() >= estado.reactivarDespuesDe
    ) {
        estado.modo = 'IA';
        estado.reactivarDespuesDe = null;

        console.log(
            `🤖 Martín reactivado automáticamente para ${normalizarTelefono(telefono)}`
        );
    }

    return estado.modo;
}

function setModoAtencion(telefono, modo, opciones = {}) {
    const clave = normalizarTelefono(telefono);
    if (!clave) return;

    const estado = getEstadoAtencion(clave);
    const solicitado = String(modo || '').toUpperCase();
    const nuevoModo =
        ['IA', 'HUMANO', 'ESPERA'].includes(solicitado)
            ? solicitado
            : 'IA';

    estado.modo = nuevoModo;

    if (nuevoModo === 'ESPERA') {
        estado.reactivarDespuesDe =
            opciones.reactivarDespuesDe ||
            Date.now() + MINUTOS_REACTIVACION * 60 * 1000;
    } else {
        estado.reactivarDespuesDe = null;
    }

    console.log(`🧭 Modo ${nuevoModo} para ${clave}`);
}

function registrarHistorialHumano(telefono, rol, mensaje) {
    const estado = getEstadoAtencion(telefono);
    const texto = String(mensaje || '').trim();
    if (!texto) return;

    estado.historialHumano.push({
        rol,
        mensaje: texto,
        fecha: Date.now()
    });

    if (estado.historialHumano.length > 20) {
        estado.historialHumano = estado.historialHumano.slice(-20);
    }
}

function volcarHistorialHumanoEnCliente(telefono, cliente) {
    const estado = getEstadoAtencion(telefono);

    if (!Array.isArray(estado.historialHumano) ||
        estado.historialHumano.length === 0) {
        return;
    }

    for (const item of estado.historialHumano) {
        guardarHistorial(
            cliente,
            item.rol === 'humano' ? 'asesor' : 'cliente',
            item.mensaje
        );
    }

    estado.historialHumano = [];
    console.log(
        `🧠 Contexto humano incorporado para ${normalizarTelefono(telefono)}`
    );
}

function esFraseCierreHumano(texto) {
    return normalizarComandoHumano(texto) === FRASE_CIERRE_HUMANO;
}

function reiniciarEsperaSiCorresponde(telefono) {
    const estado = getEstadoAtencion(telefono);
    if (estado.modo !== 'ESPERA') return;

    estado.reactivarDespuesDe =
        Date.now() + MINUTOS_REACTIVACION * 60 * 1000;

    console.log(
        `⏳ Espera reiniciada ${MINUTOS_REACTIVACION} min para ${normalizarTelefono(telefono)}`
    );
}

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


const memoriasCargadas = new Set();

async function leerMemoriaSheets(telefono) {
    const clave = normalizarTelefono(telefono);
    if (!clave) return null;
    try {
        const url = `${MARTIN_SHEETS_WEBAPP_URL}?action=memoria&telefono=${encodeURIComponent(clave)}`;
        const r = await fetch(url);
        const data = await r.json();
        if (!r.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${r.status}`);
        return data?.memoria || null;
    } catch (e) {
        console.error('⚠️ No se pudo leer MEMORIA:', e.message);
        return null;
    }
}

async function escribirMemoriaSheets(memoria) {
    const clave = normalizarTelefono(memoria?.telefono);
    if (!clave) return false;
    try {
        const r = await fetch(MARTIN_SHEETS_WEBAPP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
                action: 'guardarMemoria',
                memoria: { ...memoria, telefono: clave }
            })
        });
        const data = await r.json();
        if (!r.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${r.status}`);
        return true;
    } catch (e) {
        console.error('⚠️ No se pudo guardar MEMORIA:', e.message);
        return false;
    }
}

function resumenConversacionPersistente(cliente) {
    return (cliente?.historial || [])
        .slice(-12)
        .map(x => `${x.rol}: ${x.mensaje}`)
        .join(' | ')
        .slice(0, 3500);
}

function resumenHumanoPersistente(telefono) {
    const estado = getEstadoAtencion(telefono);
    return (estado?.historialHumano || [])
        .slice(-20)
        .map(x => `${x.rol === 'humano' ? 'asesor' : 'cliente'}: ${x.mensaje}`)
        .join(' | ')
        .slice(0, 3500);
}

async function cargarMemoriaPersistente(telefono, cliente) {
    const clave = normalizarTelefono(telefono);
    if (!clave || memoriasCargadas.has(clave)) return;

    const m = await leerMemoriaSheets(clave);
    memoriasCargadas.add(clave);
    if (!m) return;

    if (!cliente.nombre && m.nombre) cliente.nombre = String(m.nombre);
    if (!cliente.modelo && m.modeloInteres) cliente.modelo = String(m.modeloInteres);
    if (!cliente.metodo && m.metodoInteres) cliente.metodo = String(m.metodoInteres);
    if (m.estadoConversacion) cliente.etapa = String(m.estadoConversacion);
    if (m.ultimaIntencion) cliente.ultimaIntencionPersistente = String(m.ultimaIntencion);

    if (m.resumenConversacion) {
        guardarHistorial(cliente, 'contexto',
            `Resumen de conversación anterior: ${String(m.resumenConversacion)}`);
    }
    if (m.resumenIntervencionHumana) {
        guardarHistorial(cliente, 'contexto',
            `Resumen de la última intervención humana: ${String(m.resumenIntervencionHumana)}`);
    }

    const modo = String(m.modo || 'IA').toUpperCase();
    const reactivar = m.reactivarDespuesDe ? new Date(m.reactivarDespuesDe).getTime() : 0;

    if (modo === 'ESPERA' && reactivar > Date.now()) {
        setModoAtencion(clave, 'ESPERA', { reactivarDespuesDe: reactivar });
    } else if (modo === 'HUMANO') {
        setModoAtencion(clave, 'HUMANO');
    } else {
        setModoAtencion(clave, 'IA');
    }

    console.log(`🧠 Memoria recuperada: ${clave}`);
}

async function guardarMemoriaPersistente(telefono, cliente, extras = {}) {
    const clave = normalizarTelefono(telefono);
    if (!clave) return false;

    const modo = getModoAtencion(clave);
    const estado = getEstadoAtencion(clave);

    const memoria = {
        telefono: clave,
        nombre: extras.nombre || cliente?.nombre || '',
        modeloInteres: cliente?.modelo || '',
        metodoInteres: cliente?.metodo || '',
        estadoConversacion: cliente?.etapa || 'inicio',
        ultimaIntencion: extras.ultimaIntencion || cliente?.ultimaIntencionPersistente || '',
        resumenConversacion: resumenConversacionPersistente(cliente),
        resumenIntervencionHumana:
            extras.resumenIntervencionHumana !== undefined
                ? extras.resumenIntervencionHumana
                : resumenHumanoPersistente(clave),
        ultimaInteraccion: new Date().toISOString(),
        modo,
        reactivarDespuesDe:
            modo === 'ESPERA' && estado?.reactivarDespuesDe
                ? new Date(estado.reactivarDespuesDe).toISOString()
                : '',
        ultimaRespuestaMartin: cliente?.ultimoMensajeMartin || ''
    };

    const ok = await escribirMemoriaSheets(memoria);
    if (ok) console.log(`💾 Memoria sincronizada: ${clave} (${modo})`);
    return ok;
}


function getCliente(userId) {

    if (!clientes[userId]) {

        clientes[userId] = {

            etapa: 'inicio',

            nombre: null,

            modelo: null,

            metodo: null,

            usoVehiculo: null,

            decisionCompra: null,

            calificacionCompletada: false,

            llamadaConjuntaOfrecida: false,

            llamadaConjuntaRechazada: false,

            historial: [],

            esperandoRespuesta: null,

            opcionesEsperadas: [],

            derivacionSolicitada: false,

            horarioContacto: null,

            ultimaInteraccion: Date.now(),

            ultimoMensajeMartin: null,

            seguimiento20mEnviado: false,

            seguimiento24hEnviado: false
        };
    }

    return clientes[userId];
}


function guardarHistorial(cliente, rol, mensaje) {

    cliente.historial.push({
        rol,
        mensaje,
        fecha: Date.now()
    });


    if (cliente.historial.length > 30) {

        cliente.historial =
            cliente.historial.slice(-30);
    }


    cliente.ultimaInteraccion =
        Date.now();


    if (rol === 'martin') {

        cliente.ultimoMensajeMartin =
            mensaje;
    }
}


// ============================================================
// 4. UTILIDADES
// ============================================================

function normalizar(texto = '') {

    return String(texto)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}



function numeroDesdeMonto(valor) {

    if (
        typeof valor === 'number' &&
        Number.isFinite(valor)
    ) {
        return valor;
    }

    if (
        valor === null ||
        valor === undefined ||
        valor === ''
    ) {
        return null;
    }

    let texto =
        String(valor)
            .trim()
            .replace(/ARS/gi, '')
            .replace(/\$/g, '')
            .replace(/\s/g, '');

    if (!texto) {
        return null;
    }

    if (texto.includes(',')) {

        texto =
            texto
                .replace(/\./g, '')
                .replace(',', '.');

    } else {

        const puntos =
            (texto.match(/\./g) || []).length;

        if (puntos >= 1) {
            texto =
                texto.replace(/\./g, '');
        }
    }

    texto =
        texto.replace(
            /[^0-9.-]/g,
            ''
        );

    const numero =
        Number(texto);

    return Number.isFinite(numero)
        ? numero
        : null;
}


function formatearPesos(valor) {

    const numero =
        numeroDesdeMonto(valor);

    if (numero === null) {

        return String(
            valor || ''
        ).trim();
    }

    return (
        '$' +
        Math.round(numero)
            .toLocaleString('es-AR')
    );
}


function formatearPorcentaje(valor) {

    if (
        valor === null ||
        valor === undefined ||
        valor === ''
    ) {
        return '';
    }

    if (
        typeof valor === 'string' &&
        valor.includes('%')
    ) {

        const limpio =
            valor.trim();

        return limpio;
    }

    let numero =
        Number(
            String(valor)
                .replace(',', '.')
                .trim()
        );

    if (!Number.isFinite(numero)) {
        return String(valor).trim();
    }

    // Compatibilidad con celdas antiguas de Sheets:
    // 0.20 -> 20%
    if (
        numero > 0 &&
        numero <= 1
    ) {
        numero *= 100;
    }

    return (
        Number.isInteger(numero)
            ? String(numero)
            : String(
                Number(
                    numero.toFixed(2)
                )
            )
    ) + '%';
}


function textoCuotasEntrega(valor) {

    const texto =
        String(
            valor || ''
        ).trim();

    if (!texto) {
        return '';
    }

    const varias =
        /[,y\/-]/i.test(texto);

    return varias
        ? `en las cuotas ${texto}`
        : `en la cuota ${texto}`;
}


function respuestaUsoVehiculo(mensaje) {

    const t = normalizar(mensaje);

    if (
        contieneAlguna(t, [
            'trabajo',
            'laburo',
            'trabajar',
            'reparto',
            'repartir',
            'uber',
            'cabify',
            'taxi',
            'comercial'
        ])
    ) {
        return 'trabajo';
    }

    if (
        contieneAlguna(t, [
            'uso general',
            'personal',
            'familia',
            'familiar',
            'pasear',
            'viajar',
            'particular'
        ])
    ) {
        return 'uso general';
    }

    return String(mensaje || '').trim();
}


function decisionEsCompartida(mensaje) {

    const t = normalizar(mensaje);

    return contieneAlguna(t, [
        'con mi esposa',
        'con mi esposo',
        'con mi pareja',
        'con mi novia',
        'con mi novio',
        'con mi marido',
        'con mi mujer',
        'con mi socio',
        'con mi socia',
        'con alguien',
        'entre los dos',
        'entre ambos',
        'los dos',
        'mi pareja',
        'mi esposa',
        'mi esposo',
        'mi socio',
        'mi socia'
    ]);
}


function decisionEsIndividual(mensaje) {

    const t = normalizar(mensaje);

    return contieneAlguna(t, [
        'solo',
        'sola',
        'yo solo',
        'yo sola',
        'decido yo',
        'por mi cuenta',
        'yo mismo',
        'yo misma'
    ]);
}


async function sincronizarLeadWhatsApp(
    telefono,
    nombre,
    cliente
) {

    try {

        const resumen =
            cliente.historial
                .slice(-6)
                .map(
                    item =>
                        `${item.rol}: ${item.mensaje}`
                )
                .join(' | ')
                .slice(0, 1500);

        await guardarLeadEnSheets({

            telefono:
                String(
                    telefono || ''
                ).trim(),

            nombre:
                nombre ||
                cliente.nombre ||
                '',

            modelo:
                cliente.modelo ||
                '',

            metodo:
                cliente.metodo ||
                '',

            estado:
                cliente.etapa ||
                'inicio',

            ultimaInteraccion:
                new Date(
                    cliente.ultimaInteraccion ||
                    Date.now()
                ).toISOString(),

            resumen,

            derivadoA:
                (
                    cliente.derivacionSolicitada ||
                    cliente.etapa === 'derivado'
                )
                    ? (
                        seller.asesorDerivacion ||
                        'Edgardo'
                    )
                    : '',

            horarioContacto:
                cliente.horarioContacto ||
                '',

            seguimiento20m:
                cliente.seguimiento20mEnviado
                    ? 'SI'
                    : 'NO',

            seguimiento24h:
                cliente.seguimiento24hEnviado
                    ? 'SI'
                    : 'NO'
        });


        console.log(
            `📊 Lead sincronizado: ${telefono}`
        );


    } catch (error) {

        // Un problema de Sheets no debe bloquear la conversación.
        console.error(
            '⚠️ No se pudo sincronizar LEADS:',
            error.message
        );
    }
}


function contieneAlguna(texto, palabras) {

    const t =
        normalizar(texto);


    return palabras.some(
        palabra =>
            t.includes(
                normalizar(palabra)
            )
    );
}


function esConfirmacionSimple(texto) {

    const t =
        normalizar(texto);


    const confirmaciones = [

        'si',
        'dale',
        'ok',
        'okay',
        'bueno',
        'perfecto',
        'claro',
        'de una',
        'esta bien',
        'me sirve',
        'si dale',
        'dale si',
        'si claro',
        'si por favor'
    ];


    return confirmaciones.includes(t);
}


function esNegacionSimple(texto) {

    const t =
        normalizar(texto);


    const negaciones = [

        'no',
        'no gracias',
        'ahora no',
        'por ahora no',
        'despues',
        'mas adelante',
        'dejalo'
    ];


    return negaciones.includes(t);
}


function esSaludo(texto) {

    const t =
        normalizar(texto);


    const saludos = [

        'hola',
        'buenas',
        'buen dia',
        'buenas tardes',
        'buenas noches',
        'que tal',
        'como estas'
    ];


    return saludos.includes(t);
}


function tieneSaludoInicial(texto) {

    const t = normalizar(texto);

    return /^(hola|buenas|buen dia|buenas tardes|buenas noches|que tal|como estas)(\b|[,!.?])/i.test(t);
}


function nombreVehiculo(vehiculo, fallback) {

    return (
        vehiculo?.modelo ||
        fallback?.toUpperCase() ||
        'el vehículo'
    );
}


// ============================================================
// 5. DETECTAR REFERENCIA TEMPORAL
// ============================================================
//
// IMPORTANTE:
//
// Martin NO debe considerar cualquier texto como horario.
//
// Ejemplos válidos:
//
// mañana a las 10
// hoy a las 20
// el lunes a la tarde
// esta tarde
// tipo 10 de la mañana
// después de las 18
// enseguida a las 8 de la noche
//
// Ejemplos NO válidos:
//
// detalle de las cuotas
// esperá
// ok
// antes decime el precio
//
// ============================================================

function tieneReferenciaTemporal(mensaje) {

    const texto =
        normalizar(mensaje);


    const referencias = [

        'hoy',
        'manana',
        'pasado manana',

        'lunes',
        'martes',
        'miercoles',
        'jueves',
        'viernes',
        'sabado',
        'domingo',

        'esta manana',
        'esta tarde',
        'esta noche',

        'a la manana',
        'por la manana',
        'a la tarde',
        'por la tarde',
        'a la noche',
        'por la noche',

        'temprano',
        'mediodia',
        'medio dia',
        'despues del mediodia',

        'enseguida',
        'en un rato'
    ];


    if (
        referencias.some(
            referencia =>
                texto.includes(referencia)
        )
    ) {

        return true;
    }


    // --------------------------------------------------------
    // HORAS EXPLÍCITAS
    // --------------------------------------------------------
    //
    // a las 8
    // a las 20
    // tipo 10
    // tipo 10:30
    // 18:00
    // 8 pm
    //
    // --------------------------------------------------------

    const patronesHora = [

        /\ba las?\s+\d{1,2}(?::\d{2})?\b/,

        /\btipo\s+\d{1,2}(?::\d{2})?\b/,

        /\b\d{1,2}:\d{2}\b/,

        /\b\d{1,2}\s*(am|pm)\b/,

        /\bdespues de las?\s+\d{1,2}\b/,

        /\bantes de las?\s+\d{1,2}\b/
    ];


    return patronesHora.some(
        patron =>
            patron.test(texto)
    );
}


// ============================================================
// 6. DETECCIÓN DIRECTA DE MODELO
// ============================================================

async function detectarModeloDirecto(mensaje) {

    const modelos =
        await listarModelosDisponibles();


    const texto =
        normalizar(mensaje);


    for (const vehiculo of modelos) {

        const key =
            normalizar(
                vehiculo.key
            );


        const modeloCompleto =
            normalizar(
                vehiculo.modelo || ''
            );


        // Los anuncios suelen mencionar una versión corta del modelo
        // (por ejemplo "C3" o "2008") aunque en Sheets figure
        // "Citroën C3 Feel Look". Detectamos tokens distintivos con
        // números sin depender de una lista fija por vehículo.
        const tokensDistintivos =
            modeloCompleto
                .split(/\s+/)
                .filter(token => /\d/.test(token));

        const coincideTokenDistintivo =
            tokensDistintivos.some(token => {
                const patron = new RegExp(`(^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
                return patron.test(texto);
            });


        if (
            texto.includes(key) ||
            (
                modeloCompleto &&
                texto.includes(modeloCompleto)
            ) ||
            coincideTokenDistintivo
        ) {

            return vehiculo.key;
        }
    }


    return null;
}


// ============================================================
// 7. CLASIFICADOR LOCAL
// ============================================================

async function clasificarLocal(mensaje) {

    const intenciones = [];


    const modelo =
        await detectarModeloDirecto(
            mensaje
        );


    if (
        tieneSaludoInicial(mensaje) ||
        esSaludo(mensaje)
    ) {

        intenciones.push(
            'saludo'
        );
    }


    if (
        contieneAlguna(
            mensaje,
            [
                'financiacion',
                'financiamiento',
                'financiar',
                'plan',
                'credito'
            ]
        )
    ) {

        intenciones.push(
            'financiacion'
        );
    }


    if (
        contieneAlguna(
            mensaje,
            [
                'contado',
                'compra directa',
                'adquisicion directa',
                'efectivo',
                'directa'
            ]
        )
    ) {

        intenciones.push(
            'directa'
        );
    }


    if (
        contieneAlguna(
            mensaje,
            [
                'cuota',
                'cuotas',
                'mensualidad',
                'por mes',
                'detalle de cuotas',
                'detalle cuotas'
            ]
        )
    ) {

        intenciones.push(
            'cuotas'
        );
    }


    if (
        contieneAlguna(
            mensaje,
            [
                'requisito',
                'requisitos',
                'dni',
                'documentacion',
                'documentos'
            ]
        )
    ) {

        intenciones.push(
            'requisitos'
        );
    }


    if (
        contieneAlguna(
            mensaje,
            [
                'precio',
                'valor',
                'cuanto sale',
                'cuanto cuesta',
                'cuanto vale'
            ]
        )
    ) {

        intenciones.push(
            'precio'
        );
    }


    if (
        contieneAlguna(
            mensaje,
            [
                'gasto de entrega',
                'gastos de entrega',
                'gasto entrega',
                'gastos entrega',
                'gastos de patentamiento',
                'patentamiento',
                'patentar',
                'que gastos tiene',
                'qué gastos tiene',
                'tiene gastos',
                'cuanto son los gastos',
                'cuánto son los gastos',
                'gastos para retirar',
                'gastos para retirarlo',
                'gastos al retirar'
            ]
        )
    ) {

        intenciones.push(
            'gastos_entrega'
        );
    }


    if (
        contieneAlguna(
            mensaje,
            [
                'entrega',
                'retirar',
                'retiro',
                'adjudicacion',
                'adjudicar'
            ]
        )
    ) {

        intenciones.push(
            'entrega'
        );
    }


    if (
        contieneAlguna(
            mensaje,
            [
                'equipamiento',
                'equipado',
                'que trae',
                'trae',
                'camara',
                'android auto',
                'carplay'
            ]
        )
    ) {

        intenciones.push(
            'equipamiento'
        );
    }


    if (
        contieneAlguna(
            mensaje,
            [
                'pdf',
                'ficha tecnica',
                'folleto'
            ]
        )
    ) {

        intenciones.push(
            'material'
        );
    }


    // ========================================================
    // AVANZAR
    // ========================================================
    //
    // IMPORTANTE:
    //
    // Ya NO alcanza con mencionar "Edgardo".
    //
    // "Antes de pasarme con Edgardo, dame las cuotas"
    //
    // NO significa avanzar todavía.
    //
    // ========================================================

    if (
        contieneAlguna(
            mensaje,
            [
                'quiero avanzar',
                'quiero ingresar',
                'quiero hacerlo',
                'me interesa avanzar',
                'me interesa ingresar',
                'contactame',
                'contactarme',
                'que me llamen',
                'quiero hablar con alguien',
                'quiero hablar con un asesor',
                'pasame con edgardo',
                'comunícame con edgardo',
                'comunicarme con edgardo'
            ]
        )
    ) {

        intenciones.push(
            'avanzar'
        );
    }


    if (
        contieneAlguna(
            mensaje,
            [
                'no gracias',
                'no me interesa',
                'ahora no',
                'mas adelante'
            ]
        )
    ) {

        intenciones.push(
            'rechazo'
        );
    }


    return {

        modelo,

        intenciones,

        confirmacion:
            esConfirmacionSimple(mensaje),

        negacion:
            esNegacionSimple(mensaje),

        referenciaTemporal:
            tieneReferenciaTemporal(mensaje)
    };
}


// ============================================================
// 8. INTERPRETACIÓN CON QWEN
// ============================================================
//
// Qwen NO responde al cliente.
//
// Solamente interpreta el mensaje.
//
// ============================================================

async function interpretarMensaje(
    mensaje,
    cliente
) {

    const respaldo =
        await clasificarLocal(
            mensaje
        );


    try {

        const modelos =
            await listarModelosDisponibles();


        const clavesModelos =
            modelos.map(
                v => v.key
            );


        const historialReciente =
            cliente.historial
                .slice(-8)
                .map(
                    h =>
                        `${h.rol}: ${h.mensaje}`
                )
                .join('\n');


        const prompt = `
${seller.prompt}

Tu única tarea es CLASIFICAR el mensaje del cliente.

NO respondas al cliente.
NO inventes información comercial.

Devolvé ÚNICAMENTE JSON válido.

MODELOS VÁLIDOS:
${JSON.stringify(clavesModelos)}

INTENCIONES VÁLIDAS:

saludo
modelo
financiacion
directa
cuotas
requisitos
precio
gastos_entrega
entrega
equipamiento
material
avanzar
rechazo
otro

REGLAS IMPORTANTES:

1. Una frase puede tener MÁS DE UNA intención.

2. Las consultas de información tienen prioridad conceptual
sobre una posible derivación.

Ejemplo:

"Antes de pasarme con Edgardo,
dame el detalle de las cuotas"

debe detectar:
intenciones = ["cuotas"]

NO debe asumir que ya quiere ser derivado.

3. Mencionar a Edgardo no significa automáticamente avanzar.

4. Solo detectar "avanzar" cuando exista una intención clara
de hablar con el asesor o continuar el proceso.

5. "Ok", "dale" o "sí" dependen del contexto.

6. "Detalle de las cuotas" nunca es un horario.

7. Si el cliente hace otra pregunta mientras se estaba coordinando
un contacto, priorizá la nueva pregunta.

8. Interpretá el SIGNIFICADO del mensaje usando el historial, no solamente palabras exactas.
Ejemplos: "¿y cómo era el plan?", "¿y la financiación?", "recordame cómo se paga"
pueden significar financiacion aunque no coincidan con una frase programada.

9. Si una pregunta ya fue respondida o una etapa de calificación ya se completó,
NO interpretes una nueva consulta como pedido de reiniciar esa etapa.

10. Si el cliente rechaza una llamada pero pide información ahora,
la negación corresponde a la llamada y debe continuar la conversación comercial.

11. Usá el último mensaje de Martín para resolver referencias como "eso", "el detalle",
"sí", "no", "pasame eso" o "y lo otro".

12. Antes de marcar un mensaje como ambiguo, intentá resolverlo usando TODO el contexto:
modelo, método, etapa, respuesta esperada y los últimos mensajes.

13. Si el contexto permite una interpretación claramente más probable, NO marques ambigua:
clasificá esa intención y continuá normalmente.

14. Marcá "ambigua": true SOLO cuando queden DOS O MÁS interpretaciones comerciales
realmente plausibles y el contexto no permita elegir con seguridad.
En ese caso escribí en "aclaracion" UNA pregunta corta y concreta que ofrezca las
alternativas relevantes. Ejemplo:
"¿Te referís al monto para retirarlo o a los gastos de entrega?"

15. Si el mensaje no se entiende y tampoco hay alternativas concretas, marcá "ambigua": true
y usá una aclaración breve y específica. Nunca inventes qué quiso decir el cliente.

16. IMPORTANTE: "info", "información", "quiero información", "quiero saber más",
"me interesa", "vi el anuncio" o "quería consultar" NO significan material.
Si además se menciona un modelo, representan interés o consulta general sobre ese vehículo.
En esos casos NO agregues la intención "material".

17. Usá "material" SOLAMENTE cuando el cliente pida explícitamente un PDF, ficha técnica,
folleto, pauta, catálogo, archivo, documento o material comercial.

CONTEXTO:

Etapa:
${cliente.etapa}

Modelo:
${cliente.modelo || 'ninguno'}

Método:
${cliente.metodo || 'ninguno'}

Uso del vehículo ya informado:
${cliente.usoVehiculo || 'no'}

Decisión de compra ya informada:
${cliente.decisionCompra || 'no'}

Calificación completada:
${cliente.calificacionCompletada === true ? 'sí' : 'no'}

Llamada conjunta rechazada:
${cliente.llamadaConjuntaRechazada === true ? 'sí' : 'no'}

Esperando respuesta:
${cliente.esperandoRespuesta || 'ninguna'}

Opciones esperadas:
${JSON.stringify(cliente.opcionesEsperadas || [])}

HISTORIAL:

${historialReciente || 'Sin historial'}

MENSAJE:

"${mensaje}"

FORMATO EXACTO:

{
  "modelo": null,
  "intenciones": [],
  "confirmacion": false,
  "negacion": false,
  "ambigua": false,
  "aclaracion": null
}
`;


        const response =
            await groq.chat.completions.create({

                model:
                    GROQ_MODEL,

                reasoning_effort:
                    'none',

                reasoning_format:
                    'hidden',

                messages: [
                    {
                        role: 'system',
                        content: prompt
                    },
                    {
                        role: 'user',
                        content: mensaje
                    }
                ],

                temperature: 0,

                max_tokens: 180
            });


        const contenido =
            response
                .choices?.[0]
                ?.message
                ?.content || '';


        const inicio =
            contenido.indexOf('{');


        const fin =
            contenido.lastIndexOf('}');


        if (
            inicio === -1 ||
            fin === -1
        ) {

            return respaldo;
        }


        const json =
            JSON.parse(
                contenido.slice(
                    inicio,
                    fin + 1
                )
            );


        let modeloIA =
            json.modelo
                ? normalizar(
                    json.modelo
                )
                : null;


        if (
            modeloIA &&
            !clavesModelos
                .map(normalizar)
                .includes(modeloIA)
        ) {

            modeloIA = null;
        }


        const intencionesValidas = [

            'saludo',
            'modelo',
            'financiacion',
            'directa',
            'cuotas',
            'requisitos',
            'precio',
            'gastos_entrega',
            'entrega',
            'equipamiento',
            'material',
            'avanzar',
            'rechazo',
            'otro'
        ];


        let intencionesIA =
            Array.isArray(
                json.intenciones
            )
                ? json.intenciones.filter(
                    i =>
                        intencionesValidas.includes(i)
                )
                : [];


        // Qwen no puede inventar un saludo. La presencia de saludo se
        // determina localmente a partir del texto real del cliente.
        if (!tieneSaludoInicial(mensaje) && !esSaludo(mensaje)) {
            intencionesIA = intencionesIA.filter(i => i !== 'saludo');
        }

        // "Info" o "información" sobre un modelo NO es pedido de PDF/material.
        // Material queda reservado a pedidos explícitos de archivos o piezas comerciales.
        const pideMaterialExplicito =
            contieneAlguna(
                mensaje,
                [
                    'pdf',
                    'ficha tecnica',
                    'folleto',
                    'pauta',
                    'catalogo',
                    'archivo',
                    'documento',
                    'material comercial',
                    'pasame el material',
                    'mandame el material'
                ]
            );

        if (!pideMaterialExplicito) {
            intencionesIA = intencionesIA.filter(i => i !== 'material');
        }


        const intenciones = [

            ...new Set([
                ...respaldo.intenciones,
                ...intencionesIA
            ])
        ];


        return {

            modelo:
                respaldo.modelo ||
                modeloIA ||
                null,

            intenciones,

            confirmacion:
                respaldo.confirmacion ||
                json.confirmacion === true,

            negacion:
                respaldo.negacion ||
                json.negacion === true,

            ambigua:
                json.ambigua === true,

            aclaracion:
                json.ambigua === true &&
                typeof json.aclaracion === 'string' &&
                json.aclaracion.trim()
                    ? json.aclaracion.trim().slice(0, 220)
                    : null,

            referenciaTemporal:
                respaldo.referenciaTemporal
        };


    } catch (error) {

        console.error(
            '⚠️ Falló clasificación Qwen:',
            error.message
        );


        return respaldo;
    }
}


// ============================================================
// 9. RESPUESTAS CONTROLADAS
// ============================================================

function responderInfoInicial(vehiculo) {

    const datos = [];

    if (vehiculo.plan) {
        datos.push(`tiene un plan ${vehiculo.plan}`);
    }

    if (vehiculo.plazo) {
        datos.push(`a ${vehiculo.plazo} cuotas`);
    }

    if (vehiculo.precioLista) {
        datos.push(`el precio de lista es de ${formatearPesos(vehiculo.precioLista)}`);
    }

    const cuotaIngreso =
        vehiculo.cuota_1 ||
        vehiculo.cuota1 ||
        null;

    if (cuotaIngreso) {
        datos.push(`la cuota 1 es de ${formatearPesos(cuotaIngreso)}`);
    }

    const introduccion =
        datos.length > 0
            ? `Te cuento: el ${nombreVehiculo(vehiculo)} ${datos.join(', ')}.`
            : `Claro. Tengo información del ${nombreVehiculo(vehiculo)}.`;

    return (
        `¡Hola! ¿Cómo estás? Claro, no hay problema. ${introduccion} ` +
        '¿Querés que te cuente cómo funciona la financiación o preferís información para adquisición directa?'
    );
}


function responderFinanciacion(
    vehiculo
) {

    const partes = [];


    if (vehiculo.plan) {

        partes.push(
            `La financiación es ${vehiculo.plan}`
        );
    }


    if (
        vehiculo.porcentaje_entrega &&
        vehiculo.cuotas_entrega
    ) {

        partes.push(
            `podés retirar integrando el ${formatearPorcentaje(vehiculo.porcentaje_entrega)} ${textoCuotasEntrega(vehiculo.cuotas_entrega)}`
        );
    }


    const montoEntrega =
        vehiculo.monto_entrega ||
        vehiculo.monto_10_porciento;


    if (
        montoEntrega
    ) {

        partes.push(
            `ese porcentaje hoy representa ${formatearPesos(montoEntrega)}`
        );
    }


    if (
        partes.length === 0
    ) {

        return (
            'Tengo información de financiación para este modelo, ' +
            'pero el detalle completo no está disponible en este momento. ' +
            `Si querés, te lo puede confirmar ${seller.asesorDerivacion || 'Edgardo'}.`
        );
    }


    return (
        `${partes.join('. ')}. ` +
        '¿Querés conocer los requisitos o el detalle de las cuotas?'
    );
}


function responderCuotas(
    vehiculo
) {

    const respuestas = [];


    if (
        vehiculo.suscripcion
    ) {

        respuestas.push(
            `La cuota de suscripción es de ${formatearPesos(vehiculo.suscripcion)}`
        );

    } else if (
        vehiculo.cuota_1
    ) {

        respuestas.push(
            `La cuota 1 es de ${formatearPesos(vehiculo.cuota_1)}`
        );
    }


    if (
        vehiculo.cuotaPura
    ) {

        respuestas.push(
            `La cuota pura es de ${formatearPesos(vehiculo.cuotaPura)}`
        );
    }


    if (
        vehiculo.cuotaPublicitaria
    ) {

        respuestas.push(
            `La cuota publicitaria es de ${formatearPesos(vehiculo.cuotaPublicitaria)}`
        );
    }


    if (
        Array.isArray(
            vehiculo.cuotas
        ) &&
        vehiculo.cuotas.length > 0
    ) {

        for (
            const tramo
            of vehiculo.cuotas
        ) {

            if (
                tramo.desde != null &&
                tramo.hasta != null &&
                tramo.valor
            ) {

                if (
                    tramo.desde ===
                    tramo.hasta
                ) {

                    respuestas.push(
                        `La cuota ${tramo.desde} es de ${formatearPesos(tramo.valor)}`
                    );

                } else {

                    respuestas.push(
                        `De la cuota ${tramo.desde} a la ${tramo.hasta}, el valor es ${formatearPesos(tramo.valor)}`
                    );
                }
            }
        }
    }


    if (
        respuestas.length === 0
    ) {

        return (
            'No tengo el detalle de las cuotas disponible en este momento. ' +
            `Si querés, te lo puede confirmar ${seller.asesorDerivacion || 'Edgardo'}.`
        );
    }


    if (
        respuestas.length === 1
    ) {

        return (
            `${respuestas[0]}. ` +
            'El resto del detalle no está disponible en este momento. ' +
            `Si querés, te lo puede confirmar ${seller.asesorDerivacion || 'Edgardo'}.`
        );
    }


    return (
        respuestas.join('. ') +
        '. Si te parece, te paso también los requisitos para ingresar, es súper sencillo.'
    );
}


function responderRequisitos(
    vehiculo
) {

    const requisitos =
        vehiculo.requisitos ||
        (
            vehiculo.soloDNI
                ? 'DNI'
                : null
        );


    const cuotaIngreso =
        vehiculo.suscripcion ||
        vehiculo.cuota_1 ||
        null;


    const partes = [];


    if (requisitos) {

        partes.push(
            `Para ingresar necesitás ${requisitos}`
        );
    }


    if (cuotaIngreso) {

        partes.push(
            `la cuota de ingreso es de ${formatearPesos(cuotaIngreso)}`
        );
    }


    if (
        partes.length === 0
    ) {

        return (
            'No tengo todos los requisitos disponibles en este momento. ' +
            `Si querés, te los puede confirmar ${seller.asesorDerivacion || 'Edgardo'}.`
        );
    }


    return (
        partes.join(' y ') +
        `. ¿Querés que te contacte ${seller.asesorDerivacion || 'Edgardo'} para avanzar?`
    );
}


function responderPrecio(
    vehiculo
) {

    if (
        !vehiculo.precioLista
    ) {

        return (
            'No tengo el precio actualizado disponible en este momento. ' +
            `Si querés, te lo puede confirmar ${seller.asesorDerivacion || 'Edgardo'}.`
        );
    }


    return (
        `El precio de lista del ${nombreVehiculo(vehiculo)} ` +
        `es de ${formatearPesos(vehiculo.precioLista)}.`
    );
}


function responderGastosEntrega(
    vehiculo
) {

    const porcentaje =
        vehiculo.gastos_entrega;

    const monto =
        vehiculo.monto_gastos_entrega ||
        vehiculo.gastos_entrega_monto ||
        null;


    if (
        !porcentaje &&
        !monto
    ) {

        return (
            'No tengo los gastos de entrega actualizados en este momento. ' +
            `Si querés, te los puede confirmar ${seller.asesorDerivacion || 'Edgardo'}.`
        );
    }


    if (
        porcentaje &&
        monto
    ) {

        return (
            `Los gastos de entrega son del ${formatearPorcentaje(porcentaje)}. ` +
            `Eso representa aproximadamente ${formatearPesos(monto)}.`
        );
    }


    if (porcentaje) {

        return (
            `Los gastos de entrega son del ${formatearPorcentaje(porcentaje)}. ` +
            `No tengo cargado el monto aproximado actualizado en este momento.`
        );
    }


    return (
        `Los gastos de entrega representan aproximadamente ${formatearPesos(monto)}.`
    );
}


function responderEntrega(
    vehiculo
) {

    const partes = [];


    if (
        vehiculo.entrega
    ) {

        partes.push(
            vehiculo.entrega
        );
    }


    if (
        vehiculo.adjudicacion
    ) {

        partes.push(
            `La adjudicación es ${vehiculo.adjudicacion}`
        );
    }


    if (
        vehiculo.entregaAsegurada
    ) {

        partes.push(
            `La entrega asegurada es ${vehiculo.entregaAsegurada}`
        );
    }


    if (
        vehiculo.porcentaje_entrega &&
        vehiculo.cuotas_entrega
    ) {

        partes.push(
            `Podés retirar integrando el ${formatearPorcentaje(vehiculo.porcentaje_entrega)} ${textoCuotasEntrega(vehiculo.cuotas_entrega)}`
        );
    }


    if (
        vehiculo.gastos_entrega ||
        vehiculo.monto_gastos_entrega
    ) {

        const porcentajeGastos =
            vehiculo.gastos_entrega;

        const montoGastos =
            vehiculo.monto_gastos_entrega ||
            vehiculo.gastos_entrega_monto ||
            null;

        if (
            porcentajeGastos &&
            montoGastos
        ) {

            partes.push(
                `Los gastos de entrega son del ${formatearPorcentaje(porcentajeGastos)} y representan aproximadamente ${formatearPesos(montoGastos)}`
            );

        } else if (porcentajeGastos) {

            partes.push(
                `Los gastos de entrega son del ${formatearPorcentaje(porcentajeGastos)}`
            );

        } else if (montoGastos) {

            partes.push(
                `Los gastos de entrega representan aproximadamente ${formatearPesos(montoGastos)}`
            );
        }
    }


    if (
        partes.length === 0
    ) {

        return (
            'No tengo el detalle de entrega disponible en este momento. ' +
            `Si querés, te lo puede confirmar ${seller.asesorDerivacion || 'Edgardo'}.`
        );
    }


    return (
        partes.join('. ') +
        '.'
    );
}


function responderEquipamiento(
    vehiculo
) {

    if (
        !Array.isArray(
            vehiculo.equipamiento
        ) ||
        vehiculo.equipamiento.length === 0
    ) {

        return (
            'No tengo el detalle del equipamiento disponible en este momento. ' +
            `Si querés, te lo puede confirmar ${seller.asesorDerivacion || 'Edgardo'}.`
        );
    }


    return (
        `${nombreVehiculo(vehiculo)} incluye: ` +
        vehiculo.equipamiento.join(', ') +
        '.'
    );
}


function responderMaterial(
    vehiculo
) {

    const links = [];


    if (
        vehiculo.materialComercial
    ) {

        links.push(
            `Pauta comercial: ${vehiculo.materialComercial}`
        );
    }


    if (
        vehiculo.pdfFichaTecnica
    ) {

        links.push(
            `Ficha técnica: ${vehiculo.pdfFichaTecnica}`
        );
    }


    if (
        vehiculo.videoComercial
    ) {

        links.push(
            `Video: ${vehiculo.videoComercial}`
        );
    }


    if (
        links.length === 0
    ) {

        return (
            'No tengo material comercial disponible para este modelo en este momento.'
        );
    }


    return links.join('\n');
}


function normalizarEstiloMartin(texto) {

    let salida = String(texto || '').trim();

    const reemplazos = [
        [/\btú\b/gi, 'vos'],
        [/\bquieres\b/gi, 'querés'],
        [/\bpuedes\b/gi, 'podés'],
        [/\btienes\b/gi, 'tenés'],
        [/\bdime\b/gi, 'decime'],
        [/\bcuéntame\b/gi, 'contame'],
        [/\bcuentame\b/gi, 'contame'],
        [/\bnecesitas\b/gi, 'necesitás'],
        [/\bentiendes\b/gi, 'entendés'],
        [/\bte interesa\b/gi, 'te interesa']
    ];

    for (const [patron, reemplazo] of reemplazos) {
        salida = salida.replace(patron, reemplazo);
    }

    // Martín usa voseo profesional, pero nunca "che".
    salida = salida
        .replace(/(^|[\s,.;:!?])che([\s,.;:!?]|$)/gi, '$1$2')
        .replace(/\s{2,}/g, ' ')
        .trim();

    return salida;
}


// ============================================================
// 10. RESPUESTA IA SEGURA
// ============================================================

async function respuestaSeguraIA(
    mensaje,
    cliente,
    vehiculo
) {

    try {

        const datosPermitidos =
            JSON.stringify(
                vehiculo,
                null,
                2
            );


        const prompt = `
${seller.prompt}

El cliente consulta por:

${nombreVehiculo(vehiculo)}

DATOS COMERCIALES PERMITIDOS:

${datosPermitidos}

PREGUNTA DEL CLIENTE:

"${mensaje}"

REGLAS:

1. Respondé SOLO con información disponible arriba.

2. NO inventes.

3. NO hagas cálculos no disponibles.

4. NO deduzcas valores.

5. Nunca digas:
"tengo cargado",
"está cargado",
"base de datos",
"sistema",
"según la base".

6. Si falta información:
"No tengo esa información disponible en este momento. Si querés, te la puede confirmar ${seller.asesorDerivacion || 'Edgardo'}."

7. Usá español argentino rioplatense profesional y voseo natural: vos, querés, podés, tenés, decime, contame.

8. Nunca uses tuteo: no uses tú, quieres, puedes, tienes, dime, cuéntame ni formas equivalentes.

9. Nunca uses "che". No caricaturices el habla argentina ni uses modismos excesivos.

10. Mantené un tono amable, calmo, comercial y no agresivo. Nunca presiones, regañes, confrontes ni des órdenes fuertes.

11. Si el cliente rechaza una llamada o propuesta, aceptalo con naturalidad y seguí ayudándolo con la información que pida.

12. Máximo 3 oraciones.

13. No vendas ni negocies.

14. No repitas información innecesaria.

15. Si informás un monto en pesos, usá formato argentino con signo $ y separadores de miles.

16. Si informás gastos de entrega, decí SIEMPRE que son "aproximadamente" ese monto.

Respondé directamente.
`;


        const response =
            await groq.chat.completions.create({

                model:
                    GROQ_MODEL,

                reasoning_effort:
                    'none',

                reasoning_format:
                    'hidden',

                messages: [
                    {
                        role: 'system',
                        content: prompt
                    },
                    {
                        role: 'user',
                        content: mensaje
                    }
                ],

                temperature: 0.1,

                max_tokens: 180
            });


        const respuestaCruda =
            response
                .choices?.[0]
                ?.message
                ?.content || '';


        // Capa de seguridad adicional: nunca enviar razonamiento interno
        // al cliente aunque el proveedor cambiara el formato de salida.
        let respuesta =
            normalizarEstiloMartin(
                String(respuestaCruda)
                    .replace(/<think>[\s\S]*?<\/think>/gi, '')
                    .trim()
            );


        if (
            /<think>/i.test(respuesta)
        ) {

            respuesta = '';
        }


        if (!respuesta) {

            throw new Error(
                'Qwen devolvió respuesta vacía o razonamiento interno'
            );
        }


        return respuesta;


    } catch (error) {

        console.error(
            '⚠️ Error Qwen:',
            error.message
        );


        return (
            'No tengo esa información disponible en este momento. ' +
            `Si querés, te la puede confirmar ${seller.asesorDerivacion || 'Edgardo'}.`
        );
    }
}


// ============================================================
// 11. RESPUESTAS ESPERADAS
// ============================================================

async function procesarRespuestaEsperada(
    mensaje,
    cliente,
    analisis,
    vehiculo
) {

    // --------------------------------------------------------
    // CALIFICACIÓN SUAVE: USO DEL VEHÍCULO
    // --------------------------------------------------------

    if (
        cliente.esperandoRespuesta ===
        'uso_vehiculo'
    ) {

        cliente.usoVehiculo =
            respuestaUsoVehiculo(mensaje);

        cliente.esperandoRespuesta =
            'decision_compra';

        return (
            'Perfecto. Y te consulto una cosa más: ' +
            '¿la decisión la tomás vos solo o con alguien más?'
        );
    }


    // --------------------------------------------------------
    // CALIFICACIÓN SUAVE: QUIÉN TOMA LA DECISIÓN
    // --------------------------------------------------------

    if (
        cliente.esperandoRespuesta ===
        'decision_compra'
    ) {

        cliente.decisionCompra =
            String(mensaje || '').trim();

        cliente.calificacionCompletada =
            true;

        if (
            decisionEsCompartida(mensaje)
        ) {

            cliente.llamadaConjuntaOfrecida =
                true;

            cliente.esperandoRespuesta =
                'aceptar_llamada_conjunta';

            return (
                'Perfecto. Te pregunto porque, si te parece, podemos organizar una llamada ' +
                'en un horario en el que estén los dos y así les pasan toda la información juntos. ' +
                '¿Querés que la coordinemos?'
            );
        }

        cliente.esperandoRespuesta =
            'elegir_info_financiacion';

        cliente.opcionesEsperadas = [
            'requisitos',
            'cuotas'
        ];

        return (
            'Perfecto, gracias. ' +
            responderFinanciacion(vehiculo)
        );
    }


    // --------------------------------------------------------
    // PROPUESTA DE LLAMADA CONJUNTA
    // --------------------------------------------------------

    if (
        cliente.esperandoRespuesta ===
        'aceptar_llamada_conjunta'
    ) {

        if (
            analisis.confirmacion ||
            analisis.intenciones.includes('avanzar')
        ) {

            cliente.esperandoRespuesta =
                'horario_contacto';

            cliente.derivacionSolicitada =
                true;

            cliente.opcionesEsperadas = [];

            return (
                `Perfecto. ¿Qué día y horario les queda cómodo para que los contacte ${seller.asesorDerivacion || 'Edgardo'}?`
            );
        }

        if (
            analisis.negacion
        ) {

            cliente.llamadaConjuntaRechazada =
                true;

            cliente.esperandoRespuesta =
                'elegir_info_financiacion';

            cliente.opcionesEsperadas = [
                'requisitos',
                'cuotas'
            ];

            return (
                'No hay problema. ' +
                responderFinanciacion(vehiculo)
            );
        }

        return (
            'Si te parece, la podemos coordinar para cuando estén los dos. ' +
            '¿Querés que te pida un día y horario?'
        );
    }

    // --------------------------------------------------------
    // REQUISITOS O CUOTAS
    // --------------------------------------------------------

    if (
        cliente.esperandoRespuesta ===
        'elegir_info_financiacion'
    ) {

        // Si Martín acaba de ofrecer "requisitos o detalle de cuotas",
        // expresiones naturales como "pasame el detalle" deben
        // interpretarse como detalle de CUOTAS sin depender de Qwen.
        if (
            contieneAlguna(
                mensaje,
                [
                    'pasame el detalle',
                    'pásame el detalle',
                    'dame el detalle',
                    'el detalle',
                    'detalle'
                ]
            )
        ) {

            cliente.etapa =
                'consultando_cuotas';

            cliente.esperandoRespuesta =
                'ofrecer_requisitos';

            cliente.opcionesEsperadas = [];

            return responderCuotas(
                vehiculo
            );
        }

        if (
            analisis.confirmacion
        ) {

            return (
                'Dale. ¿Querés que te pase primero los requisitos o el detalle de las cuotas?'
            );
        }
    }


    // --------------------------------------------------------
    // OFRECER REQUISITOS DESPUÉS DEL DETALLE DE CUOTAS
    // --------------------------------------------------------

    if (
        cliente.esperandoRespuesta ===
        'ofrecer_requisitos'
    ) {

        if (
            analisis.confirmacion ||
            analisis.intenciones.includes('requisitos')
        ) {

            cliente.etapa =
                'consultando_requisitos';

            cliente.esperandoRespuesta =
                'aceptar_derivacion';

            cliente.opcionesEsperadas = [];

            return responderRequisitos(
                vehiculo
            );
        }

        if (
            analisis.negacion
        ) {

            cliente.esperandoRespuesta =
                null;

            cliente.opcionesEsperadas = [];

            return (
                'Perfecto, no hay problema. ' +
                'Si querés consultar otra cosa del vehículo, decime.'
            );
        }

        // Si el cliente pregunta otra cosa concreta, dejamos que el
        // enrutador general procese esa intención en lugar de forzarlo
        // a responder sí/no sobre los requisitos.
        if (
            analisis.intenciones.length > 0
        ) {

            cliente.esperandoRespuesta =
                null;

            cliente.opcionesEsperadas = [];

            return null;
        }

        return (
            'Si te parece, te paso también los requisitos para ingresar. ' +
            '¿Querés que te los pase?'
        );
    }


    // --------------------------------------------------------
    // ACEPTAR DERIVACIÓN
    // --------------------------------------------------------

    if (
        cliente.esperandoRespuesta ===
        'aceptar_derivacion'
    ) {

        if (
            analisis.intenciones.includes(
                'avanzar'
            ) ||
            analisis.confirmacion
        ) {

            cliente.esperandoRespuesta =
                'horario_contacto';


            cliente.derivacionSolicitada =
                true;


            cliente.opcionesEsperadas = [];


            return (
                `Perfecto. ¿Qué día y horario te queda cómodo para que te contacte ${seller.asesorDerivacion || 'Edgardo'}?`
            );
        }


        if (
            analisis.negacion
        ) {

            cliente.esperandoRespuesta =
                null;


            cliente.opcionesEsperadas = [];


            return (
                'Dale, no hay problema. Si necesitás otra información, decime.'
            );
        }
    }


    // --------------------------------------------------------
    // ESPERANDO HORARIO
    // --------------------------------------------------------

    if (
        cliente.esperandoRespuesta ===
        'horario_contacto'
    ) {

        if (
            analisis.referenciaTemporal
        ) {

            cliente.esperandoRespuesta =
                null;


            cliente.etapa =
                'derivado';


            cliente.horarioContacto =
                mensaje;


            return (
                `Perfecto. Queda registrado. ${seller.asesorDerivacion || 'Edgardo'} va a continuar con vos. Muchas gracias.`
            );
        }


        return (
            `Dale. Para coordinar con ${seller.asesorDerivacion || 'Edgardo'}, decime qué día o en qué horario te queda cómodo.`
        );
    }


    return null;
}


// ============================================================
// 12. PROCESAR MENSAJE
// ============================================================

async function procesarMensaje(
    userMessage,
    userId
) {

    const mensaje =
        String(
            userMessage || ''
        ).trim();


    if (!mensaje) {

        return (
            'Escribime qué necesitás saber y te ayudo.'
        );
    }


    const cliente =
        getCliente(userId);


    guardarHistorial(
        cliente,
        'cliente',
        mensaje
    );


    cliente.seguimiento20mEnviado =
        false;

    cliente.seguimiento24hEnviado =
        false;


    const analisis =
        await interpretarMensaje(
            mensaje,
            cliente
        );


    console.log(
        '🧠 Interpretación:',
        JSON.stringify({
            mensaje,
            modelo: analisis.modelo || null,
            intenciones: analisis.intenciones || [],
            ambigua: analisis.ambigua === true,
            aclaracion: analisis.aclaracion || null
        })
    );


    // ========================================================
    // ACTUALIZAR MODELO
    // ========================================================

    if (
        analisis.modelo
    ) {

        cliente.modelo =
            analisis.modelo;
    }


    // ========================================================
    // ACLARACIÓN DE MENSAJES REALMENTE AMBIGUOS
    // ========================================================
    //
    // Qwen primero usa el contexto reciente. Solo llega acá si
    // todavía quedan dos o más interpretaciones plausibles o si
    // el mensaje no puede entenderse con seguridad.
    // ========================================================

    if (
        analisis.ambigua === true &&
        analisis.aclaracion
    ) {

        const respuesta =
            analisis.aclaracion;


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    // ========================================================
    // SALUDO
    // ========================================================

    const intencionesNoSaludo =
        analisis.intenciones.filter(
            i =>
                i !== 'saludo'
        );


    if (
        analisis.intenciones.includes(
            'saludo'
        ) &&
        intencionesNoSaludo.length === 0 &&
        !analisis.modelo
    ) {

        cliente.etapa =
            'esperando_modelo';


        cliente.esperandoRespuesta =
            'modelo';


        const respuesta =
            'Hola, ¿en qué te puedo ayudar?';


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    // ========================================================
    // SIN MODELO
    // ========================================================

    if (
        !cliente.modelo
    ) {

        const modelos =
            await listarModelosDisponibles();


        const nombres =
            modelos.map(
                v =>
                    v.key.toUpperCase()
            );


        const respuesta =
            nombres.length > 0
                ? `Claro. ¿Qué modelo te interesa? Tengo información de ${nombres.join(', ')}.`
                : 'Decime qué modelo te interesa y te ayudo.';


        cliente.etapa =
            'esperando_modelo';


        cliente.esperandoRespuesta =
            'modelo';


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    // ========================================================
    // VEHÍCULO
    // ========================================================

    const vehiculo =
        await obtenerVehiculo(
            cliente.modelo
        );


    if (
        !vehiculo
    ) {

        const respuesta =
            'En este momento no tengo información disponible para ese modelo.';


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    // ========================================================
    // PRIORIDAD ABSOLUTA:
    // PREGUNTAS COMERCIALES EXPLÍCITAS
    // ========================================================
    //
    // Esto ocurre ANTES de procesar una derivación pendiente.
    //
    // "Antes de pasarme con Edgardo,
    // dame las cuotas"
    //
    // → responde cuotas.
    //
    // ========================================================


    if (
        analisis.intenciones.includes(
            'cuotas'
        )
    ) {

        cliente.etapa =
            'consultando_cuotas';


        cliente.esperandoRespuesta =
            'ofrecer_requisitos';


        const respuesta =
            responderCuotas(
                vehiculo
            );


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    if (
        analisis.intenciones.includes(
            'precio'
        )
    ) {

        cliente.esperandoRespuesta =
            null;


        const respuesta =
            responderPrecio(
                vehiculo
            );


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    if (
        analisis.intenciones.includes(
            'requisitos'
        )
    ) {

        cliente.etapa =
            'consultando_requisitos';


        cliente.esperandoRespuesta =
            'aceptar_derivacion';


        const respuesta =
            responderRequisitos(
                vehiculo
            );


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    if (
        analisis.intenciones.includes(
            'gastos_entrega'
        )
    ) {

        cliente.esperandoRespuesta =
            null;


        const respuesta =
            responderGastosEntrega(
                vehiculo
            );


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    if (
        analisis.intenciones.includes(
            'entrega'
        )
    ) {

        cliente.esperandoRespuesta =
            null;


        const respuesta =
            responderEntrega(
                vehiculo
            );


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    if (
        analisis.intenciones.includes(
            'equipamiento'
        )
    ) {

        cliente.esperandoRespuesta =
            null;


        const respuesta =
            responderEquipamiento(
                vehiculo
            );


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    if (
        analisis.intenciones.includes(
            'material'
        )
    ) {

        cliente.esperandoRespuesta =
            null;


        const respuesta =
            responderMaterial(
                vehiculo
            );


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    // ========================================================
    // FINANCIACIÓN
    // ========================================================

    if (
        analisis.intenciones.includes(
            'financiacion'
        )
    ) {

        cliente.metodo =
            'financiacion';


        cliente.etapa =
            'financiacion';


        // La calificación comercial se hace una sola vez por conversación.
        // Si el cliente vuelve a preguntar por financiación, Martín responde
        // la información y no reinicia las preguntas de uso/decisión.
        if (
            cliente.calificacionCompletada ||
            (cliente.usoVehiculo && cliente.decisionCompra)
        ) {

            cliente.calificacionCompletada =
                true;

            cliente.esperandoRespuesta =
                'elegir_info_financiacion';

            cliente.opcionesEsperadas = [
                'requisitos',
                'cuotas'
            ];

            const respuesta =
                responderFinanciacion(vehiculo);

            guardarHistorial(
                cliente,
                'martin',
                respuesta
            );

            return respuesta;
        }


        // Si ya respondió para qué necesita el vehículo pero faltó la segunda
        // pregunta, retomamos exactamente donde quedó en vez de volver al inicio.
        if (
            cliente.usoVehiculo &&
            !cliente.decisionCompra
        ) {

            cliente.esperandoRespuesta =
                'decision_compra';

            cliente.opcionesEsperadas = [];

            const respuesta =
                'Perfecto. Y te consulto una cosa más: ¿la decisión la tomás vos solo o con alguien más?';

            guardarHistorial(
                cliente,
                'martin',
                respuesta
            );

            return respuesta;
        }


        cliente.esperandoRespuesta =
            'uso_vehiculo';


        cliente.opcionesEsperadas = [];


        const respuesta =
            'Perfecto. Antes de pasarte el detalle, te hago un par de preguntas cortitas para orientarme un poco. ' +
            '¿El vehículo lo necesitás para trabajo o para uso general?';


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    // ========================================================
    // DIRECTA
    // ========================================================

    if (
        analisis.intenciones.includes(
            'directa'
        )
    ) {

        cliente.metodo =
            'directa';


        cliente.etapa =
            'directa';


        cliente.esperandoRespuesta =
            'aceptar_derivacion';


        let respuesta =
            `Perfecto. Para adquisición directa del ${nombreVehiculo(vehiculo)}`;


        if (
            vehiculo.precioLista
        ) {

            respuesta +=
                ` el precio de lista es de ${formatearPesos(vehiculo.precioLista)}.`;

        } else {

            respuesta += '.';
        }


        respuesta +=
            ` Si querés avanzar con una propuesta, te puedo poner en contacto con ${seller.asesorDerivacion || 'Edgardo'}.`;


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    // ========================================================
    // MODELO NUEVO
    // ========================================================

    const preguntasComerciales = [

        'financiacion',
        'directa',
        'cuotas',
        'requisitos',
        'precio',
        'gastos_entrega',
        'entrega',
        'equipamiento',
        'material',
        'avanzar'
    ];


    const tienePreguntaComercial =
        analisis.intenciones.some(
            i =>
                preguntasComerciales.includes(i)
        );


    if (
        analisis.modelo &&
        !tienePreguntaComercial
    ) {

        cliente.etapa =
            'esperando_metodo';


        cliente.esperandoRespuesta =
            'metodo_compra';


        cliente.opcionesEsperadas = [
            'directa',
            'financiacion'
        ];


        const respuesta =
            responderInfoInicial(vehiculo);


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    // ========================================================
    // RESPUESTAS ESPERADAS
    // ========================================================

    const respuestaEsperada =
        await procesarRespuestaEsperada(
            mensaje,
            cliente,
            analisis,
            vehiculo
        );


    if (
        respuestaEsperada
    ) {

        guardarHistorial(
            cliente,
            'martin',
            respuestaEsperada
        );


        return respuestaEsperada;
    }


    // ========================================================
    // AVANZAR EXPLÍCITAMENTE
    // ========================================================

    if (
        analisis.intenciones.includes(
            'avanzar'
        )
    ) {

        cliente.etapa =
            'esperando_horario';


        cliente.esperandoRespuesta =
            'horario_contacto';


        cliente.derivacionSolicitada =
            true;


        const respuesta =
            `Perfecto. ¿Qué día y horario te queda cómodo para que te contacte ${seller.asesorDerivacion || 'Edgardo'}?`;


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    // ========================================================
    // RECHAZO
    // ========================================================

    if (
        analisis.intenciones.includes(
            'rechazo'
        )
    ) {

        cliente.esperandoRespuesta =
            null;


        cliente.opcionesEsperadas =
            [];


        const respuesta =
            'Dale, no hay problema. Si más adelante necesitás información, escribime.';


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    // ========================================================
    // CONFIRMACIÓN SIN CONTEXTO
    // ========================================================

    if (
        analisis.confirmacion
    ) {

        const respuesta =
            'Dale. ¿Qué otra información querés saber?';


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    // ========================================================
    // PREGUNTA NO PREVISTA
    // ========================================================

    const respuesta =
        await respuestaSeguraIA(
            mensaje,
            cliente,
            vehiculo
        );


    guardarHistorial(
        cliente,
        'martin',
        respuesta
    );


    return respuesta;
}


// ============================================================
// WHATSAPP CLOUD API - ENVIAR MENSAJE
// ============================================================

async function enviarMensajeWhatsApp(
    numeroDestino,
    mensaje
) {

    if (
        !WHATSAPP_TOKEN ||
        !WHATSAPP_PHONE_NUMBER_ID
    ) {

        throw new Error(
            'Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID en Render'
        );
    }


    const url =
        `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;


    const response =
        await fetch(
            url,
            {
                method: 'POST',

                headers: {
                    'Authorization':
                        `Bearer ${WHATSAPP_TOKEN}`,

                    'Content-Type':
                        'application/json'
                },

                body:
                    JSON.stringify({
                        messaging_product:
                            'whatsapp',

                        recipient_type:
                            'individual',

                        to:
                            numeroDestino,

                        type:
                            'text',

                        text: {
                            preview_url:
                                false,

                            body:
                                mensaje
                        }
                    })
            }
        );


    if (!response.ok) {

        const errorBody =
            await response.text();


        throw new Error(
            `WhatsApp API ${response.status}: ${errorBody}`
        );
    }


    return response.json();
}


// ============================================================
// WHATSAPP CLOUD API - VERIFICACIÓN DEL WEBHOOK
// ============================================================

app.get(
    '/webhook',
    (req, res) => {

        const mode =
            req.query['hub.mode'];

        const token =
            req.query['hub.verify_token'];

        const challenge =
            req.query['hub.challenge'];


        if (
            mode === 'subscribe' &&
            token === WHATSAPP_VERIFY_TOKEN
        ) {

            console.log(
                '✅ Webhook de WhatsApp verificado por Meta'
            );


            return res
                .status(200)
                .send(challenge);
        }


        console.warn(
            '⚠️ Intento de verificación de webhook rechazado'
        );


        return res.sendStatus(403);
    }
);


// ============================================================
// WHATSAPP CLOUD API - WEBHOOK META
// ============================================================
//
// Arquitectura actual:
// - Los mensajes del CLIENTE entran por ManyChat -> /manychat.
// - Este webhook de Meta se usa para detectar mensajes enviados
//   manualmente desde WhatsApp Business App mediante
//   smb_message_echoes.
//
// IMPORTANTE:
// No responder directamente a value.messages desde este webhook,
// porque ManyChat ya procesa esos mensajes. Hacerlo duplicaría la
// conversación y además usaría la antigua ruta directa de Cloud API.
// ============================================================

app.post(
    '/webhook',
    async (req, res) => {

        res.sendStatus(200);

        const body =
            req.body;

        const change =
            body?.entry?.[0]
                ?.changes?.[0];

        const field =
            change?.field;

        const value =
            change?.value;

        console.log(
            '📡 WEBHOOK META RECIBIDO:',
            field || 'sin campo'
        );

        // --------------------------------------------------------
        // TOMA HUMANA DESDE WHATSAPP BUSINESS APP
        // --------------------------------------------------------
        //
        // Meta envía smb_message_echoes cuando el negocio escribe
        // desde WhatsApp Business App o un dispositivo vinculado.
        // "to" es el teléfono real del cliente.
        // --------------------------------------------------------

        if (
            field === 'smb_message_echoes' &&
            Array.isArray(value?.message_echoes)
        ) {

            for (
                const echo
                of value.message_echoes
            ) {

                const telefonoCliente =
                    normalizarTelefono(
                        echo?.to
                    );

                if (!telefonoCliente) {
                    continue;
                }

                const textoHumano =
                    echo?.text?.body || '';

                const clienteHumano = getCliente(telefonoCliente);
                await cargarMemoriaPersistente(telefonoCliente, clienteHumano);

                registrarHistorialHumano(
                    telefonoCliente,
                    'humano',
                    textoHumano
                );

                if (esFraseCierreHumano(textoHumano)) {
                    setModoAtencion(
                        telefonoCliente,
                        'ESPERA'
                    );

                    console.log(
                        `⏳ Cierre humano detectado para ${telefonoCliente}. Martín esperará ${MINUTOS_REACTIVACION} minutos de silencio.`
                    );
                } else {
                    setModoAtencion(
                        telefonoCliente,
                        'HUMANO'
                    );

                    console.log(
                        `👤 Toma humana detectada desde WhatsApp Business para ${telefonoCliente}`
                    );
                }

                await guardarMemoriaPersistente(
                    telefonoCliente,
                    clienteHumano
                );
            }

            return;
        }

        // --------------------------------------------------------
        // MENSAJES DEL CLIENTE
        // --------------------------------------------------------
        //
        // ManyChat es el único canal que debe enviarlos a Martín.
        // Meta también puede notificarlos aquí porque la app está
        // suscripta a "messages", pero se ignoran deliberadamente.
        // --------------------------------------------------------

        if (field === 'messages') {

            console.log(
                'ℹ️ Evento messages de Meta ignorado: lo procesa ManyChat'
            );

            return;
        }
    }
);


// ============================================================
// MANYCHAT - SOLICITUD EXTERNA
// ============================================================
//
// ManyChat envía:
// {
//   "mensaje": "<Last Text Input>",
//   "userId": "<ManyChat Contact ID>",
//   "telefono": "<WhatsApp ID / wa_id>"
// }
//
// El teléfono real es la clave canónica para poder relacionar
// ManyChat con smb_message_echoes de Meta.
//
// Si el contacto está en modo HUMANO:
// {
//   "ok": true,
//   "modo": "HUMANO",
//   "responder": false,
//   "reply": "",
//   "respuesta": ""
// }
// ============================================================

app.post(
    '/manychat',
    async (req, res) => {

        const body =
            req.body || {};

        const message =
            body.message ??
            body.mensaje ??
            body.text ??
            body.lastTextInput ??
            '';

        const userId =
            body.userId ??
            body.user_id ??
            body.contactId ??
            body.contact_id ??
            '';

        const telefonoRecibido =
            body.telefono ??
            body.phone ??
            body.wa_id ??
            body.whatsappId ??
            body.whatsapp_id ??
            '';

        const name =
            body.name ??
            body.nombre ??
            body.firstName ??
            body.first_name ??
            '';

        const mensaje =
            String(message || '').trim();

        const telefono =
            normalizarTelefono(
                telefonoRecibido
            );

        const identificadorManyChat =
            String(userId || '').trim();

        const identificador =
            telefono ||
            identificadorManyChat;

        if (!mensaje) {

            return res
                .status(400)
                .json({
                    ok: false,
                    error: 'Falta el mensaje del cliente'
                });
        }

        if (!identificador) {

            return res
                .status(400)
                .json({
                    ok: false,
                    error: 'Falta un identificador estable del contacto'
                });
        }

        try {

            console.log(
                `📥 ManyChat entrante de ${identificador} (MC ${identificadorManyChat || 'sin ID'}): ${mensaje}`
            );

            // Damos una ventana breve para que, si el mensaje fue enviado
            // manualmente desde WhatsApp Business App, llegue primero el
            // smb_message_echoes y cambie el contacto a HUMANO.
            if (telefono) {
                await esperar(1500);
            }

            const clienteManyChat = getCliente(identificador);

            if (telefono) {
                await cargarMemoriaPersistente(telefono, clienteManyChat);
            }

            const modoActual =
                telefono
                    ? getModoAtencion(telefono)
                    : 'IA';

            if (
                telefono &&
                (
                    modoActual === 'HUMANO' ||
                    modoActual === 'ESPERA'
                )
            ) {

                registrarHistorialHumano(
                    telefono,
                    'cliente',
                    mensaje
                );

                if (modoActual === 'ESPERA') {
                    reiniciarEsperaSiCorresponde(telefono);
                }

                await guardarMemoriaPersistente(
                    telefono,
                    clienteManyChat,
                    { resumenIntervencionHumana: resumenHumanoPersistente(telefono) }
                );

                console.log(
                    `🛑 ManyChat suprimido: ${telefono} está en modo ${modoActual}`
                );

                return res.json({
                    ok: true,
                    modo: modoActual,
                    responder: false,
                    reply: '',
                    respuesta: ''
                });
            }

            if (telefono) {
                volcarHistorialHumanoEnCliente(
                    telefono,
                    clienteManyChat
                );
            }

            if (name) {

                clienteManyChat.nombre =
                    String(name).trim();
            }

            const reply =
                await procesarMensaje(
                    mensaje,
                    identificador
                );

            await sincronizarLeadWhatsApp(
                telefono || identificador,
                name,
                getCliente(
                    identificador
                )
            );

            if (telefono) {
                await guardarMemoriaPersistente(
                    telefono,
                    getCliente(identificador),
                    { nombre: name, ultimaIntencion: mensaje }
                );
            }

            console.log(
                `✅ ManyChat respondido a ${identificador}`
            );

            return res.json({
                ok: true,
                modo: 'IA',
                responder: true,
                reply,
                respuesta: reply
            });

        } catch (error) {

            console.error(
                '❌ Error procesando ManyChat:',
                error
            );

            return res
                .status(500)
                .json({
                    ok: false,
                    error: 'Error procesando mensaje'
                });
        }
    }
);


// ============================================================
// CONTROL INTERNO IA / HUMANO
// ============================================================
//
// Endpoint preparado para una futura acción interna de ManyChat
// o panel de control. No se usa desde el chat del cliente.
//
// Requiere MARTIN_CONTROL_TOKEN en Render.
// POST /control/modo
// Header: x-martin-control-token
// Body: { "telefono": "549...", "modo": "IA" | "HUMANO" }
// ============================================================

app.post(
    '/control/modo',
    (req, res) => {

        const tokenEsperado =
            process.env.MARTIN_CONTROL_TOKEN;

        const tokenRecibido =
            req.headers[
                'x-martin-control-token'
            ];

        if (
            !tokenEsperado ||
            tokenRecibido !== tokenEsperado
        ) {

            return res
                .status(403)
                .json({
                    ok: false,
                    error: 'No autorizado'
                });
        }

        const telefono =
            normalizarTelefono(
                req.body?.telefono
            );

        const modo =
            String(
                req.body?.modo || ''
            ).toUpperCase();

        if (
            !telefono ||
            !['IA', 'HUMANO', 'ESPERA'].includes(modo)
        ) {

            return res
                .status(400)
                .json({
                    ok: false,
                    error: 'telefono y modo (IA/HUMANO/ESPERA) son obligatorios'
                });
        }

        setModoAtencion(
            telefono,
            modo
        );

        return res.json({
            ok: true,
            telefono,
            modo
        });
    }
);


// ============================================================
// 13. ENDPOINT CHAT
// ============================================================

app.post(
    '/chat',
    async (req, res) => {

        const {
            message,
            userId
        } = req.body;


        try {

            const reply =
                await procesarMensaje(
                    message,
                    userId || 'web_user'
                );


            res.json({
                reply
            });


        } catch (error) {

            console.error(
                '❌ Error procesando mensaje:',
                error
            );


            res.status(500).json({
                error:
                    'Error procesando mensaje'
            });
        }
    }
);


// ============================================================
// 14. HEALTH
// ============================================================

app.get(
    '/health',
    (req, res) => {

        res.json({

            ok: true,

            seller:
                seller.nombre,

            empresa:
                seller.empresa,

            sheets:
                process.env.USE_GOOGLE_SHEETS === 'true'
                    ? 'habilitado'
                    : 'pendiente',

            timestamp:
                new Date().toISOString()
        });
    }
);


// ============================================================
// 15. START
// ============================================================

const PORT =
    process.env.PORT || 3000;


app.listen(
    PORT,
    () => {

        console.log(
            '🚀 MARTIN IA SELLER - V4 PUBLICIDAD + QWEN 3.8 + MEMORIA'
        );

        console.log(
            `👤 Seller: ${seller.nombre}`
        );

        console.log(
            `🏢 Empresa: ${seller.empresa}`
        );

        console.log(
            `📂 Puerto: ${PORT}`
        );

        console.log(
            '🧠 IA: Groq / Qwen 3.6 27B'
        );

        console.log(
            `📊 Google Sheets: ${
                process.env.USE_GOOGLE_SHEETS === 'true'
                    ? 'HABILITADO'
                    : 'PENDIENTE - usando campaigns.json'
            }`
        );
    }
);