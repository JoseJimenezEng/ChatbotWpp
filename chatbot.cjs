// assistant_console.js
// Node.js assistant para Estética BellaVida con sesiones (TTL 24h),
// agendar, reagendar y cancelar incluyen nombre del tratamiento y correo,
// treatment almacena nombre, treatmentID nuevo para ID, email obligatorio.
// Prerrequisitos:
// - Node.js v14+
// - Instalar dependencias: `npm install openai axios dotenv readline`
// - Crear un `.env` con tu clave de OpenAI:
//     OPENAI_API_KEY=tu_api_key_de_openai
// - Reemplazar WEBHOOK_URL con tu endpoint real para procesar citas/compras.

const Configuration = require("openai");
const OpenAIApi = require("openai");
const axios = require("axios");
const dotenv = require("dotenv");
const parse = require('csv-parse/sync');
dotenv.config();

// -----------------------------------------------------------------------------
// Configuración y constantes
// -----------------------------------------------------------------------------

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("❌ Please set your OPENAI_API_KEY in a .env file.");
  process.exit(1);
}

const WEBHOOK_URL = process.env.WEBHOOK_URL; // ← Reemplaza con tu URL de webhook real

// TTL en milisegundos: 24 horas
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// Mapa en memoria para almacenar hilos de conversación y timestamp de última actividad
const sessions = new Map();
// Cada entrada: { messages: Array<Object>, lastUpdated: Number (timestamp en ms) }

// Obtiene la fecha actual en zona Bogotá (UTC-5)
function getCurrentDate() {
  const now = new Date();
  const offsetMs = 5 * 60 * 60 * 1000; // UTC-5
  const bogotaTime = new Date(now.getTime());
  return bogotaTime;
}

const TODAY = getCurrentDate();
console.log(`📅 Fecha actual: ${TODAY}`);

const DATE_CHECK_RULES = `
- Tus respuestas no deben tener más de 70 palabras. Usa emojis para hacerlas más amigables.
- Si el cliente hace varias peticiones en un solo mensaje, debes responder que solo puedes procesar una a la vez y que vayan haciendolas una a una. No debes procesar más de una petición a la vez. No debes olvidar el resto de peticiones, debes recordarlas y procesarlas una a una.
- Antes de agendar/reagendar/cancelar, pide al usuario su nombre y cédula, luego busca toda la información del usuario en el LISTADO DE CITAS.
- Debes ser inteligente respecto al agendamiento, reagendamiento y cancelación de citas. Pues sucede que si un usuario te pide agendar una cita en un dia y hora que ya tiene una cita, debes decirle que ya tiene una cita agendada y preguntarle si quiere reagendarla. Se inteligente y verifica que la fecha y hora no se crucen con otras citas.
- El agendamiento de citas debe ser dentro dentro de un rango de 2 semanas, si el usuario se pasa de ese tiempo, hacerle saber amablemente esta regla.
- Se inteligente al agendar o reagendar y verifica que la fecha y hora no se crucen con otras citas.
- Tambien debes verificar que la cedula sea válida (de 6 a 10 dígitos), nombre, celular y correo electrónico.
- Siempre confirma todos los datos de la cita o compra antes de procesar.
- Verifica que la fecha y hora estén dentro del horario comercial.
- La fecha de agendamiento no puede ser anterior a hoy (${TODAY.toISOString().split("T")[0]}).
- Si falta información del servicio, pídele al usuario que la proporcione.
- Cuando brindes la hora, usa 12 horas (HH:MM AM/PM).
`;

async function fetchCitasDesdeSheet() {
  try {
    const sheetCsvUrl = 'https://docs.google.com/spreadsheets/d/1gV24hSe_CW5RPPB--sI0N1RbozDQM3UbQrYaiKgMYjY/export?format=csv&gid=0';
    const response = await axios.get(sheetCsvUrl);
    const records = parse.parse(response.data, {
      columns: true,
      skip_empty_lines: true
    });
    return records; // array de objetos por fila
  } catch (err) {
    console.error('❌ Error leyendo el sheet:', err.message);
    return [];
  }
}

let SYSTEM_PROMPT = '';

(async () => {
  const citas = await fetchCitasDesdeSheet();
  const listado = citas.map(c =>
    `• ${c.Nombre || 'Paciente'} de cedula ${c.Cedula || 'nula'} tiene cita para ${c.Tratamiento || 'tratamiento'} el ${c.Fecha} a las ${c.Hora}`
  ).join('\n');

  SYSTEM_PROMPT = `Eres el asistente virtual de Estética BellaVida.

Hoy es ${TODAY.toISOString().split("T")[0]}.
${DATE_CHECK_RULES}

LISTADO DE CITAS:
${listado || 'No hay citas registradas.'}
${console.log(`📅 Citas cargadas: ${listado}`)}


Nombre de la empresa: Estética BellaVida
Correo electrónico: info@esteticabellevia.com
Horario comercial:
  • Lunes a Viernes: 9:00 AM – 7:00 PM
  • Sábados: 10:00 AM – 3:00 PM
  • Domingos: Cerrado (excepto por emergencias previamente coordinadas).

Dirección:
  Calle 82 #15-40, Barrio Chapinero, Bogotá, Colombia
Sitio web:
  www.esteticabellevia.com

Información adicional:
  Estética BellaVida es una clínica especializada en medicina estética y cuidado personalizado, ubicada en el corazón de Bogotá. Ofrecemos tratamientos no invasivos y productos de alta calidad para realzar tu belleza natural.

Características únicas:
  • Equipo médico certificado y tecnología avanzada.
  • Tratamientos personalizados según las necesidades del cliente.
  • Enfoque en seguridad, higiene y resultados visibles.

Políticas:
  • Cancelaciones con al menos 24 horas de anticipación.
  • Garantía de satisfacción o reprogramación gratuita en tratamientos.
  • Productos con devolución dentro de los 7 días posteriores a la compra (solo si no han sido usados).

Cómo realizar pedidos y contacto:
  • Por teléfono: +57 324 624 7615
  • WhatsApp: Enviar mensaje
  • Instagram: @EsteticaBellaVida

Opciones de pago:
  • Tarjeta de crédito/débito (Visa, Mastercard) a través de nuestro link de pago seguro.
  • PayPal: pagos@esteticabellevia.com
  • Efectivo o transferencia bancaria en sucursales locales.

Entrega:
  • Productos: Envíos nacionales e internacionales vía FedEx o DHL (rastreo en tiempo real).
  • Tratamientos: Presenciales en nuestras instalaciones.

Requisitos de reserva:
  • Información de contacto (nombre, celular, correo y correo electrónico).
  • Selección del servicio o producto.
  • Pago del 50% del valor total para confirmar la cita (reembolsable en caso de cancelación con 48 horas de anticipación).

Cómo reservar:
  1. Contáctanos por WhatsApp o teléfono para agendar una consulta inicial.
  2. Confirma tu elección de servicio/producto y horario.
  3. Realiza el pago inicial y recibe confirmación vía correo.

Catálogo de servicios destacados:
  1. Toxina Botulínica (Botox)
     • ID de servicio: BOTX001
     • Precio: $1.200.000 COP (USD 300)
     • Descripción: Reducción de arrugas faciales (frente, patas de gallo, entrecejo).
     • Disponibilidad: En stock | Sesión de 30 minutos.
  2. Relleno de Ácido Hialurónico
     • ID de servicio: HALU002
     • Precio: $1.800.000 COP (USD 450) por jeringa
     • Descripción: Volumen en labios, mejillas o contorno facial.
     • Disponibilidad: En stock | Resultados inmediatos.
  3. Depilación Láser
     • ID de servicio: DLZR003
     • Precio: $400.000 COP (USD 100) por sesión (zona pequeña)
     • Descripción: Tecnología LightSheer para eliminación permanente del vello.
     • Disponibilidad: Reserva previa | 6 sesiones recomendadas.
  4. Piel Radiante (Peeling Químico + Hidratación)
     • ID de servicio: PIEL004
     • Precio: $350.000 COP (USD 85)
     • Descripción: Tratamiento para manchas, poros y textura irregular.
     • Disponibilidad: En stock | Duración: 45 minutos.

Catálogo de productos:
  1. Crema Antienvejecimiento BellaVida
     • ID de producto: CREMA-ANTIENVE-001
     • Precio: $150.000 COP (USD 35)
     • Disponibilidad: En stock | Envío internacional disponible.

Puedes usar los ID de servicio o producto cuando quieras agendar o comprar.

${DATE_CHECK_RULES}
`;

})();



// Inicializar cliente de OpenAI
const configuration = new Configuration({
  apiKey: OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// -----------------------------------------------------------------------------
// Funciones auxiliares
// -----------------------------------------------------------------------------

async function callWebhook(payload) {
  try {
    const response = await axios.post(WEBHOOK_URL, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 5000,
    });
    return response.data;
  } catch (error) {
    console.error("❌ Error calling webhook:", error.message);
    throw new Error("No se pudo conectar con el servicio de backend.");
  }
}

function getSession(threadId) {
  const entry = sessions.get(threadId);
  if (!entry) return null;
  const now = Date.now();
  if (now - entry.lastUpdated > SESSION_TTL_MS) {
    sessions.delete(threadId);
    return null;
  }
  return entry;
}

function upsertSession(threadId, newMessage) {
  const now = Date.now();
  let session = getSession(threadId);
  if (!session) {
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      newMessage,
    ];
    sessions.set(threadId, { messages, lastUpdated: now });
    session = sessions.get(threadId);
  } else {
    session.messages.push(newMessage);
    session.lastUpdated = now;
  }
  return session.messages;
}

function cloneMessages(messages) {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function isSchedulingIntent(text) {
  const lower = text.toLowerCase();
  return /(?:agendar cita|reagendar cita|cancelar cita)/.test(lower);
}

// Validaciones de fecha/hora y rango comercial
const WEEKDAYS = { lunes: 1, martes: 2, miércoles: 3, jueves: 4, viernes: 5, sábado: 6, domingo: 0 };
function parseRelativeDate(text) {
  text = text.toLowerCase().trim();
  const today = getCurrentDate();
  if (text === "hoy") return today.toISOString().split("T")[0];
  if (text === "mañana") {
    const tm = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    return tm.toISOString().split("T")[0];
  }
  if (WEEKDAYS[text] !== undefined) {
    const targetDow = WEEKDAYS[text];
    const currentDow = today.getDay();
    let diff = targetDow - currentDow;
    if (diff <= 0) diff += 7;
    const nextDate = new Date(today.getTime() + diff * 24 * 60 * 60 * 1000);
    return nextDate.toISOString().split("T")[0];
  }
  return null;
}

function isWithinBusinessHours(dateStr, timeStr) {
  const [hms, period] = timeStr.split(" ");
  let [hour, minute] = hms.split(":").map((v) => parseInt(v, 10));
  if (period.toUpperCase() === "PM" && hour !== 12) hour += 12;
  if (period.toUpperCase() === "AM" && hour === 12) hour = 0;

  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  const dow = d.getDay();

  if (dow >= 1 && dow <= 5) {
    if (hour < 9 || hour > 19 || (hour === 19 && minute > 0)) return false;
    return true;
  } else if (dow === 6) {
    if (hour < 10 || hour > 15 || (hour === 15 && minute > 0)) return false;
    return true;
  }
  return false;
}

function generateAppointmentId() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6 dígitos
}

// Definir funciones para OpenAI
const baseFunctions = [
  {
    name: "schedule_appointment",
    description: `Agendar una nueva cita para un cliente de Estética BellaVida.
   - Datos obligatorios: nombre, cedula, treatmentID, treatment_name, email, date, time.
   - Verificar fecha/hora según reglas.`,
    parameters: {
      type: "object",
      properties: {
        nombre: { type: "string", description: "Nombre completo del paciente." },
        cedula: { type: "string", description: "Cédula de ciudadanía del cliente." },
        treatmentID: { type: "string", description: "ID del tratamiento (ej. BOTX001)." },
        treatment_name: { type: "string", description: "Nombre del tratamiento (ej. Botox)." },
        email: { type: "string", description: "Correo electrónico del cliente." },
        date: { type: "string", description: "Fecha de la cita en formato YYYY-MM-DD o palabra relativa." },
        time: { type: "string", description: "Hora de la cita en formato 12 horas (HH:MM AM/PM)." },
      },
      required: ["nombre", "cedula", "treatmentID", "treatment_name", "email", "date", "time"],
    }
  },
  {
    name: "cancel_appointment",
    description: `Cancelar una cita existente para un cliente de Estética BellaVida.
    - Datos obligatorios: cedula, appointment_id, treatment_name, email.`,
    parameters: {
      type: "object",
      properties: {
        cedula: { type: "string", description: "Cédula de ciudadanía del cliente." },
        appointment_id: { type: "string", description: "ID de la cita a cancelar (treatmentID + cedula)." },
        treatment_name: { type: "string", description: "Nombre del tratamiento (ej. Botox)." },
        email: { type: "string", description: "Correo electrónico del cliente." },
      },
      required: ["cedula", "appointment_id", "treatment_name", "email"],
    },
  },
  {
    name: "purchase_product",
    description: "Registrar la compra de un producto en Estética BellaVida.",
    parameters: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "ID del producto a comprar." },
      },
      required: ["product_id"],
    },
  },
  {
    name: "get_products_and_services",
    description: "Obtiene dinámicamente el catálogo completo de productos y servicios de Estética BellaVida.",
    parameters: { type: "object", properties: {} },
    required: [],
  },
];

const extraFunction = {
  name: "get_current_date",
  description: "Obtiene la fecha actual en Bogotá.",
  parameters: { type: "object", properties: {} },
  required: [],
};

// -----------------------------------------------------------------------------
// Lógica principal: manejo de un mensaje de usuario en un thread
// -----------------------------------------------------------------------------

async function handleUserMessage(threadId, userText) {
  const userMessage = { role: "user", content: userText };
  const sessionMessages = upsertSession(threadId, userMessage);
  const messagesToSend = cloneMessages(sessionMessages);

  let functionsToUse = [...baseFunctions];
  if (isSchedulingIntent(userText)) {
    functionsToUse.push(extraFunction);
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: messagesToSend,
    functions: functionsToUse,
    function_call: "auto",
  });

  const responseMessage = completion.choices[0].message;

  if (responseMessage.function_call) {
    const { name, arguments: argsJSON } = responseMessage.function_call;
    let args;
    try {
      args = JSON.parse(argsJSON);
    } catch (e) {
      console.error("❌ Error parseando argumentos de función:", e);
      return "❌ Hubo un problema interpretando tu solicitud. ¿Puedes expresarla de otra manera?";
    }

    let assistantReply = "";

    switch (name) {
      case "schedule_appointment": {
        const { nombre, cedula, treatmentID, treatment_name, email, date, time } = args;
        const parsed = parseRelativeDate(date);
        const finalDate = parsed || date;
        const hoyStr = getCurrentDate().toISOString().split("T")[0];
        if (finalDate < hoyStr) {
          return "❗ La fecha indicada es anterior a hoy. Por favor, proporciona una fecha válida.";
        }
        if (!isWithinBusinessHours(finalDate, time)) {
          return "❗ La hora o fecha ingresada está fuera del horario comercial. Revisa por favor.";
        }
        const appointmentId = treatmentID + cedula;
        const payload = {
          type: "agendar",
          numero: threadId,          // si ya estabas enviando el número
          appointment_id: appointmentId,
          nombre,                    // <-- Nuevo campo
          cedula,
          treatment_id: treatmentID,
          treatment_name,
          email,
          date: finalDate,
          time,
        };
        try {
          await callWebhook(payload);
          assistantReply =
            `✅ Tu cita ha sido agendada exitosamente:\n` +
            `• ID de cita: ${appointmentId}\n` +
            `• Cédula: ${cedula}\n` +
            `• Correo: ${email}\n` +
            `• Tratamiento: ${treatment_name}\n` +
            `• Fecha: ${finalDate}\n` +
            `• Hora: ${time}`;
        } catch {
          assistantReply =
            "Lo siento, no pudimos agendar tu cita en este momento. Por favor, intenta más tarde.";
        }
        break;
      }
      case "reschedule_appointment": {
        const { nombre, cedula, appointment_id, treatment_name, email, new_date, new_time } = args;
        const parsed = parseRelativeDate(new_date);
        const finalNewDate = parsed || new_date;
        const hoyStr = getCurrentDate().toISOString().split("T")[0];
        if (finalNewDate < hoyStr) {
          return "❗ La nueva fecha indicada es anterior a hoy. Por favor, proporciona una fecha válida.";
        }
        if (!isWithinBusinessHours(finalNewDate, new_time)) {
          return "❗ La nueva hora o fecha está fuera del horario comercial. Revisa por favor.";
        }
        const payload = {
          type: "reagendar",
          appointment_id,
          nombre,                   // <-- Agregado
          cedula,
          treatment_name,
          email,
          new_date: finalNewDate,
          new_time,
        };
        try {
          await callWebhook(payload);
          assistantReply =
            `✅ Tu cita ha sido reagendada exitosamente:\n` +
            `• ID de cita: ${appointment_id}\n` +
            `• Cédula: ${cedula}\n` +
            `• Correo: ${email}\n` +
            `• Nuevo tratamiento: ${treatment_name}\n` +
            `• Nueva fecha: ${finalNewDate}\n` +
            `• Nueva hora: ${new_time}`;
        } catch {
          assistantReply =
            "Lo siento, no pudimos reagendar tu cita en este momento. Por favor, intenta más tarde.";
        }
        break;
      }
      case "cancel_appointment": {
        const { nombre, cedula, appointment_id, treatment_name, email } = args;
        const payload = {
          type: "cancelar",
          appointment_id,
          nombre,                   // <-- Agregado
          cedula,
          treatment_name,
          email,
        };
        try {
          await callWebhook(payload);
          assistantReply =
            `✅ Tu cita ha sido cancelada exitosamente:\n` +
            `• ID de cita: ${appointment_id}\n` +
            `• Cédula: ${cedula}\n` +
            `• Correo: ${email}\n` +
            `• Tratamiento: ${treatment_name}`;
        } catch {
          assistantReply =
            "Lo siento, no pudimos cancelar tu cita en este momento. Por favor, intenta más tarde.";
        }
        break;
      }
      case "purchase_product": {
        const { product_id } = args;
        const payload = {
          type: "compra",
          product_id,
        };
        try {
          await callWebhook(payload);
          assistantReply =
            `✅ Tu compra ha sido registrada:\n` +
            `• ID de producto: ${product_id}\nNos pondremos en contacto para los detalles de pago y envío.`;
        } catch {
          assistantReply =
            "Lo siento, no pudimos procesar tu compra en este momento. Por favor, intenta más tarde.";
        }
        break;
      }
      case "get_current_date": {
        const currentDate = await getCurrentDate();
        assistantReply = `Hoy es ${currentDate}.`;
        break;
      }
      case "get_products_and_services": {
        assistantReply =
          `Catálogo de servicios destacados:\n` +
          `1. Toxina Botulínica (Botox)\n` +
          `   • ID de servicio: BOTX001\n` +
          `   • Precio: $1.200.000 COP (USD 300)\n` +
          `   • Descripción: Reducción de arrugas faciales (frente, patas de gallo, entrecejo).\n` +
          `   • Disponibilidad: En stock | Sesión de 30 minutos.\n\n` +
          `2. Relleno de Ácido Hialurónico\n` +
          `   • ID de servicio: HALU002\n` +
          `   • Precio: $1.800.000 COP (USD 450) por jeringa\n` +
          `   • Descripción: Volumen en labios, mejillas o contorno facial.\n` +
          `   • Disponibilidad: En stock | Resultados inmediatos.\n\n` +
          `3. Depilación Láser\n` +
          `   • ID de servicio: DLZR003\n` +
          `   • Precio: $400.000 COP (USD 100) por sesión (zona pequeña)\n` +
          `   • Descripción: Tecnología LightSheer para eliminación permanente del vello.\n` +
          `   • Disponibilidad: Reserva previa | 6 sesiones recomendadas.\n\n` +
          `4. Piel Radiante (Peeling Químico + Hidratación)\n` +
          `   • ID de servicio: PIEL004\n` +
          `   • Precio: $350.000 COP (USD 85)\n` +
          `   • Descripción: Tratamiento para manchas, poros y textura irregular.\n` +
          `   • Disponibilidad: En stock | Duración: 45 minutos.\n\n` +
          `Catálogo de productos:\n` +
          `1. Crema Antienvejecimiento BellaVida\n` +
          `   • ID de producto: CREMA-ANTIENVE-001\n` +
          `   • Precio: $150.000 COP (USD 35)\n` +
          `   • Disponibilidad: En stock | Envío internacional disponible.\n\n` +
          `Puedes usar los ID de servicio o producto cuando quieras agendar o comprar.`;
        break;
      }
      default:
        assistantReply = "Lo siento, no pude procesar esa solicitud.";
    }

    const assistantFuncMessage = { role: "assistant", content: assistantReply };
    const session = sessions.get(threadId);
    if (session) {
      session.messages.push(assistantFuncMessage);
      session.lastUpdated = Date.now();
    }
    return assistantReply;
  }

  const assistantContent = responseMessage.content || "";
  const assistantMessage = { role: "assistant", content: assistantContent };
  const session = sessions.get(threadId);
  if (session) {
    session.messages.push(assistantMessage);
    session.lastUpdated = Date.now();
  }
  return assistantContent;
}

// -----------------------------------------------------------------------------
// Interfaz de consola
// -----------------------------------------------------------------------------


module.exports = { handleUserMessage };
