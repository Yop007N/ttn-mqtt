// app.ts
import express from "express";
import deviceRoutes from "./routes/deviceRoutes";
import { errorHandler } from "./middleware/errorHandler";
import { logger } from "./utils/logger";
import { initializeMqttClient } from "./mqtt/mqttClient"; // Nuevo archivo para la lógica MQTT
import db from "./models/index";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use("/api", deviceRoutes);
app.use(errorHandler); // Middleware de manejo de errores para toda la aplicación

initializeMqttClient(); // Inicializar el cliente MQTT y suscripciones

// Inicio del servidor
app.listen(PORT, () =>

  logger.info(`Server is running on http://localhost:${PORT}/api/devices`)

);

// Conexión a la base de datos
db.authenticate()
  .then(() => logger.info('Connection to the database has been established successfully.'))
  .catch((err) => {
    // Convertimos el error a string y lo concatenamos con el mensaje.
    logger.error(`Unable to connect to the database: ${err}`);
  });