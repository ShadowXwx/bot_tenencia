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

        console.log("🔥 Intent detectado:", intentName);

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
        // LÓGICA DE INTENTS (SEPARADOS POR TRÁMITE)
        // ==========================================
        switch (intentName) {
            
            // ------------------------------------------
            // 1. CAPTURAR NOMBRE
            // ------------------------------------------
            case 'capturar_nombre': {
                const nombreNuevo = formatearNombre(parametros.nombre);
                return res.json({
                    fulfillmentText: `¡Mucho gusto, ${nombreNuevo}! 👋✨\n\n¿En qué puedo ayudarte hoy?\nPuedo consultar tu tenencia, refrendo, multas, ver cuándo circulas o revisar tus citas. 🚗💨`,
                    outputContexts: generarMemoria(sesionActual, nombreNuevo, placaGlobal)
                });
            }

            // ------------------------------------------
            // 2. CONSULTAR TENENCIA
            // ------------------------------------------
            case 'ConsultarVehiculo':
            case 'consulta_tenencia': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, ¿me podrías proporcionar tu número de placa para consultar tu tenencia? 🚗` });

                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                if (!sheetRes.data || sheetRes.data.length === 0) return res.json({ fulfillmentText: `Lo siento ${nombreUsuario}, no encontré la placa ${placaGlobal} en el padrón. 🔎` });

                const adeudo = sheetRes.data[0].adeudo_tenencia || "Sin adeudo";
                
                const prompt = `Eres un asistente de trámites vehiculares. El usuario es: ${nombreUsuario} (NUNCA lo llames por su placa). Placa: ${placaGlobal}.
                REGLAS: Habla ÚNICAMENTE de la Tenencia Vehicular. Su adeudo actual es: ${adeudo}. Redacta 2 párrafos cortos, usa emojis (💰, 🚗), sin asteriscos. Sé directo y amable.`;

                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
                
                return res.json({ fulfillmentText: aiRes.data.choices[0].message.content.replace(/\*/g, ""), outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) });
            }

            // ------------------------------------------
            // 3. CONSULTAR REFRENDO
            // ------------------------------------------
            case 'refrendo': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, ¿me podrías dar tu número de placa para revisar tu situación de refrendo? 🚗` });

                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                if (!sheetRes.data || sheetRes.data.length === 0) return res.json({ fulfillmentText: `Lo siento ${nombreUsuario}, no encontré la placa ${placaGlobal}. 🔎` });

                const adeudo = sheetRes.data[0].adeudo_tenencia || "Sin adeudo";
                
                const prompt = `Eres un asistente de trámites vehiculares. El usuario es: ${nombreUsuario} (NUNCA lo llames por su placa). Placa: ${placaGlobal}.
                REGLAS: Habla ÚNICAMENTE del Refrendo Vehicular. Su estatus de pago es: ${adeudo}. Redacta 2 párrafos cortos, usa emojis (📄, ✅), sin asteriscos. Confírmale su estatus de refrendo.`;

                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
                
                return res.json({ fulfillmentText: aiRes.data.choices[0].message.content.replace(/\*/g, ""), outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) });
            }

            // ------------------------------------------
            // 4. PROGRAMA HOY NO CIRCULA
            // ------------------------------------------
            case 'hoy_no_circula':
            case 'ConsultarCircula': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, indícame tu número de placa para decirte cuándo no circulas. 🚗` });

                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                if (!sheetRes.data || sheetRes.data.length === 0) return res.json({ fulfillmentText: `Lo siento ${nombreUsuario}, no encontré la placa ${placaGlobal}. 🔎` });

                const datosAuto = sheetRes.data[0];
                const digito = parseInt(datosAuto.ultimo_digito);
                const reglas = { 5: "Lunes", 6: "Lunes", 7: "Martes", 8: "Martes", 3: "Miércoles", 4: "Miércoles", 1: "Jueves", 2: "Jueves", 9: "Viernes", 0: "Viernes" };
                const diaNoCircula = (datosAuto.holograma === "0" || datosAuto.holograma === "00") ? "Circula diario" : reglas[digito];

                const prompt = `Eres un asistente de trámites vehiculares. El usuario es: ${nombreUsuario} (NUNCA lo llames por su placa). Placa: ${placaGlobal}.
                REGLAS: Habla ÚNICAMENTE del programa Hoy No Circula. Indica EXPLÍCITAMENTE esto: "Tu vehículo descansa el día ${diaNoCircula}". Redacta en 2 párrafos cortos, usa emojis (📅, 🛑), sin asteriscos. No des definiciones largas.`;

                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
                
                return res.json({ fulfillmentText: aiRes.data.choices[0].message.content.replace(/\*/g, ""), outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) });
            }

            // ------------------------------------------
            // 5. CONSULTAR MULTAS
            // ------------------------------------------
            case 'consultar_multas':
            case 'ConsultarMultas': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, ¿me podrías proporcionar tu número de placa para buscar tus infracciones? 🚓` });

                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                if (!sheetRes.data || sheetRes.data.length === 0) return res.json({ fulfillmentText: `Lo siento ${nombreUsuario}, no encontré la placa ${placaGlobal}. 🔎` });

                const multas = sheetRes.data[0].multas || sheetRes.data[0].adeudo_multas || "Sin infracciones pendientes. ✅";

                const prompt = `Eres un asistente de trámites. Usuario: ${nombreUsuario} (NUNCA uses la placa como nombre). Placa: ${placaGlobal}.
                REGLAS: Habla ÚNICAMENTE de Infracciones de tránsito. Situación: ${multas}. Redacta 2 párrafos cortos, usa emojis (🚓, 💸), sin asteriscos.`;

                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
                
                return res.json({ fulfillmentText: aiRes.data.choices[0].message.content.replace(/\*/g, ""), outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) });
            }

            // ------------------------------------------
            // 6. AGENDAR CITA
            // ------------------------------------------
            case 'agendar_cita': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa para poder agendar la cita. 🚗` });

                const tramite = parametros.tramite || "General";
                const fecha = parametros.date ? parametros.date.split('T')[0] : "Sin fecha";
                const hora = parametros.time ? parametros.time.split('T')[1].substring(0, 5) : "Sin hora";
                const idCita = "CITA-" + Math.random().toString(36).substr(2, 4).toUpperCase();
                const fechaReg = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });

                await axios.post(`${SHEETDB_URL}?sheet=Agenda_Citas`, {
                    data: [{ ID_Cita: idCita, Fecha_Registro: fechaReg, Nombre_Usuario: nombreUsuario, Placa_Vehiculo: placaGlobal, Tipo_Tramite: tramite, Fecha_Cita: fecha, Hora_Cita: hora, Estatus: "Pendiente" }]
                });

                return res.json({ fulfillmentText: `¡Excelente, ${nombreUsuario}! ✅\nTu cita quedó registrada.\n🆔 Folio: ${idCita}\n🚗 Placa: ${placaGlobal}\n📋 Trámite: ${tramite}\n📅 Fecha: ${fecha}\n⏰ Hora: ${hora}\n¡Nos vemos pronto! ✨`, outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) });
            }

            // ------------------------------------------
            // 7. CONSULTAR CITA EXISTENTE
            // ------------------------------------------
            case 'consultar_cita': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, dime tu placa para buscar tus citas en el sistema. 🚗` });

                const citaRes = await axios.get(`${SHEETDB_URL}/search?Placa_Vehiculo=${placaGlobal}&sheet=Agenda_Citas`);
                if (!citaRes.data || citaRes.data.length === 0) return res.json({ fulfillmentText: `${nombreUsuario}, no encontré ninguna cita programada para la placa ${placaGlobal}. ❌` });

                let mensajeCitas = `¡Hola de nuevo, ${nombreUsuario}! 🔍\nEncontré estas citas para tu vehículo (${placaGlobal}):\n\n`;

                citaRes.data.forEach((cita, index) => {
                    mensajeCitas += `📌 CITA ${index + 1}:\n🆔 Folio: ${cita.ID_Cita || "N/A"}\n📋 Trámite: ${cita.Tipo_Tramite || "N/A"}\n📅 Fecha: ${cita.Fecha_Cita || "N/A"}\n⏰ Hora: ${cita.Hora_Cita || "N/A"} hrs\n⚙️ Estatus: ${cita.Estatus || "Pendiente"}\n\n`;
                });

                mensajeCitas += `¿Deseas realizar alguna otra consulta? ✨`;
                return res.json({ fulfillmentText: mensajeCitas, outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) });
            }

            // ------------------------------------------
            // RESPUESTA POR DEFECTO
            // ------------------------------------------
            default:
                return res.json({ fulfillmentText: `Aún no tengo configurada la acción para el trámite '${intentName}' en mi sistema. ⚙️` });
        }

    } catch (error) {
        console.error("Error en Webhook:", error.message);
        return res.json({ fulfillmentText: "Hubo un problema procesando tu solicitud. Intenta de nuevo más tarde. 🔌" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Servidor vial corriendo en el puerto ${PORT}`));
