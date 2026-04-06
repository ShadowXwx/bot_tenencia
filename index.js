const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// Configuración de APIs (Cámbialas por tus llaves reales)
const SHEETDB_URL = "https://sheetdb.io/api/v1/n5w7uq6z7cy4m";
const GROQ_API_KEY = "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";

app.get('/', (req, res) => {
    res.send('Servidor del Bot Vehicular Activo y funcionando ✅');
});

app.post('/webhook', async (req, res) => {
    try {
        const intentName = req.body.queryResult.intent.displayName;
        const parametros = req.body.queryResult.parameters;
        const contextos = req.body.queryResult.outputContexts || [];

        // ==========================================
        // EXTRACCIÓN DE MEMORIA GLOBAL
        // ==========================================
        let nombreUsuario = "Ciudadano";
        let placaGlobal = parametros.placa;
        
        const memoria = contextos.find(c => c.name.includes('memoria_usuario'));
        if (memoria && memoria.parameters) {
            nombreUsuario = (typeof memoria.parameters.nombre === 'object') 
                ? (memoria.parameters.nombre.name || "Ciudadano") 
                : (memoria.parameters.nombre || "Ciudadano");
                
            if (!placaGlobal && memoria.parameters.placa) {
                placaGlobal = memoria.parameters.placa;
            }
        }

        // ==========================================
        // INTENT 1: CAPTURAR Y RECORDAR NOMBRE
        // ==========================================
        if (intentName === 'capturar_nombre') {
            const nombreCapturado = (typeof parametros.nombre === 'object') 
                ? (parametros.nombre.name || "ciudadano") 
                : (parametros.nombre || "ciudadano");
                
            return res.json({
                fulfillmentText: `¡Mucho gusto, ${nombreCapturado}! 👋✨\n\n¿En qué puedo ayudarte hoy?\n\nPuedo consultar tu tenencia, ver tus citas agendadas o agendar una nueva. 🚗💨`,
                outputContexts: [
                    {
                        name: `${req.body.session}/contexts/memoria_usuario`,
                        lifespanCount: 50,
                        parameters: { nombre: nombreCapturado }
                    }
                ]
            });
        }

        // ==========================================
        // INTENT 2: CONSULTAR VEHÍCULO (TENENCIA)
        // ==========================================
        if (intentName === 'ConsultarVehiculo' || intentName === 'consulta_tenencia') {
            if (!placaGlobal) {
                return res.json({ fulfillmentText: `${nombreUsuario}, ¿me podrías proporcionar tu número de placa? 🚗` });
            }

            const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placaGlobal}`);
            const datosAuto = sheetRes.data[0];

            if (!datosAuto) {
                return res.json({ fulfillmentText: `Lo siento ${nombreUsuario}, no encontré la placa ${placaGlobal} en el padrón vehicular. 🔎` });
            }

            const digito = parseInt(datosAuto.ultimo_digito);
            const reglas = { 
                5: "Lunes", 6: "Lunes", 7: "Martes", 8: "Martes", 
                3: "Miércoles", 4: "Miércoles", 1: "Jueves", 2: "Jueves", 9: "Viernes", 0: "Viernes" 
            };
            const diaNoCircula = (datosAuto.holograma === "0" || datosAuto.holograma === "00") ? "Circula diario" : reglas[digito];

            const prompt = `Eres un asistente oficial de trámites vehiculares. El usuario se llama ${nombreUsuario}.
            Sus datos son: Placa ${placaGlobal}, Adeudo: ${datosAuto.adeudo_tenencia}, No circula: ${diaNoCircula}.
            REGLAS: Saluda por su nombre, usa 3 párrafos cortos separados por dobles saltos de línea, usa emojis, NO uses asteriscos en lo absoluto.`;

            const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: "llama-3.1-8b-instant",
                messages: [{ role: "user", content: prompt }]
            }, {
                headers: { 
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            let textoLimpio = aiRes.data.choices[0].message.content;
            textoLimpio = textoLimpio.replace(/\*/g, ""); // Borrado total de asteriscos

            return res.json({
                fulfillmentText: textoLimpio,
                outputContexts: [{
                    name: `${req.body.session}/contexts/memoria_usuario`,
                    lifespanCount: 50,
                    parameters: { nombre: nombreUsuario, placa: placaGlobal }
                }]
            });
        }

        // ==========================================
        // INTENT 3: AGENDAR CITA
        // ==========================================
        if (intentName === 'agendar_cita') {
            if (!placaGlobal) {
                return res.json({ fulfillmentText: `${nombreUsuario}, necesito tu placa para poder agendar la cita. 🚗` });
            }

            const tramite = parametros.tramite || "General";
            const fechaRaw = parametros.date; 
            const horaRaw = parametros.time;

            const fecha = fechaRaw ? fechaRaw.split('T')[0] : "Sin fecha";
            const hora = horaRaw ? horaRaw.split('T')[1].substring(0, 5) : "Sin hora";

            // Generación de ID y Timestamp
            const idCita = "CITA-" + Math.random().toString(36).substr(2, 4).toUpperCase();
            const fechaReg = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });

            try {
                await axios.post(`${SHEETDB_URL}?sheet=Agenda_Citas`, {
                    data: [{
                        ID_Cita: idCita,
                        Fecha_Registro: fechaReg,
                        Nombre_Usuario: nombreUsuario,
                        Placa_Vehiculo: placaGlobal,
                        Tipo_Tramite: tramite,
                        Fecha_Cita: fecha,
                        Hora_Cita: hora,
                        Estatus: "Pendiente"
                    }]
                });

                return res.json({
                    fulfillmentText: `¡Excelente noticia, ${nombreUsuario}! ✅\n\nTu cita quedó registrada exitosamente.\n\n🆔 Folio: ${idCita}\n🚗 Placa: ${placaGlobal}\n📋 Trámite: ${tramite}\n📅 Fecha: ${fecha}\n⏰ Hora: ${hora} hrs\n\n¡Nos vemos pronto! ✨`,
                    outputContexts: [{
                        name: `${req.body.session}/contexts/memoria_usuario`,
                        lifespanCount: 50,
                        parameters: { nombre: nombreUsuario, placa: placaGlobal }
                    }]
                });

            } catch (sheetError) {
                console.error("Error SheetDB:", sheetError.message);
                return res.json({ fulfillmentText: "Lo siento, tuve un problema al guardar tu cita. 🔌" });
            }
        }

        // ==========================================
        // INTENT 4: CONSULTAR CITA EXISTENTE
        // ==========================================
        if (intentName === 'consultar_cita') {
            if (!placaGlobal) {
                return res.json({ fulfillmentText: `${nombreUsuario}, dime tu placa para buscar tu cita en el sistema. 🚗` });
            }

            const citaRes = await axios.get(`${SHEETDB_URL}/search?Placa_Vehiculo=${placaGlobal}&sheet=Agenda_Citas`);
            
            if (citaRes.data.length === 0) {
                return res.json({ fulfillmentText: `${nombreUsuario}, no encontré ninguna cita programada para la placa ${placaGlobal}. ❌` });
            }

            const miCita = citaRes.data[citaRes.data.length - 1];

        // ESTA LÍNEA ES MAGIA PARA DEPURAR:
        console.log("Objeto recibido de SheetDB:", JSON.stringify(miCita, null, 2));

        return res.json({
            fulfillmentText: `¡Hola de nuevo, ${nombreUsuario}! 🔍...`

            return res.json({
                fulfillmentText: `¡Hola de nuevo, ${nombreUsuario}! 🔍\n\nEncontré una cita programada para tu vehículo:\n\n🆔 Folio: ${miCita.ID_Cita}\n📋 Trámite: ${miCita.Tipo_Tramite}\n📅 Fecha: ${miCita.Fecha_Cita}\n⏰ Hora: ${miCita.Hora_Cita} hrs\n📌 Estatus: ${miCita.Estatus}\n\n¿Deseas realizar alguna otra consulta? ✨`
            });
        }

        // ==========================================
        // RESPUESTA POR DEFECTO
        // ==========================================
        return res.json({ fulfillmentText: "Aún no tengo configurada la acción para este trámite en mi sistema. ⚙️" });

    } catch (error) {
        console.error("Error en Webhook:", error.message);
        return res.json({ fulfillmentText: "Hubo un problema procesando tu solicitud. Intenta de nuevo más tarde. 🔌" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor vial corriendo en el puerto ${PORT}`);
});
