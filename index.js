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

// --- MENÚS DE NAVEGACIÓN ---
const MENU_BIENVENIDA = "\n\n¿En qué puedo ayudarte hoy? Estas son mis opciones:\n💰 Tenencia\n🚓 Multas\n📅 Agendar Cita\n🍃 Verificación";
const MENU_REINTENTAR = "\n\n¿Deseas realizar otro trámite? Estas son mis opciones:\n💰 Tenencia\n🚓 Multas\n📅 Agendar Cita\n🍃 Verificación";

// ==========================================
// RUTAS DEL SERVIDOR
// ==========================================
app.get('/', (req, res) => res.send('Servidor Vehicular UNAM Activo ✅'));

app.post('/webhook', async (req, res) => {
    try {
        if (!req.body || !req.body.queryResult) return res.status(400).send('Petición inválida');

        const intentName = req.body.queryResult.intent.displayName;
        const parametros = req.body.queryResult.parameters || {};
        const contextos = req.body.queryResult.outputContexts || [];
        const sesionActual = req.body.session;

        // --- EXTRACCIÓN DE MEMORIA ACORAZADA ---
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
            
            // 1. SALUDO INICIAL
            case 'capturar_nombre': {
                const msjPlaca = placaGlobal ? `Placa ${placaGlobal} vinculada.` : "Aún no tengo tu placa registrada.";
                return res.json({
                    fulfillmentText: `¡Mucho gusto, ${nombreUsuario}! 👋✨\n\n${msjPlaca}${MENU_BIENVENIDA}`,
                    outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal)
                });
            }

            // 2. CONSULTAR TENENCIA
            case 'consulta_tenencia':
            case 'ConsultarVehiculo': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa para consultar tenencia. 🚗` });
                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                if (!Array.isArray(sheetRes.data) || sheetRes.data.length === 0) return res.json({ fulfillmentText: `No encontré la placa ${placaGlobal}. 🔎` });

                const adeudo = sheetRes.data[0].adeudo_tenencia || "$0.00";
                const estado = (adeudo === "0" || adeudo === "$0.00") ? "AL CORRIENTE" : `Debe ${adeudo}`;
                
                const prompt = `Asistente vehicular. Usuario: ${nombreUsuario}. Placa: ${placaGlobal}. Tenencia: ${estado}. 2 párrafos cortos, emojis, sin asteriscos.`;
                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
                
                return res.json({ 
                    fulfillmentText: aiRes.data.choices[0].message.content.replace(/\*/g, "") + MENU_REINTENTAR, 
                    outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) 
                });
            }

            // 3. AGENDAR CITA + WHATSAPP
            case 'agendar_cita': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa. 🚗` });
                const tramite = parametros.tramite || "General";
                const fecha = parametros.date ? parametros.date.split('T')[0] : "Sin fecha";
                const idCita = "CITA-" + Math.random().toString(36).substr(2, 4).toUpperCase();
                let telefono = parametros.telefono ? parametros.telefono.replace(/\D/g, '') : null;

                await axios.post(`${SHEETDB_URL}?sheet=Agenda_Citas`, {
                    data: [{ ID_Cita: idCita, Fecha_Registro: new Date().toLocaleString(), Nombre_Usuario: nombreUsuario, Placa_Vehiculo: placaGlobal, Tipo_Tramite: tramite, Fecha_Cita: fecha, Estatus: "Pendiente" }]
                });

                if (telefono && process.env.ULTRAMSG_INSTANCE) {
                    try {
                        if (telefono.length === 10) telefono = `+52${telefono}`;
                        const msjWA = `🚗 *CONFIRMACIÓN DE CITA*\n\nHola *${nombreUsuario}*\nFolio: ${idCita}\nPlaca: ${placaGlobal}\nTrámite: ${tramite}\nFecha: ${fecha}`;
                        await axios.post(`https://api.ultramsg.com/${process.env.ULTRAMSG_INSTANCE}/messages/chat`, { token: process.env.ULTRAMSG_TOKEN, to: telefono, body: msjWA });
                    } catch (e) { console.error("Error WA:", e.message); }
                }
                return res.json({ fulfillmentText: `¡Listo ${nombreUsuario}! Folio: ${idCita}. Te envié un WhatsApp. ✅${MENU_REINTENTAR}`, outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) });
            }

            // 4. VERIFICACIÓN + GOOGLE MAPS GRATIS
            case 'verificacion':
            case 'verificación':
            case 'ConsultarVerificacion': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa. 🍃` });
                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                if (!Array.isArray(sheetRes.data) || sheetRes.data.length === 0) return res.json({ fulfillmentText: `No encontré la placa ${placaGlobal}. 🔎` });

                const holograma = sheetRes.data[0].holograma || "No registrado";
                const zona = parametros.ubicacion || "CDMX";
                const mapaLink = `http://googleusercontent.com/maps.google.com/5{encodeURIComponent("Verificentro cerca de " + zona)}`;

                const prompt = `Asistente vehicular. Usuario: ${nombreUsuario}. Placa: ${placaGlobal}. Holograma: ${holograma}. Explica brevemente. 2 párrafos, emojis, sin asteriscos.`;
                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });

                return res.json({ 
                    fulfillmentText: `${aiRes.data.choices[0].message.content.replace(/\*/g, "")}\n\n📍 Mapa en ${zona}: ${mapaLink}${MENU_REINTENTAR}`, 
                    outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) 
                });
            }

            // 5. CONSULTAR MULTAS
            case 'consultar_multas':
            case 'ConsultarMultas': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa. 🚓` });
                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                if (!Array.isArray(sheetRes.data) || sheetRes.data.length === 0) return res.json({ fulfillmentText: `Placa no encontrada.` });

                const multas = sheetRes.data[0].multas || "$0.00";
                const estado = (multas === "0" || multas === "$0.00") ? "Sin infracciones." : `Debe ${multas}.`;

                const prompt = `Asistente vehicular. Usuario: ${nombreUsuario}. Placa: ${placaGlobal}. Multas: ${estado}. 2 párrafos cortos, sin asteriscos.`;
                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });

                return res.json({ fulfillmentText: aiRes.data.choices[0].message.content.replace(/\*/g, "") + MENU_REINTENTAR, outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) });
            }

            // 6. SALIDA
            case 'salir':
            case 'despedida': {
                return res.json({
                    fulfillmentText: `¡Hasta luego, ${nombreUsuario}! 👋 Fue un placer ayudarte. Vuelve cuando lo necesites. ✨`,
                    outputContexts: [{ name: `${sesionActual}/contexts/memoria_usuario`, lifespanCount: 0 }]
                });
            }
                // 7. CONSULTAR CITA EXISTENTE
            case 'consultar_cita': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, dime tu placa para buscar tus citas. 🚗` });

                // Buscamos en la pestaña específica de Agenda_Citas
                const citaRes = await axios.get(`${SHEETDB_URL}/search?Placa_Vehiculo=${placaGlobal}&sheet=Agenda_Citas`);
                
                if (!Array.isArray(citaRes.data) || citaRes.data.length === 0) {
                    return res.json({ fulfillmentText: `${nombreUsuario}, no encontré citas programadas para la placa ${placaGlobal}. ❌${MENU_REINTENTAR}` });
                }

                let mensajeCitas = `¡Hola de nuevo, ${nombreUsuario}! 🔍\nEncontré estas citas para tu vehículo (${placaGlobal}):\n\n`;
                
                citaRes.data.forEach((cita, index) => {
                    mensajeCitas += `📌 CITA ${index + 1}:\n🆔 Folio: ${cita.ID_Cita || "N/A"}\n📋 Trámite: ${cita.Tipo_Tramite || "N/A"}\n📅 Fecha: ${cita.Fecha_Cita || "N/A"}\n⚙️ Estatus: ${cita.Estatus || "Pendiente"}\n\n`;
                });

                return res.json({ 
                    fulfillmentText: mensajeCitas + MENU_REINTENTAR, 
                    outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) 
                });
            }

            default:
                return res.json({ fulfillmentText: `Acción '${intentName}' no reconocida. ⚙️${MENU_BIENVENIDA}` });
        }
    } catch (error) {
        console.error("Error:", error.message);
        return res.json({ fulfillmentText: `🚨 Error técnico: ${error.message}. ¿Probamos otro trámite?${MENU_BIENVENIDA}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Servidor UNAM activo puerto ${PORT}`));
