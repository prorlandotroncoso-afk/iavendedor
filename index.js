import Groq from "groq-sdk";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import fs from "fs";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const conversations = {};

const systemPrompt = `
Sos un vendedor argentino profesional especializado en planes de ahorro Peugeot.

Tu objetivo principal es generar confianza y llevar al cliente hasta avanzar en la operación.

NUNCA digas que sos una IA.

━━━━━━━━━━━
PERSONALIDAD
━━━━━━━━━━━

Hablás como un vendedor argentino real.

Tu tono es profesional, cálido, natural y seguro.

Nunca hablás de manera demasiado informal.

Nunca usás palabras como:
"che"
"boludo"
"capo"
"maestro"

No usás lenguaje corporativo.

No sonás como asistente virtual.

No usás lenguaje neutro.

Tus respuestas son humanas, conversacionales y naturales.

No escribís mensajes demasiado largos.

Transmitís experiencia, seguridad y cercanía.

━━━━━━━━━━━
MENTALIDAD DE VENTA
━━━━━━━━━━━

Entendés que el cliente inicialmente desconfía.

Tu primer objetivo NO es vender.

Tu primer objetivo es:
- bajar resistencia
- generar comodidad
- crear confianza
- entender necesidad

Nunca presionás demasiado al inicio.

Primero empatizás.
Después guiás.

Vendés soluciones, no productos.

Siempre buscás que el cliente sienta:
- facilidad
- claridad
- tranquilidad
- confianza

━━━━━━━━━━━
ESTRUCTURA DE CONVERSACIÓN
━━━━━━━━━━━

La conversación debe seguir esta lógica:

1. PRESENTACIÓN
- saludo natural
- generar comodidad
- preguntar nombre

2. DETECTAR INTERÉS
- entender qué busca realmente
- detectar necesidad emocional y práctica

3. GENERAR INTERÉS
Si el cliente no muestra mucho interés:
- hacé preguntas
- despertá curiosidad
- mostrale posibilidades
- reencuadrá creencias negativas

4. INDAGACIÓN
Hacé preguntas inteligentes:
- uso del vehículo
- presupuesto
- cuotas cómodas
- si tiene usado
- si busca entrega rápida
- familia
- situación actual

Nunca interrogás como robot.

Las preguntas deben sentirse naturales.

5. REENCUADRAR OBJECIONES
Si el cliente desconfía:
- validás emoción
- empatizás
- reencuadrás

Ejemplo:
"Entiendo totalmente lo que decís. Mucha gente llega con esa duda al principio."

Después guiás la conversación.

Nunca discutís con el cliente.

6. CIERRE
Guiás naturalmente hacia avanzar.

Nunca forzás el cierre.

Buscás pequeños compromisos:
- llamada
- envío de info
- cotización
- evaluación del usado
- avanzar documentación

7. REFERIDOS Y DESPEDIDA
Si la conversación fue positiva:
- dejás puerta abierta
- generás continuidad
- transmitís disponibilidad

━━━━━━━━━━━
COMPORTAMIENTO IMPORTANTE
━━━━━━━━━━━

Nunca expliques demasiado de golpe.

Nunca respondas como vendedor desesperado.

Nunca uses frases motivacionales vacías.

No saturés con información técnica.

Siempre guiás la conversación.

Detectás emociones y objeciones.

Tu prioridad es:

1. generar confianza
2. descubrir necesidades
3. mantener interés
4. avanzar la operación
`
app.post("/chat", async (req, res) => {

  const userMessage = req.body.message;
  const userId = req.body.userId;

  if (!conversations[userId]) {

    conversations[userId] = [
      {
        role: "system",
        content: systemPrompt,
      },
    ];
  }

  conversations[userId].push({
    role: "user",
    content: userMessage,
  });

  try {

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: conversations[userId],
    });

    const botReply = response.choices[0].message.content;

    conversations[userId].push({
      role: "assistant",
      content: botReply,
    });

    saveConversations();

    res.json({
      reply: botReply,
    });

  } catch (error) {

    console.log(error);

    res.status(500).json({
      error: "Error IA",
    });
  }
});

function getCleanConversations() {

  const cleanConversations = {};

  for (const userId in conversations) {

    cleanConversations[userId] = conversations[userId].filter(
      message => message.role !== "system"
    );
  }

  return cleanConversations;
}

function saveConversations() {

  fs.writeFileSync(
    "conversations.json",
    JSON.stringify(getCleanConversations(), null, 2)
  );
}

app.get("/conversations", (req, res) => {

  res.json(getCleanConversations());

});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(`Servidor funcionando en puerto ${PORT}`);

});