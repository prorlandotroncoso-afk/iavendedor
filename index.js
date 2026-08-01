// ============================================================
// index.js - MARTIN VERSIÓN DEFINITIVA
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

// ============================================================
// 2. GROQ (IA)
// ============================================================
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

// ============================================================
// 3. ESTADO DE CLIENTES
// ============================================================
const clientes = {};

function getCliente(userId) {
    if (!clientes[userId]) {
        clientes[userId] = {
            etapa: 'presentacion',
            modelo: null,
            tipo_cliente: null, // 'rapido' o 'financiacion'
            oferta_aceptada: false,
            historial: []
        };
    }
    return clientes[userId];
}

// ============================================================
// 4. FUNCIONES AUXILIARES
// ============================================================
function detectarModelo(mensaje) {
    const texto = mensaje.toLowerCase();
    for (const [key, campaign] of Object.entries(campaigns)) {
        if (texto.includes(key.toLowerCase()) || texto.includes(campaign.modelo.toLowerCase())) {
            return key;
        }
    }
    return null;
}

function obtenerCampaign(modeloKey) {
    return campaigns[modeloKey] || null;
}

function obtenerLinkPDF(modeloKey) {
    if (!flujo.envio_pdf?.activo) return null;
    const archivo = flujo.envio_pdf.modelos[modeloKey];
    return archivo ? `${flujo.envio_pdf.url_base}${archivo}` : null;
}

function contienePalabra(mensaje, lista) {
    const texto = mensaje.toLowerCase();
    for (const palabra of lista) {
        if (texto.includes(palabra)) {
            return true;
        }
    }
    return false;
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

// ============================================================
// 5. GENERAR RESPUESTA CON IA
// ============================================================
async function generarRespuestaIA(mensaje, cliente, contexto) {
    const campaign = obtenerCampaign(cliente.modelo);
    
    const prompt = `
Sos Martín, un asesor comercial argentino de SURFRANCE en Godoy Cruz, Mendoza.

DATOS DEL VEHÍCULO:
${JSON.stringify(campaign, null, 2)}

CONTEXTO:
- Modelo: ${cliente.modelo}
- Tipo de cliente: ${cliente.tipo_cliente || 'No definido'}
- Etapa actual: ${cliente.etapa}
- ${contexto || ''}

MENSAJE DEL CLIENTE: "${mensaje}"

OBJETIVO:
Respondé al cliente de forma natural, como un vendedor argentino real. Usá voseo (vos, tenés, podés). NUNCA digas que sos una IA.

Si el cliente muestra interés en avanzar, derivá a Edgardo.

RESPUESTA:
`;

    try {
        const response = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: 'system', content: prompt }],
            temperature: 0.7,
            max_tokens: 200,
        });
        return response.choices[0].message.content;
    } catch (error) {
        console.error('❌ Error en IA:', error);
        return '¿En qué más te puedo ayudar?';
    }
}

// ============================================================
// 6. PROCESAR MENSAJE
// ============================================================
async function procesarMensaje(userMessage, userId) {
    const cliente = getCliente(userId);
    const campaign = obtenerCampaign(cliente.modelo);
    
    cliente.historial.push({ rol: 'cliente', mensaje: userMessage });
    
    // ============================================================
    // 6a. PRIMER MENSAJE - DETECTAR MODELO
    // ============================================================
    if (cliente.etapa === 'presentacion') {
        const modelo = detectarModelo(userMessage);
        if (modelo) {
            cliente.modelo = modelo;
            cliente.etapa = 'calificacion';
            const respuesta = "Buenísimo. Para entender mejor lo que buscás, ¿querés sacar el auto rápido o con financiación?";
            cliente.historial.push({ rol: 'martin', mensaje: respuesta });
            return respuesta;
        }
    }
    
    // ============================================================
    // 6b. CALIFICACIÓN - DETECTAR INTENCIÓN
    // ============================================================
    if (cliente.etapa === 'calificacion') {
        // Si dice "rápido" o similar
        if (contienePalabra(userMessage, flujo.palabras_clave?.rapido || [])) {
            cliente.tipo_cliente = 'rapido';
            cliente.etapa = 'rapido_precio';
            const precio = campaign?.precioLista || '$XX.XXX.XXX';
            const modelo = campaign?.modelo || cliente.modelo;
            const respuesta = `Excelente. El precio de lista del ${modelo} es de ${precio}. ¿Te sirve?`;
            cliente.historial.push({ rol: 'martin', mensaje: respuesta });
            return respuesta;
        }
        
        // Si dice "financiación" o similar
        if (contienePalabra(userMessage, flujo.palabras_clave?.financiacion || [])) {
            cliente.tipo_cliente = 'financiacion';
            cliente.etapa = 'financiacion_explicacion';
            const respuestaIA = await generarRespuestaIA(userMessage, cliente, 'Explicá el plan 70/30 de forma clara y natural.');
            cliente.historial.push({ rol: 'martin', mensaje: respuestaIA });
            return respuestaIA;
        }
        
        // Si no detecta intención clara
        const respuesta = "Entendido. Decime, ¿estás buscando comprar al contado o necesitás financiación?";
        cliente.historial.push({ rol: 'martin', mensaje: respuesta });
        return respuesta;
    }
    
    // ============================================================
    // 6c. RÁPIDO - PRECIO DADO
    // ============================================================
    if (cliente.etapa === 'rapido_precio') {
        // Si confirma la compra
        if (contienePalabra(userMessage, flujo.palabras_clave?.confirmacion_compra || [])) {
            cliente.etapa = 'rapido_cierre';
            const respuesta = "Genial. Te paso con Edgardo, él te va a ayudar con la venta directa. Te contacta al toque.";
            cliente.historial.push({ rol: 'martin', mensaje: respuesta });
            return respuesta;
        }
        
        // Si dice que es caro
        if (contienePalabra(userMessage, flujo.palabras_clave?.rechazo_precio || [])) {
            const respuesta = "Entiendo. También tenemos financiación de fábrica con un plan 70/30. ¿Te parece si te explico cómo funciona?";
            cliente.etapa = 'calificacion';
            // Forzar a que el cliente elija financiación
            cliente.historial.push({ rol: 'martin', mensaje: respuesta });
            return respuesta;
        }
        
        // Cualquier otra respuesta, usar IA
        const respuestaIA = await generarRespuestaIA(userMessage, cliente, 'El cliente preguntó sobre el precio. Respondé y preguntá si le sirve.');
        cliente.historial.push({ rol: 'martin', mensaje: respuestaIA });
        return respuestaIA;
    }
    
    // ============================================================
    // 6d. FINANCIACIÓN - EXPLICACIÓN DEL PLAN
    // ============================================================
    if (cliente.etapa === 'financiacion_explicacion') {
        cliente.etapa = 'financiacion_detalle';
        const respuestaIA = await generarRespuestaIA(userMessage, cliente, 'El cliente está interesado en financiación. Explicá las cuotas, la entrega asegurada y los requisitos.');
        cliente.historial.push({ rol: 'martin', mensaje: respuestaIA });
        return respuestaIA;
    }
    
    if (cliente.etapa === 'financiacion_detalle') {
        // Si el cliente quiere avanzar
        if (contienePalabra(userMessage, flujo.palabras_clave?.confirmacion_compra || [])) {
            cliente.etapa = 'financiacion_cierre';
            const respuesta = "Genial. Te paso con Edgardo, él te va a ayudar con los papeles. Te contacta al toque.";
            cliente.historial.push({ rol: 'martin', mensaje: respuesta });
            return respuesta;
        }
        
        // Si pide más info, usar IA
        const respuestaIA = await generarRespuestaIA(userMessage, cliente, 'El cliente pidió más información sobre el plan de financiación. Respondé con claridad.');
        cliente.historial.push({ rol: 'martin', mensaje: respuestaIA });
        return respuestaIA;
    }
    
    // ============================================================
    // 6e. DETECTAR OBJECIÓN
    // ============================================================
    const objecion = detectarObjecion(userMessage);
    if (objecion) {
        let respuesta = objecion.respuesta;
        if (objecion.key === 'pedir_detalle') {
            const linkPDF = obtenerLinkPDF(cliente.modelo);
            respuesta = linkPDF ? 
                `Dale, te paso el link con el detalle completo: ${linkPDF}` : 
                'Dale, te paso el detalle completo. Ahora te lo envío.';
        }
        cliente.historial.push({ rol: 'martin', mensaje: respuesta });
        return respuesta;
    }
    
    // ============================================================
    // 6f. RESPUESTA POR DEFECTO (IA)
    // ============================================================
    const respuestaIA = await generarRespuestaIA(userMessage, cliente, 'Respondé al cliente de forma natural.');
    cliente.historial.push({ rol: 'martin', mensaje: respuestaIA });
    return respuestaIA;
}

// ============================================================
// 7. ENDPOINTS
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
// 8. INICIO
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 MARTIN - Versión definitiva`);
    console.log(`📂 Puerto: ${PORT}`);
});