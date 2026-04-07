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
app.get('/', (req, res) => res.send('Servidor Vehicular UNAM v3.0 ✅'));

app.post('/webhook', async (req, res) => {
    try {
        if (!req.body || !req.body.queryResult) return res.status(400).send('Petición inválida');

        const intentName = req.body.queryResult.intent.displayName;
        const parametros = req.body.queryResult.parameters || {};
        const contextos = req.body.queryResult.outputContexts || [];
        const sesionActual = req.body.session;

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
                
                // PROMPT RESTRINGIDO: Sin inventar servicios
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
                const mapaLink = `https://www.google.com/maps/search/${queryMaps}`;

                const prompt = `Asistente de trámites. Usuario: ${nombreUsuario}. Placa: ${placaGlobal}. Holograma: ${holograma}. Explica brevemente la situación de emisiones. REGLA: No inventes servicios. 2 párrafos cortos, sin asteriscos.`;
                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });

                return res.json({ 
                    fulfillmentText: `${aiRes.data.choices[0].message.content.replace(/\*/g, "")}\n\n📍 Mapa en ${zona}: ${mapaLink}${MENU_REINTENTAR}`, 
                    outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) 
                });
            }

            case 'agendar_cita': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa. 🚗` });
                const tramite = parametros.tramite || "General";
                const fecha = parametros.date ? parametros.date.split('T')[0] : "Sin fecha";
                const idCita = "CITA-" + Math.random().toString(36).substr(2, 4).toUpperCase();

                await axios.post(`${SHEETDB_URL}?sheet=Agenda_Citas`, {
                    data: [{ ID_Cita: idCita, Fecha_Registro: new Date().toLocaleString(), Nombre_Usuario: nombreUsuario, Placa_Vehiculo: placaGlobal, Tipo_Tramite: tramite, Fecha_Cita: fecha, Estatus: "Pendiente" }]
                });

                return res.json({ fulfillmentText: `¡Listo ${nombreUsuario}! Cita agendada con folio: ${idCita}. ✅${MENU_REINTENTAR}`, outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) });
            }

            case 'consultar_cita': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa para buscar tus citas. 🔍` });
                const citaRes = await axios.get(`${SHEETDB_URL}/search?Placa_Vehiculo=${placaGlobal}&sheet=Agenda_Citas`);
                
                if (!Array.isArray(citaRes.data) || citaRes.data.length === 0) {
                    return res.json({ fulfillmentText: `${nombreUsuario}, no encontré citas para la placa ${placaGlobal}. ❌${MENU_REINTENTAR}` });
                }

                let mensajeCitas = `¡Hola, ${nombreUsuario}! Encontré esto:\n\n`;
                citaRes.data.forEach((cita, i) => {
                    mensajeCitas += `📌 CITA ${i + 1}:\n🆔 Folio: ${cita.ID_Cita}\n📋 Trámite: ${cita.Tipo_Tramite}\n📅 Fecha: ${cita.Fecha_Cita}\n⚙️ Estatus: ${cita.Estatus}\n\n`;
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

            default:
                return res.json({ fulfillmentText: `Esa opción no la tengo configurada. ⚙️${MENU_BIENVENIDA}` });
        }
    } catch (error) {
        console.error("Error:", error.message);
        return res.json({ fulfillmentText: `🚨 Problema técnico. ¿Intentamos con otro trámite?${MENU_BIENVENIDA}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Servidor activo puerto ${PORT}`));
