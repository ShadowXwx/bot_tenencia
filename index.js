const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// Configuración de APIs (Cámbialas por tus llaves reales)
const SHEETDB_URL = "https://sheetdb.io/api/v1/lfpxkwuhzmvmk";
const DEEPSEEK_API_KEY = "sk-c4cff4628b1c4bc5a7b2841078ac023e";

app.post('/webhook', async (req, res) => {
    // Es buena práctica usar un bloque try-catch que envuelva todo el proceso
    try {
        const intentName = req.body.queryResult.intent.displayName;
        const placa = req.body.queryResult.parameters.placa;

        // 3. Asegúrate de que el nombre coincida EXACTAMENTE con tu Dialogflow
        // En tu imagen anterior tenías "consulta_tenencia", "hoy_no_circula", etc.
        if (intentName === 'ConsultarVehiculo' || intentName === 'consulta_tenencia') {
            
            // Consultar SheetDB
            const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placa}`);
            const datosAuto = sheetRes.data[0];

            if (!datosAuto) {
                return res.json({ fulfillmentText: `No encontré la placa ${placa} en el padrón vehicular.` });
            }

            // Lógica del Hoy No Circula
            const digito = parseInt(datosAuto.ultimo_digito);
            const reglas = {
                5: "Lunes", 6: "Lunes", 7: "Martes", 8: "Martes", 
                3: "Miércoles", 4: "Miércoles", 1: "Jueves", 2: "Jueves", 9: "Viernes", 0: "Viernes"
            };
            
            // 4. Mejora lógica: Los hologramas "0" y "00" circulan diario en México
            const diaNoCircula = (datosAuto.holograma === "0" || datosAuto.holograma === "00") 
                                 ? "Circula diario" 
                                 : reglas[digito];

            // 5. Prompting: Dale un poco más de contexto (rol) a DeepSeek
            const prompt = `Actúa como un asistente virtual oficial de trámites vehiculares. Un ciudadano pregunta por su auto. Placa: ${placa}. 
                            Adeudo Tenencia: ${datosAuto.adeudo_tenencia}. 
                            Días que no circula: ${diaNoCircula}. 
                            Responde de forma amable, clara, breve y si tiene adeudo indícale que debe regularizarse en el portal oficial de finanzas.`;

            const aiRes = await axios.post('https://api.deepseek.com/v1/chat/completions', {
                model: "deepseek-chat",
                messages: [{ role: "user", content: prompt }]
            }, {
                headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` }
            });

            // Enviar respuesta a Dialogflow
            return res.json({
                fulfillmentText: aiRes.data.choices[0].message.content
            });
        }

        // Si llega un intent que no está en el if
        return res.json({ fulfillmentText: "Aún no tengo configurada la acción para este trámite en mi sistema." });

    } catch (error) {
        console.error("Error en webhook:", error); // Útil para debugear en la consola del servidor (ej. Render)
        // Evita mostrar el error.message crudo al usuario final por seguridad/UX
        return res.json({ fulfillmentText: "Hubo un problema de conexión con el sistema vehicular. Intenta de nuevo más tarde." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor vial corriendo en puerto ${PORT}`));
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor vial corriendo en puerto ${PORT}`));
