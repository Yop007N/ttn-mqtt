# TTN MQTT Gateway 📡

> Sistema de comunicación MQTT para dispositivos IoT con integración a PostgreSQL

## 📋 Descripción

TTN MQTT Gateway es una aplicación Node.js robusta que actúa como puente entre dispositivos IoT y bases de datos, utilizando el protocolo MQTT para comunicación en tiempo real. Diseñado específicamente para trabajar con The Things Network (TTN) y optimizado para manejo de grandes volúmenes de datos de sensores.

## ✨ Características Principales

- **🔌 Conectividad MQTT**: Cliente MQTT optimizado para alta frecuencia de mensajes
- **💾 Persistencia de Datos**: Integración con PostgreSQL usando Sequelize ORM
- **⚡ Procesamiento en Tiempo Real**: Manejo asíncrono de datos de sensores
- **🛡️ Manejo de Errores**: Sistema robusto de gestión de errores y logging
- **🔧 Middleware Personalizable**: Sistema de filtros y validación de datos
- **📊 Monitoreo de Dispositivos**: Seguimiento del estado de dispositivos IoT
- **🌐 API REST**: Endpoints para consulta y gestión de datos

## 🛠️ Stack Tecnológico

### Backend
- **Node.js** - Runtime principal
- **TypeScript** - Tipado estático
- **Express.js** - Framework web
- **MQTT 5.3.5** - Protocolo de comunicación IoT

### Base de Datos
- **PostgreSQL** - Base de datos principal
- **Sequelize ORM** - Mapeo objeto-relacional
- **pg** - Driver PostgreSQL nativo

### Herramientas de Desarrollo
- **Jest** - Framework de testing
- **Nodemon** - Desarrollo en caliente
- **ts-node** - Ejecución directa de TypeScript
- **Azure Pipelines** - CI/CD

## 🚀 Instalación y Configuración

### Prerrequisitos
- Node.js 18+ (LTS recomendado)
- PostgreSQL 13+
- npm o yarn
- Broker MQTT (TTN o Mosquitto)

### Instalación

```bash
# Clonar el repositorio
git clone https://github.com/Yop007N/ttn-mqtt.git
cd ttn-mqtt

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
```

### Configuración de Variables de Entorno

```env
# Base de Datos PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=ttn_mqtt_db
DB_USERNAME=your_db_user
DB_PASSWORD=your_db_password

# Configuración MQTT
MQTT_BROKER_URL=mqtt://broker.url
MQTT_CLIENT_ID=ttn-gateway-client
MQTT_USERNAME=your_mqtt_user
MQTT_PASSWORD=your_mqtt_password

# The Things Network
TTN_APPLICATION_ID=your_ttn_app_id
TTN_ACCESS_KEY=your_ttn_access_key

# Servidor
PORT=3000
NODE_ENV=development
```

## 📖 Scripts Disponibles

```bash
# Desarrollo
npm run dev           # Ejecuta con nodemon y ts-node

# Construcción
npm run prebuild      # Limpia el directorio dist
npm run build         # Compila TypeScript a JavaScript

# Producción
npm start             # Ejecuta la aplicación compilada

# Testing
npm test              # Ejecuta los tests con Jest
```

## 🏗️ Estructura del Proyecto

```
src/
├── config/                 # Configuraciones de la aplicación
│   ├── database.ts         # Configuración de PostgreSQL
│   └── mqtt.ts             # Configuración del cliente MQTT
├── controllers/            # Controladores de la API
│   ├── deviceController.ts # Gestión de dispositivos
│   └── errorHandler.ts     # Manejo centralizado de errores
├── middleware/             # Middlewares personalizados
│   └── deviceMiddleware.ts # Validación y filtrado de datos
├── models/                 # Modelos de base de datos
│   ├── Device.ts           # Modelo de dispositivos
│   ├── SensorData.ts       # Modelo de datos de sensores
│   └── index.ts            # Configuración de Sequelize
├── services/               # Servicios de negocio
│   ├── mqttService.ts      # Lógica de MQTT
│   └── dataProcessor.ts    # Procesamiento de datos
├── types/                  # Definiciones de tipos TypeScript
│   └── mqtt.types.ts       # Tipos para mensajes MQTT
├── utils/                  # Utilidades y helpers
│   ├── logger.ts           # Sistema de logging
│   └── validators.ts       # Validadores de datos
└── app.ts                  # Punto de entrada de la aplicación
```

## 📡 Funcionalidades MQTT

### Conexión y Suscripciones

```typescript
// Suscripción a topics de TTN
const topics = [
  'v3/+/devices/+/up',        // Mensajes uplink
  'v3/+/devices/+/down/sent', // Confirmación downlink
  'v3/+/devices/+/join',      // Eventos de join
];

// Manejo de mensajes
client.on('message', (topic, payload) => {
  const data = JSON.parse(payload.toString());
  await processDeviceData(data);
});
```

### Procesamiento de Datos

- **Validación**: Verificación de estructura y tipos de datos
- **Transformación**: Conversión de formatos y unidades
- **Persistencia**: Almacenamiento en PostgreSQL
- **Notificaciones**: Alertas para eventos críticos

## 🗄️ Modelos de Base de Datos

### Dispositivos

```typescript
interface Device {
  id: string;
  name: string;
  devEui: string;
  applicationId: string;
  lastSeen: Date;
  isActive: boolean;
  metadata: JSON;
}
```

### Datos de Sensores

```typescript
interface SensorData {
  id: number;
  deviceId: string;
  timestamp: Date;
  payload: JSON;
  rssi: number;
  snr: number;
  frequency: number;
  dataRate: string;
}
```

## 🌐 API Endpoints

### Dispositivos

```http
GET    /api/devices              # Listar todos los dispositivos
GET    /api/devices/:id          # Obtener dispositivo específico
POST   /api/devices              # Registrar nuevo dispositivo
PUT    /api/devices/:id          # Actualizar dispositivo
DELETE /api/devices/:id          # Eliminar dispositivo
```

### Datos de Sensores

```http
GET    /api/data                 # Obtener datos de sensores
GET    /api/data/device/:id      # Datos por dispositivo
GET    /api/data/range           # Datos por rango de fechas
POST   /api/data/query           # Consulta personalizada
```

### Estadísticas

```http
GET    /api/stats/devices        # Estadísticas de dispositivos
GET    /api/stats/data           # Estadísticas de datos
GET    /api/health               # Estado del sistema
```

## 🔧 Configuración Avanzada

### Cliente MQTT Personalizado

```typescript
const mqttOptions = {
  clientId: `ttn-gateway-${Math.random().toString(16)}`,
  keepalive: 60,
  reconnectPeriod: 5000,
  connectTimeout: 30000,
  will: {
    topic: 'ttn-gateway/status',
    payload: 'offline',
    qos: 1,
    retain: true
  }
};
```

### Configuración de Base de Datos

```typescript
const sequelizeConfig = {
  dialect: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  database: process.env.DB_DATABASE,
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  pool: {
    max: 20,
    min: 5,
    acquire: 60000,
    idle: 10000
  }
};
```

## 🧪 Testing

```bash
# Ejecutar todos los tests
npm test

# Tests con cobertura
npm run test:coverage

# Tests en modo watch
npm run test:watch
```

### Ejemplo de Test

```typescript
describe('MQTT Service', () => {
  test('should process TTN message correctly', async () => {
    const mockPayload = {
      end_device_ids: { device_id: 'test-device' },
      uplink_message: {
        decoded_payload: { temperature: 25.5 }
      }
    };

    const result = await processMessage(mockPayload);
    expect(result.success).toBe(true);
  });
});
```

## 🚀 Despliegue

### Docker

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist
EXPOSE 3000

CMD ["npm", "start"]
```

### Docker Compose

```yaml
version: '3.8'
services:
  ttn-mqtt:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    depends_on:
      - postgres

  postgres:
    image: postgres:13
    environment:
      POSTGRES_DB: ttn_mqtt_db
      POSTGRES_USER: ttn_user
      POSTGRES_PASSWORD: ttn_password
```

## 📊 Monitoreo y Logging

- **Winston Logger** - Sistema de logs estructurado
- **Health Checks** - Verificación de estado de servicios
- **Metrics** - Métricas de rendimiento y uso
- **Alertas** - Notificaciones automáticas por eventos críticos

## 🤝 Contribución

1. Fork el proyecto
2. Crea tu branch (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push al branch (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📝 Licencia

Este proyecto está bajo la Licencia ISC. Ver `LICENSE` para más detalles.

## 👨‍💻 Autor

**Enrique Bobadilla (Yop007N)**
- GitHub: [@Yop007N](https://github.com/Yop007N)
- Especialización: IoT y Comunicaciones MQTT

## 🔗 Enlaces Relacionados

- [The Things Network](https://www.thethingsnetwork.org/)
- [MQTT Protocol](https://mqtt.org/)
- [Node.js MQTT Client](https://github.com/mqttjs/MQTT.js)
- [Sequelize ORM](https://sequelize.org/)

---

📡 Conectando el mundo IoT, un mensaje a la vez