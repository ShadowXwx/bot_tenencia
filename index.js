require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const SHEETDB_URL = process.env.SHEETDB_URL;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ==========================================
// FUNCIONES DE AYUDA (HELPERS)
// ==========================================
const formatearNombre = (paramNombre) => {
    if (!paramNombre) return null;
    if (typeof paramNombre === 'object' && paramNombre.name) return paramNombre.name;
    if (typeof paramNombre === 'string' && paramNombre.trim() !== '') return paramNombre.trim();
    if (Array.isArray(paramNombre) && paramNombre.length > 0) return paramNombre[0];
    return null;
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

// --- MENÚS DE NAVEGACIÓN ACTUALIZADOS ---
const OPCIONES_TEXTO = "\n💰 Tenencia\n🚓 Multas\n📅 Agendar Cita\n🔍 Consultar Cita\n🍃 Verificación";
const MENU_BIENVENIDA = `\n\n¿En qué puedo ayudarte hoy? Estas son mis opciones:${OPCIONES_TEXTO}`;
const MENU_REINTENTAR = `\n\n¿Deseas realizar otro trámite? Estas son mis opciones:${OPCIONES_TEXTO}`;

// ==========================================
// RUTAS DEL SERVIDOR
// ==========================================
app.get('/', (req, res) => res.send('Servidor Vehicular UNAM con Fallback IA ✅'));

app.post('/webhook', async (req, res) => {
    try {
        if (!req.body || !req.body.queryResult) return res.status(400).send('Petición inválida');

        const intentName = req.body.queryResult.intent.displayName;
        const parametros = req.body.queryResult.parameters || {};
        const contextos = req.body.queryResult.outputContexts || [];
        const sesionActual = req.body.session;
        
        // Atrapamos exactamente lo que el usuario escribió
        const textoUsuario = req.body.queryResult.queryText || "";

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

        switch (intentName) {
            
            case 'capturar_nombre': {
                const msjPlaca = placaGlobal ? `Placa ${placaGlobal} vinculada.` : "Aún no tengo tu placa registrada.";
                return res.json({
                    fulfillmentText: `¡Mucho gusto, ${nombreUsuario}! 👋✨\n\n${msjPlaca}${MENU_BIENVENIDA}`,
                    outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal)
                });
            }

            case 'consulta_tenencia':
            case 'ConsultarVehiculo': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa. 🚗` });
                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                if (!Array.isArray(sheetRes.data) || sheetRes.data.length === 0) return res.json({ fulfillmentText: `No encontré la placa ${placaGlobal}. 🔎` });

                const adeudo = sheetRes.data[0].adeudo_tenencia || "$0.00";
                const estado = (adeudo === "0" || adeudo === "$0.00") ? "AL CORRIENTE" : `DEBE ${adeudo}`;
                
                const prompt = `Eres un asistente de trámites. Usuario: ${nombreUsuario}. Placa: ${placaGlobal}. Tenencia: ${estado}. Explica el estado de pago de forma directa. REGLA: No menciones estacionamientos, tránsito ni otros servicios. 2 párrafos cortos, sin asteriscos.`;
                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
                
                return res.json({ 
                    fulfillmentText: aiRes.data.choices[0].message.content.replace(/\*/g, "") + MENU_REINTENTAR, 
                    outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) 
                });
            }

            case 'consultar_multas':
            case 'ConsultarMultas': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa. 🚓` });
                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                if (!Array.isArray(sheetRes.data) || sheetRes.data.length === 0) return res.json({ fulfillmentText: `Placa no encontrada.` });

                const multas = sheetRes.data[0].multas || "$0.00";
                const estado = (multas === "0" || multas === "$0.00") ? "SIN INFRACCIONES" : `ADEUDO DE ${multas}`;

                const prompt = `Asistente de trámites. Usuario: ${nombreUsuario}. Placa: ${placaGlobal}. Multas: ${estado}. Explica brevemente el estado de infracciones. REGLA: No ofrezcas otros servicios. 2 párrafos cortos, sin asteriscos.`;
                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });

                return res.json({ fulfillmentText: aiRes.data.choices[0].message.content.replace(/\*/g, "") + MENU_REINTENTAR, outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) });
            }

            case 'verificacion':
            case 'verificación':
            case 'ConsultarVerificacion': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa. 🍃` });
                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                if (!Array.isArray(sheetRes.data) || sheetRes.data.length === 0) return res.json({ fulfillmentText: `No encontré la placa ${placaGlobal}.` });

                const holograma = sheetRes.data[0].holograma || "No registrado";
                
                let zona = "CDMX";
                if (parametros.ubicacion) {
                    zona = typeof parametros.ubicacion === 'object' ? (parametros.ubicacion.city || "CDMX") : parametros.ubicacion;
                }
                
                const queryMaps = encodeURIComponent(`Verificentro cerca de ${zona}`);
                const mapaLink = `https://www.google.com/maps/search/?api=1&query=${queryMaps}`;

                const prompt = `Asistente de trámites. Usuario: ${nombreUsuario}. Placa: ${placaGlobal}. Holograma: ${holograma}. Explica brevemente la situación de emisiones. REGLA: No inventes servicios. 2 párrafos cortos, sin asteriscos.`;
                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });

                return res.json({ 
                    fulfillmentText: `${aiRes.data.choices[0].message.content.replace(/\*/g, "")}\n\n📍 Mapa en ${zona}: ${mapaLink}${MENU_REINTENTAR}`, 
                    outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) 
                });
            }

            case 'agendar_cita': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa para agendar. 🚗` });

                const tramite = parametros.tramite || "General";
                const fecha = parametros.date ? parametros.date.split('T')[0] : null;
                const hora = parametros.time ? parametros.time.split('T')[1].substring(0, 5) : null;
                let telefono = parametros.telefono ? parametros.telefono.replace(/\D/g, '') : null;

                if (!fecha || !hora) {
                    return res.json({ fulfillmentText: `Para agendar, necesito que me indiques una fecha y hora específica. ✨` });
                }

                const fechaObj = new Date(fecha + 'T00:00:00');
                const diaSemana = fechaObj.getDay();
                if (diaSemana === 0 || diaSemana === 6) {
                    return res.json({ fulfillmentText: `Lo siento ${nombreUsuario}, el ${fecha} es fin de semana y no laboramos. 🏥\n\nPor favor, elige un día de Lunes a Viernes.${MENU_REINTENTAR}` });
                }

                const feriados = ['2026-01-01', '2026-02-02', '2026-03-16', '2026-05-01', '2026-09-16', '2026-11-16', '2026-12-25'];
                if (feriados.includes(fecha)) {
                    return res.json({ fulfillmentText: `El ${fecha} es día feriado oficial. Nuestras oficinas estarán cerradas. 🚩\n\n¿Te gustaría intentar con otra fecha?${MENU_REINTENTAR}` });
                }

                const consultaConflicto = await axios.get(`${SHEETDB_URL}/search?Fecha_Cita=${fecha}&Hora_Cita=${hora}&sheet=Agenda_Citas`);
                if (Array.isArray(consultaConflicto.data) && consultaConflicto.data.length > 0) {
                    return res.json({ fulfillmentText: `¡Ups! Ya existe una cita agendada para el ${fecha} a las ${hora} hrs. 🕒\n\n¿Podrías elegir un horario diferente?${MENU_REINTENTAR}` });
                }

                const idCita = "CITA-" + Math.random().toString(36).substr(2, 4).toUpperCase();
                await axios.post(`${SHEETDB_URL}?sheet=Agenda_Citas`, {
                    data: [{ 
                        ID_Cita: idCita, 
                        Fecha_Registro: new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" }), 
                        Nombre_Usuario: nombreUsuario, 
                        Placa_Vehiculo: placaGlobal, 
                        Tipo_Tramite: tramite, 
                        Fecha_Cita: fecha, 
                        Hora_Cita: hora, 
                        Estatus: "Pendiente" 
                    }]
                });

                let notaWhatsApp = "";
                if (telefono && process.env.ULTRAMSG_INSTANCE) {
                    try {
                        if (telefono.length === 10) telefono = `+52${telefono}`;
                        const msjWA = `🚗 *CONFIRMACIÓN DE CITA*\n\nHola *${nombreUsuario}*\nTu cita ha sido confirmada en nuestro sistema.\n\n🆔 Folio: ${idCita}\n🚗 Placa: ${placaGlobal}\n📋 Trámite: ${tramite}\n📅 Fecha: ${fecha}\n⏰ Hora: ${hora} hrs`;
                        await axios.post(`https://api.ultramsg.com/${process.env.ULTRAMSG_INSTANCE}/messages/chat`, { token: process.env.ULTRAMSG_TOKEN, to: telefono, body: msjWA });
                        notaWhatsApp = "\n\n📱 ¡Te acabo de enviar un comprobante oficial por WhatsApp!";
                    } catch (e) { 
                        console.error("Error WA:", e.message); 
                    }
                }

                return res.json({ 
                    fulfillmentText: `¡Excelente, ${nombreUsuario}! ✅\n\nTu cita ha sido confirmada.\n🆔 Folio: ${idCita}\n📅 Fecha: ${fecha}\n⏰ Hora: ${hora} hrs${notaWhatsApp}${MENU_REINTENTAR}`, 
                    outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) 
                });
            }

            case 'consultar_cita': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa para buscar tus citas. 🔍` });
                const citaRes = await axios.get(`${SHEETDB_URL}/search?Placa_Vehiculo=${placaGlobal}&sheet=Agenda_Citas`);
                
                if (!Array.isArray(citaRes.data) || citaRes.data.length === 0) {
                    return res.json({ fulfillmentText: `${nombreUsuario}, no encontré citas para la placa ${placaGlobal}. ❌${MENU_REINTENTAR}` });
                }

                let mensajeCitas = `¡Hola, ${nombreUsuario}! Encontré esto:\n\n`;
                citaRes.data.forEach((cita, i) => {
                    mensajeCitas += `📌 CITA ${i + 1}:\n🆔 Folio: ${cita.ID_Cita}\n📋 Trámite: ${cita.Tipo_Tramite}\n📅 Fecha: ${cita.Fecha_Cita}\n⏰ Hora: ${cita.Hora_Cita}\n⚙️ Estatus: ${cita.Estatus}\n\n`;
                });

                return res.json({ fulfillmentText: mensajeCitas + MENU_REINTENTAR, outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) });
            }

            case 'salir':
            case 'despedida': {
                return res.json({
                    fulfillmentText: `¡Hasta luego, ${nombreUsuario}! 👋 Fue un placer atenderte. Vuelve pronto. ✨`,
                    outputContexts: [{ name: `${sesionActual}/contexts/memoria_usuario`, lifespanCount: 0 }]
                });
            }

            // ------------------------------------------
            // 8. FALLBACK INTELIGENTE (RESPUESTA IA ABIERTA)
            // ------------------------------------------
            default: {
                try {
                    // Si el intent no existe, mandamos la pregunta cruda a la IA
                    const promptFallback = `Eres un asistente virtual de trámites vehiculares. El usuario (${nombreUsuario}) te pregunta: "${textoUsuario}".
                    REGLAS STRICTAS:
                    1. Si la pregunta está relacionada con autos, conducción, refacciones, seguros, leyes de tránsito o mecánica básica, respóndela amablemente con tus conocimientos generales.
                    2. Si la pregunta NO tiene relación con vehículos (ej. recetas, política, tareas, chistes), dile cortésmente que eres un bot especializado en temas vehiculares y no puedes ayudar con eso.
                    3. Sé breve y directo (máximo 2 párrafos cortos). Usa emojis. No ofrezcas servicios ficticios.`;

                    const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { 
                        model: "llama-3.1-8b-instant", 
                        messages: [{ role: "user", content: promptFallback }] 
                    }, { 
                        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } 
                    });

                    const respuestaLibre = aiRes.data.choices[0].message.content.replace(/\*/g, "");

                    return res.json({ 
                        // Adjuntamos el menú de bienvenida para regresar al usuario al camino correcto
                        fulfillmentText: `${respuestaLibre}${MENU_BIENVENIDA}`, 
                        outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal)
                    });

                } catch (error) {
                    console.error("Error en Fallback IA:", error.message);
                    return res.json({ fulfillmentText: `Esa opción no la tengo configurada. ⚙️${MENU_BIENVENIDA}` });
                }
            }
        }
    } catch (error) {
        console.error("Error General:", error.message);
        return res.json({ fulfillmentText: `🚨 Problema técnico. ¿Intentamos con otro trámite?${MENU_BIENVENIDA}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Servidor activo puerto ${PORT}`));
