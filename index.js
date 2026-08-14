// ============================================================
// index.js
// MARTIN IA SELLER - VERSIÓN HÍBRIDA CONTROLADA
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


dotenv.config();


// ============================================================
// 1. APP
// ============================================================

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));


// ============================================================
// 2. CONFIGURACIÓN DEL SELLER
// ============================================================

const seller = await loadSeller();

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});


// ============================================================
// 3. MEMORIA TEMPORAL
// ============================================================

const clientes = {};


function getCliente(userId) {

    if (!clientes[userId]) {

        clientes[userId] = {

            etapa: 'inicio',

            modelo: null,

            metodo: null,

            historial: [],

            ultimaPregunta: null,

            derivacionSolicitada: false
        };
    }

    return clientes[userId];
}


function guardarHistorial(cliente, rol, mensaje) {

    cliente.historial.push({
        rol,
        mensaje
    });

    if (cliente.historial.length > 20) {

        cliente.historial =
            cliente.historial.slice(-20);
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


function contieneAlguna(texto, palabras) {

    const t = normalizar(texto);

    return palabras.some(
        palabra => t.includes(normalizar(palabra))
    );
}


function esConfirmacionSimple(texto) {

    const t = normalizar(texto);

    const confirmaciones = [
        'si',
        'dale',
        'ok',
        'bueno',
        'perfecto',
        'claro',
        'de una',
        'esta bien',
        'me sirve'
    ];

    return confirmaciones.includes(t);
}


function esSaludo(texto) {

    const t = normalizar(texto);

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


function nombreVehiculo(vehiculo, fallback) {

    return (
        vehiculo?.modelo ||
        fallback?.toUpperCase() ||
        'el vehículo'
    );
}


// ============================================================
// 5. DETECCIÓN DIRECTA DE MODELO
// ============================================================

async function detectarModeloDirecto(mensaje) {

    const modelos =
        await listarModelosDisponibles();

    const texto = normalizar(mensaje);

    for (const vehiculo of modelos) {

        const key =
            normalizar(vehiculo.key);

        const modeloCompleto =
            normalizar(vehiculo.modelo || '');

        if (
            texto.includes(key) ||
            (
                modeloCompleto &&
                texto.includes(modeloCompleto)
            )
        ) {
            return vehiculo.key;
        }
    }

    return null;
}


// ============================================================
// 6. CLASIFICADOR LOCAL DE RESPALDO
// ============================================================

async function clasificarLocal(mensaje) {

    const intenciones = [];

    const modelo =
        await detectarModeloDirecto(mensaje);


    if (esSaludo(mensaje)) {

        intenciones.push('saludo');
    }


    if (
        contieneAlguna(mensaje, [
            'financiacion',
            'financiamiento',
            'financiar',
            'plan',
            'credito'
        ])
    ) {

        intenciones.push('financiacion');
    }


    if (
        contieneAlguna(mensaje, [
            'contado',
            'compra directa',
            'adquisicion directa',
            'efectivo',
            'directa'
        ])
    ) {

        intenciones.push('directa');
    }


    if (
        contieneAlguna(mensaje, [
            'cuota',
            'cuotas',
            'mensualidad',
            'por mes',
            'detalle',
            'resto'
        ])
    ) {

        intenciones.push('cuotas');
    }


    if (
        contieneAlguna(mensaje, [
            'requisito',
            'requisitos',
            'dni',
            'documentacion',
            'documentos'
        ])
    ) {

        intenciones.push('requisitos');
    }


    if (
        contieneAlguna(mensaje, [
            'precio',
            'valor',
            'cuanto sale',
            'cuanto cuesta'
        ])
    ) {

        intenciones.push('precio');
    }


    if (
        contieneAlguna(mensaje, [
            'entrega',
            'retirar',
            'retiro',
            'adjudicacion',
            'adjudicar'
        ])
    ) {

        intenciones.push('entrega');
    }


    if (
        contieneAlguna(mensaje, [
            'equipamiento',
            'equipado',
            'trae',
            'tiene camara',
            'android auto',
            'carplay'
        ])
    ) {

        intenciones.push('equipamiento');
    }


    if (
        contieneAlguna(mensaje, [
            'pdf',
            'ficha tecnica',
            'folleto'
        ])
    ) {

        intenciones.push('material');
    }


    if (
        contieneAlguna(mensaje, [
            'quiero avanzar',
            'quiero ingresar',
            'quiero hacerlo',
            'me interesa avanzar',
            'contactame',
            'contactarme',
            'que me llamen',
            'hablar con alguien',
            'hablar con un asesor',
            'edgardo'
        ])
    ) {

        intenciones.push('avanzar');
    }


    if (
        contieneAlguna(mensaje, [
            'no gracias',
            'no me interesa',
            'ahora no',
            'mas adelante'
        ])
    ) {

        intenciones.push('rechazo');
    }


    return {

        modelo,

        intenciones,

        confirmacion: esConfirmacionSimple(mensaje)
    };
}


// ============================================================
// 7. INTERPRETAR MENSAJE CON GROQ
// ============================================================

async function interpretarMensaje(mensaje, cliente) {

    const respaldo =
        await clasificarLocal(mensaje);

    try {

        const modelos =
            await listarModelosDisponibles();

        const clavesModelos =
            modelos.map(v => v.key);

        const historialReciente =
            cliente.historial
                .slice(-6)
                .map(
                    h => `${h.rol}: ${h.mensaje}`
                )
                .join('\n');


        const prompt = `
${seller.prompt}

Ahora actuás SOLAMENTE como clasificador de intención.

NO respondas al cliente.
NO des información comercial.
NO inventes nada.

Analizá el mensaje y devolvé ÚNICAMENTE JSON válido.

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
entrega
equipamiento
material
avanzar
rechazo
otro

IMPORTANTE:

Una frase puede tener MÁS DE UNA intención.

Ejemplo:

"Sí me sirve, pero ¿las cuotas cuánto son?"

debe detectar "cuotas" y NO asumir que quiere ser derivado.

"Sí, dale"

puede ser solamente confirmación dependiendo del contexto.

"Quiero avanzar con el 2008"

debe detectar:
modelo = "2008"
intenciones = ["avanzar"]

"¿Y el resto?"

si el contexto reciente habla de cuotas,
debe interpretar intención "cuotas".

CONTEXTO ACTUAL:

Etapa: ${cliente.etapa}
Modelo actual: ${cliente.modelo || 'ninguno'}
Método actual: ${cliente.metodo || 'ninguno'}

HISTORIAL RECIENTE:

${historialReciente || 'Sin historial'}

MENSAJE:

"${mensaje}"

FORMATO EXACTO:

{
  "modelo": null,
  "intenciones": [],
  "confirmacion": false
}
`;


        const response =
            await groq.chat.completions.create({

                model: 'llama-3.3-70b-versatile',

                messages: [
                    {
                        role: 'system',
                        content: prompt
                    }
                ],

                temperature: 0,

                max_tokens: 180
            });


        const contenido =
            response.choices?.[0]?.message?.content || '';


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
                contenido.slice(inicio, fin + 1)
            );


        let modeloIA = json.modelo
            ? normalizar(json.modelo)
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
            'entrega',
            'equipamiento',
            'material',
            'avanzar',
            'rechazo',
            'otro'
        ];


        const intencionesIA =
            Array.isArray(json.intenciones)
                ? json.intenciones.filter(
                    i => intencionesValidas.includes(i)
                )
                : [];


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
                json.confirmacion === true
        };


    } catch (error) {

        console.error(
            '⚠️ Falló clasificación Groq:',
            error.message
        );

        return respaldo;
    }
}


// ============================================================
// 8. RESPUESTAS COMERCIALES CONTROLADAS
// ============================================================

function responderFinanciacion(vehiculo) {

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
            `podés retirar integrando el ${vehiculo.porcentaje_entrega} en las cuotas ${vehiculo.cuotas_entrega}`
        );
    }


    if (vehiculo.monto_10_porciento) {

        partes.push(
            `ese porcentaje hoy representa ${vehiculo.monto_10_porciento}`
        );
    }


    if (partes.length === 0) {

        return (
            'Tengo información de financiación para este modelo, ' +
            'pero el detalle completo no está disponible en este momento. ' +
            `Si querés, te lo puede confirmar ${seller.asesorDerivacion || 'Edgardo'}.`
        );
    }


    return (
        `${partes.join('. ')}. ` +
        '¿Querés que te cuente los requisitos o el detalle de las cuotas?'
    );
}


function responderCuotas(vehiculo) {

    const respuestas = [];


    if (vehiculo.suscripcion) {

        respuestas.push(
            `Cuota de suscripción: ${vehiculo.suscripcion}`
        );

    } else if (vehiculo.cuota_1) {

        respuestas.push(
            `Cuota 1: ${vehiculo.cuota_1}`
        );
    }


    if (vehiculo.cuotaPura) {

        respuestas.push(
            `Cuota pura: ${vehiculo.cuotaPura}`
        );
    }


    if (vehiculo.cuotaPublicitaria) {

        respuestas.push(
            `Cuota publicitaria: ${vehiculo.cuotaPublicitaria}`
        );
    }


    if (
        Array.isArray(vehiculo.cuotas) &&
        vehiculo.cuotas.length > 0
    ) {

        for (const tramo of vehiculo.cuotas) {

            if (
                tramo.desde != null &&
                tramo.hasta != null &&
                tramo.valor
            ) {

                if (
                    tramo.desde === tramo.hasta
                ) {

                    respuestas.push(
                        `Cuota ${tramo.desde}: ${tramo.valor}`
                    );

                } else {

                    respuestas.push(
                        `Cuotas ${tramo.desde} a ${tramo.hasta}: ${tramo.valor}`
                    );
                }
            }
        }
    }


    if (respuestas.length === 0) {

        return (
            'No tengo el detalle de las cuotas disponible en este momento. ' +
            `Si querés, te lo puede confirmar ${seller.asesorDerivacion || 'Edgardo'}.`
        );
    }


    if (
        respuestas.length === 1 &&
        (
            vehiculo.cuota_1 ||
            vehiculo.suscripcion
        )
    ) {

        return (
            `${respuestas[0]}. ` +
            'El resto del detalle no está disponible en este momento. ' +
            `Si querés, te lo puede confirmar ${seller.asesorDerivacion || 'Edgardo'}.`
        );
    }


    return respuestas.join('. ') + '.';
}


function responderRequisitos(vehiculo) {

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
            `la cuota de ingreso es de ${cuotaIngreso}`
        );
    }


    if (partes.length === 0) {

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


function responderPrecio(vehiculo) {

    if (!vehiculo.precioLista) {

        return (
            'No tengo el precio actualizado disponible en este momento. ' +
            `Si querés, te lo puede confirmar ${seller.asesorDerivacion || 'Edgardo'}.`
        );
    }


    return (
        `El precio de lista del ${nombreVehiculo(vehiculo)} ` +
        `es de ${vehiculo.precioLista}.`
    );
}


function responderEntrega(vehiculo) {

    const partes = [];


    if (vehiculo.entrega) {

        partes.push(
            vehiculo.entrega
        );
    }


    if (vehiculo.adjudicacion) {

        partes.push(
            `La adjudicación es ${vehiculo.adjudicacion}`
        );
    }


    if (vehiculo.entregaAsegurada) {

        partes.push(
            `La entrega asegurada es ${vehiculo.entregaAsegurada}`
        );
    }


    if (
        vehiculo.porcentaje_entrega &&
        vehiculo.cuotas_entrega
    ) {

        partes.push(
            `Podés retirar integrando el ${vehiculo.porcentaje_entrega} ` +
            `en las cuotas ${vehiculo.cuotas_entrega}`
        );
    }


    if (partes.length === 0) {

        return (
            'No tengo el detalle de entrega disponible en este momento. ' +
            `Si querés, te lo puede confirmar ${seller.asesorDerivacion || 'Edgardo'}.`
        );
    }


    return partes.join('. ') + '.';
}


function responderEquipamiento(vehiculo) {

    if (
        !Array.isArray(vehiculo.equipamiento) ||
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


function responderMaterial(vehiculo) {

    const links = [];


    if (vehiculo.materialComercial) {

        links.push(
            `Pauta comercial: ${vehiculo.materialComercial}`
        );
    }


    if (vehiculo.pdfFichaTecnica) {

        links.push(
            `Ficha técnica: ${vehiculo.pdfFichaTecnica}`
        );
    }


    if (vehiculo.videoComercial) {

        links.push(
            `Video: ${vehiculo.videoComercial}`
        );
    }


    if (links.length === 0) {

        return (
            'No tengo material comercial disponible para este modelo en este momento.'
        );
    }


    return links.join('\n');
}


// ============================================================
// 9. RESPUESTA IA SEGURA PARA PREGUNTAS NO PREVISTAS
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

El cliente está consultando por:

${nombreVehiculo(vehiculo)}

DATOS COMERCIALES PERMITIDOS:

${datosPermitidos}

PREGUNTA DEL CLIENTE:

"${mensaje}"

REGLAS ABSOLUTAS:

1. Respondé solamente con información que aparezca explícitamente en DATOS COMERCIALES PERMITIDOS.

2. NO hagas cálculos salvo que el resultado esté expresamente disponible.

3. NO deduzcas datos.

4. NO inventes.

5. Nunca uses expresiones como:
"tengo cargado",
"está cargado",
"en la base",
"en el sistema",
"según la base de datos".

6. Si la información preguntada no aparece, decí de manera natural:
"No tengo esa información disponible en este momento. Si querés, te la puede confirmar ${seller.asesorDerivacion || 'Edgardo'}."

7. Usá voseo argentino.

8. Máximo 3 oraciones.

9. No intentes cerrar una venta.

10. No derives automáticamente salvo que el cliente pida hablar con alguien.

Respondé directamente al cliente.
`;


        const response =
            await groq.chat.completions.create({

                model: 'llama-3.3-70b-versatile',

                messages: [
                    {
                        role: 'system',
                        content: prompt
                    }
                ],

                temperature: 0.15,

                max_tokens: 180
            });


        const respuesta =
            response.choices?.[0]?.message?.content;


        if (!respuesta) {

            throw new Error(
                'Groq devolvió respuesta vacía'
            );
        }


        return respuesta.trim();


    } catch (error) {

        console.error(
            '⚠️ Falló respuesta segura Groq:',
            error.message
        );


        return (
            'No tengo esa información disponible en este momento. ' +
            `Si querés, te la puede confirmar ${seller.asesorDerivacion || 'Edgardo'}.`
        );
    }
}


// ============================================================
// 10. PROCESAR MENSAJE
// ============================================================

async function procesarMensaje(
    userMessage,
    userId
) {

    const mensaje =
        String(userMessage || '').trim();


    if (!mensaje) {

        return 'Escribime qué necesitás saber y te ayudo.';
    }


    const cliente =
        getCliente(userId);


    guardarHistorial(
        cliente,
        'cliente',
        mensaje
    );


    const analisis =
        await interpretarMensaje(
            mensaje,
            cliente
        );


    // ========================================================
    // MODELO
    // ========================================================

    if (analisis.modelo) {

        cliente.modelo =
            analisis.modelo;
    }


    // ========================================================
    // SALUDO PURO
    // ========================================================

    const intencionesNoSaludo =
        analisis.intenciones.filter(
            i => i !== 'saludo'
        );


    if (
        analisis.intenciones.includes('saludo') &&
        intencionesNoSaludo.length === 0 &&
        !analisis.modelo
    ) {

        cliente.etapa =
            'esperando_modelo';


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
    // SI TODAVÍA NO SABEMOS EL MODELO
    // ========================================================

    if (!cliente.modelo) {

        const modelos =
            await listarModelosDisponibles();


        const nombres =
            modelos.map(
                v => v.key.toUpperCase()
            );


        const respuesta =
            nombres.length > 0
                ? `Claro. ¿Qué modelo te interesa? Tengo información de ${nombres.join(', ')}.`
                : 'Decime qué modelo te interesa y te ayudo.';


        cliente.etapa =
            'esperando_modelo';


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    // ========================================================
    // OBTENER DATOS REALES
    // ========================================================

    const vehiculo =
        await obtenerVehiculo(
            cliente.modelo
        );


    if (!vehiculo) {

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
    // SI ACABA DE ELEGIR MODELO Y NO HIZO OTRA PREGUNTA
    // ========================================================

    const preguntasComerciales = [
        'financiacion',
        'directa',
        'cuotas',
        'requisitos',
        'precio',
        'entrega',
        'equipamiento',
        'material',
        'avanzar'
    ];


    const tienePreguntaComercial =
        analisis.intenciones.some(
            i => preguntasComerciales.includes(i)
        );


    if (
        analisis.modelo &&
        !tienePreguntaComercial
    ) {

        cliente.etapa =
            'esperando_metodo';


        const respuesta =
            `Perfecto. Tengo información del ${nombreVehiculo(vehiculo)}. ` +
            '¿Buscás adquisición directa o financiación de fábrica?';


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    // ========================================================
    // PRIORIDAD 1: PREGUNTAS DEL CLIENTE
    // ========================================================

    if (
        analisis.intenciones.includes('cuotas')
    ) {

        cliente.etapa =
            'consultando_cuotas';


        const respuesta =
            responderCuotas(vehiculo);


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    if (
        analisis.intenciones.includes('precio')
    ) {

        const respuesta =
            responderPrecio(vehiculo);


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    if (
        analisis.intenciones.includes('requisitos')
    ) {

        cliente.etapa =
            'esperando_derivacion';


        const respuesta =
            responderRequisitos(vehiculo);


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    if (
        analisis.intenciones.includes('entrega')
    ) {

        const respuesta =
            responderEntrega(vehiculo);


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    if (
        analisis.intenciones.includes('equipamiento')
    ) {

        const respuesta =
            responderEquipamiento(vehiculo);


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    if (
        analisis.intenciones.includes('material')
    ) {

        const respuesta =
            responderMaterial(vehiculo);


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
        analisis.intenciones.includes('financiacion')
    ) {

        cliente.metodo =
            'financiacion';

        cliente.etapa =
            'financiacion';


        const respuesta =
            responderFinanciacion(vehiculo);


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    // ========================================================
    // ADQUISICIÓN DIRECTA
    // ========================================================

    if (
        analisis.intenciones.includes('directa')
    ) {

        cliente.metodo =
            'directa';

        cliente.etapa =
            'esperando_derivacion';


        let respuesta =
            `Perfecto. Para adquisición directa del ${nombreVehiculo(vehiculo)}`;


        if (vehiculo.precioLista) {

            respuesta +=
                ` el precio de lista es de ${vehiculo.precioLista}.`;

        } else {

            respuesta += '.';
        }


        respuesta +=
            ` Si querés una propuesta concreta, te contacto con ${seller.asesorDerivacion || 'Edgardo'}.`;


        guardarHistorial(
            cliente,
            'martin',
            respuesta
        );


        return respuesta;
    }


    // ========================================================
    // CLIENTE QUIERE AVANZAR
    // ========================================================

    if (
        analisis.intenciones.includes('avanzar')
    ) {

        cliente.etapa =
            'esperando_horario';

        cliente.derivacionSolicitada =
            true;


        const respuesta =
            `Perfecto. Te contacto con ${seller.asesorDerivacion || 'Edgardo'} para que continúe con vos. ` +
            '¿Qué día y horario te queda cómodo?';


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
        analisis.intenciones.includes('rechazo')
    ) {

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
    // CONFIRMACIÓN SEGÚN CONTEXTO
    // ========================================================

    if (analisis.confirmacion) {

        if (
            cliente.etapa === 'financiacion'
        ) {

            cliente.etapa =
                'esperando_derivacion';


            const respuesta =
                responderRequisitos(vehiculo);


            guardarHistorial(
                cliente,
                'martin',
                respuesta
            );


            return respuesta;
        }


        if (
            cliente.etapa === 'esperando_derivacion'
        ) {

            cliente.etapa =
                'esperando_horario';

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
    }


    // ========================================================
    // HORARIO DE CONTACTO
    // ========================================================

    if (
        cliente.etapa === 'esperando_horario'
    ) {

        cliente.etapa =
            'derivado';


        const respuesta =
            `Perfecto. Queda registrado. ${seller.asesorDerivacion || 'Edgardo'} va a continuar con vos. Muchas gracias.`;


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
// 11. ENDPOINT CHAT
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
// 12. ENDPOINT DE ESTADO
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
// 13. INICIO
// ============================================================

const PORT =
    process.env.PORT || 3000;


app.listen(
    PORT,
    () => {

        console.log(
            '🚀 MARTIN IA SELLER - VERSIÓN HÍBRIDA'
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
            `🧠 IA: Groq / llama-3.3-70b-versatile`
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