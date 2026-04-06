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
        // INTENT 1: CAPTURAR Y RECORDAR NOMBRE
        // ==========================================
        if (intentName === 'capturar_nombre') {
            let nombre = "ciudadano";
            
            if (parametros.nombre) {
                if (typeof parametros.nombre === 'object') {
                    nombre = parametros.nombre.name || "ciudadano";
                } else {
                    nombre = parametros.nombre;
                }
            }
            
            return res.json({
                fulfillmentText: `¡Mucho gusto, ${nombre}! 👋✨\n\nSoy tu asistente de trámites vehiculares. Ya te conozco, así que dime: ¿en qué puedo ayudarte hoy?\n\nPuedo consultar tu tenencia, agendar una cita o ver cuándo no circulas. 🚗💨`,
                outputContexts: [
                    {
                        name: `${req.body.session}/contexts/memoria_usuario`,
                        lifespanCount: 50,
                        parameters: { nombre: nombre }
                    }
                ]
            });
        }

        // ==========================================
        // INTENT 2: CONSULTAR VEHÍCULO
        // ==========================================
        if (intentName === 'ConsultarVehiculo' || intentName === 'consulta_tenencia') {
            
            // 1. Revisar la memoria
            let nombreUsuario = "Ciudadano";
            let placa = parametros.placa;
            
            const memoria = contextos.find(c => c.name.includes('memoria_usuario'));
            if (memoria && memoria.parameters) {
                if (memoria.parameters.nombre) {
                    if (typeof memoria.parameters.nombre === 'object') {
                        nombreUsuario = memoria.parameters.nombre.name || "Ciudadano";
                    } else {
                        nombreUsuario = memoria.parameters.nombre;
                    }
                }
                if (!placa && memoria.parameters.placa) {
                    placa = memoria.parameters.placa;
                }
            }

            if (!placa) {
                return res.json({ fulfillmentText: `${nombreUsuario}, ¿me podrías proporcionar tu número de placa? 🚗` });
            }

            // 2. Consultar Base de Datos
            const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placa}`);
            const datosAuto = sheetRes.data[0];

            if (!datosAuto) {
                return res.json({ fulfillmentText: `Lo siento ${nombreUsuario}, no encontré la placa ${placa} en el padrón vehicular. 🔎` });
            }

            // 3. Reglas de Negocio
            const digito = parseInt(datosAuto.ultimo_digito);
            const reglas = {
                5: "Lunes", 6: "Lunes", 7: "Martes", 8: "Martes", 
                3: "Miércoles", 4: "Miércoles", 1: "Jueves", 2: "Jueves", 9: "Viernes", 0: "Viernes"
            };
            const diaNoCircula = (datosAuto.holograma === "0" || datosAuto.holograma === "00") 
                                 ? "Circula diario" : reglas[digito];

            // 4. Prompt Refactorizado (Más estricto con la IA)
            const prompt = `Eres un asistente oficial de trámites vehiculares. El usuario se llama ${nombreUsuario}.
            Sus datos son: Placa ${placa}, Adeudo: ${datosAuto.adeudo_tenencia}, No circula: ${diaNoCircula}.
            
            REGLAS ESTRICTAS DE FORMATO (¡Obligatorias!):
            1. Saluda al usuario por su nombre.
            2. Redacta la respuesta en 3 párrafos cortos separados por dobles saltos de línea.
            3. NO USES ASTERISCOS ni para negritas ni para listas.
            4. Usa emojis (🚗, 💰, 📅).
            5. Sé muy directo y amable.`;

            // 5. Llamada a Groq
            const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: "llama-3.1-8b-instant",
                messages: [{ role: "user", content: prompt }]
            }, {
                headers: { 
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            // 6. Limpieza final de la respuesta
            let textoLimpio = aiRes.data.choices[0].message.content;
            textoLimpio = textoLimpio.replace(/\*\*/g, ""); // Borra todos los asteriscos dobles
            textoLimpio = textoLimpio.replace(/\*/g, "");   // Borra todos los asteriscos simples
            textoLimpio = textoLimpio.replace(/- /g, "• "); // Cambia guiones por viñetas elegantes

            return res.json({
                fulfillmentText: textoLimpio,
                // Refrescamos la memoria con la placa
                outputContexts: [
                    {
                        name: `${req.body.session}/contexts/memoria_usuario`,
                        lifespanCount: 50,
                        parameters: { nombre: nombreUsuario, placa: placa }
                    }
                ]
            });
        }

        // ==========================================
        // INTENT 3: AGENDAR CITA (Escritura en Sheets)
        // ==========================================
        if (intentName === 'agendar_cita') {
            // 1. Extraer datos de la memoria (Nombre y Placa)
            let nombreUsuario = "Ciudadano";
            let placa = "No proporcionada";
            
            const memoria = contextos.find(c => c.name.includes('memoria_usuario'));
            if (memoria && memoria.parameters) {
                if (memoria.parameters.nombre) {
                    if (typeof memoria.parameters.nombre === 'object') {
                        nombreUsuario = memoria.parameters.nombre.name || "Ciudadano";
                    } else {
                        nombreUsuario = memoria.parameters.nombre;
                    }
                }
                placa = memoria.parameters.placa || "No proporcionada";
            }

            // 2. Extraer datos del Intent (Trámite, Fecha y Hora)
            const tramite = parametros.tramite || "General";
            const fechaRaw = parametros.date; // Dialogflow manda la fecha en formato ISO
            const horaRaw = parametros.time;

            // Limpiar fecha y hora para que se vean bien
            const fecha = fechaRaw ? fechaRaw.split('T')[0] : "Sin fecha";
            const hora = horaRaw ? horaRaw.split('T')[1].substring(0, 5) : "Sin hora";

            // 3. Generar ID único y Fecha de Registro automática
            const idCita = "CITA-" + Math.random().toString(36).substr(2, 4).toUpperCase();
            const fechaRegistro = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });

            // 4. Guardar en Google Sheets vía SheetDB
            try {
                await axios.post(`${SHEETDB_URL}?sheet=Agenda_Citas`, {
                    data: [{
                        ID_Cita: idCita,
                        Fecha_Registro: fechaRegistro,
                        Nombre_Usuario: nombreUsuario,
                        Placa_Vehiculo: placa,
                        Tipo_Tramite: tramite,
                        Fecha_Cita: fecha,
                        Hora_Cita: hora,
                        Estatus: "Pendiente"
                    }]
                });

                // 5. Respuesta confirmando la cita
                return res.json({
                    fulfillmentText: `¡Excelente noticia, ${nombreUsuario}! ✅\n\nTu cita ha sido registrada exitosamente en nuestro sistema con el folio ${idCita}.\n\nRESUMEN DE TU CITA:\n🚗 Placa: ${placa}\n📋 Trámite: ${tramite}\n📅 Fecha: ${fecha}\n⏰ Hora: ${hora} hrs\n\nTe hemos enviado una confirmación. ¡Nos vemos pronto! ✨`,
                    outputContexts: [
                        {
                            name: `${req.body.session}/contexts/memoria_usuario`,
                            lifespanCount: 50,
                            parameters: { nombre: nombreUsuario, placa: placa }
                        }
                    ]
                });

            } catch (sheetError) {
                console.error("Error al escribir en Sheets:", sheetError.message);
                return res.json({ fulfillmentText: "Lo siento, tuve un problema al guardar tu cita en la base de datos. 🔌" });
            }
        }

        // ==========================================
        // RESPUESTA POR DEFECTO (FALLBACK)
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
