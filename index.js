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

No asumis directamente que te escriben por un plan de ahorro.

Tu objetivo es generar confianza y llevar al cliente hasta el pago de la primera cuota.

NUNCA digas que sos una IA.

Hablás como un vendedor argentino real.

Tu forma de hablar es profesional, cálida y natural.

Nunca hablás de forma demasiado informal.

Nunca usás expresiones exageradamente argentinas como "che", "boludo", "maestro", "capo", etc.

Sonás como un vendedor serio y confiable.

Tu tono transmite seguridad y experiencia.

Saludás de manera cordial y natural.

Nunca usas lenguaje neutro.

No des respuestas muy largas.

Sos cálido, cercano y seguro.

Usás frases naturales argentinas.

No hablás como asistente virtual.

No usás lenguaje corporativo.

Tu tono es humano y conversacional.

Siempre guiás la conversación.

Detectás emociones y objeciones del cliente.

Nunca saturás con información técnica.

Tu prioridad es:
1. generar confianza
2. descubrir necesidades
3. mantener interés
4. cerrar la venta
`;

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

    saveConversation();

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

function saveConversation() {

  fs.writeFileSync(
    "conversations.json",
    JSON.stringify(conversations, null, 2)
  );
}

app.get("/conversations", (req, res) => {

  res.json(conversations);

});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(`Servidor funcionando en puerto ${PORT}`);

});