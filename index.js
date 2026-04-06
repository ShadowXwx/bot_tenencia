const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// Configuración de APIs (Cámbialas por tus llaves reales)
const SHEETDB_URL = "https://sheetdb.io/api/v1/n5w7uq6z7cy4m";
const GROQ_API_KEY = "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";

// ==========================================
// FUNCIONES DE AYUDA (HELPERS)
// ==========================================

// 1. Extrae el nombre correctamente, sin importar cómo lo envíe Dialogflow
const formatearNombre = (paramNombre) => {
    if (!paramNombre) return "Ciudadano";
    return typeof paramNombre === 'object' ? (paramNombre.name || "Ciudadano") : paramNombre;
};

// 2. Genera el bloque de memoria para guardar en Dialogflow y no repetir código
const generarMemoria = (session, nombre, placa) => {
    return [{
        name: `${session}/contexts/memoria_usuario`,
        lifespanCount: 50,
        parameters: { nombre, placa }
    }];
};

// ==========================================
// RUTAS DEL SERVIDOR
// ==========================================

// Health Check
app.get('/', (req, res) => res.send('Servidor del Bot Vehicular Activo ✅'));

app.post('/webhook', async (req, res) => {
    try {
        const intentName = req.body.queryResult.intent.displayName;
        const parametros = req.body.queryResult.parameters;
        const contextos = req.body.queryResult.outputContexts || [];
        const sesionActual = req.body.session;

        // --- EXTRACCIÓN DE MEMORIA GLOBAL ---
        let nombreUsuario = "Ciudadano";
        let placaGlobal = parametros.placa;
        
        const memoria = contextos.find(c => c.name.includes('memoria_usuario'));
        if (memoria && memoria.parameters) {
            nombreUsuario = formatearNombre(memoria.parameters.nombre);
            if (!placaGlobal && memoria.parameters.placa) {
                placaGlobal = memoria.parameters.placa;
            }
        }

        // ==========================================
        // LÓGICA DE INTENTS
        // ==========================================

        switch (intentName) {
            
            // ------------------------------------------
            // 1. CAPTURAR NOMBRE
            // ------------------------------------------
            case 'capturar_nombre': {
                const nombreNuevo = formatearNombre(parametros.nombre);
                return res.json({
                    fulfillmentText: `¡Mucho gusto, ${nombreNuevo}! 👋✨\n\n¿En qué puedo ayudarte hoy?\nPuedo consultar tu tenencia, ver tus citas agendadas o agendar una nueva. 🚗💨`,
                    outputContexts: generarMemoria(sesionActual, nombreNuevo, placaGlobal)
                });
            }

            // ------------------------------------------
            // 2. CONSULTAR VEHÍCULO (TENENCIA)
            // ------------------------------------------
            case 'ConsultarVehiculo':
            case 'consulta_tenencia': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, ¿me podrías proporcionar tu número de placa? 🚗` });

                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                if (!sheetRes.data || sheetRes.data.length === 0) {
                    return res.json({ fulfillmentText: `Lo siento ${nombreUsuario}, no encontré la placa ${placaGlobal} en el padrón vehicular. 🔎` });
                }

                const datosAuto = sheetRes.data[0];
                const digito = parseInt(datosAuto.ultimo_digito);
                const reglas = { 5: "Lunes", 6: "Lunes", 7: "Martes", 8: "Martes", 3: "Miércoles", 4: "Miércoles", 1: "Jueves", 2: "Jueves", 9: "Viernes", 0: "Viernes" };
                const diaNoCircula = (datosAuto.holograma === "0" || datosAuto.holograma === "00") ? "Circula diario" : reglas[digito];

                const prompt = `Eres un asistente oficial de trámites vehiculares. Usuario: ${nombreUsuario}. Placa: ${placaGlobal}. Adeudo: ${datosAuto.adeudo_tenencia}. No circula: ${diaNoCircula}. REGLAS: Saluda por su nombre, usa 3 párrafos cortos separados por dobles saltos de línea, usa emojis, NO uses asteriscos en lo absoluto.`;

                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                    model: "llama-3.1-8b-instant",
                    messages: [{ role: "user", content: prompt }]
                }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });

                const textoLimpio = aiRes.data.choices[0].message.content.replace(/\*/g, "");

                return res.json({
                    fulfillmentText: textoLimpio,
                    outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal)
                });
            }

            // ------------------------------------------
            // 3. AGENDAR CITA
            // ------------------------------------------
            case 'agendar_cita': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa para poder agendar la cita. 🚗` });

                const tramite = parametros.tramite || "General";
                const fecha = parametros.date ? parametros.date.split('T')[0] : "Sin fecha";
                const hora = parametros.time ? parametros.time.split('T')[1].substring(0, 5) : "Sin hora";
                const idCita = "CITA-" + Math.random().toString(36).substr(2, 4).toUpperCase();
                const fechaReg = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });

                await axios.post(`${SHEETDB_URL}?sheet=Agenda_Citas`, {
                    data: [{
                        ID_Cita: idCita, Fecha_Registro: fechaReg, Nombre_Usuario: nombreUsuario,
                        Placa_Vehiculo: placaGlobal, Tipo_Tramite: tramite, Fecha_Cita: fecha,
                        Hora_Cita: hora, Estatus: "Pendiente"
                    }]
                });

                return res.json({
                    fulfillmentText: `¡Excelente noticia, ${nombreUsuario}! ✅\n\nTu cita quedó registrada exitosamente.\n\n🆔 Folio: ${idCita}\n🚗 Placa: ${placaGlobal}\n📋 Trámite: ${tramite}\n📅 Fecha: ${fecha}\n⏰ Hora: ${hora} hrs\n\n¡Nos vemos pronto! ✨`,
                    outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal)
                });
            }

            // ------------------------------------------
            // 4. CONSULTAR CITA EXISTENTE (MUESTRA TODAS)
            // ------------------------------------------
            case 'consultar_cita': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, dime tu placa para buscar tus citas en el sistema. 🚗` });

                const citaRes = await axios.get(`${SHEETDB_URL}/search?Placa_Vehiculo=${placaGlobal}&sheet=Agenda_Citas`);
                if (!citaRes.data || citaRes.data.length === 0) {
                    return res.json({ fulfillmentText: `${nombreUsuario}, no encontré ninguna cita programada para la placa ${placaGlobal}. ❌` });
                }

                // Armamos el inicio del mensaje
                let mensajeCitas = `¡Hola de nuevo, ${nombreUsuario}! 🔍\n\nEncontré las siguientes citas para tu vehículo (${placaGlobal}):\n\n`;

                // Recorremos TODAS las citas encontradas y las agregamos al mensaje
                citaRes.data.forEach((cita, index) => {
                    const folio = cita.ID_Cita || cita.id_cita || "No disponible";
                    const tramite = cita.Tipo_Tramite || cita.tipo_tramite || "No especificado";
                    const fecha = cita.Fecha_Cita || cita.fecha_cita || "Sin fecha";
                    const hora = cita.Hora_Cita || cita.hora_cita || "Sin hora";
                    const estatus = cita.Estatus || cita.estatus || "Pendiente";

                    mensajeCitas += `📌 CITA ${index + 1}:\n🆔 Folio: ${folio}\n📋 Trámite: ${tramite}\n📅 Fecha: ${fecha}\n⏰ Hora: ${hora} hrs\n⚙️ Estatus: ${estatus}\n\n`;
                });

                mensajeCitas += `¿Deseas realizar alguna otra consulta? ✨`;

                return res.json({
                    fulfillmentText: mensajeCitas,
                    outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal)
                });
            }

            // ------------------------------------------
            // RESPUESTA POR DEFECTO
            // ------------------------------------------
            default:
                return res.json({ fulfillmentText: "Aún no tengo configurada la acción para este trámite en mi sistema. ⚙️" });
        }

    } catch (error) {
        console.error("Error en Webhook:", error.message);
        return res.json({ fulfillmentText: "Hubo un problema procesando tu solicitud. Intenta de nuevo más tarde. 🔌" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Servidor vial corriendo en el puerto ${PORT}`));
