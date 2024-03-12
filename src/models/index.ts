import sequelize from '../config/config';
import Device from './deviceModel';
//import Sensor from './sensorModel'; // Asumiendo que tienes otro modelo llamado Sensor

// Aquí puedes exportar otros modelos si los tienes
export { 
    Device, 
   // Sensor 
};



export default sequelize;
