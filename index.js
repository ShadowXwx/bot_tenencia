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
app.get('/', (req, res) => res.send('Servidor del Bot Vehicular UNAM Activo ✅'));

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
            
            case 'capturar_nombre': {
                const placaMsj = placaGlobal ? `He guardado tu placa ${placaGlobal}.` : "Aún no tengo tu placa, pero me la puedes dar después.";
                return res.json({
                    fulfillmentText: `¡Mucho gusto, ${nombreUsuario}! 👋✨\n\n${placaMsj}\n\n¿En qué puedo ayudarte hoy?\n(Tenencia, multas, citas o verificación) 🚗💨`,
                    outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal)
                });
            }

            case 'salir':
            case 'despedida': {
                return res.json({
                    fulfillmentText: `¡Hasta luego, ${nombreUsuario}! 👋 He borrado tus datos. Escribe "Hola" si vuelves. ✨`,
                    outputContexts: [{ name: `${sesionActual}/contexts/memoria_usuario`, lifespanCount: 0 }]
                });
            }

            case 'consulta_tenencia':
            case 'ConsultarVehiculo': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa. 🚗` });
                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                if (!Array.isArray(sheetRes.data) || sheetRes.data.length === 0) return res.json({ fulfillmentText: `No encontré la placa ${placaGlobal}. 🔎` });

                const adeudo = sheetRes.data[0].adeudo_tenencia || "$0.00";
                const estadoPago = (adeudo === "0" || adeudo === "$0.00" || adeudo.toLowerCase() === "sin adeudo") 
                    ? "Está AL CORRIENTE, saldo $0.00. Felicítalo." : `Debe ${adeudo}. Indícale pagar.`;
                
                const prompt = `Eres asistente vehicular. Usuario: ${nombreUsuario}. Placa: ${placaGlobal}.\nTarea: Tenencia. ${estadoPago}. 2 párrafos, emojis (💰, 🚗), sin asteriscos.`;
                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
                return res.json({ fulfillmentText: aiRes.data.choices[0].message.content.replace(/\*/g, ""), outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) });
            }

            case 'agendar_cita': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa. 🚗` });
                const tramite = parametros.tramite || "General";
                const fecha = parametros.date ? parametros.date.split('T')[0] : "Sin fecha";
                const hora = parametros.time ? parametros.time.split('T')[1].substring(0, 5) : "Sin hora";
                const idCita = "CITA-" + Math.random().toString(36).substr(2, 4).toUpperCase();
                let telefono = parametros.telefono ? parametros.telefono.replace(/\D/g, '') : null;

                await axios.post(`${SHEETDB_URL}?sheet=Agenda_Citas`, {
                    data: [{ ID_Cita: idCita, Fecha_Registro: new Date().toLocaleString(), Nombre_Usuario: nombreUsuario, Placa_Vehiculo: placaGlobal, Tipo_Tramite: tramite, Fecha_Cita: fecha, Hora_Cita: hora, Estatus: "Pendiente" }]
                });

                if (telefono && process.env.ULTRAMSG_INSTANCE) {
                    try {
                        if (telefono.length === 10) telefono = `+52${telefono}`;
                        const msjWA = `🚗 *CONFIRMACIÓN DE CITA*\n\nHola *${nombreUsuario}*\nFolio: ${idCita}\nPlaca: ${placaGlobal}\nTrámite: ${tramite}\nFecha: ${fecha}\nHora: ${hora} hrs`;
                        await axios.post(`https://api.ultramsg.com/${process.env.ULTRAMSG_INSTANCE}/messages/chat`, { token: process.env.ULTRAMSG_TOKEN, to: telefono, body: msjWA });
                    } catch (e) { console.error("Error WhatsApp:", e.message); }
                }
                return res.json({ fulfillmentText: `¡Listo ${nombreUsuario}! Cita agendada: ${idCita}. Te envié un WhatsApp. ✅`, outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) });
            }

            case 'verificacion':
            case 'ConsultarVerificacion': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa. 🍃` });
                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                if (!Array.isArray(sheetRes.data) || sheetRes.data.length === 0) return res.json({ fulfillmentText: `No encontré la placa ${placaGlobal}. 🔎` });

                const holograma = sheetRes.data[0].holograma || "No registrado";
                
                // --- ALTERNATIVA HACKER: GOOGLE MAPS GRATIS ---
                const zona = parametros.ubicacion || "CDMX";
                const queryMaps = encodeURIComponent(`Verificentro cerca de ${zona}`);
                const mapaLink = `https://www.google.com/maps/search/${queryMaps}`;

                const prompt = `Eres asistente vehicular. Usuario: ${nombreUsuario}. Placa: ${placaGlobal}. Holograma: ${holograma}.
                REGLAS: Habla de verificación. Menciona que adjuntas link de Google Maps para centros en ${zona}. 2 párrafos, emojis (🍃, 📍), sin asteriscos.`;

                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
                const respuestaIA = aiRes.data.choices[0].message.content.replace(/\*/g, "");

                return res.json({ 
                    fulfillmentText: `${respuestaIA}\n\n📍 Mapa de Verificentros: ${mapaLink}`, 
                    outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) 
                });
            }

            default:
                return res.json({ fulfillmentText: `Acción '${intentName}' no configurada. ⚙️` });
        }
    } catch (error) {
        console.error("Error:", error.message);
        return res.json({ fulfillmentText: `🚨 Error: ${error.message}. Revisa tus APIs. 🔌` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Servidor activo en puerto ${PORT}`));
