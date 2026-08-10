// ============================================================
// index.js - MARTIN ASISTENTE 24/7 (CORREGIDO)
// ============================================================

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Groq from 'groq-sdk';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============================================================
// 1. CARGAR CONFIGURACIÓN
// ============================================================
const flujoPath = path.join(__dirname, 'sellers', 'martin-autos', 'flujo.json');
let flujo = JSON.parse(fs.readFileSync(flujoPath, 'utf-8'));

const campaignsPath = path.join(__dirname, 'sellers', 'martin-autos', 'campaigns.json');
let campaigns = JSON.parse(fs.readFileSync(campaignsPath, 'utf-8'));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ============================================================
// 2. ESTADO DE CLIENTES
// ============================================================
const clientes = {};

function getCliente(userId) {
    if (!clientes[userId]) {
        clientes[userId] = {
            etapa: 'saludo',
            modelo: null,
            metodo: null,
            historial: []
        };
    }
    return clientes[userId];
}

// ============================================================
// 3. FUNCIONES AUXILIARES
// ============================================================
function elegirFrase(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function contienePalabra(mensaje, lista) {
    if (!lista) return false;
    const texto = mensaje.toLowerCase();
    for (const palabra of lista) {
        if (texto.includes(palabra.toLowerCase())) {
            return true;
        }
    }
    return false;
}

function detectarModelo(mensaje) {
    const texto = mensaje.toLowerCase();
    for (const [key] of Object.entries(campaigns)) {
        if (texto.includes(key.toLowerCase())) {
            return key;
        }
    }
    return null;
}

function detectarObjecion(mensaje) {
    const texto = mensaje.toLowerCase();
    for (const [key, obj] of Object.entries(flujo.objeciones || {})) {
        for (const palabra of obj.detectar) {
            if (texto.includes(palabra)) {
                return { key, respuesta: obj.respuesta };
            }
        }
    }
    return null;
}

function obtenerLinkPDF(modeloKey) {
    if (!flujo.envio_pdf?.activo) return null;
    const archivo = flujo.envio_pdf.modelos[modeloKey];
    return archivo ? `${flujo.envio_pdf.url_base}${archivo}` : null;
}

// ============================================================
// 4. GENERAR RESPUESTA CON IA (DESVÍOS)
// ============================================================
async function generarRespuestaIA(mensaje, cliente) {
    const prompt = `
Sos Martín, asistente de SURFRANCE. El cliente dijo: "${mensaje}".
Etapa actual: ${cliente.etapa}. Modelo: ${cliente.modelo || 'ninguno'}.

Respondé de forma clara, breve y en voseo argentino.
Si no sabés algo, decí que se lo consultás a Edgardo.
Si el cliente quiere avanzar, derivá a Edgardo.
`;

    try {
        const response = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: 'system', content: prompt }],
            temperature: 0.7,
            max_tokens: 150,
        });
        return response.choices[0].message.content;
    } catch (error) {
        console.error('❌ Error en IA:', error);
        return 'No tengo esa información, te paso con Edgardo.';
    }
}

// ============================================================
// 5. PROCESAR MENSAJE
// ============================================================
async function procesarMensaje(userMessage, userId) {
    const cliente = getCliente(userId);
    cliente.historial.push({ rol: 'cliente', mensaje: userMessage });

    // 1. Detectar objeción
    const objecion = detectarObjecion(userMessage);
    if (objecion) {
        let respuesta = objecion.respuesta;
        if (objecion.key === 'pedir_detalle') {
            const link = obtenerLinkPDF(cliente.modelo);
            respuesta = link ? `Dale, te paso el link: ${link}` : 'Dale, te paso el detalle.';
        }
        cliente.historial.push({ rol: 'martin', mensaje: respuesta });
        return respuesta;
    }

    // 2. Seguir el flujo
    const etapaActual = cliente.etapa;
    const etapaData = flujo.etapas[etapaActual];
    if (!etapaData) {
        const respuesta = 'No tengo esa información, te paso con Edgardo.';
        cliente.historial.push({ rol: 'martin', mensaje: respuesta });
        return respuesta;
    }

    // Saludo
    if (etapaActual === 'saludo') {
        cliente.etapa = 'modelo';
        const respuesta = elegirFrase(etapaData.frase);
        cliente.historial.push({ rol: 'martin', mensaje: respuesta });
        return respuesta;
    }

    // Modelo
    if (etapaActual === 'modelo') {
        const modelo = detectarModelo(userMessage);
        if (modelo) {
            cliente.modelo = modelo;
            cliente.etapa = 'metodo';
            const respuesta = elegirFrase(flujo.etapas.metodo.frase);
            cliente.historial.push({ rol: 'martin', mensaje: respuesta });
            return respuesta;
        }
        const respuesta = 'No entendí qué modelo te interesa. Tenemos 208, 2008, Partner y Expert. ¿Cuál te llama?';
        cliente.historial.push({ rol: 'martin', mensaje: respuesta });
        return respuesta;
    }

    // Método
    if (etapaActual === 'metodo') {
        if (contienePalabra(userMessage, flujo.palabras_clave?.directa || [])) {
            cliente.metodo = 'directa';
            const respuesta = 'Perfecto. Te paso con Edgardo para la venta directa. Te contacta al toque.';
            cliente.etapa = 'derivacion';
            cliente.historial.push({ rol: 'martin', mensaje: respuesta });
            return respuesta;
        }
        if (contienePalabra(userMessage, flujo.palabras_clave?.financiacion || [])) {
            cliente.metodo = 'financiacion';
            cliente.etapa = 'financiacion';
            const respuesta = elegirFrase(flujo.etapas.financiacion.frase);
            cliente.historial.push({ rol: 'martin', mensaje: respuesta });
            return respuesta;
        }
        const respuesta = '¿Buscás adquisición directa o financiamiento de fábrica?';
        cliente.historial.push({ rol: 'martin', mensaje: respuesta });
        return respuesta;
    }

    // Financiación
    if (etapaActual === 'financiacion') {
        if (contienePalabra(userMessage, flujo.palabras_clave?.confirmacion || [])) {
            cliente.etapa = 'requisitos';
            const respuesta = elegirFrase(flujo.etapas.requisitos.frase);
            cliente.historial.push({ rol: 'martin', mensaje: respuesta });
            return respuesta;
        }
        const respuesta = '¿Te gustaría saber los requisitos para ingresar?';
        cliente.historial.push({ rol: 'martin', mensaje: respuesta });
        return respuesta;
    }

    // Requisitos
    if (etapaActual === 'requisitos') {
        if (contienePalabra(userMessage, flujo.palabras_clave?.confirmacion || [])) {
            cliente.etapa = 'cierre';
            const respuesta = elegirFrase(flujo.etapas.cierre.frase);
            cliente.historial.push({ rol: 'martin', mensaje: respuesta });
            return respuesta;
        }
        if (contienePalabra(userMessage, flujo.palabras_clave?.rechazo || [])) {
            const respuesta = 'Dale, tomate tu tiempo. Si querés, te paso el detalle por PDF.';
            cliente.historial.push({ rol: 'martin', mensaje: respuesta });
            return respuesta;
        }
        const respuesta = elegirFrase(flujo.etapas.requisitos.frase);
        cliente.historial.push({ rol: 'martin', mensaje: respuesta });
        return respuesta;
    }

    // Cierre
    if (etapaActual === 'cierre') {
        if (contienePalabra(userMessage, flujo.palabras_clave?.confirmacion || [])) {
            cliente.etapa = 'contacto';
            const respuesta = elegirFrase(flujo.etapas.contacto.frase);
            cliente.historial.push({ rol: 'martin', mensaje: respuesta });
            return respuesta;
        }
        const respuesta = elegirFrase(flujo.etapas.cierre.frase);
        cliente.historial.push({ rol: 'martin', mensaje: respuesta });
        return respuesta;
    }

    // Contacto
    if (etapaActual === 'contacto') {
        cliente.etapa = 'derivacion';
        const respuesta = elegirFrase(flujo.etapas.derivacion.frase);
        cliente.historial.push({ rol: 'martin', mensaje: respuesta });
        return respuesta;
    }

    // Derivación (final) - CORREGIDO: reinicia la etapa a 'saludo'
    if (etapaActual === 'derivacion') {
        const respuesta = 'Ya te contacta Edgardo. ¡Gracias por comunicarte!';
        cliente.historial.push({ rol: 'martin', mensaje: respuesta });
        // Reiniciar la etapa para que pueda seguir conversando
        cliente.etapa = 'saludo';
        return respuesta;
    }

    // Respuesta por defecto
    const respuestaDefault = '¿En qué más te puedo ayudar?';
    cliente.historial.push({ rol: 'martin', mensaje: respuestaDefault });
    return respuestaDefault;
}

// ============================================================
// 6. ENDPOINTS
// ============================================================
app.post('/chat', async (req, res) => {
    const { message, userId } = req.body;
    try {
        const reply = await procesarMensaje(message, userId || 'web_user');
        res.json({ reply });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error procesando mensaje' });
    }
});

// ============================================================
// 7. INICIO
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 MARTIN - Asistente 24/7 (corregido)`);
    console.log(`📂 Puerto: ${PORT}`);
    console.log(`📋 Etapas: ${Object.keys(flujo.etapas).length}`);
    console.log(`🛡️ Objeciones: ${Object.keys(flujo.objeciones || {}).length}`);
    console.log(`📄 Envío de PDF: ${flujo.envio_pdf?.activo ? 'ACTIVADO' : 'DESACTIVADO'}`);
});