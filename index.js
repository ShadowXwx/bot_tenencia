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
        const placa = req.body.queryResult.parameters.placa;

        if (intentName === 'ConsultarVehiculo' || intentName === 'consulta_tenencia') {
            
            // 1. Consulta a tu SheetDB
            const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placa}`);
            const datosAuto = sheetRes.data[0];

            if (!datosAuto) {
                return res.json({ fulfillmentText: `No encontré la placa ${placa} en el padrón vehicular.` });
            }

            // 2. Lógica del Hoy No Circula
            const digito = parseInt(datosAuto.ultimo_digito);
            const reglas = {
                5: "Lunes", 6: "Lunes", 7: "Martes", 8: "Martes", 
                3: "Miércoles", 4: "Miércoles", 1: "Jueves", 2: "Jueves", 9: "Viernes", 0: "Viernes"
            };
            
            const diaNoCircula = (datosAuto.holograma === "0" || datosAuto.holograma === "00") 
                                 ? "Circula diario" 
                                 : reglas[digito];

            const prompt = `Actúa como un asistente virtual oficial de trámites vehiculares en México. Un ciudadano pregunta por su auto. Placa: ${placa}. 
                            Adeudo Tenencia: ${datosAuto.adeudo_tenencia}. 
                            Días que no circula: ${diaNoCircula}. 
                            Responde de forma amable, clara, breve y si tiene adeudo indícale que debe regularizarse en el portal oficial de finanzas.`;

            // 3. Consulta a la IA (Corregido para usar GROQ)
            const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: "llama3-8b-8192", // Modelo gratuito de Groq
                messages: [{ role: "user", content: prompt }]
            }, {
                headers: { 
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            return res.json({
                fulfillmentText: aiRes.data.choices[0].message.content
            });
        }

        return res.json({ fulfillmentText: "Aún no tengo configurada la acción para este trámite en mi sistema." });

    } catch (error) {
        if (error.response) {
            console.error("Error de la API:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.error("Error general:", error.message);
        }
        return res.json({ fulfillmentText: "Hubo un problema de conexión con el sistema vehicular. Intenta de nuevo más tarde." });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor vial corriendo en el puerto ${PORT}`);
});
