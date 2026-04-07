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
const formatearNombre = (paramNombre) => {
    if (!paramNombre) return null;
    return typeof paramNombre === 'object' ? (paramNombre.name || null) : paramNombre;
};

const generarMemoria = (session, nombre, placa) => {
    return [{
        name: `${session}/contexts/memoria_usuario`,
        lifespanCount: 50,
        parameters: { 
            nombre_guardado: nombre || "Ciudadano", 
            placa_guardada: placa || null
        }
    }];
};

// ==========================================
// RUTAS DEL SERVIDOR
// ==========================================
app.get('/', (req, res) => res.send('Servidor del Bot Vehicular Activo ✅'));

app.post('/webhook', async (req, res) => {
    try {
        if (!req.body || !req.body.queryResult) return res.status(400).send('Petición inválida');

        const intentName = req.body.queryResult.intent.displayName;
        const parametros = req.body.queryResult.parameters || {};
        const contextos = req.body.queryResult.outputContexts || [];
        const sesionActual = req.body.session;

        console.log("🔥 Intent detectado:", intentName);

        // --- EXTRACCIÓN DE MEMORIA GLOBAL ---
        let nombreUsuario = "Ciudadano";
        let placaGlobal = null;

        const extraerDato = (dato) => {
            if (!dato) return null;
            if (typeof dato === 'string' && dato.trim() !== '') return dato.trim();
            if (Array.isArray(dato) && dato.length > 0) return dato[0];
            return null;
        };

        placaGlobal = extraerDato(parametros.placa);
        let nombreTemporal = formatearNombre(parametros.nombre);
        
        const memoria = contextos.find(c => c.name.includes('memoria_usuario'));
        if (memoria && memoria.parameters) {
            nombreUsuario = nombreTemporal || extraerDato(memoria.parameters.nombre_guardado) || "Ciudadano";
            if (!placaGlobal) placaGlobal = extraerDato(memoria.parameters.placa_guardada);
        } else if (nombreTemporal) {
            nombreUsuario = nombreTemporal;
        }

        // ==========================================
        // LÓGICA DE INTENTS
        // ==========================================
        switch (intentName) {
            
            case 'capturar_nombre': {
                const placaMsj = placaGlobal ? `He guardado tu placa ${placaGlobal} en mi memoria.` : "Aún no tengo tu placa, pero me la puedes dar más adelante.";
                return res.json({
                    fulfillmentText: `¡Mucho gusto, ${nombreUsuario}! 👋✨\n\n${placaMsj}\n\n¿En qué puedo ayudarte hoy?\n(Tenencia, refrendo, multas, citas, o verificación) 🚗💨`,
                    outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal)
                });
            }

            case 'salir':
            case 'despedida': {
                return res.json({
                    fulfillmentText: `¡Hasta luego, ${nombreUsuario}! 👋 Fue un placer ayudarte.\n\nHe borrado tus datos de mi sistema. Si necesitas consultar de nuevo, solo escríbeme "Hola". ✨`,
                    outputContexts: [{ name: `${sesionActual}/contexts/memoria_usuario`, lifespanCount: 0 }]
                });
            }

            case 'ConsultarVehiculo':
            case 'consulta_tenencia': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, no tengo registrada tu placa. ¿Me la podrías proporcionar? 🚗` });

                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                
                // PROTECCIÓN ANTI-COLAPSOS (Array.isArray)
                if (!Array.isArray(sheetRes.data) || sheetRes.data.length === 0) {
                    console.log("Respuesta de BD:", sheetRes.data);
                    return res.json({ fulfillmentText: `Lo siento ${nombreUsuario}, no encontré la placa ${placaGlobal} o hubo un problema con la base de datos. 🔎` });
                }

                const adeudo = sheetRes.data[0].adeudo_tenencia || "$0.00";
                const estadoPago = (adeudo === "0" || adeudo === "$0.00" || adeudo.toLowerCase() === "sin adeudo") 
                    ? "Está AL CORRIENTE, su saldo es $0.00. Felicítalo y dile que NO debe pagar nada." 
                    : `Tiene un adeudo pendiente de ${adeudo}. Indícale que debe regularizar su pago.`;
                
                const prompt = `Eres un asistente vehicular. Usuario: ${nombreUsuario}. Placa: ${placaGlobal}.\nREGLAS: Habla ÚNICAMENTE de Tenencia. INSTRUCCIÓN ESTRICTA: ${estadoPago}. 2 párrafos cortos, emojis (💰, 🚗), sin asteriscos.`;
                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
                
                return res.json({ fulfillmentText: aiRes.data.choices[0].message.content.replace(/\*/g, ""), outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) });
            }

            case 'refrendo': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, no tengo registrada tu placa. ¿Me la podrías proporcionar? 🚗` });

                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                if (!Array.isArray(sheetRes.data) || sheetRes.data.length === 0) return res.json({ fulfillmentText: `Lo siento ${nombreUsuario}, no encontré la placa ${placaGlobal}. 🔎` });

                const adeudo = sheetRes.data[0].adeudo_tenencia || "$0.00";
                const estadoPago = (adeudo === "0" || adeudo === "$0.00" || adeudo.toLowerCase() === "sin adeudo") 
                    ? "Está AL CORRIENTE con refrendo, saldo $0.00. Felicítalo y dile que NO debe pagar." 
                    : `Tiene adeudo de refrendo de ${adeudo}. Indícale que debe pagar.`;
                
                const prompt = `Eres un asistente vehicular. Usuario: ${nombreUsuario}. Placa: ${placaGlobal}.\nREGLAS: Habla ÚNICAMENTE de Refrendo. INSTRUCCIÓN ESTRICTA: ${estadoPago}. 2 párrafos cortos, emojis (📄, ✅), sin asteriscos.`;
                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
                
                return res.json({ fulfillmentText: aiRes.data.choices[0].message.content.replace(/\*/g, ""), outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) });
            }

            case 'hoy_no_circula':
            case 'ConsultarCircula': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, no tengo registrada tu placa. ¿Me la podrías proporcionar? 🚗` });

                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                if (!Array.isArray(sheetRes.data) || sheetRes.data.length === 0) return res.json({ fulfillmentText: `Lo siento ${nombreUsuario}, no encontré la placa ${placaGlobal}. 🔎` });

                const datosAuto = sheetRes.data[0];
                const reglas = { 5: "Lunes", 6: "Lunes", 7: "Martes", 8: "Martes", 3: "Miércoles", 4: "Miércoles", 1: "Jueves", 2: "Jueves", 9: "Viernes", 0: "Viernes" };
                const diaNoCircula = (datosAuto.holograma === "0" || datosAuto.holograma === "00") ? "Circula diario" : reglas[parseInt(datosAuto.ultimo_digito)];

                const prompt = `Eres un asistente vehicular. Usuario: ${nombreUsuario}. Placa: ${placaGlobal}.\nREGLAS: Habla ÚNICAMENTE de Hoy No Circula. Indica EXPLÍCITAMENTE: "Tu vehículo descansa el día ${diaNoCircula}". 2 párrafos, emojis (📅, 🛑), sin asteriscos.`;
                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
                
                return res.json({ fulfillmentText: aiRes.data.choices[0].message.content.replace(/\*/g, ""), outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) });
            }

            case 'consultar_multas':
            case 'ConsultarMultas': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, no tengo registrada tu placa. ¿Me la podrías proporcionar? 🚓` });

                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                if (!Array.isArray(sheetRes.data) || sheetRes.data.length === 0) return res.json({ fulfillmentText: `Lo siento ${nombreUsuario}, no encontré la placa ${placaGlobal}. 🔎` });

                const multas = sheetRes.data[0].multas || sheetRes.data[0].adeudo_multas || "$0.00";
                const estadoMultas = (multas === "0" || multas === "$0.00" || multas.toLowerCase() === "sin multas" || multas.toLowerCase() === "sin adeudo") 
                    ? "No tiene infracciones. Felicítalo por ser buen conductor." 
                    : `Tiene infracciones por ${multas}. Indícale que debe pagarlas.`;

                const prompt = `Eres un asistente vehicular. Usuario: ${nombreUsuario}. Placa: ${placaGlobal}.\nREGLAS: Habla ÚNICAMENTE de Infracciones. INSTRUCCIÓN ESTRICTA: ${estadoMultas}. 2 párrafos cortos, emojis (🚓, 💸), sin asteriscos.`;
                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
                
                return res.json({ fulfillmentText: aiRes.data.choices[0].message.content.replace(/\*/g, ""), outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) });
            }

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

            case 'consultar_cita': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, dime tu placa para buscar tus citas. 🚗` });

                const citaRes = await axios.get(`${SHEETDB_URL}/search?Placa_Vehiculo=${placaGlobal}&sheet=Agenda_Citas`);
                if (!Array.isArray(citaRes.data) || citaRes.data.length === 0) return res.json({ fulfillmentText: `${nombreUsuario}, no encontré citas programadas para la placa ${placaGlobal}. ❌` });

                let mensajeCitas = `¡Hola de nuevo, ${nombreUsuario}! 🔍\nEncontré estas citas para tu vehículo (${placaGlobal}):\n\n`;
                citaRes.data.forEach((cita, index) => {
                    mensajeCitas += `📌 CITA ${index + 1}:\n🆔 Folio: ${cita.ID_Cita || "N/A"}\n📋 Trámite: ${cita.Tipo_Tramite || "N/A"}\n📅 Fecha: ${cita.Fecha_Cita || "N/A"}\n⏰ Hora: ${cita.Hora_Cita || "N/A"} hrs\n⚙️ Estatus: ${cita.Estatus || "Pendiente"}\n\n`;
                });

                return res.json({ fulfillmentText: mensajeCitas + `¿Deseas realizar alguna otra consulta? ✨`, outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) });
            }

            case 'verificación': 
            case 'verificacion':
            case 'ConsultarVerificacion': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, no tengo registrada tu placa. ¿Me la podrías proporcionar? 🍃` });

                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                if (!Array.isArray(sheetRes.data) || sheetRes.data.length === 0) return res.json({ fulfillmentText: `Lo siento ${nombreUsuario}, no encontré la placa ${placaGlobal}. 🔎` });

                const holograma = sheetRes.data[0].holograma || "No registrado";
                const estadoVerificacion = (holograma !== "No registrado" && holograma !== "") 
                    ? `Vehículo con holograma '${holograma}'. Dile que está al corriente con emisiones.` 
                    : `No hay registro de holograma vigente. Indícale que debe verificar pronto.`;

                const prompt = `Eres un asistente vehicular. Usuario: ${nombreUsuario}. Placa: ${placaGlobal}.\nREGLAS: Habla ÚNICAMENTE de Verificación. INSTRUCCIÓN ESTRICTA: ${estadoVerificacion}. 2 párrafos cortos, emojis (🍃, 🚗), sin asteriscos.`;
                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
                
                return res.json({ fulfillmentText: aiRes.data.choices[0].message.content.replace(/\*/g, ""), outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) });
            }

            default:
                return res.json({ fulfillmentText: `Aún no tengo configurada la acción para el trámite '${intentName}'. ⚙️` });
        }

    } catch (error) {
        console.error("Error en Webhook:", error.message);
        
        // ¡EL TRUCO DE DEPURACIÓN! Te manda el error directo al chat de Dialogflow
        let mensajeChismoso = error.message;
        if (error.response && error.response.status === 429) mensajeChismoso = "Rate Limit (Esperar 1 min y reintentar)";
        if (error.response && error.response.status === 402) mensajeChismoso = "Límite gratis de base de datos agotado";
        
        return res.json({ fulfillmentText: `🚨 Error detectado: ${mensajeChismoso}. Revisa los límites de tus APIs. 🔌` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Servidor vial corriendo en el puerto ${PORT}`));
