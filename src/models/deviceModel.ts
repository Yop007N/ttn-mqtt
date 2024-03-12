import { Model, DataTypes } from 'sequelize';
import sequelize from '../config/config';

/**
 * Clase Device que representa un registro de dispositivo en la base de datos.
 * Extiende Model de Sequelize, permitiendo interactuar con la tabla de dispositivos.
 */

export class Device extends Model {

// Descripciones de las propiedades del modelo Device
public id!: number; // Identificador único del dispositivo

public device_id!: string; // Identificador del dispositivo asignado por el usuario

public application_id!: string; // Identificador de la aplicación a la que pertenece el dispositivo

public dev_eui!: string; // Identificador único del dispositivo (EUI) proporcionado por el fabricante

public join_eui!: string; // Identificador de la entidad de unión (EUI) para la autenticación del dispositivo

public decoded_payload_bytes!: string; // Datos decodificados del payload recibido del dispositivo, en formato hexadecimal

public created_at!: Date; // Fecha y hora de creación del registro del dispositivo

public updated_at!: Date; // Fecha y hora de la última actualización del registro del dispositivo

}
    // Inicializa el modelo con sus campos y opciones

Device.init({
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    device_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
    },
    application_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
    },
    dev_eui: {
        type: DataTypes.STRING(255),
        allowNull: false,
    },
    join_eui: {
        type: DataTypes.STRING(255),
        allowNull: false,
    },
    //Obtiene el valor de 'decoded_payload_bytes' como una cadena hexadecimal o null si no hay valor.
    
    decoded_payload_bytes: {
        type: DataTypes.STRING(255),
        allowNull: false,
        get() {
          // Esta función getter asegurará que siempre se maneje el valor como una cadena hexadecimal
          const value = this.getDataValue('decoded_payload_bytes');
          // Suponiendo que value es un Buffer, lo convertimos a hexadecimal
          return value ? value.toString('hex') : null;
        }
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
    },
    updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
    },
}, {
    tableName: 'device_payloads',
    sequelize,
    timestamps: true,
    underscored: true,
});

export default Device;
