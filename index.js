const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// Configuración de APIs (Cámbialas por tus llaves reales)
const SHEETDB_URL = "https://sheetdb.io/api/v1/lfpxkwuhzmvmk";
const DEEPSEEK_API_KEY = "sk-c4cff4628b1c4bc5a7b2841078ac023e";

app.post('/webhook', async (req, res) => {
    const intentName = req.body.queryResult.intent.displayName;
    const placa = req.body.queryResult.parameters.placa;

    if (intentName === 'ConsultarVehiculo') {
        try {
            // 1. Consultar SheetDB
            const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placa}`);
            const datosAuto = sheetRes.data[0];

            if (!datosAuto) {
                return res.json({ fulfillmentText: `No encontré la placa ${placa} en el sistema.` });
            }

            // 2. Lógica del Hoy No Circula (Reglas que definimos)
            const digito = parseInt(datosAuto.ultimo_digito);
            const reglas = {
                5: "Lunes", 6: "Lunes", 7: "Martes", 8: "Martes", 
                3: "Miércoles", 4: "Miércoles", 1: "Jueves", 2: "Jueves", 9: "Viernes", 0: "Viernes"
            };
            const diaNoCircula = datosAuto.holograma === "0" ? "Circula diario" : reglas[digito];

            // 3. Consultar a DeepSeek para una respuesta creativa
            const prompt = `Un usuario pregunta por su auto. Placa: ${placa}. 
                            Estatus Tenencia: ${datosAuto.adeudo_tenencia}. 
                            No circula los: ${diaNoCircula}. 
                            Responde de forma amable y dile dónde pagar si debe.`;

            const aiRes = await axios.post('https://api.deepseek.com/v1/chat/completions', {
                model: "deepseek-chat",
                messages: [{ role: "user", content: prompt }]
            }, {
                headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` }
            });

            // 4. Enviar respuesta a Dialogflow
            return res.json({
                fulfillmentText: aiRes.data.choices[0].message.content
            });

        } catch (error) {
            return res.json({ fulfillmentText: "Error en el servidor: " + error.message });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor vial corriendo en puerto ${PORT}`));
