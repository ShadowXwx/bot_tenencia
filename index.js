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
        
        if (intentName === 'ConsultarVehiculo' || intentName === 'consulta_tenencia') {
            
            // 1. EXTRAER MEMORIA (Buscar el contexto 'memoria_usuario')
            let nombreUsuario = "Ciudadano"; // Valor por defecto por si no nos dio su nombre
            let placa = parametros.placa;
            
            const contextos = req.body.queryResult.outputContexts || [];
            const memoria = contextos.find(c => c.name.includes('memoria_usuario'));
            
            if (memoria && memoria.parameters) {
                // Si el usuario nos dio su nombre antes, lo sacamos de la memoria
                if (memoria.parameters.nombre) {
                    nombreUsuario = memoria.parameters.nombre;
                }
                // Si la placa venía vacía en este turno, pero está en la memoria, la rescatamos
                if (!placa && memoria.parameters.placa) {
                    placa = memoria.parameters.placa;
                }
            }

            // Si a pesar de revisar la memoria seguimos sin placa, la pedimos
            if (!placa) {
                return res.json({ fulfillmentText: `${nombreUsuario}, ¿me podrías proporcionar tu número de placa? 🚗` });
            }

            // 2. Consultar a SheetDB
            const sheetRes = await axios.get(`${SHEETDB_URL}/search?placa=${placa}`);
            const datosAuto = sheetRes.data[0];

            if (!datosAuto) {
                return res.json({ fulfillmentText: `Lo siento ${nombreUsuario}, no encontré la placa ${placa} en el padrón vehicular. 🔎` });
            }

            // 3. Lógica del Hoy No Circula
            const digito = parseInt(datosAuto.ultimo_digito);
            const reglas = {
                5: "Lunes", 6: "Lunes", 7: "Martes", 8: "Martes", 
                3: "Miércoles", 4: "Miércoles", 1: "Jueves", 2: "Jueves", 9: "Viernes", 0: "Viernes"
            };
            const diaNoCircula = (datosAuto.holograma === "0" || datosAuto.holograma === "00") 
                                 ? "Circula diario" : reglas[digito];

            // 4. Prompt mejorado con Emojis, Formato y Nombre del Usuario
            const prompt = `Actúa como un asistente virtual oficial de trámites vehiculares en México. 
                            El usuario se llama: ${nombreUsuario}. ¡Salúdalo por su nombre!

                            Datos del vehículo:
                            - Placa: ${placa}
                            - Adeudo Tenencia: ${datosAuto.adeudo_tenencia}
                            - Días que no circula: ${diaNoCircula}

                            REGLAS ESTRICTAS DE FORMATO:
                            1. Usa saltos de línea (párrafos separados) para que la lectura sea limpia y no se vea amontonado.
                            2. Usa una lista con viñetas para mostrar los datos del vehículo.
                            3. Incluye emojis amigables y profesionales (🚗, 📅, 💰, ✅, ⚠️).
                            4. Si tiene adeudo, indícale que debe regularizarse en el portal de finanzas.
                            5. Sé amable y servicial.`;

            // 5. Consulta a Groq
            const aiRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: "llama-3.1-8b-instant",
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

        return res.json({ fulfillmentText: "Aún no tengo configurada la acción para este trámite en mi sistema. ⚙️" });

    } catch (error) {
        console.error("Error general:", error.message);
        return res.json({ fulfillmentText: "Hubo un problema de conexión con el sistema vehicular. Intenta de nuevo más tarde. 🔌" });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor vial corriendo en el puerto ${PORT}`);
});
