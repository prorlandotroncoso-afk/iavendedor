// ============================================================
// utils/loader.js - Carga el vendedor activo
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function loadSeller() {
    const sellerName = process.env.SELLER_ACTIVO || 'martin-autos';
    const sellerPath = path.join(__dirname, '..', 'sellers', sellerName);
    
    if (!fs.existsSync(sellerPath)) {
        throw new Error(`❌ Vendedor "${sellerName}" no encontrado en ${sellerPath}`);
    }
    
    const configPath = path.join(sellerPath, 'config.json');
    if (!fs.existsSync(configPath)) {
        throw new Error(`❌ config.json no encontrado en ${configPath}`);
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    const promptPath = path.join(sellerPath, 'prompt.js');
    let prompt = '';
    if (fs.existsSync(promptPath)) {
        const promptModule = await import('file://' + promptPath);
        prompt = promptModule.default;
    } else {
        prompt = `Sos ${config.nombre}, asesor de ${config.empresa}.`;
    }
    
    return {
        ...config,
        nombreCarpeta: sellerName,
        prompt,
        instruccionesAdicionales: config.instruccionesAdicionales || ''
    };
}