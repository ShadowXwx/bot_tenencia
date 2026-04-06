const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// Configuración de APIs (Cámbialas por tus llaves reales)
const SHEETDB_URL = "https://sheetdb.io/api/v1/lfpxkwuhzmvmk";
const DEEPSEEK_API_KEY = "sk-c4cff4628b1c4bc5a7b2841078ac023e";

app.get('/', (req, res) => {
    res.send('Servidor del Bot Vehicular Activo y funcionando ✅');
});

app.post('/webhook', async (req, res) => {
    try {
        const intentName = req.body.queryResult.intent.displayName;
        const placa = req.body.queryResult.parameters.placa;

        if (intentName === 'ConsultarVehiculo' || intentName === 'consulta_tenencia') {
            
            const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placa}`);
            const datosAuto = sheetRes.data[0];

            if (!datosAuto) {
                return res.json({ fulfillmentText: `No encontré la placa ${placa} en el padrón vehicular.` });
            }

            const digito = parseInt(datosAuto.ultimo_digito);
            const reglas = {
                5: "Lunes", 6: "Lunes", 7: "Martes", 8: "Martes", 
                3: "Miércoles", 4: "Miércoles", 1: "Jueves", 2: "Jueves", 9: "Viernes", 0: "Viernes"
            };
            
            const diaNoCircula = (datosAuto.holograma === "0" || datosAuto.holograma === "00") 
                                 ? "Circula diario" 
                                 : reglas[digito];

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

            return res.json({
                fulfillmentText: aiRes.data.choices[0].message.content
            });
        }

        return res.json({ fulfillmentText: "Aún no tengo configurada la acción para este trámite en mi sistema." });

    } catch (error) {
        console.error("Error en webhook:", error); 
        return res.json({ fulfillmentText: "Hubo un problema de conexión con el sistema vehicular. Intenta de nuevo más tarde." });
    }
});

const PORT = process.env.PORT || 3000;

// SOLUCIÓN 2: Binding a '0.0.0.0'
// En local usamos localhost, pero los servidores en la nube requieren escuchar
// en todas las interfaces de red, por eso se añade '0.0.0.0'.
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor vial corriendo en el puerto ${PORT}`);
});
