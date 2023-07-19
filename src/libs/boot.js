let hoyAhora = new Date();
let diaHoy = hoyAhora.toString().slice(0, 3);
let fullHoraAhora = hoyAhora.toString().slice(16, 21);

module.exports = (app) => {
  //metodo sync que crea las tablas
  app.db.sequelize.sync().then(() => {
    app.listen(app.get("port"), () => {
      console.log("Server on port", app.get("port"));
      console.log("Enviador de Reporte Gerencial iniciado a las:", fullHoraAhora);
    });
  });
};
