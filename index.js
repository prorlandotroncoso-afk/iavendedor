// ============================================================
// index.js - MOTOR MODULAR DE MARTIN CON MANUAL DE OPERACIONES
// ============================================================

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Groq from 'groq-sdk';
import { loadSeller } from './utils/loader.js';
import { humanizarRespuesta } from './utils/humanizer.js';
import { guardarLead, buscarLead, actualizarEtapa } from './config/googleSheets.js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============================================================
// 1. CARGA DEL VENDEDOR
// ============================================================
let seller;

try {
    seller = await loadSeller();
    console.log(`✅ Vendedor cargado: ${seller.nombre} (${seller.industria})`);
} catch (error) {
    console.error('❌ Error cargando vendedor:', error.message);
    process.exit(1);
}

// ============================================================
// 2. CARGA DEL MANUAL DE OPERACIONES
// ============================================================
function cargarManual() {
    const manualPath = path.join(__dirname, 'sellers', seller.nombreCarpeta, 'knowledge', 'manual.txt');
    if (fs.existsSync(manualPath)) {
        return fs.readFileSync(manualPath, 'utf-8');
    }
    return '';
}

const manual = cargarManual();
if (manual) {
    console.log('✅ Manual de operaciones cargado');
} else {
    console.log('⚠️ Manual de operaciones no encontrado');
}

// ============================================================
// 3. GROQ
// ============================================================
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

// ============================================================
// 4. CONVERSACIONES
// ============================================================
const conversations = {};

function getConversation(userId) {
    if (!conversations[userId]) {
        // Crear el sistema con prompt + manual
        let systemContent = seller.prompt;
        if (manual) {
            systemContent += `\n\nMANUAL DE OPERACIONES:\n${manual}`;
        }
        conversations[userId] = [
            { role: 'system', content: systemContent }
        ];
    }
    return conversations[userId];
}

// ============================================================
// 5. DETECCIÓN DE CAMPAÑA
// ============================================================
function detectCampaign(message, campaigns) {
    const text = message.toLowerCase();
    for (const key in campaigns) {
        const campaign = campaigns[key];
        if (!campaign.modelo) continue;
        const modelo = campaign.modelo.toLowerCase();
        if (text.includes(key.toLowerCase()) || text.includes(modelo)) {
            return campaign;
        }
        const palabras = modelo.split(' ');
        for (const palabra of palabras) {
            if (palabra.length > 2 && text.includes(palabra)) {
                return campaign;
            }
        }
    }
    return null;
}

// ============================================================
// 6. PROCESAR MENSAJE
// ============================================================
async function procesarMensaje(userMessage, userId) {
    const conv = getConversation(userId);
    
    // Cargar campaigns desde la carpeta del seller
    const campaignsPath = path.join(__dirname, 'sellers', seller.nombreCarpeta, 'campaigns.json');
    let campaigns = {};
    if (fs.existsSync(campaignsPath)) {
        campaigns = JSON.parse(fs.readFileSync(campaignsPath));
    }
    
    // Detectar campaña
    const currentCampaign = detectCampaign(userMessage, campaigns);
    
    // Enriquecer mensaje
    let enhancedMessage = userMessage;
    if (currentCampaign) {
        enhancedMessage += `\n\nINFORMACIÓN OFICIAL DE CAMPAÑA:\n${JSON.stringify(currentCampaign, null, 2)}`;
    }
    
    if (seller.instruccionesAdicionales) {
        enhancedMessage += `\n\n${seller.instruccionesAdicionales}`;
    }
    
    conv.push({ role: 'user', content: enhancedMessage });
    
    try {
        const response = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: conv.slice(0, 20),
        });
        
        let botReply = response.choices[0].message.content;
        
        // Humanizar solo si no es un saludo corto
        if (!botReply.startsWith('Hola') && !botReply.startsWith('Buen')) {
            botReply = humanizarRespuesta(botReply);
        }
        
        conv.push({ role: 'assistant', content: botReply });
        
        // Guardar en Google Sheets (si está configurado)
        try {
            await guardarLead({
                telefono: userId,
                nombre: 'Cliente',
                vehiculo: currentCampaign?.modelo || '',
                etapa: 'conversando',
                ultimoMensaje: userMessage
            });
        } catch (e) {
            // Google Sheets es opcional
        }
        
        return botReply;
        
    } catch (error) {
        console.error('❌ Error en Groq:', error);
        return 'Disculpá, hubo un problema. Te paso con Edgardo para que te ayude.';
    }
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

app.post('/save-campaign', (req, res) => {
    const data = req.body;
    const campaignsPath = path.join(__dirname, 'sellers', seller.nombreCarpeta, 'campaigns.json');
    const campaigns = JSON.parse(fs.readFileSync(campaignsPath));
    const key = data.modelo.trim().toLowerCase();
    campaigns[key] = data;
    fs.writeFileSync(campaignsPath, JSON.stringify(campaigns, null, 2));
    res.json({ success: true });
});

// ============================================================
// 8. INICIO
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 MARTIN ${seller.nombre} corriendo en puerto ${PORT}`);
    console.log(`📂 Industria: ${seller.industria}`);
});