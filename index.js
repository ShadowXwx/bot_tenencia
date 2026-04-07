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

// Texto estándar de opciones para no repetir código
const MENU_OPCIONES = "\n\n¿Deseas realizar otro trámite? Estás son mis opciones:\n💰 Tenencia\n🚓 Multas\n📅 Agendar Cita\n🍃 Verificación";

// ==========================================
// RUTAS DEL SERVIDOR
// ==========================================
app.get('/', (req, res) => res.send('Servidor Vehicular UNAM con Menú Activo ✅'));

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
                return res.json({
                    fulfillmentText: `¡Mucho gusto, ${nombreUsuario}! 👋✨\n\n${placaGlobal ? `Placa ${placaGlobal} lista.` : "Aún no tengo tu placa."}${MENU_OPCIONES}`,
                    outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal)
                });
            }

            case 'consulta_tenencia':
            case 'ConsultarVehiculo': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa. 🚗` });
                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                if (!Array.isArray(sheetRes.data) || sheetRes.data.length === 0) return res.json({ fulfillmentText: `No encontré la placa ${placaGlobal}. 🔎` });

                const adeudo = sheetRes.data[0].adeudo_tenencia || "$0.00";
                const estadoPago = (adeudo === "0" || adeudo === "$0.00") ? "AL CORRIENTE" : `Debe ${adeudo}`;
                
                const prompt = `Eres asistente vehicular. Usuario: ${nombreUsuario}. Placa: ${placaGlobal}. Situación Tenencia: ${estadoPago}. Explica brevemente. 2 párrafos cortos, sin asteriscos.`;
                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
                
                return res.json({ 
                    fulfillmentText: aiRes.data.choices[0].message.content.replace(/\*/g, "") + MENU_OPCIONES, 
                    outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) 
                });
            }

            case 'consultar_multas':
            case 'ConsultarMultas': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa para multas. 🚓` });
                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                if (!Array.isArray(sheetRes.data) || sheetRes.data.length === 0) return res.json({ fulfillmentText: `Placa ${placaGlobal} no encontrada.` });

                const multas = sheetRes.data[0].multas || "$0.00";
                const estadoMultas = (multas === "0" || multas === "$0.00") ? "No tiene infracciones." : `Debe ${multas} en multas.`;

                const prompt = `Asistente vehicular. Usuario: ${nombreUsuario}. Placa: ${placaGlobal}. Multas: ${estadoMultas}. Explica brevemente. 2 párrafos, emojis, sin asteriscos.`;
                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });

                return res.json({ 
                    fulfillmentText: aiRes.data.choices[0].message.content.replace(/\*/g, "") + MENU_OPCIONES, 
                    outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) 
                });
            }

            case 'verificacion':
            case 'verificación':
            case 'ConsultarVerificacion': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa. 🍃` });
                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                if (!Array.isArray(sheetRes.data) || sheetRes.data.length === 0) return res.json({ fulfillmentText: `No encontré la placa ${placaGlobal}.` });

                const holograma = sheetRes.data[0].holograma || "No registrado";
                const zona = parametros.ubicacion || "CDMX";
                const mapaLink = `http://googleusercontent.com/maps.google.com/4{encodeURIComponent("Verificentro " + zona)}`;

                const prompt = `Asistente vehicular. Usuario: ${nombreUsuario}. Placa: ${placaGlobal}. Holograma: ${holograma}. Explica brevemente sobre su verificación. 2 párrafos, sin asteriscos.`;
                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });

                return res.json({ 
                    fulfillmentText: `${aiRes.data.choices[0].message.content.replace(/\*/g, "")}\n\n📍 Mapa en ${zona}: ${mapaLink}${MENU_OPCIONES}`, 
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

                return res.json({ 
                    fulfillmentText: `¡Listo ${nombreUsuario}! Cita agendada con folio: ${idCita}. ✅${MENU_OPCIONES}`, 
                    outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) 
                });
            }

            case 'salir':
            case 'despedida': {
                return res.json({
                    fulfillmentText: `¡Hasta luego, ${nombreUsuario}! 👋 Fue un placer atenderte. Vuelve pronto. ✨`,
                    outputContexts: [{ name: `${sesionActual}/contexts/memoria_usuario`, lifespanCount: 0 }]
                });
            }

            default:
                return res.json({ fulfillmentText: `Esa opción no la tengo configurada aún. ⚙️${MENU_OPCIONES}` });
        }
    } catch (error) {
        console.error("Error:", error.message);
        return res.json({ fulfillmentText: `🚨 Hubo un problema técnico. ¿Intentamos con otro trámite?${MENU_OPCIONES}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Servidor activo en puerto ${PORT}`));
