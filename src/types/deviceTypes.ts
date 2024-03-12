/**
 * Representa la estructura de datos para un dispositivo IoT dentro del sistema.
 * Esta interfaz define los campos clave que identifican a un dispositivo y la información que transmite.
 *
 * @interface
 * @property {string} device_id - Identificador único del dispositivo. Usualmente es asignado por la red o plataforma IoT (por ejemplo, TTN).
 * @property {string} application_id - Identificador de la aplicación a la que pertenece el dispositivo. Permite agrupar dispositivos bajo una misma aplicación lógica.
 * @property {string} dev_eui - Identificador único a nivel de hardware del dispositivo (EUI-64). Proporcionado por el fabricante del dispositivo.
 * @property {string} join_eui - Identificador del servidor de join (EUI-64) utilizado en el proceso de OTAA (Over The Air Activation) para LoRaWAN.
 * @property {string} decoded_payload_bytes - Datos transmitidos por el dispositivo, ya decodificados del formato Base64 a una cadena hexadecimal.
 * @property {any} [data] - Campo opcional que puede contener cualquier dato adicional recibido del dispositivo o procesado durante el manejo del mensaje.
 *
 * Esta interfaz se utiliza para tipificar los datos recibidos y procesados por el sistema, asegurando que todos los componentes manejen correctamente la estructura esperada de los datos de un dispositivo.
 */
export interface DeviceData {
  device_id: string;
  application_id: string;
  dev_eui: string;
  join_eui: string;
  decoded_payload_bytes: string;
  data?: any;  
}
