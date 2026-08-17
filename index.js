// ============================================================
// index.js
// MARTIN IA SELLER
// VERSIÓN HÍBRIDA + RESPUESTAS CONTEXTUALES
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
// 2. CONFIGURACIÓN SELLER
// ============================================================

const seller = await loadSeller();

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});


// ============================================================
// 3. MEMORIA TEMPORAL
// ============================================================
//
// IMPORTANTE:
//
// Por ahora esta memoria vive en RAM.
//
// Más adelante:
// - estado persistente → Google Sheets
// - leads → Google Sheets
// - seguimientos → Google Sheets / scheduler
//
// ============================================================

const clientes = {};


function getCliente(userId) {

    if (!clientes[userId]) {

        clientes[userId] = {

            etapa: 'inicio',

            modelo: null,

            metodo: null,

            historial: [],

            // Qué respuesta espera Martin
            esperandoRespuesta: null,

            // Opciones cuando Martin hace una pregunta doble
            opcionesEsperadas: [],

            derivacionSolicitada: false,

            // ------------------------------------------------
            // PREPARADO PARA SEGUIMIENTOS FUTUROS
            // ------------------------------------------------

            ultimaInteraccion: Date.now(),

            ultimoMensajeMartin: null,

            seguimiento20mEnviado: false,

            seguimiento24hEnviado: false
        };
    }

    return clientes[userId];
}


function guardarHistorial(
    cliente,
    rol,
    mensaje
) {

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


function contieneAlguna(
    texto,
    palabras
) {

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


function nombreVehiculo(
    vehiculo,
    fallback
) {

    return (
        vehiculo?.modelo ||
        fallback?.toUpperCase() ||
        'el vehículo'
    );
}


// ============================================================
// 5. DETECCIÓN DIRECTA DE MODELO
// ============================================================

async function detectarModeloDirecto(
    mensaje
) {

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


        if (
            texto.includes(key) ||
            (
                modeloCompleto &&
                texto.includes(
                    modeloCompleto
                )
            )
        ) {

            return vehiculo.key;
        }
    }


    return null;
}


// ============================================================
// 6. CLASIFICADOR LOCAL
// ============================================================

async function clasificarLocal(
    mensaje
) {

    const intenciones = [];


    const modelo =
        await detectarModeloDirecto(
            mensaje
        );


    if (
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
                'hablar con alguien',
                'hablar con un asesor',
                'pasame con edgardo',
                'edgardo'
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
            esNegacionSimple(mensaje)
    };
}


// ============================================================
// 7. INTERPRETACIÓN CON GROQ
// ============================================================
//
// GROQ NO RESPONDE ACÁ.
//
// Solo interpreta qué quiso decir
// el cliente.
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

Tu única tarea ahora es CLASIFICAR el mensaje del cliente.

NO respondas al cliente.
NO des información comercial.
NO inventes nada.

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
entrega
equipamiento
material
avanzar
rechazo
otro

IMPORTANTE:

Una frase puede tener MÁS DE UNA intención.

Ejemplos:

"Sí me sirve, pero ¿las cuotas cuánto son?"

intenciones:
["cuotas"]

confirmacion:
true


"Quiero avanzar con el 2008"

modelo:
"2008"

intenciones:
["avanzar"]


"¿Y el resto?"

Si el historial reciente habla de cuotas,
debe interpretarse como intención "cuotas".


"Ok"

NO significa automáticamente avanzar.

Debe interpretarse usando ESPERANDO RESPUESTA.


CONTEXTO ACTUAL:

Etapa:
${cliente.etapa}

Modelo:
${cliente.modelo || 'ninguno'}

Método:
${cliente.metodo || 'ninguno'}

Esperando respuesta:
${cliente.esperandoRespuesta || 'ninguna'}

Opciones esperadas:
${JSON.stringify(cliente.opcionesEsperadas || [])}


HISTORIAL RECIENTE:

${historialReciente || 'Sin historial'}


MENSAJE DEL CLIENTE:

"${mensaje}"


FORMATO EXACTO:

{
  "modelo": null,
  "intenciones": [],
  "confirmacion": false,
  "negacion": false
}
`;


        const response =
            await groq.chat.completions.create({

                model:
                    'qwen/qwen3.6-27b',

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
            'entrega',
            'equipamiento',
            'material',
            'avanzar',
            'rechazo',
            'otro'
        ];


        const intencionesIA =
            Array.isArray(
                json.intenciones
            )
                ? json.intenciones.filter(
                    i =>
                        intencionesValidas.includes(i)
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
                json.confirmacion === true,

            negacion:
                respaldo.negacion ||
                json.negacion === true
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
// 8. RESPUESTAS CONTROLADAS
// ============================================================

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
            `podés retirar integrando el ${vehiculo.porcentaje_entrega} en las cuotas ${vehiculo.cuotas_entrega}`
        );
    }


    if (
        vehiculo.monto_10_porciento
    ) {

        partes.push(
            `ese porcentaje hoy representa ${vehiculo.monto_10_porciento}`
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
            `La cuota de suscripción es de ${vehiculo.suscripcion}`
        );

    } else if (
        vehiculo.cuota_1
    ) {

        respuestas.push(
            `La cuota 1 es de ${vehiculo.cuota_1}`
        );
    }


    if (
        vehiculo.cuotaPura
    ) {

        respuestas.push(
            `La cuota pura es de ${vehiculo.cuotaPura}`
        );
    }


    if (
        vehiculo.cuotaPublicitaria
    ) {

        respuestas.push(
            `La cuota publicitaria es de ${vehiculo.cuotaPublicitaria}`
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
                        `La cuota ${tramo.desde} es de ${tramo.valor}`
                    );

                } else {

                    respuestas.push(
                        `De la cuota ${tramo.desde} a la ${tramo.hasta}, el valor es ${tramo.valor}`
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
        '.'
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
            `la cuota de ingreso es de ${cuotaIngreso}`
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
        `es de ${vehiculo.precioLista}.`
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
            `Podés retirar integrando el ${vehiculo.porcentaje_entrega} en las cuotas ${vehiculo.cuotas_entrega}`
        );
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


// ============================================================
// 9. RESPUESTA IA SEGURA
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

3. NO hagas cálculos que no estén expresamente disponibles.

4. NO deduzcas valores.

5. Nunca digas:
"tengo cargado",
"está cargado",
"base de datos",
"sistema",
"según la base".

6. Si no tenés la información:
"No tengo esa información disponible en este momento. Si querés, te la puede confirmar ${seller.asesorDerivacion || 'Edgardo'}."

7. Usá voseo argentino.

8. Máximo 3 oraciones.

9. No vendas.

10. No repitas información que el cliente no pidió.

Respondé directamente.
`;


        const response =
            await groq.chat.completions.create({

                model:
                    'qwen/qwen3.6-27b',

                messages: [
                    {
                        role: 'system',
                        content: prompt
                    }
                ],

                temperature: 0.1,

                max_tokens: 180
            });


        const respuesta =
            response
                .choices?.[0]
                ?.message
                ?.content;


        if (!respuesta) {

            throw new Error(
                'Groq devolvió respuesta vacía'
            );
        }


        return respuesta.trim();


    } catch (error) {

        console.error(
            '⚠️ Error Groq:',
            error.message
        );


        return (
            'No tengo esa información disponible en este momento. ' +
            `Si querés, te la puede confirmar ${seller.asesorDerivacion || 'Edgardo'}.`
        );
    }
}


// ============================================================
// 10. RESPUESTAS ESPERADAS
// ============================================================

async function procesarRespuestaEsperada(
    mensaje,
    cliente,
    analisis,
    vehiculo
) {

    // --------------------------------------------------------
    // ELECCIÓN ENTRE REQUISITOS O CUOTAS
    // --------------------------------------------------------

    if (
        cliente.esperandoRespuesta ===
        'elegir_info_financiacion'
    ) {

        if (
            analisis.intenciones.includes(
                'cuotas'
            )
        ) {

            cliente.esperandoRespuesta =
                'aceptar_derivacion';


            cliente.opcionesEsperadas = [];


            return responderCuotas(
                vehiculo
            );
        }


        if (
            analisis.intenciones.includes(
                'requisitos'
            )
        ) {

            cliente.esperandoRespuesta =
                'aceptar_derivacion';


            cliente.opcionesEsperadas = [];


            return responderRequisitos(
                vehiculo
            );
        }


        // "dale", "sí", "ok"
        // no alcanza para saber cuál quiere.

        if (
            analisis.confirmacion
        ) {

            return (
                'Dale. ¿Querés que te pase primero los requisitos o el detalle de las cuotas?'
            );
        }
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
            mensaje.length >= 2
        ) {

            cliente.esperandoRespuesta =
                null;


            cliente.etapa =
                'derivado';


            // FUTURO:
            //
            // guardarLead(...)
            // en Google Sheets.


            return (
                `Perfecto. Queda registrado. ${seller.asesorDerivacion || 'Edgardo'} va a continuar con vos. Muchas gracias.`
            );
        }
    }


    return null;
}


// ============================================================
// 11. PROCESAR MENSAJE
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


    // Cada vez que el cliente responde,
    // cancelamos futuros flags de seguimiento.

    cliente.seguimiento20mEnviado =
        false;

    cliente.seguimiento24hEnviado =
        false;


    const analisis =
        await interpretarMensaje(
            mensaje,
            cliente
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
    // OBTENER VEHÍCULO
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
    // RESPUESTA ESPERADA
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
    // MODELO NUEVO
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
    // PREGUNTAS COMERCIALES
    // ========================================================

    if (
        analisis.intenciones.includes(
            'cuotas'
        )
    ) {

        cliente.etapa =
            'consultando_cuotas';


        cliente.esperandoRespuesta =
            'aceptar_derivacion';


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


        cliente.esperandoRespuesta =
            'elegir_info_financiacion';


        cliente.opcionesEsperadas = [
            'requisitos',
            'cuotas'
        ];


        const respuesta =
            responderFinanciacion(
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
                ` el precio de lista es de ${vehiculo.precioLista}.`;

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
    // AVANZAR
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
// 12. ENDPOINT CHAT
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
// 13. HEALTH
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
// 14. START
// ============================================================

const PORT =
    process.env.PORT || 3000;


app.listen(
    PORT,
    () => {

        console.log(
            '🚀 MARTIN IA SELLER - CONTEXTO V2'
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
            '🧠 IA: Groq / qwen/qwen3.6-27b'
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