// webhook.js
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const usarAPIOFICIAL = false; // Cambia a false si usas API de terceros
// Importamos la función del chatbot
const { handleUserMessage } = require('./chatbot.cjs');

const app = express();
app.use(bodyParser.json());

const PHONE_NUMBER_ID = ''; // Ejemplo: "109876543212345"
const ACCESS_TOKEN = ''; // Tu token real
const VERIFY_TOKEN = ''; // el token de verificación que configuraste en tu webhook

// Map para buffers por usuario: key=fromNumber, value={ buffer: [], timer: Timeout }
const userBuffers = new Map();
const BUFFER_INTERVAL = 10000; // 10 segundos para agrupar mensajes
if (usarAPIOFICIAL) {
  // —— Verificación del webhook (GET PARA API OFICIAL DE WHATSAPP) —————————————————————————————————————————
  app.get('/webhook', (req, res) => {
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (token === VERIFY_TOKEN) {
      console.log('✅ WEBHOOK VERIFICADO');
      return res.status(200).send(challenge);
    } else {
      console.error('❌ FALLÓ LA VERIFICACIÓN DEL WEBHOOK');
      return res.sendStatus(403);
    }
  });

  // —— Recepción de mensajes entrantes (POST con API OFICIAL DE WHATSAPP) ————————————————————————————————————
  app.post('/webhook', async (req, res) => {
    try {
      const body = req.body;

      if (
        body.object === 'whatsapp_business_account' &&
        body.entry && body.entry.length > 0 &&
        body.entry[0].changes && body.entry[0].changes.length > 0
      ) {
        const change = body.entry[0].changes[0];
        const value = change.value;
        const messages = value.messages;

        if (messages && messages.length > 0) {
          for (let msg of messages) {
            const fromNumber = msg.from;
            const msgType = msg.type;

            console.log(`🆕 Mensaje recibido de ${fromNumber}. Tipo: ${msgType}`);

            if (msgType === 'text') {
              const textBody = msg.text.body.trim();
              console.log(`📨 Texto recibido: "${textBody}"`);

              // Inicializar buffer si no existe
              if (!userBuffers.has(fromNumber)) {
                userBuffers.set(fromNumber, { buffer: [], timer: null });
              }
              const entry = userBuffers.get(fromNumber);
              entry.buffer.push(textBody);

              // Si no hay timer, crear uno
              if (!entry.timer) {
                entry.timer = setTimeout(async () => {
                  const combined = entry.buffer.join('. ');
                  entry.buffer = [];
                  entry.timer = null;

                  console.log(`📤 Enviando al chatbot (texto combinado): "${combined}" desde ${fromNumber}`);
                  let botReply;
                  try {
                    botReply = await handleUserMessage(fromNumber, combined);
                  } catch (err) {
                    console.error('❌ Error al llamar al chatbot:', err);
                    botReply = 'Lo siento, ocurrió un error interno. Intenta de nuevo más tarde.';
                  }

                  // Separar respuesta en oraciones por ". "
                  const sentences = botReply.split('. ').filter(s => s.trim().length > 0).map(s => s.trim());
                  let cumulativeDelay = 0;

                  for (let sentence of sentences) {
                    // Calcular retardo según longitud: mínimo 4s, máximo 12s
                    const lengthFactor = sentence.length;
                    let delay = 100 + lengthFactor * 50; // ejemplo: 50ms por carácter
                    if (delay > 10000) delay = 10000;

                    cumulativeDelay += delay;
                    setTimeout(async () => {
                      try {
                        await enviarTextoWhatsapp(fromNumber, sentence);
                        console.log(`✅ Enviado a ${fromNumber}: "${sentence}"`);
                      } catch (err) {
                        console.error(`❌ Error enviando parte de respuesta a ${fromNumber}:`, err.response ? err.response.data : err.message);
                      }
                    }, cumulativeDelay);
                  }

                }, BUFFER_INTERVAL);
              }
            }
          }
        }
        return res.sendStatus(200);
      } else {
        return res.sendStatus(200);
      }
    } catch (error) {
      console.error('Error al procesar webhook:', error);
      return res.sendStatus(500);
    }
  });

  // —— Función para enviar texto por WhatsApp (usando Graph API) ——————————————————————
  async function enviarTextoWhatsapp(to, mensaje) {
    const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;
    const data = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'text',
      text: { body: mensaje }
    };
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ACCESS_TOKEN}`
    };

    const resp = await axios.post(url, data, { headers });
    return resp.data;
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Servidor escuchando en puerto ${PORT}`);
  });
} else {
  const { Client } = require('whatsapp-web.js');
  const qrcode = require('qrcode-terminal');

  const client = new Client();

  // Inicializamos el cliente de WhatsApp Web
  client.on('ready', () => {
    console.log('Client is ready!');
  });

  client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
  });

  // ------------------------------------------------------------------------------------------------
  // Aquí replicamos la lógica de buffer y envío con delay dentro del evento message_create
  // ------------------------------------------------------------------------------------------------

  client.on('message_create', message => {
    const fromNumber = message.from;
    const textBody = message.body.trim();

    // Ignoramos mensajes del propio bot (reemplaza con tu número si es distinto)
    if (fromNumber === '573246247615@c.us') {
      return;
    }

    console.log(`🆕 Mensaje recibido de ${fromNumber}. Texto: "${textBody}"`);

    // Solo procesamos si hay texto
    if (!textBody) {
      return;
    }

    // Inicializar buffer si no existe
    if (!userBuffers.has(fromNumber)) {
      userBuffers.set(fromNumber, { buffer: [], timer: null });
    }
    const entry = userBuffers.get(fromNumber);
    entry.buffer.push(textBody);

    // Si no hay timer, creamos uno para agrupar mensajes
    if (!entry.timer) {
      entry.timer = setTimeout(async () => {
        const combined = entry.buffer.join('. ');
        entry.buffer = [];
        entry.timer = null;

        console.log(`📤 Enviando al chatbot (texto combinado): "${combined}" desde ${fromNumber}`);
        let botReply;
        try {
          botReply = await handleUserMessage(fromNumber, combined);
        } catch (err) {
          console.error('❌ Error al llamar al chatbot:', err);
          botReply = 'Lo siento, ocurrió un error interno. Intenta de nuevo más tarde.';
        }

        // Dividir la respuesta del bot en oraciones por ". "
        const sentences = botReply
          .split('. ')
          .filter(s => s.trim().length > 0)
          .map(s => s.trim());

        let cumulativeDelay = 0;
        for (let sentence of sentences) {
          // Calcular retardo según longitud: mínimo 100ms, máximo 10000ms
          const lengthFactor = sentence.length;
          let delay = 100 + lengthFactor * 50; // 50ms por carácter
          if (delay > 10000) delay = 10000;

          cumulativeDelay += delay;
          setTimeout(async () => {
            try {
              await client.sendMessage(fromNumber, sentence);
              console.log(`✅ Enviado a ${fromNumber}: "${sentence}"`);
            } catch (err) {
              console.error(`❌ Error enviando parte de respuesta a ${fromNumber}:`, err);
            }
          }, cumulativeDelay);
        }
      }, BUFFER_INTERVAL);
    }
  });

  client.initialize();
}