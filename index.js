require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const SHEETDB_URL = process.env.SHEETDB_URL;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ==========================================
// CONFIGURACIÓN DE SITIOS DE PAGO (OFICIALES)
// ==========================================
const LINKS_PAGO = {
    CDMX: "https://data.finanzas.cdmx.gob.mx/pages/consultas",
    EDOMEX: "https://sfpya.edomexico.gob.mx/tstcm/jsp/AyudaTenencia.jsp",
    GENERAL: "https://www.finanzas.cdmx.gob.mx/oficinas-de-atencion/administraciones-tributarias"
};

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
const OPCIONES_TEXTO = "\n💰 Tenencia\n🚓 Multas\n💳 ¿Dónde Pagar?\n📅 Agendar Cita\n🔍 Consultar Cita\n🍃 Verificación";
const MENU_BIENVENIDA = `\n\n¿En qué puedo ayudarte hoy? Estas son mis opciones:${OPCIONES_TEXTO}`;
const MENU_REINTENTAR = `\n\n¿Deseas realizar otro trámite? Estas son mis opciones:${OPCIONES_TEXTO}`;

// ==========================================
// RUTAS DEL SERVIDOR
// ==========================================
app.get('/', (req, res) => res.send('Servidor Vehicular UNAM v5.0 (Pagos) ✅'));

app.post('/webhook', async (req, res) => {
    try {
        if (!req.body || !req.body.queryResult) return res.status(400).send('Petición inválida');

        const intentName = req.body.queryResult.intent.displayName;
        const parametros = req.body.queryResult.parameters || {};
        const contextos = req.body.queryResult.outputContexts || [];
        const sesionActual = req.body.session;
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

            // ------------------------------------------
            // 2. DONDE PAGAR (GLOBAL - SIN PLACA)
            // ------------------------------------------
            case 'donde_pagar': {
                const zona = parametros.ubicacion || "CDMX";
                const link = (zona.toLowerCase().includes("edo") || zona.toLowerCase().includes("mexico")) ? LINKS_PAGO.EDOMEX : LINKS_PAGO.CDMX;
                
                return res.json({
                    fulfillmentText: `Para realizar tus pagos de tenencia, multas o refrendo en ${zona}, puedes acudir a Bancos, Tiendas de Autoservicio (OXXO, 7-Eleven) o usar el portal oficial:\n\n🌐 Sitio Oficial: ${link}\n\n📍 También puedes buscar "Tesorería" en Google Maps para puntos físicos.${MENU_REINTENTAR}`,
                    outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal)
                });
            }

            case 'consulta_tenencia':
            case 'ConsultarVehiculo': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa. 🚗` });
                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                if (!Array.isArray(sheetRes.data) || sheetRes.data.length === 0) return res.json({ fulfillmentText: `No encontré la placa ${placaGlobal}. 🔎` });

                const adeudo = sheetRes.data[0].adeudo_tenencia || "$0.00";
                const tieneAdeudo = (adeudo !== "0" && adeudo !== "$0.00");
                const msjPago = tieneAdeudo ? `\n\n💳 Puedes pagarlo aquí: ${LINKS_PAGO.CDMX}` : "";
                
                const prompt = `Asistente de trámites. Usuario: ${nombreUsuario}. Placa: ${placaGlobal}. Tenencia: ${tieneAdeudo ? 'DEBE ' + adeudo : 'AL CORRIENTE'}. Explica el estado. 2 párrafos cortos, sin asteriscos.`;
                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
                
                return res.json({ 
                    fulfillmentText: aiRes.data.choices[0].message.content.replace(/\*/g, "") + msjPago + MENU_REINTENTAR, 
                    outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) 
                });
            }

            case 'consultar_multas':
            case 'ConsultarMultas': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa. 🚓` });
                const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
                if (!Array.isArray(sheetRes.data) || sheetRes.data.length === 0) return res.json({ fulfillmentText: `Placa no encontrada.` });

                const multas = sheetRes.data[0].multas || "$0.00";
                const tieneMultas = (multas !== "0" && multas !== "$0.00");
                const msjPago = tieneMultas ? `\n\n💸 Paga tus multas aquí: ${LINKS_PAGO.CDMX}` : "";

                const prompt = `Asistente de trámites. Usuario: ${nombreUsuario}. Placa: ${placaGlobal}. Multas: ${tieneMultas ? 'DEUDOR' : 'LIMPIO'}. Explica brevemente. 2 párrafos cortos, sin asteriscos.`;
                const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });

                return res.json({ fulfillmentText: aiRes.data.choices[0].message.content.replace(/\*/g, "") + msjPago + MENU_REINTENTAR, outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) });
            }

            case 'agendar_cita': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa. 🚗` });
                const tramite = parametros.tramite || "General";
                const fecha = parametros.date ? parametros.date.split('T')[0] : null;
                const hora = parametros.time ? parametros.time.split('T')[1].substring(0, 5) : null;

                if (!fecha || !hora) return res.json({ fulfillmentText: `Dime fecha y hora para agendar. ✨` });

                const idCita = "CITA-" + Math.random().toString(36).substr(2, 4).toUpperCase();
                await axios.post(`${SHEETDB_URL}?sheet=Agenda_Citas`, {
                    data: [{ ID_Cita: idCita, Fecha_Registro: new Date().toLocaleString(), Nombre_Usuario: nombreUsuario, Placa_Vehiculo: placaGlobal, Tipo_Tramite: tramite, Fecha_Cita: fecha, Hora_Cita: hora, Estatus: "Pendiente" }]
                });

                return res.json({ fulfillmentText: `¡Listo ${nombreUsuario}! Folio: ${idCita}. ✅${MENU_REINTENTAR}`, outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) });
            }

            case 'consultar_cita': {
                if (!placaGlobal) return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa. 🔍` });
                const citaRes = await axios.get(`${SHEETDB_URL}/search?Placa_Vehiculo=${placaGlobal}&sheet=Agenda_Citas`);
                if (!Array.isArray(citaRes.data) || citaRes.data.length === 0) return res.json({ fulfillmentText: `Sin citas para ${placaGlobal}. ❌${MENU_REINTENTAR}` });

                let mensaje = `Citas para ${placaGlobal}:\n\n`;
                citaRes.data.forEach((c, i) => mensaje += `📌 ${i+1}: ${c.ID_Cita} - ${c.Fecha_Cita} (${c.Estatus})\n`);
                return res.json({ fulfillmentText: mensaje + MENU_REINTENTAR, outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal) });
            }

            case 'salir':
            case 'despedida': {
                return res.json({
                    fulfillmentText: `¡Hasta luego, ${nombreUsuario}! 👋 Vuelve pronto. ✨`,
                    outputContexts: [{ name: `${sesionActual}/contexts/memoria_usuario`, lifespanCount: 0 }]
                });
            }

            default: {
                try {
                    const promptFallback = `Asistente vehicular. Usuario (${nombreUsuario}) pregunta: "${textoUsuario}". Responde si es sobre autos/trámites, si no, discúlpate. Máximo 2 párrafos.`;
                    const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: promptFallback }] }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` } });
                    return res.json({ fulfillmentText: `${aiRes.data.choices[0].message.content.replace(/\*/g, "")}${MENU_BIENVENIDA}`, outputContexts: generarMemoria(sesionActual, nombreUsuario, placaGlobal)});
                } catch (e) {
                    return res.json({ fulfillmentText: `Esa opción no la tengo configurada. ⚙️${MENU_BIENVENIDA}` });
                }
            }
        }
    } catch (error) {
        console.error("Error:", error.message);
        return res.json({ fulfillmentText: `🚨 Problema técnico. ¿Intentamos con otro trámite?${MENU_BIENVENIDA}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Servidor activo puerto ${PORT}`));
