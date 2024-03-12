---
###🌐 Proyecto MQTT con Node.js y PostgreSQL

###📖 Descripción

Este proyecto 🚀 es un servidor en Node.js que se conecta a un broker MQTT 
y utiliza PostgreSQL para la gestión de datos. Diseñado específicamente para 
interactuar con dispositivos IoT 📡, facilita la recepción y procesión de datos 
a través del protocolo MQTT.

###📋 Requisitos Previos

Para sumergirte en este proyecto, necesitarás:
- Node.js (última versión LTS 🌟 recomendada)
- npm (incluido con Node.js)
- PostgreSQL (última versión estable 🏁)


###🛠 Instalación

📦 Clonar el Repositorio
Obtén el código fuente clonando este repositorio:
 ```bash
        git clone -b integracion-ttn-node-mqtt https://PTI-PY@dev.azure.com/PTI-PY/DT.723%20-%20Dev/_git/DT.723%20-%20Dev 
   ```
### 📚 Instalar Dependencias
Dentro del directorio del proyecto, ejecuta:
```bash
npm install
```

### ⚙ Configuración del Proyecto
### 🗄 Base de Datos
Ajusta las variables de entorno para PostgreSQL en `.env`:
```plaintext
DB_DATABASE=tu_base_de_datos
DB_USERNAME=tu_usuario_de_postgres
DB_PASSWORD=tu_contraseña
DB_HOST=****
DB_PORT=****
```
---

### 🚀 Estructura del Proyecto - Un Viaje por el Código

Adéntrate en la arquitectura de nuestro proyecto MQTT, diseñada meticulosamente para una navegación intuitiva y un mantenimiento sin esfuerzos. 
Aquí está el mapa 🗺️:

```  
/mi-proyecto-mqtt
  /src
    /config                   🛠️ - Donde la magia de la configuración comienza.
    /controllers              👮 - Los guardianes que dirigen el tráfico de datos.
      - deviceController.ts
      - errorHandler.ts
    /middleware               🚧 - Los filtros por donde todo debe pasar.
      - deviceMiddleware.ts
    /models                   📦 - Los moldes de nuestros datos.
      - deviceModel.ts
      - index.ts
    /mqtt                     📡 - Nuestro canal de comunicación con el mundo IoT.
      - mqttClient.ts
    /routes                   🚏 - Caminos definidos para explorar nuestro proyecto.
      - deviceRoutes.ts
    /services                 🛎️ - Servicios esenciales que cumplen las solicitudes.
      - deviceServices.ts
    /types                    📄 - Definiciones de tipos para TypeScript.
      - deviceTypes.ts
    /utils                    🔧 - Herramientas que hacen la vida más fácil.
      - calculatorTests.ts
      - logger.ts
    - app.ts                  🌟 - El corazón pulsante de nuestra aplicación.
  .env                        🗝️ - Secretos bien guardados.
  .gitignore                  🙈 - Lo que preferimos mantener en las sombras.
  package.json                📋 - Nuestro manifiesto y lista de invitados.
  package-lock.json           🔒 - Manteniendo firmes nuestras dependencias.
  README.md                   📖 - La guía para navegantes y curiosos.
  tsconfig.json               🏗️ - El esqueleto de nuestro proyecto TypeScript.
```
---

### 🚀 Ejecución
### 🔧 Desarrollo
Inicia el servidor en modo de desarrollo con:
```bash
npm run dev
```
Conectándose automáticamente al broker MQTT y a PostgreSQL.

### 📚 Base de Datos
### 🏗 Creación de Tablas
Script SQL para crear las tablas necesarias:
```sql
CREATE TABLE IF NOT EXISTS device_payloads (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(255) NOT NULL,
    application_id VARCHAR(255) NOT NULL,
    dev_eui VARCHAR(255) NOT NULL,
    join_eui VARCHAR(255) NOT NULL,
    decoded_payload_bytes VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```
### 📄 Documentación del Código
Encuentra comentarios detallados en el código para una comprensión profunda de cada componente.
# 🌐 Descripción General

Este proyecto 🛠 es una aplicación de servidor desarrollada utilizando Node.js y TypeScript, que facilita la integración de dispositivos LoRaWAN 📡 con la red The Things Network (TTN) y almacena la información recibida en una base de datos PostgreSQL. Está diseñado para manejar eficientemente la comunicación entre dispositivos IoT y aplicaciones de servidor mediante el uso del protocolo MQTT, proporcionando un flujo de datos en tiempo real para aplicaciones de monitoreo y análisis.

### 📂 Estructura del Proyecto

El proyecto se estructura en varios módulos para mantener una arquitectura limpia y escalable:

- `app.ts`:       Punto de entrada 🚪 del servidor que inicia el middleware y las rutas.
- `/config`:      Contiene la configuración de la base de datos y variables de entorno.
- `/controllers`: Alberga los controladores que gestionan las solicitudes y respuestas HTTP.
- `/middleware`:  Define funciones middleware para el manejo de errores y validación de datos.
- `/models`:      Define los modelos de Sequelize que representan y gestionan los datos de la aplicación.
- `/mqtt`:        Incluye la configuración y gestión del cliente MQTT.
- `/routes`:      Contiene las rutas HTTP que definen la interfaz de la API.
- `/services`:    Implementa la lógica de negocio y la interacción con la base de datos.
- `/types`:       Define las interfaces TypeScript para tipos de datos consistentes en el proyecto.
- `/utils`:       Proporciona herramientas y funciones auxiliares para todo el proyecto.

# 🧩 Módulos

### `app.ts`
Este módulo 📄 inicia el servidor Express, configura middleware global y rutas, y conecta con la base de datos, actuando como el director de orquesta del proyecto.

### `/config`
Establece la conexión con la base de datos y centraliza las configuraciones globales 🌐 que se utilizan en toda la aplicación.

### `/controllers`
Manejan las solicitudes que llegan al servidor y delegan la ejecución de la lógica de negocio a los servicios, formatean las respuestas y manejan las excepciones. Los controladores son el punto de conexión entre el servidor Express y los servicios que interactúan con la base de datos.

### `/middleware`
Proporciona funciones de middleware que se ejecutan entre la solicitud HTTP y los controladores. Esto incluye la captura de errores, la validación de datos de entrada y la autenticación de usuarios.

### `/models`
Define la estructura de la base de datos utilizando el ORM Sequelize. Cada modelo representa una tabla en la base de datos y las relaciones entre ellas, proporcionando métodos para consultar y manipular los datos.

### `/mqtt`
Gestiona la conexión y la lógica asociada al cliente MQTT. Se encarga de suscribirse a los topics correspondientes y procesar los mensajes entrantes, desencadenando acciones en la base de datos o servicios según sea necesario.

### `/routes`
Organiza y expone los endpoints de la API. Cada ruta se asocia con un controlador que manejará la lógica de la petición.

### `/services`
Contiene la lógica de negocio central del proyecto. Los servicios se comunican con los modelos para realizar consultas a la base de datos y procesar los datos según las reglas de negocio.

### `/types`
Aloja definiciones de tipos TypeScript para garantizar que los datos mantengan su integridad a lo largo de la aplicación. Los tipos definen la forma de los objetos que se pasan entre funciones, ayudando a prevenir errores en tiempo de compilación.

### `/utils`
Ofrece funciones de utilidad como `logger` para registrar mensajes en la consola y posiblemente en archivos de log, y otras herramientas que pueden ser reutilizadas en diferentes partes del proyecto.

# ⚙️ Flujo de Trabajo
1. Inicio del servidor con `node` o `nodemon` ejecutando `app.ts`.
2. Conexión a la base de datos y configuración del cliente MQTT.
3. Recepción de solicitudes HTTP y enrutamiento a los controladores correspondientes.
4. Procesamiento de mensajes MQTT y ejecución de la lógica de negocios en los servicios correspondientes.
5. Los servicios interactúan con la base de datos a través de los modelos para almacenar o recuperar datos.
6. Respuestas formateadas y enviadas de vuelta al cliente o, en caso de errores, manejo de excepciones y proporcionamiento de mensajes de error descriptivos.
7. Monitoreo continuo de la conexión MQTT para recibir y procesar datos entrantes de dispositivos LoRaWAN.

# 🖥 Instalación y Ejecución
Para poner en marcha este proyecto, asegúrate de tener Node.js instalado y sigue estos pasos:

1. Clona el repositorio o descarga el código fuente.
2. Navega al directorio del proyecto.
3. Ejecuta `npm install` para instalar las dependencias.
4. Crea un archivo `.env` en la raíz del proyecto para definir las variables de entorno necesarias.
5. Ejecuta `npm run build` para compilar TypeScript a JavaScript.
6. Inicia el servidor con `npm start` o `npm run dev` para el desarrollo con recarga automática.

# 📦 Dependencias
- Node.js y npm
- Express: framework de servidor
- Sequelize: ORM para PostgreSQL
- MQTT: cliente para la comunicación con MQTT broker
- Dotenv: para manejar variables de entorno
- Tipos de TypeScript: para definiciones de tipos y aserciones

Las dependencias exactas y sus versiones están detalladas en el archivo `package.json`.

# 📝 Documentación con Typedoc
Para generar la documentación del proyecto con Typedoc:

1. Instala Typedoc globalmente con `npm install -g typedoc` o como dependencia de desarrollo.
2. Asegúrate de tener comentarios adecuados en tu código TypeScript, utilizando el formato JSDoc.
3. Ejecuta `typedoc --out docs src` para generar la documentación en la carpeta `docs`.
4. La documentación se puede visualizar abriendo los archivos HTML generados en un navegador web.

Typedoc es una herramienta poderosa que mejora la comprensibilidad del código y facilita el mantenimiento y la colaboración en proyectos TypeScript.
---
