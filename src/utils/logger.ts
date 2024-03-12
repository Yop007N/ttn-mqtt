// Un simple utilitario de logging que puedes expandir según sea necesario.

export const logger = {
    info: (message: string) => {
      console.log(message);
    },
    error: (message: string | Error) => {
      console.error(message);
    },
    //  más métodos de logging como `warn`, `debug`, etc., si los necesitas.
  };
  